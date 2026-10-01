/**
 * Bölüm kapaklarını **gerçek bölüm görselleriyle** doldurur ve
 * `src/data/episode-thumbs.json` dosyasına yazar.
 *
 * NEDEN BU KAYNAK: panelde bölüme yalnızca embed adresi giriliyor; embed
 * sağlayıcıları (megaplay, vidlink, videasy) bölüm kapağı YAYINLAMIYOR. Var olan
 * `episode-posters.json` zinciri de yalnızca VidMoly linklerinden türetme
 * yapabildiği için sağlayıcı embed'li bölümlerde boş kalıyordu.
 *
 * api.ani.zip (TVDB + AniDB + AniList birleşik eşleme servisi) MAL kimliğiyle
 * bölüm bölüm `image` (gerçek bölüm kapağı), `title` ve `runtime` döndürüyor.
 * Ölçüm (25.09.2026): MAL 40748 → 46 bölüm, her birinde `image` var; görseller
 * `artworks.thetvdb.com` üzerinden referer'sız HTTP 200 + `image/jpeg` (hotlink
 * serbest, `<img>` ile doğrudan kullanılabilir).
 *
 * ÖNEMLİ: Bu, videodan alınmış bir KARE DEĞİLDİR. Gerçek kare ancak videoyu
 * kendimiz barındırırsak (R2 + kendi oynatıcı) üretilebilir; cross-origin
 * iframe'in içindeki videoya erişilemez. Amaç, kırık/boş kapak yerine bölüme
 * ait GERÇEK bir görsel göstermek.
 *
 * Kullanım:
 *   node scripts/sync-anizip-covers.mjs            # eksik olanları ekler
 *   node scripts/sync-anizip-covers.mjs --force    # hepsini yeniden çeker
 *
 * Yeni seri ekledikten sonra (mal_id doldurulmuş olmalı) bir kez çalıştır.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(root, "src/data/episode-thumbs.json");
/**
 * MAL → TMDB kimlik eşlemesi. TMDB tabanlı embed sağlayıcıları (vidsrc.to)
 * `https://vidsrc.to/embed/tv/{tmdb}/{sezon}/{bölüm}` biçimini kullanır; MAL
 * kimliği bu şablonlarda işe yaramaz. Aynı ani.zip yanıtından üretilir.
 */
const TMDB_OUT = resolve(root, "src/data/mal-tmdb.json");
const FORCE = process.argv.includes("--force");

/** .env içinden Supabase bağlantısını okur (bağımlılık eklememek için elle). */
function readEnv() {
  const env = { ...process.env };
  for (const name of [".env", ".env.local"]) {
    try {
      for (const line of readFileSync(resolve(root, name), "utf8").split("\n")) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
        if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {
      /* dosya yoksa geç */
    }
  }
  return env;
}

const env = readEnv();
const SUPA_URL = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
const SUPA_KEY =
  env.SUPABASE_PUBLISHABLE_KEY ??
  env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  env.SUPABASE_ANON_KEY ??
  env.VITE_SUPABASE_ANON_KEY;

if (!SUPA_URL || !SUPA_KEY) {
  console.error("Supabase adresi/anahtarı .env içinde bulunamadı.");
  process.exit(1);
}

/** PostgREST okuması. Yeni `sb_publishable_` anahtarları JWT değil → yalnızca apikey. */
async function supabase(path) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPA_KEY, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** MAL kimliği olan serileri çeker. `id` bölüm eşleşmesi için gerekli. */
async function fetchShows() {
  const rows = await supabase("shows?select=id,slug,title,mal_id&mal_id=not.is.null");
  return rows.filter((row) => Number.isFinite(Number(row.mal_id)));
}

/**
 * Veritabanındaki bütün bölümleri `show_id → Set("s1e1", …)` olarak döndürür.
 *
 * NEDEN GEREKLİ: eskiden bir seri "en az bir kapağı VARSA" tamamen atlanıyordu.
 * Bu yüzden SONRADAN EKLENEN bölümler sonsuza dek kapaksız kalıyordu (kullanıcı
 * bildirimi, 30.09.2026: "yeni anime eklesem de bölüm eklesem de hep kapak
 * çeksin"). Artık atlama kararı "veritabanındaki bölümlerin TAMAMI kapsanıyor
 * mu?" sorusuna bakar; tek bir bölüm bile eksikse seri yeniden çekilir.
 */
async function fetchEpisodeKeys() {
  const rows = await supabase("show_episodes?select=show_id,season,number&limit=5000");
  const byShow = new Map();
  for (const row of rows) {
    if (!byShow.has(row.show_id)) byShow.set(row.show_id, new Set());
    byShow.get(row.show_id).add(`s${row.season}e${row.number}`);
  }
  return byShow;
}

/**
 * Bütün SEZON MAL kimliklerini döndürür (`show_seasons.mal_id`).
 *
 * NEDEN GEREKLİ: MAL'de her sezon AYRI bir anime kaydıdır (Jujutsu Kaisen S2
 * gibi). SERİ kimliğiyle çekilen tablo o sezonları KAPSAMAZ — ör. 40748 yalnızca
 * 1. sezonun 24 bölümünü içerir. Sezonların kendi kimlikleri de ayrı ayrı
 * çekilmezse `anizipCoverForSeason` boş döner ve o sezon kapaksız kalır.
 */
async function fetchSeasonMalIds() {
  const rows = await supabase("show_seasons?select=mal_id&mal_id=not.is.null&limit=500");
  const fromDb = rows
    .map((row) => Number(row.mal_id))
    .filter((value) => Number.isFinite(value) && value > 0);
  // OTOMATİK ÇÖZÜLEN KİMLİKLER: `resolve-season-mal-ids.mjs` bunları AniList'in
  // PREQUEL/SEQUEL zincirinden bulup `season-mal-ids.json`a yazar. Panelde kimlik
  // girilmemiş sezonların (ör. Jujutsu Kaisen S2/S3) kapakları da böyle çekilir.
  let fromResolved = [];
  const resolvedFile = resolve(root, "src/data/season-mal-ids.json");
  if (existsSync(resolvedFile)) {
    const resolved = JSON.parse(readFileSync(resolvedFile, "utf8"));
    fromResolved = Object.values(resolved).flatMap((seasons) => Object.values(seasons));
  }
  /**
   * TAM SEZON ZİNCİRLERİ — BÖLÜNMÜŞ SEZONLARIN KARDEŞ KAYITLARI.
   *
   * NEDEN GEREKLİ (ölçüm 30.09.2026): bazı sezonlar MAL'de İKİ kayda bölünür ve
   * `season-mal-ids.json` yalnızca VERİTABANINDAKİ sezonun kimliğini tutar (ör.
   * re-zero S2 = 42203). Kardeş kayıt (39587 = bölüm 1-13) orada bulunmaz; bu
   * yüzden TVDB görselleri onun için HİÇ çekilmiyordu ve `anizipCoverFromChain`
   * işe yaramıyordu (`thumbs["39587"]` yok → bölüm 1-13 kapaksız).
   */
  let fromChains = [];
  const chainsFile = resolve(root, "src/data/season-chains.json");
  if (existsSync(chainsFile)) {
    const chains = JSON.parse(readFileSync(chainsFile, "utf8"));
    fromChains = Object.values(chains).flatMap((ids) => (Array.isArray(ids) ? ids : []));
  }
  return [...new Set([...fromDb, ...fromResolved, ...fromChains])];
}

/**
 * ani.zip eşlemesini çekip bölüm kapağı tablosuna çevirir.
 *
 * İki anahtar biçimi yazılır:
 *   `s<sezon>e<bölüm>` → sezon+bölüm birebir eşleşmesi (tercih edilen)
 *   `abs<bölüm>`       → mutlak bölüm numarası (sezon bilgisi tutmayan seriler için)
 */
async function fetchAnizip(malId) {
  const res = await fetch(`https://api.ani.zip/mappings?mal_id=${malId}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`ani.zip ${res.status}`);
  const json = await res.json();
  const table = {};
  for (const ep of Object.values(json.episodes ?? {})) {
    const image = typeof ep.image === "string" ? ep.image : "";
    if (!image) continue;
    const season = Number(ep.seasonNumber);
    const number = Number(ep.episodeNumber);
    const absolute = Number(ep.absoluteEpisodeNumber);
    if (Number.isFinite(season) && Number.isFinite(number)) table[`s${season}e${number}`] = image;
    if (Number.isFinite(absolute)) table[`abs${absolute}`] = image;
  }
  // Aynı yanıt TMDB kimliğini de taşır — vidsrc.to gibi TMDB tabanlı
  // sağlayıcılar için ayrı bir istek gerekmez.
  const tmdb = Number(json.mappings?.themoviedb_id);
  return { table, tmdb: Number.isFinite(tmdb) && tmdb > 0 ? String(tmdb) : "" };
}

function loadJson(path) {
  if (FORCE || !existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

const existing = loadJson(OUT);
const tmdbMap = loadJson(TMDB_OUT);

const shows = await fetchShows();
const episodeKeys = await fetchEpisodeKeys();
console.log(`Supabase: ${shows.length} seri (mal_id dolu).`);

let added = 0;
let refreshed = 0;
let skipped = 0;
let failed = 0;
let tmdbAdded = 0;

for (const show of shows) {
  const key = String(show.mal_id);
  const hasTmdb = Boolean(tmdbMap[key]);
  const table = existing[key] ?? {};
  // Veritabanında OLUP bu tabloda karşılığı olmayan bölüm sayısı.
  const needed = episodeKeys.get(show.id) ?? new Set();
  const missing = [...needed].filter((k) => !table[k]).length;
  // Tek istek hem kapakları hem TMDB kimliğini getirir. Seri ancak TMDB'si
  // varsa VE veritabanındaki bütün bölümleri kapsıyorsa atlanır.
  if (hasTmdb && missing === 0) {
    skipped += 1;
    continue;
  }
  try {
    const { table: fresh, tmdb } = await fetchAnizip(key);
    if (tmdb && !hasTmdb) {
      tmdbMap[key] = tmdb;
      tmdbAdded += 1;
    }
    const count = Object.keys(fresh).length;
    if (count === 0) {
      console.warn(`  ! ${show.slug} (MAL ${key}) → kapak bulunamadı`);
      failed += 1;
    } else {
      // BİRLEŞTİR, üzerine YAZMA: eski kayıtlar ve `abs` anahtarları korunur.
      existing[key] = { ...table, ...fresh };
      if (Object.keys(table).length === 0) {
        added += 1;
        console.log(`  + ${show.slug} (MAL ${key}) → ${count} kapak, TMDB ${tmdb || "yok"}`);
      } else {
        refreshed += 1;
        console.log(
          `  ~ ${show.slug} (MAL ${key}) → ${count} kapak tazelendi (${missing} bölüm eksikti)`,
        );
      }
    }
    // ani.zip'i yormamak için kısa bekleme.
    await new Promise((r) => setTimeout(r, 400));
  } catch (err) {
    failed += 1;
    console.warn(`  ! ${show.slug} (MAL ${key}) → ${err.message}`);
  }
}

// ── İKİNCİ GEÇİŞ: SEZON MAL KİMLİKLERİ ───────────────────────────────────────
// Tablo anahtarı MAL kimliğidir. Seri kimliği yalnızca KENDİ sezonunu kapsar;
// sonraki sezonlar MAL'de ayrı kayıt olduğu için (ör. Jujutsu Kaisen S2) burada
// ayrıca çekilir. Bu geçiş olmadan `anizipCoverForSeason` her zaman boş döner.
const seasonMals = await fetchSeasonMalIds();
let seasonAdded = 0;
for (const malId of seasonMals) {
  const key = String(malId);
  if (existing[key] && Object.keys(existing[key]).length > 0) continue;
  try {
    const { table: fresh, tmdb } = await fetchAnizip(key);
    if (tmdb && !tmdbMap[key]) tmdbMap[key] = tmdb;
    const count = Object.keys(fresh).length;
    if (count === 0) {
      console.warn(`  ! sezon kaydı MAL ${key} → kapak bulunamadı`);
    } else {
      existing[key] = { ...(existing[key] ?? {}), ...fresh };
      seasonAdded += 1;
      console.log(`  + sezon kaydı MAL ${key} → ${count} kapak`);
    }
    await new Promise((r) => setTimeout(r, 400));
  } catch (err) {
    console.warn(`  ! sezon kaydı MAL ${key} → ${err.message}`);
  }
}

// YAZMA, İKİ GEÇİŞİN DE SONUNDA YAPILIR. (Önceden birinci geçişten hemen sonra
// yazılıyordu; sezon kayıtları bellekte kalıyor ve dosyaya HİÇ girmiyordu —
// "13 kayıt" denip dosyada 9 kayıt görünmesinin sebebi buydu.)
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
writeFileSync(TMDB_OUT, `${JSON.stringify(tmdbMap, null, 2)}\n`, "utf8");

console.log(
  `\nYazıldı: ${OUT}\n  seri: ${Object.keys(existing).length}` +
    ` (yeni ${added}, tazelenen ${refreshed}, atlanan ${skipped}, hata ${failed}, sezon kaydı ${seasonAdded})` +
    `\nYazıldı: ${TMDB_OUT}\n  TMDB eşlemesi: ${Object.keys(tmdbMap).length} (yeni ${tmdbAdded})`,
);

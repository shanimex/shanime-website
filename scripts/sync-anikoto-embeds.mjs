/**
 * Anikoto API'sinden bölüm başına HAZIR embed adreslerini çeker ve
 * `src/data/episode-embeds.json` dosyasına yazar.
 *
 * NEDEN: aynı sağlayıcıyı (megaplay) kullanıyoruz ama `s-2` yolu **daha iyi
 * sunucuyu** veriyor. Anikoto'nun oynatıcısında kalite menüsü 1080p'ye kadar
 * çıkıyor; kaynak `master.m3u8` (çoklu kalite). Bizim şu anki yol
 * (`/stream/mal/{mal}/{ep}/{lang}`) bu sunucuyu kullanmıyor.
 *
 * BELGE: https://megaplay.buzz/api  ·  API: https://anikotoapi.site
 *   GET /recent-anime?page=&per_page=   →  dizi listesi (id, title, slug, ...)
 *   GET /series/{id}                    →  { anime, episodes[] }
 *        her bölümde: episode_embed_id + embed_url.sub / embed_url.dub
 *
 * KURALLAR (API'nin kendi belgesinden):
 *   · 120 saniyede IP başına 60 istek → 429 · ağır kullanımda 403
 *   · "Front-end'den çağırmayın, kendi sunucunuzdan çağırıp saklayın"
 *     → bu yüzden derleme zamanında çekilip dosyaya yazılıyor.
 *
 * KULLANIM
 *   node scripts/sync-anikoto-embeds.mjs --scan            (adayları listeler)
 *   node scripts/sync-anikoto-embeds.mjs --scan --pages 60
 *   node scripts/sync-anikoto-embeds.mjs                   (kimlikler hazırsa yazar)
 *   node scripts/sync-anikoto-embeds.mjs --force
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(root, "src/data/episode-embeds.json");
/** Elle seçilmiş Anikoto seri kimlikleri (tarama sonucu buraya yazılır). */
const IDS = resolve(root, "scripts/anikoto-ids.json");

const API = "https://anikotoapi.site";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

/**
 * İstekler arası bekleme. API sınırı: 120 saniyede 60 istek (= 1 istek / 2 sn).
 * 2,2 sn ile sınırın altında kalıyoruz; hızlı gidince **429** yiyordu.
 */
const GAP_MS = 2200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const SCAN = args.includes("--scan") || args.includes("--match");
/**
 * `--match`: API'ye HİÇ istek atmadan yerel katalog önbelleğinden eşleştirir.
 * Eşleştirme kuralını değiştirdikten sonra 90 sayfayı yeniden taramamak için
 * (bkz. `CACHE` açıklaması). Önbellek yoksa hata verir.
 */
const MATCH = args.includes("--match");
const FORCE = args.includes("--force");
const PAGE_LIMIT = Number(args[args.indexOf("--pages") + 1]) || 40;
const PER_PAGE = 100;

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

/**
 * `/series/{id}` yanıtından bölüm listesini çıkarır.
 *
 * NEDEN: API'nin yanıt şekli değişti. Eskiden `{anime, episodes}` dönüyordu,
 * artık `{ok, anikoto_domains, data:{anime, episodes}}`. Yalnızca `json.episodes`
 * okuyan sürüm **0 bölüm** görüyordu (ölçüldü: 1384/1103/5694/1468 → hepsi 0).
 * İki şekli de destekliyoruz ki API yine değişirse sessizce bozulmasın.
 */
function episodesOf(json) {
  if (Array.isArray(json?.episodes)) return json.episodes;
  if (Array.isArray(json?.data?.episodes)) return json.data.episodes;
  return [];
}

/** Başlıkları karşılaştırmak için sadeleştirir: küçük harf, harf+rakam dışını at. */
function norm(value) {
  return String(value ?? "")
    .toLocaleLowerCase("tr")
    .replace(/[^a-z0-9ğüşıöç]+/g, "");
}

async function apiJson(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 429) throw new Error("429 — istek sınırı aşıldı, biraz bekleyip tekrar dene");
  if (res.status === 403) throw new Error("403 — IP engellendi (ağır kullanım)");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
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

const supaHeaders = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };
const supa = async (path) => {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: supaHeaders });
  if (!res.ok) throw new Error(`Supabase ${path} → ${res.status}`);
  return res.json();
};

/** Bizim diziler: slug + başlık (eşleştirme için). */
const shows = await supa("shows?select=id,slug,title,mal_id&order=slug");
console.log(`Supabase: ${shows.length} dizi`);

const ids = existsSync(IDS) ? JSON.parse(readFileSync(IDS, "utf8")) : {};

const existing = FORCE || !existsSync(OUT) ? {} : JSON.parse(readFileSync(OUT, "utf8"));

// ---------------------------------------------------------------- TARAMA
if (SCAN) {
  /**
   * Eşleşme eşiği.
   *
   * NEDEN 5: önceki sürüm `> 6` istiyordu ve **kısa adlı diziler tamamen
   * kaçıyordu** — "Erased" → `erased` (6 harf), "Re:Zero" → `rezero` (6 harf).
   * 90 sayfalık tam taramada bu iki dizi bu yüzden "eşleşme yok" göründü.
   * 5 harf, tek kelimelik adları yakalar; kısa kelimelerin gürültüsünü
   * (ör. "kai") hâlâ eler.
   */
  const MIN_MATCH = 5;
  /**
   * Katalog önbelleği: tarama sırasında görülen TÜM satırlar buraya yazılır.
   * Amaç: eşleştirme kuralını değiştirdiğimizde API'yi yeniden taramamak
   * (90 sayfa ≈ 200 saniye + 429 riski). `--match` alt komutu bu dosyayı okur.
   */
  const CACHE = resolve(root, ".tmp_a/anikoto-catalog.json");
  const needles = shows.map((s) => {
    const short = norm(s.title.split(/[:–-]/)[0]).slice(0, 14);
    return { show: s, full: norm(s.title), short };
  });
  console.log(`\nTarama: en fazla ${PAGE_LIMIT} sayfa × ${PER_PAGE} dizi\n`);
  let catalog = [];
  const found = {};
  if (MATCH) {
    if (!existsSync(CACHE)) {
      console.error(`${CACHE} yok. Önce bir kez --scan çalıştır.`);
      process.exit(1);
    }
    catalog = JSON.parse(readFileSync(CACHE, "utf8"));
    console.log(`Önbellekten eşleştirme: ${catalog.length} kayıt (API'ye istek atılmadı)\n`);
    for (const row of catalog) {
      const title = norm(row.title);
      for (const { show, full, short } of needles) {
        if (!title) continue;
        const hit =
          (full.length >= MIN_MATCH && title.includes(full)) ||
          (short.length >= MIN_MATCH && title.includes(short)) ||
          (title.length >= MIN_MATCH && full.includes(title));
        if (!hit) continue;
        found[show.slug] = found[show.slug] ?? [];
        found[show.slug].push(row);
      }
    }
    for (const show of shows) {
      const list = found[show.slug] ?? [];
      console.log(`\n${show.slug}  ("${show.title}")`);
      if (list.length === 0) {
        console.log("   eşleşme yok");
        continue;
      }
      for (const c of list.slice(0, 14)) {
        console.log(`   id=${c.id}  ${c.title}  [${c.slug}]  sub=${c.is_sub} dub=${c.is_dub}`);
      }
    }
    console.log("\nSeçtiklerini scripts/anikoto-ids.json dosyasına yaz: {\"<slug>\": <id>}");
    process.exit(0);
  }
  for (let page = 1; page <= PAGE_LIMIT; page += 1) {
    let json;
    try {
      json = await apiJson(`/recent-anime?page=${page}&per_page=${PER_PAGE}`);
    } catch (err) {
      console.error(`sayfa ${page}: ${err.message}`);
      break;
    }
    const rows = json.data ?? [];
    if (rows.length === 0) break;
    for (const row of rows) {
      catalog.push({ id: row.id, title: row.title, slug: row.slug, is_sub: row.is_sub, is_dub: row.is_dub });
      const title = norm(row.title);
      for (const { show, full, short } of needles) {
        if (!title) continue;
        const hit =
          (full.length >= MIN_MATCH && title.includes(full)) ||
          (short.length >= MIN_MATCH && title.includes(short)) ||
          (title.length >= MIN_MATCH && full.includes(title));
        if (!hit) continue;
        found[show.slug] = found[show.slug] ?? [];
        found[show.slug].push({ id: row.id, title: row.title, slug: row.slug, is_sub: row.is_sub, is_dub: row.is_dub });
      }
    }
    const total = json.pagination?.total_pages ?? "?";
    console.log(`  sayfa ${page}/${total} · kümülatif eşleşme: ${Object.values(found).flat().length}`);
    if (Object.keys(found).length === shows.length && page >= 3) break;
    await sleep(GAP_MS);
  }
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`\nKatalog önbelleği: ${CACHE} (${catalog.length} kayıt)`);

  console.log("\n=== ADAYLAR ===");
  for (const show of shows) {
    const list = found[show.slug] ?? [];
    console.log(`\n${show.slug}  ("${show.title}")`);
    if (list.length === 0) {
      console.log("   eşleşme yok (daha fazla sayfa taranmalı: --pages 200)");
      continue;
    }
    for (const c of list.slice(0, 12)) {
      console.log(`   id=${c.id}  ${c.title}  [${c.slug}]  sub=${c.is_sub} dub=${c.is_dub}`);
    }
  }
  console.log("\nSeçtiklerini scripts/anikoto-ids.json dosyasına yaz: {\"<slug>\": <id>}");
  process.exit(0);
}

// ---------------------------------------------------------------- YAZMA
if (Object.keys(ids).length === 0) {
  console.error("scripts/anikoto-ids.json yok/boş. Önce: --scan ile adayları bul.");
  process.exit(1);
}

const episodes = await supa("show_episodes?select=show_id,season,number");
const byShow = new Map();
for (const ep of episodes) {
  const list = byShow.get(ep.show_id) ?? [];
  list.push(ep);
  byShow.set(ep.show_id, list);
}

const out = { ...existing };
let written = 0;
let missing = 0;

for (const show of shows) {
  const seriesId = ids[show.slug];
  if (!seriesId) continue;
  let json;
  try {
    json = await apiJson(`/series/${seriesId}`);
  } catch (err) {
    console.error(`${show.slug}: ${err.message}`);
    continue;
  }
  const list = episodesOf(json);
  const byNumber = new Map(list.map((e) => [Number(e.number), e]));
  console.log(`\n${show.slug} → anikoto seri ${seriesId} · ${list.length} bölüm`);
  for (const ep of byShow.get(show.id) ?? []) {
    const match = byNumber.get(Number(ep.number));
    const url = match?.embed_url?.sub ?? "";
    if (!url) {
      missing += 1;
      continue;
    }
    out[`${show.slug}-s${ep.season}b${ep.number}`] = url;
    written += 1;
  }
  await sleep(GAP_MS);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`\nYazıldı: ${OUT}`);
console.log(`toplam kayıt=${Object.keys(out).length} · bu turda eşleşen=${written} · bulunamayan=${missing}`);

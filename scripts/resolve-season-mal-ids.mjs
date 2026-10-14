/**
 * SEZON MAL KİMLİKLERİNİ **OTOMATİK** ÇÖZER — elle giriş gerektirmez.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NEDEN GEREKLİ
 * ═══════════════════════════════════════════════════════════════════════════
 * MAL'de her sezon AYRI bir anime kaydıdır: Jujutsu Kaisen S1 = 40748 ama
 * S2 = 51009, S3 = 57658. Kapak araması sezonun KENDİ kimliğine baktığı için
 * (`anizipCoverForSeason`), bu kimlikler bilinmedikçe o sezonlar kapaksız kalır.
 * Kullanıcı bildirimi (30.09.2026): "panelde sadece 1 tane MAL id yazma yeri
 * var" — çok sezonlu serilerin sonraki sezonları kimliksiz kalıyordu.
 *
 * ── NASIL ÇÖZÜYOR ──────────────────────────────────────────────────────────
 * AniList'in `relations` alanı sezonları birbirine bağlar (PREQUEL/SEQUEL).
 * Zincir iki yöne yürünerek TAM sıra elde edilir, sonra her sezon bu sıradan
 * BÖLÜM SAYISI eşleşmesiyle bulunur:
 *
 *   Jujutsu Kaisen zinciri: 40748(24) → 51009(23) → 57658(12)
 *   Veritabanı:             S1=24 bölüm, S2=23 bölüm, S3=12 bölüm   → birebir
 *
 * ⚠️ KONUM EŞLEŞTİRMESİ KULLANILMAZ: MAL bazı sezonları "Part 2" diye ayrı
 * kayıt yapar (ör. Mushoku Tensei S1 = 39535 + 45576), o yüzden sıra numarası
 * güvenilmez. Bölüm sayısı eşleşmesi ZORUNLUDUR ve TEK olmalıdır; belirsizse
 * (aynı sayıda iki kayıt varsa) TAHMİN YÜRÜTÜLMEZ, o sezon boş bırakılır.
 *
 * ── ÇIKTI ──────────────────────────────────────────────────────────────────
 * `src/data/season-mal-ids.json`
 *   { "<seri MAL kimliği>": { "<sezon no>": <sezon MAL kimliği>, … }, … }
 *
 * Veritabanında `show_seasons.mal_id` DOLUYSA o değer esastır; bu dosya yalnızca
 * BOŞ olanlar için kullanılır (bkz. `lib/anizip-covers.ts` → `resolveSeasonMalId`).
 *
 * KULLANIM
 *   node scripts/resolve-season-mal-ids.mjs          # eksikleri çözer
 *   node scripts/resolve-season-mal-ids.mjs --force  # hepsini yeniden çözer
 *   node scripts/resolve-season-mal-ids.mjs --dry    # yazmaz, ne bulduğunu söyler
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(root, "src/data/season-mal-ids.json");
/** Seri başına TAM sezon zinciri (kardeş kayıt araması için). */
const CHAINS_OUT = resolve(root, "src/data/season-chains.json");
const ANILIST = "https://graphql.anilist.co";

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const DRY = args.includes("--dry");

// ── Ortam ────────────────────────────────────────────────────────────────────
function loadEnv() {
  const file = resolve(root, ".env");
  if (!existsSync(file)) throw new Error(".env bulunamadı");
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = loadEnv();
const SUPA_URL = env.VITE_SUPABASE_URL;
const SUPA_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!SUPA_URL || !SUPA_KEY)
  throw new Error(".env eksik: VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY");

async function supabase(path) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

// ── AniList ──────────────────────────────────────────────────────────────────
const QUERY = `query($idMal:Int){Media(idMal:$idMal,type:ANIME){
  idMal episodes format
  relations{edges{relationType node{idMal type format episodes}}}
}}`;

/**
 * AniList çağrısı. 429 (hız sınırı) ve 5xx'te ARTAN BEKLEMEYLE yeniden dener —
 * zincir yürüyüşü seri başına 3-6 istek attığı için sınıra takılmak normaldir.
 */
async function gql(malId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(ANILIST, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { idMal: malId } }),
    });
    if (res.status === 429 || res.status >= 500) {
      const wait = 3000 * 2 ** attempt;
      console.warn(`  … AniList ${res.status}, ${Math.round(wait / 1000)} sn bekleniyor`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`AniList ${res.status}`);
    return res.json();
  }
  throw new Error("AniList 429 (denemeler tükendi)");
}

/** Tek bir MAL kaydının komşularını döndürür. */
async function neighbours(malId) {
  const media = (await gql(malId)).data?.Media;
  if (!media) return null;
  const pick = (type) =>
    media.relations.edges
      .filter(
        (e) =>
          e.relationType === type &&
          e.node.type === "ANIME" &&
          ["TV", "TV_SHORT"].includes(e.node.format),
      )
      .map((e) => Number(e.node.idMal))
      .filter((n) => Number.isFinite(n) && n > 0);
  return {
    self: { malId: Number(media.idMal), episodes: Number(media.episodes) || 0 },
    prequels: pick("PREQUEL"),
    sequels: pick("SEQUEL"),
  };
}

/**
 * Serinin TAM sezon zincirini sırayla döndürür.
 * Önce PREQUEL'ler geriye yürünür (başlangıca inilir), sonra SEQUEL'ler ileri.
 * Tek bir TV sezonu varsa zincir tek elemanlıdır.
 */
async function seasonChain(malId) {
  const chain = [];
  const seen = new Set();
  // Geri: en eski sezona kadar in.
  let cursor = malId;
  const back = [];
  for (let i = 0; i < 10; i++) {
    const info = await neighbours(cursor);
    if (!info) break;
    back.unshift(info.self);
    const prev = info.prequels.find((id) => !seen.has(id));
    if (!prev || seen.has(prev)) break;
    seen.add(prev);
    cursor = prev;
    await new Promise((r) => setTimeout(r, 1200)); // AniList hız sınırı
  }
  for (const item of back) {
    chain.push(item);
    seen.add(item.malId);
  }
  // İleri: son sezona kadar yürü.
  cursor = malId;
  for (let i = 0; i < 10; i++) {
    const info = await neighbours(cursor);
    if (!info) break;
    const next = info.sequels.find((id) => !seen.has(id));
    if (!next) break;
    seen.add(next);
    const nextInfo = await neighbours(next);
    if (!nextInfo) break;
    chain.push(nextInfo.self);
    cursor = next;
    await new Promise((r) => setTimeout(r, 1200));
  }
  return chain;
}

// ── Ana akış ─────────────────────────────────────────────────────────────────
const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const result = FORCE ? {} : { ...existing };
/**
 * Seri MAL kimliği → TAM sezon zinciri (MAL kimlikleri sırayla).
 *
 * ── NEDEN MEVCUT ZİNCİRLER YÜKLENİR (düzeltme 30.09.2026) ───────────────────
 * Eskiden `chains` her koşuda `{}`dan başlıyordu ve aşağıdaki erken `continue`
 * ("bu seri zaten çözülmüş") zincir hesaplamasından ÖNCE atıldığı için, daha
 * önce çözülmüş serilerin zincirleri dosyaya HİÇ yazılmıyordu. Sonuç: dosyada
 * yalnızca o koşuda "yeni" görülen seri kalıyordu — ölçüm: `season-chains.json`
 * tek satıra düşmüştü (`{"58567":[52299,58567]}`). Oysa re-zero zinciri
 * ([31240,39587,42203,54857,61316]) `anizipCoverFromChain` için şarttır.
 * Artık mevcut zincirler korunur ve zincir, sezonlar zaten çözülü olsa bile
 * (yalnızca bir kez) hesaplanıp tamamlanır.
 */
const chains = FORCE
  ? {}
  : existsSync(CHAINS_OUT)
    ? JSON.parse(readFileSync(CHAINS_OUT, "utf8"))
    : {};

const shows = await supabase("shows?select=id,slug,mal_id&mal_id=not.is.null&order=slug");
const seasons = await supabase("show_seasons?select=show_id,number,mal_id&limit=500");
const episodes = await supabase("show_episodes?select=show_id,season,number&limit=5000");

/** Bir sezonun bölüm sayısı. */
function episodeCount(showId, seasonNumber) {
  return episodes.filter((e) => e.show_id === showId && e.season === seasonNumber).length;
}

console.log(`Supabase: ${shows.length} seri.`);
let resolved = 0;
let skippedShows = 0;

for (const show of shows) {
  const showMal = String(show.mal_id);
  const mine = seasons.filter((s) => s.show_id === show.id).sort((a, b) => a.number - b.number);
  if (mine.length < 2) {
    skippedShows += 1;
    continue; // Tek sezonlu seride zincire gerek yok.
  }
  // Sezonlar zaten çözülmüş VE zincir de biliniyorsa AniList'e hiç sorma.
  const chainKnown = Array.isArray(chains[showMal]) && chains[showMal].length >= 2;
  if (result[showMal] && !FORCE && chainKnown) {
    skippedShows += 1;
    continue;
  }
  let chain;
  try {
    chain = await seasonChain(Number(show.mal_id));
  } catch (err) {
    console.warn(`  ! ${show.slug} → zincir alınamadı: ${err.message}`);
    if (result[showMal]) skippedShows += 1; // sezon eşlemesi zaten dosyada
    continue;
  }
  if (chain.length < 2) {
    console.log(`  ~ ${show.slug} → zincir tek kayıt (çok sezonlu değil)`);
    skippedShows += 1;
    continue;
  }
  // ZİNCİR, sezon eşlemesi zaten çözülü olsa bile kaydedilir (kardeş kayıt araması).
  chains[showMal] = chain.map((item) => item.malId);
  if (result[showMal] && !FORCE) {
    console.log(
      `  = ${show.slug} → zincir tazelendi (${chain.length} kayıt), sezonlar zaten çözülü`,
    );
    skippedShows += 1;
    continue;
  }
  const map = {};
  const used = new Set();
  // ÖNCE veritabanındaki bütün kimlikler "kullanılmış" işaretlenir.
  // Yoksa boş bir sezon, BAŞKA bir sezonun kimliğini kapabilir (ölçüldü
  // 30.09.2026: solo-leveling S1, S2'nin 58567'sini aldı — ikisinin de bölüm
  // sayısı 13 olduğu için eşleşme yanıltıcıydı).
  for (const season of mine) {
    if (season.mal_id) used.add(Number(season.mal_id));
  }
  for (const season of mine) {
    // Veritabanındaki değer esastır; varsa zincirden atama YAPILMAZ.
    if (season.mal_id) {
      map[season.number] = Number(season.mal_id);
      continue;
    }
    const count = episodeCount(show.id, season.number);
    if (!count) continue;
    // BÖLÜM SAYISI birebir eşleşen ve TEK olan zincir kaydı seçilir.
    const matches = chain.filter((item) => item.episodes === count && !used.has(item.malId));
    if (matches.length !== 1) {
      console.log(
        `  ? ${show.slug} S${season.number} (${count} bölüm) → ${matches.length} aday, TAHMİN YOK`,
      );
      continue;
    }
    map[season.number] = matches[0].malId;
    used.add(matches[0].malId);
    resolved += 1;
    console.log(`  + ${show.slug} S${season.number} (${count} bölüm) → MAL ${matches[0].malId}`);
  }
  if (Object.keys(map).length > 1) result[showMal] = map;
  // TAM ZİNCİR de saklanır: bazı sezonlar MAL'de İKİ kayda bölünür (ölçüm
  // 30.09.2026: re-zero S2 = 39587 (1-13) + 42203 (14-25)). Tek kimlikle
  // eşleşmeyen bölümler için zincirdeki KARDEŞ kayıtlara bakılabilir.
  chains[showMal] = chain.map((item) => item.malId);
}

console.log(`\nçözülen sezon: ${resolved}   atlanan seri: ${skippedShows}`);
if (!DRY) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  writeFileSync(CHAINS_OUT, `${JSON.stringify(chains, null, 2)}\n`, "utf8");
  console.log(`yazıldı: ${OUT}`);
  console.log(`yazıldı: ${CHAINS_OUT}`);
}

/**
 * EKSİK YEREL BÖLÜM KAPAKLARINI **YALNIZCA ani.zip / TVDB** GÖRSELİNDEN İNDİRİP
 * `public/static/episode-covers/` altına YAZAR — "bir kez kur, hep çalışsın"
 * boru hattının son halkası.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TEK KAYNAK KURALI (kullanıcı, kesin)
 * ═══════════════════════════════════════════════════════════════════════════
 * Bölüm kapakları YALNIZCA TVDB'den (ani.zip üzerinden) gelir. animecix,
 * sağlayıcı (voe/morencius/vidmoly) kareleri, katalog kapağı ve SERİ POSTERİ
 * KAPAK OLARAK KULLANILMAZ. TVDB'de bölümün görseli YOKSA **dosya YAZILMAZ**
 * (var olan dosya da SİLİNMEZ) — o bölüm kartı kapaksız/kendi numara rozetiyle
 * kalır; uydurma/yedek görsel üretilmez.
 *
 * KAYNAK: `src/data/episode-thumbs.json` (ani.zip → `artworks.thetvdb.com`).
 * Eşleşme `src/lib/anizip-covers.ts` ile AYNIdır ve kayıt-farkındadır: yalnızca
 * bölümü GERÇEKTEN içeren kayıt eşleşir (`s<sezon>e<bölüm>`, tek sezonluk kayıtta
 * `s1e<bölüm>`). Bölünmüş sezonlar (ör. re-zero S2 = 42203 + 39587) zincirdeki
 * kardeş kayıttan çözülür.
 *
 * İDEMPOTENT: var olan dosya ATLANIR (`--force` ile yenilenir). Veritabanına
 * DOKUNMAZ (yalnızca okur). Best-effort: hata olursa o bölüm atlanır, çıkış 0.
 *
 * KULLANIM
 *   node scripts/sync-anizip-local-covers.mjs              # eksikleri indirir
 *   node scripts/sync-anizip-local-covers.mjs --slug re-zero
 *   node scripts/sync-anizip-local-covers.mjs --force      # var olanları yeniler
 *   node scripts/sync-anizip-local-covers.mjs --dry        # yazmaz, ne bulduğunu söyler
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COVERS_DIR = resolve(root, "public/static/episode-covers");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const FORCE = has("--force");
const DRY = has("--dry");
const ONLY_SLUG = valueOf("--slug");

// ── Ortam + veri ──────────────────────────────────────────────────────────────
function loadEnv() {
  const out = {};
  for (const line of readFileSync(resolve(root, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = loadEnv();
const SUPA_URL = env.VITE_SUPABASE_URL;
const SUPA_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!SUPA_URL || !SUPA_KEY) {
  console.warn("sync-anizip-local-covers: .env eksik → atlandı.");
  process.exit(0);
}
async function supabase(path) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

const thumbs = JSON.parse(readFileSync(resolve(root, "src/data/episode-thumbs.json"), "utf8"));
const chains = existsSync(resolve(root, "src/data/season-chains.json"))
  ? JSON.parse(readFileSync(resolve(root, "src/data/season-chains.json"), "utf8"))
  : {};
const seasonMalIds = existsSync(resolve(root, "src/data/season-mal-ids.json"))
  ? JSON.parse(readFileSync(resolve(root, "src/data/season-mal-ids.json"), "utf8"))
  : {};

// ── Kayıt-farkında ani.zip eşleşmesi (lib/anizip-covers.ts ile AYNI kural) ──────
function tableSeasons(table) {
  const seasons = new Set();
  for (const key of Object.keys(table)) {
    const m = /^s(\d+)e\d+$/.exec(key);
    if (m) seasons.add(Number(m[1]));
  }
  return [...seasons];
}
function imageFromTable(table, season, episode) {
  if (!table) return "";
  const direct = table[`s${season}e${episode}`];
  if (direct) return direct;
  const onlyFirst = tableSeasons(table).every((v) => v === 0 || v === 1);
  if (onlyFirst && season === 1) return table[`s1e${episode}`] ?? "";
  return "";
}
function resolveSeasonMalId(showMalId, season, explicit) {
  if (explicit) return Number(explicit);
  if (!showMalId) return null;
  const v = seasonMalIds[String(showMalId)]?.[String(season)];
  return v ? Number(v) : null;
}
/**
 * ani.zip/TVDB bölüm görseli — sıra `lib/anizip-covers.ts` ile AYNI:
 *   1) sezonun KENDİ MAL kaydı (varsa),
 *   2) SERİNİN MAL kaydı (`show.mal_id`) — tek sezonlu serilerde (cyberpunk,
 *      death-note, erased…) bölümler yalnız seri kaydının tablosunda bulunur,
 *   3) zincirdeki kardeş kayıtlar (bölünmüş sezonlar; ör. solo-leveling S1 = 52299).
 * `imageFromTable` kayıt-farkındadır: yalnızca bölümü GERÇEKTEN içeren kayıt eşleşir.
 */
function aniZipImage(showMalId, season, episode, explicit) {
  const sm = resolveSeasonMalId(showMalId, season, explicit);
  const chain = chains[String(showMalId)] ?? [];
  const order = [...(sm ? [sm] : []), ...(showMalId ? [Number(showMalId)] : []), ...chain].filter(
    (id, i, arr) => id && arr.indexOf(id) === i,
  );
  for (const id of order) {
    const hit = imageFromTable(thumbs[String(id)], season, episode);
    if (hit) return hit;
  }
  return "";
}

// ── İndirme + yazma ───────────────────────────────────────────────────────────
const isJpeg = (buf) => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
async function fetchImage(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, type };
}
/** Görseli yerel kapağa yazar; JPEG değilse ffmpeg ile jpg'ye çevirir. */
async function writeCover(outPath, buf, type) {
  if (isJpeg(buf) || /jpe?g/i.test(type)) {
    writeFileSync(outPath, buf);
    return true;
  }
  // PNG/WEBP vb. → jpg'ye çevir (kapak adı her zaman `.jpg`).
  const tmp = `${outPath}.src`;
  writeFileSync(tmp, buf);
  try {
    await run("ffmpeg", ["-y", "-v", "error", "-i", tmp, "-frames:v", "1", "-q:v", "3", outPath]);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* önemsiz */
    }
  }
  return existsSync(outPath);
}

// ── Ana akış ─────────────────────────────────────────────────────────────────
const shows = await supabase("shows?select=id,slug,mal_id,animecix_id,image_path&order=slug");
console.log(
  `sync-anizip-local-covers: ${shows.length} seri${ONLY_SLUG ? ` (slug=${ONLY_SLUG})` : ""}`,
);
if (!DRY) mkdirSync(COVERS_DIR, { recursive: true });

let downloaded = 0;
let skipped = 0;
let noTvdb = 0;
let failed = 0;
const viaAniZip = [];
const noTvdbList = [];
const failures = [];

for (const show of shows) {
  if (!show.slug) continue;
  if (ONLY_SLUG && show.slug !== ONLY_SLUG) continue;
  const seasonRows = await supabase(
    `show_seasons?select=number,mal_id&show_id=eq.${show.id}&limit=200`,
  );
  const explicitBySeason = new Map(seasonRows.map((s) => [Number(s.number), s.mal_id]));
  const eps = await supabase(
    `show_episodes?select=season,number&show_id=eq.${show.id}&order=season,number`,
  );
  for (const ep of eps) {
    const name = `${show.slug}-s${ep.season}e${ep.number}.jpg`;
    const outPath = resolve(COVERS_DIR, name);
    if (!FORCE && existsSync(outPath)) {
      skipped += 1;
      continue;
    }

    const remote = aniZipImage(
      show.mal_id,
      ep.season,
      ep.number,
      explicitBySeason.get(Number(ep.season)) ?? null,
    );

    if (DRY) {
      console.log(`  [dry] ${name} <- anizip:${remote || "(TVDB görseli yok)"}`);
      if (remote) downloaded += 1;
      else noTvdb += 1;
      continue;
    }

    if (!remote) {
      // TVDB'de yok → DOKUNMA (ne yaz ne sil). Kart kapaksız kalır.
      noTvdb += 1;
      noTvdbList.push(name);
      console.log(`  --  ${name}  -> TVDB görseli yok (dosya yazılmadı)`);
      continue;
    }

    try {
      const img = await fetchImage(remote);
      const wrote = await writeCover(outPath, img.buf, img.type);
      if (wrote) {
        downloaded += 1;
        viaAniZip.push(name);
        console.log(`  ok  ${name}  (anizip)`);
      } else {
        failed += 1;
        failures.push(`${name}: kapak yazılamadı`);
        console.log(`  --  ${name}  -> kapak yazılamadı`);
      }
    } catch (err) {
      failed += 1;
      failures.push(`${name}: ${err.message}`);
      console.log(`  --  ${name}  -> ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 120));
  }
}

console.log("");
console.log(
  `indirilen: ${downloaded}   atlanan (vardı): ${skipped}   TVDB görseli yok: ${noTvdb}   başarısız: ${failed}`,
);
if (viaAniZip.length) console.log(`  ani.zip/TVDB : ${viaAniZip.join(", ")}`);
if (noTvdbList.length)
  console.log(`  TVDB karşılığı OLMAYAN (kapaksız kalacak): ${noTvdbList.join(", ")}`);
if (failures.length) {
  console.log("başarısızlar:");
  for (const f of failures.slice(0, 20)) console.log(`  ${f}`);
}

/**
 * Bölümler için TÜRKÇE altyazıları indirir ve `public/subs/` altına yazar.
 *
 * NEDEN: hiçbir ücretsiz embed "Japonca ses" ve "Türkçe altyazı"yı birlikte
 * vermiyor. Çözüm: ses megaplay'den (orijinal Japonca), altyazı bizden
 * (`src/components/SubtitleOverlay.tsx` sağlayıcı iframe'inin üstüne çiziyor).
 * Bu betik altyazı DOSYALARINI üretir; video indirmek/yüklemek GEREKMEZ.
 *
 * KAYNAK: OpenSubtitles.com REST API (resmî, CORS destekli).
 *   Arama : GET  https://api.opensubtitles.com/api/v1/subtitles
 *           ?tmdb_id=<id>&season_number=<s>&episode_number=<e>&languages=tr&type=episode
 *   İndirme: POST https://api.opensubtitles.com/api/v1/download   { file_id, sub_format }
 *   Başlıklar: Api-Key (zorunlu) · User-Agent (zorunlu)
 *
 *   Anahtar: https://www.opensubtitles.com/consumers → "New consumer" (ücretsiz).
 *   Panelde consumer'ı "Under Development" yaparsan kimlik doğrulamasız
 *   günde 100 indirme hakkı olur (aksi halde IP başına 24 saatte 5).
 *   Anahtarı `.env` dosyasına `OPENSUBTITLES_API_KEY=...` olarak koy.
 *
 * KULLANIM
 *   node scripts/sync-tr-subtitles.mjs               # eksik olanları indirir (en fazla 5)
 *   node scripts/sync-tr-subtitles.mjs --limit 50    # günlük hakkı zorla
 *   node scripts/sync-tr-subtitles.mjs --force       # var olanları da yeniler
 *   node scripts/sync-tr-subtitles.mjs --dry         # indirmez, ne bulduğunu yazar
 *
 * Betik İDEMPOTENTTİR: var olan dosyayı atlar, yani her çalıştırmada yalnızca
 * yeni bölümler için indirme harcanır.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(root, "public/subs");
const TMDB_MAP = resolve(root, "src/data/mal-tmdb.json");
const API = "https://api.opensubtitles.com/api/v1";
const APP = "shanime v1.0";

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const DRY = args.includes("--dry");
const LIMIT = (() => {
  const at = args.indexOf("--limit");
  return at >= 0 ? Number(args[at + 1]) : 5;
})();

/** .env / .env.local okur (bağımlılık eklememek için elle). */
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
const OS_KEY = env.OPENSUBTITLES_API_KEY ?? env.VITE_OPENSUBTITLES_API_KEY;

if (!SUPA_URL || !SUPA_KEY) {
  console.error("Supabase adresi/anahtarı .env içinde bulunamadı.");
  process.exit(1);
}
if (!OS_KEY) {
  console.error(
    [
      "OPENSUBTITLES_API_KEY bulunamadı.",
      "",
      "Nasıl alınır (ücretsiz, 2 dakika):",
      "  1) https://www.opensubtitles.com/consumers adresine gir ve giriş yap",
      "  2) 'New consumer' → isim: shanime → kaydet",
      "  3) Çıkan API anahtarını .env dosyasına ekle:",
      "       OPENSUBTITLES_API_KEY=buraya_anahtar",
      "",
      "İpucu: consumer ayarında 'Under Development' işaretlersen günde 100",
      "indirme hakkı olur (aksi halde IP başına 24 saatte 5).",
    ].join("\n"),
  );
  process.exit(1);
}

const supaHeaders = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };

async function supa(path) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: supaHeaders });
  if (!res.ok) throw new Error(`Supabase ${res.status} ${path}`);
  return res.json();
}

/** `00:00:01,000` → `00:00:01.000` · başına WEBVTT ekler. */
function srtToVtt(srt) {
  const body = srt
    .replace(/\r\n?/g, "\n")
    .replace(/^\uFEFF/, "")
    .split("\n")
    .map((line) => line.replace(/^(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/, "$1.$2"))
    .join("\n");
  return `WEBVTT\n\n${body.trim()}\n`;
}

/** Altyazı dosyasının adı: yerleşik kural (kod da bu yolu arar). */
export function subtitleFileFor(slug, season, episode) {
  return `${slug}-s${season}b${episode}.vtt`;
}

async function searchTr(tmdbId, season, episode) {
  const params = new URLSearchParams({
    tmdb_id: String(tmdbId),
    season_number: String(season),
    episode_number: String(episode),
    languages: "tr",
    type: "episode",
  });
  const res = await fetch(`${API}/subtitles?${params}`, {
    headers: { "Api-Key": OS_KEY, "User-Agent": APP, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`arama ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows
    .map((row) => ({
      fileId: row?.attributes?.files?.[0]?.file_id ?? null,
      language: row?.attributes?.language ?? "",
      downloads: Number(row?.attributes?.download_count ?? 0),
      season:
        row?.attributes?.feature_details?.season_number ?? row?.attributes?.season_number ?? null,
      episode:
        row?.attributes?.feature_details?.episode_number ?? row?.attributes?.episode_number ?? null,
      release: String(row?.attributes?.release ?? "").slice(0, 48),
    }))
    .filter((r) => r.fileId && r.language.toLowerCase().startsWith("tr"))
    .sort((a, b) => b.downloads - a.downloads);
}

async function download(fileId) {
  const res = await fetch(`${API}/download`, {
    method: "POST",
    headers: {
      "Api-Key": OS_KEY,
      "User-Agent": APP,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file_id: fileId, sub_format: "srt" }),
  });
  if (!res.ok) throw new Error(`indirme ${res.status}`);
  const json = await res.json();
  if (!json.link) throw new Error("indirme bağlantısı yok");
  const file = await fetch(json.link, { headers: { "User-Agent": APP } });
  if (!file.ok) throw new Error(`dosya ${file.status}`);
  return file.text();
}

const tmdbMap = existsSync(TMDB_MAP) ? JSON.parse(readFileSync(TMDB_MAP, "utf8")) : {};
const shows = await supa("shows?select=id,slug,title,mal_id");
const episodes = await supa("show_episodes?select=show_id,season,number");

mkdirSync(OUT_DIR, { recursive: true });

let used = 0;
let written = 0;
let skipped = 0;
let missing = 0;
const problems = [];

for (const show of shows) {
  const tmdbId = Number(tmdbMap[String(show.mal_id)] ?? 0);
  if (!tmdbId) {
    problems.push(`${show.slug}: TMDB eşlemesi yok (node scripts/sync-anizip-covers.mjs)`);
    continue;
  }
  const list = episodes.filter((e) => e.show_id === show.id);
  for (const ep of list) {
    const file = resolve(OUT_DIR, subtitleFileFor(show.slug, ep.season, ep.number));
    if (existsSync(file) && !FORCE) {
      skipped += 1;
      continue;
    }
    if (used >= LIMIT) {
      console.log(`\nGünlük indirme sınırına ulaşıldı (${LIMIT}). Kalanlar sonraki çalıştırmada.`);
      console.log("Daha fazlası için: --limit 50 (veya consumer'ı 'Under Development' yap)");
      console.log(
        `\nÖzet: yazıldı=${written} atlandı=${skipped} bulunamadı=${missing} harcanan=${used}`,
      );
      process.exit(0);
    }
    try {
      const results = await searchTr(tmdbId, ep.season, ep.number);
      if (results.length === 0) {
        missing += 1;
        console.log(`  ${show.slug} S${ep.season}B${ep.number}: Türkçe altyazı bulunamadı`);
        continue;
      }
      const best = results[0];
      if (DRY) {
        console.log(
          `  ${show.slug} S${ep.season}B${ep.number}: ${results.length} aday · en iyi "${best.release}" (${best.downloads} indirme)`,
        );
        continue;
      }
      const srt = await download(best.fileId);
      used += 1;
      writeFileSync(file, srtToVtt(srt));
      written += 1;
      console.log(
        `  ${show.slug} S${ep.season}B${ep.number}: yazıldı ← "${best.release}" (${best.downloads} indirme)`,
      );
    } catch (err) {
      problems.push(`${show.slug} S${ep.season}B${ep.number}: ${err.message}`);
    }
  }
}

console.log(`\nÖzet: yazıldı=${written} atlandı=${skipped} bulunamadı=${missing} harcanan=${used}`);
if (problems.length > 0) {
  console.log("\nSorunlar:");
  problems.slice(0, 20).forEach((p) => console.log("  - " + p));
}
console.log("\nDosyalar: public/subs/ — kod bu yolu otomatik arar, panelde ayar yapmak GEREKMEZ.");

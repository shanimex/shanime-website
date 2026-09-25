#!/usr/bin/env node
/**
 * Streamtape klasörünü okur, bölümleri ada göre çözer ve eşleme raporu üretir.
 *
 * NEDEN YALNIZ EMBED LİNKİ ÜRETİYOR:
 * Streamtape API'si bir "download ticket" akışıyla ham dosya adresi de verir,
 * ama o adresi kendi oynatıcımızda göstermek Streamtape Şartlar ve Koşulları'nın
 * "Prohibited Activities" bölümüne aykırıdır ("use content obtained from
 * Streamtape ... for commercial purposes" / "display, perform ... except by
 * using functionality provided by Streamtape") ve hesabın kapatılması +
 * kazançların kesilmesiyle sonuçlanır. Bu yüzden üretilen adres
 * https://streamtape.com/e/<id> biçimindeki RESMÎ oynatıcı adresidir; reklamlar
 * orada görünür ve izlenmeler Publisher Program kapsamında yazılır.
 * Ayrıntı: docs/OYNATICI-FLUIDPLAYER.md
 *
 * Kullanım:
 *   node scripts/import-streamtape.mjs           → rapor yazar (veritabanına YAZMAZ)
 *   node scripts/import-streamtape.mjs --json    → ayrıca streamtape-episodes.json üretir
 */
import { readFileSync, writeFileSync } from "node:fs";

const API = "https://api.streamtape.com";

/** .env dosyasını basitçe okur (dotenv bağımlılığı eklemeden). */
function loadEnv() {
  const env = { ...process.env };
  try {
    const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index < 0) continue;
      const key = trimmed.slice(0, index).trim();
      // Kabuk/CI ortam değişkeni varsa o kazanır.
      if (!env[key]) env[key] = trimmed.slice(index + 1).trim();
    }
  } catch {
    // .env yoksa ortam değişkenleriyle devam.
  }
  return env;
}

const env = loadEnv();
const login = env["STREAMTAPE_LOGIN"];
const key = env["STREAMTAPE_KEY"];
const folder = env["STREAMTAPE_FOLDER"] || "";
const subsFolder = env["STREAMTAPE_SUBS_FOLDER"] || "";

if (!login || !key) {
  console.error("Eksik: STREAMTAPE_LOGIN ve/veya STREAMTAPE_KEY (.env dosyasına ekle).");
  process.exit(1);
}

async function api(path, params = {}) {
  const query = new URLSearchParams({ ...params, login, key });
  const response = await fetch(`${API}${path}?${query.toString()}`);
  const payload = await response.json();
  if (payload.status !== 200) {
    throw new Error(`Streamtape API hatası (${payload.status}): ${payload.msg}`);
  }
  return payload.result;
}

/** Dosya adından sezon/bölüm çözer: "JujutsuKaisen-1080p-S1B12.mp4" → {season:1, episode:12} */
function parseName(name) {
  const match = /S(\d{1,3})\s*B(\d{1,4})/i.exec(name ?? "");
  if (!match) return null;
  return { season: Number(match[1]), episode: Number(match[2]) };
}

const embedUrl = (id) => `https://streamtape.com/e/${id}`;

async function listFiles(folderId) {
  const result = await api("/file/listfolder", folderId ? { folder: folderId } : {});
  return result.files ?? [];
}

const episodes = new Map();
let skipped = 0;

for (const file of await listFiles(folder)) {
  const parsed = parseName(file.name);
  if (!parsed) {
    skipped += 1;
    continue;
  }
  episodes.set(`${parsed.season}-${parsed.episode}`, {
    season: parsed.season,
    episode: parsed.episode,
    fileName: file.name,
    linkId: file.linkid,
    embedUrl: embedUrl(file.linkid),
    sizeMB: Math.round((file.size ?? 0) / 1024 / 1024),
    converted: (file.convert ?? "") === "converted",
  });
}

const subtitles = new Map();
if (subsFolder) {
  for (const file of await listFiles(subsFolder)) {
    const parsed = parseName(file.name);
    if (!parsed) continue;
    subtitles.set(`${parsed.season}-${parsed.episode}`, file.name);
  }
}

const rows = [...episodes.values()].sort((a, b) => a.season - b.season || a.episode - b.episode);

console.log("");
console.log(`Streamtape klasörü: ${folder || "(kök)"}`);
console.log(
  `Çözülen bölüm: ${rows.length}${skipped ? ` · adı çözülemeyen dosya: ${skipped}` : ""}`,
);
console.log(
  rows.length
    ? `Aralık: S${rows[0].season}B${rows[0].episode} … S${rows.at(-1).season}B${rows.at(-1).episode}`
    : "",
);
console.log("");
console.log("Bölüm | Embed adresi | Altyazı | Boyut");
console.log("-".repeat(78));
for (const row of rows) {
  const label = `S${row.season}B${row.episode}`.padEnd(7);
  const subs = subtitles.get(`${row.season}-${row.episode}`) ?? "—";
  console.log(`${label}| ${row.embedUrl} | ${subs} | ${row.sizeMB} MB`);
}

const missingSubs = rows.filter((row) => !subtitles.has(`${row.season}-${row.episode}`));
if (subtitles.size) {
  console.log("");
  console.log(`Altyazısı bulunan bölüm: ${rows.length - missingSubs.length}/${rows.length}`);
  if (missingSubs.length) {
    console.log(
      `Altyazısı eksik: ${missingSubs.map((r) => `S${r.season}B${r.episode}`).join(", ")}`,
    );
  }
}

// Altyazıyı oynatıcıya verme notu (Streamtape embed parametreleri).
console.log("");
console.log(
  "Altyazı notu: Streamtape embed'i `?c1_label=TR&c1_file=<adres>` ile altyazı yükler ve",
);
console.log(".srt ile .vtt'yi kabul eder — ama `c1_file` tarayıcının DOĞRUDAN indirebildiği bir");
console.log("adres olmalı; Streamtape'teki /v/<id> sayfası ham dosya değildir. Altyazıların");
console.log("sitenin kendi alanına (ör. Supabase Storage public bucket) konması gerekir.");

if (process.argv.includes("--json")) {
  writeFileSync(
    new URL("../streamtape-episodes.json", import.meta.url),
    `${JSON.stringify({ folder, count: rows.length, episodes: rows }, null, 2)}\n`,
    "utf8",
  );
  console.log("");
  console.log("Yazıldı: streamtape-episodes.json");
}

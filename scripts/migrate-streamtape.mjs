#!/usr/bin/env node
/**
 * Streamtape'teki KENDİ dosyalarını indirir — böylece içeriği kendi depolamana
 * taşıyıp Fluid Player ile oynatabilirsin.
 *
 * NEDEN BU YOL: Fluid Player bir iframe oynatamaz; Streamtape videosunu Fluid
 * Player'da oynatmanın TEK meşru yolu dosyanın sende olmasıdır. Bunun için
 * Streamtape'in KENDİ resmî indirme API'si kullanılır (`/file/dlticket` →
 * `/file/dl`) — bu, hesap sahibinin kendi içeriğini indirmesi için belgelenmiş
 * yoldur. (Embed'in reklamlarını filtreleyip ham dosyayı siteye gömmek ise
 * Streamtape Şartlar ve Koşulları'nın "Prohibited Activities" bölümüne aykırıdır
 * ve hesap + kazanç kaybıyla sonuçlanır. Ayrıntı: docs/OYNATICI-FLUIDPLAYER.md)
 *
 * Kullanım:
 *   node scripts/migrate-streamtape.mjs                    → plan (hiçbir şey indirmez)
 *   node scripts/migrate-streamtape.mjs --download --limit 1
 *   node scripts/migrate-streamtape.mjs --download          → hepsini indirir
 *
 * İndirilen dosyalar `media/` klasörüne yazılır (gitignore'da).
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.streamtape.com";
const OUT_DIR = fileURLToPath(new URL("../media/", import.meta.url));

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
      if (!env[key]) env[key] = trimmed.slice(index + 1).trim();
    }
  } catch {
    /* .env yoksa ortam değişkenleriyle devam */
  }
  return env;
}

const env = loadEnv();
const login = env["STREAMTAPE_LOGIN"];
const key = env["STREAMTAPE_KEY"];
const folder = env["STREAMTAPE_FOLDER"] || "";

if (!login || !key) {
  console.error("Eksik: STREAMTAPE_LOGIN ve/veya STREAMTAPE_KEY (.env).");
  process.exit(1);
}

const args = process.argv.slice(2);
const doDownload = args.includes("--download");
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number.parseInt(args[limitArg + 1] ?? "0", 10) : 0;

const api = async (path, params = {}) => {
  const query = new URLSearchParams({ ...params, login, key });
  const response = await fetch(`${API}${path}?${query.toString()}`);
  const payload = await response.json();
  if (payload.status !== 200)
    throw new Error(`Streamtape API hatası (${payload.status}): ${payload.msg}`);
  return payload.result;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Resmî indirme akışı: bilet al → wait_time bekle → ham adresi al. */
async function directUrl(linkId) {
  const ticket = await api("/file/dlticket", { file: linkId });
  const waitSeconds = Math.max(1, Number(ticket.wait_time) || 1);
  await sleep((waitSeconds + 1) * 1000);
  const resolved = await api("/file/dl", { file: linkId, ticket: ticket.ticket });
  return { url: resolved.url, size: Number(resolved.size) || 0 };
}

const files = (await api("/file/listfolder", folder ? { folder } : {})).files ?? [];
const plan = files
  .filter((file) => (file.convert ?? "") === "converted")
  .sort((a, b) => String(a.name).localeCompare(String(b.name)));

const totalBytes = plan.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
console.log("");
console.log(`Kaynak klasör : ${folder || "(kök)"}  (${plan.length} dosya)`);
console.log(`Toplam boyut  : ${mb(totalBytes)}`);
console.log(`Hedef klasör  : media/`);
console.log(`Mod           : ${doDownload ? "İNDİR" : "PLAN (indirmez — --download ekle)"}`);
console.log("");

if (!doDownload) {
  for (const file of plan) console.log(`  ${file.name}  (${mb(Number(file.size) || 0)})`);
  console.log("");
  console.log("İndirmek için: node scripts/migrate-streamtape.mjs --download");
  console.log("Tek dosya dene: node scripts/migrate-streamtape.mjs --download --limit 1");
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });

const targets = limit > 0 ? plan.slice(0, limit) : plan;
let done = 0;
let failed = 0;

for (const file of targets) {
  const localPath = join(OUT_DIR, file.name);

  const expected = Number(file.size) || 0;
  const existing = existsSync(localPath) ? statSync(localPath).size : 0;

  // Tamamen inmişse atla (yeniden çalıştırma kaldığı yerden devam eder).
  if (existing > 0 && expected > 0 && existing === expected) {
    console.log(`  = atlandı (zaten tam): ${file.name}`);
    done += 1;
    continue;
  }

  process.stdout.write(
    `  ↓ ${file.name} (${mb(expected)})${existing > 0 ? ` [${mb(existing)} noktasından devam]` : ""} … `,
  );
  try {
    const { url } = await directUrl(file.linkid);
    // KALDIĞI YERDEN DEVAM: yarım dosya varsa `Range: bytes=<boyut>-` gönderilir.
    // Streamtape CDN'i Range destekliyor (doğrulandı: 206 Partial Content +
    // `Content-Range: bytes 200000000-287181688/287181689`). 206 dönerse veri
    // dosyanın SONUNA eklenir; 200 dönerse (desteklemiyor) baştan yazılır —
    // iki durumda da sonuç doğru. Böylece 15 dakikalık arka plan pencerelerine
    // bölünen indirmeler ilerlemeyi kaybetmez.
    const headers = existing > 0 ? { Range: `bytes=${existing}-` } : undefined;
    const response = await fetch(url, headers ? { headers } : {});
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

    const resuming = existing > 0 && response.status === 206;
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(localPath, resuming ? { flags: "a" } : {}),
    );

    const finalSize = statSync(localPath).size;
    if (expected > 0 && finalSize !== expected) {
      throw new Error(
        `boyut tutmadı: ${finalSize} / ${expected} (sonraki çalıştırmada devam eder)`,
      );
    }
    console.log("tamam");
    done += 1;
  } catch (error) {
    console.log(`HATA: ${error instanceof Error ? error.message : String(error)}`);
    failed += 1;
  }
}

console.log("");
console.log(`Bitti: ${done} dosya indirildi, ${failed} hata.`);
console.log("");
console.log("SONRAKİ ADIM — dosyaları yayına almak:");
console.log("  1) Cloudflare R2 kovası aç (depolama ~$0,015/GB/ay, ÇIKIŞ TRAFİĞİ ÜCRETSİZ).");
console.log(
  "  2) media/ içeriğini kovaya yükle ve bir alt alan adına bağla (ör. media.shanime.xyz).",
);
console.log("  3) Yükleme sonrası her bölümün play_url'ünü o adrese çevir; Fluid Player");
console.log("     VAST ad-pod'unu (2 x 5 sn atlanabilir) kendisi oynatır — iframe yok,");
console.log("     sağlayıcı reklamı yok, CAPTCHA yok, reklam gelirinin %100'ü sende.");

/**
 * Yerel bölüm kapaklarını R2'ye taşır ve yalnızca bütün public URL'ler
 * doğrulandıktan sonra R2 anahtar manifestini günceller.
 *
 * Bu betik yerel dosyaları SİLMEZ. Silme işlemi, URL doğrulamasından sonra
 * ayrı ve bilinçli bir bakım adımıdır.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AwsClient } from "aws4fetch";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coversDir = resolve(root, "public/static/episode-covers");
const manifestPath = resolve(root, "src/data/episode-cover-files.json");
const allowed = /\.(?:jpe?g|png|webp|avif)$/i;

function loadEnv() {
  const env = { ...process.env };
  for (const file of [".dev.vars", ".env", ".env.local"]) {
    try {
      for (const line of readFileSync(resolve(root, file), "utf8").split(/\r?\n/)) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
        if (match && !env[match[1]]) env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
      }
    } catch {
      /* optional environment file */
    }
  }
  return env;
}

function collectFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectFiles(full));
    else if (allowed.test(entry.name)) found.push(full);
  }
  return found.sort();
}

function contentType(file) {
  const ext = extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".avif") return "image/avif";
  return "image/jpeg";
}

function objectKey(file) {
  const name = relative(coversDir, file).split(/\\/g).join("/");
  return `covers/${name}`;
}

function objectUrl(endpoint, key) {
  return `${endpoint}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

const env = loadEnv();
const required = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_URL",
];
const missing = required.filter((key) => !env[key]);
if (missing.length) throw new Error(`Eksik R2 değişkenleri: ${missing.join(", ")}`);
if (!existsSync(coversDir))
  throw new Error("Yerel kapak klasörü bulunamadı; manifest güncellenmedi.");

const files = collectFiles(coversDir);
if (!files.length) throw new Error("Yerel kapak bulunamadı; manifest güncellenmedi.");

const client = new AwsClient({
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  service: "s3",
  region: "auto",
});
const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}`;
const publicBase = env.R2_PUBLIC_URL.replace(/\/+$/, "");
const verifiedKeys = [];

console.log(`R2 taşıması başlıyor: ${files.length} kapak`);
for (const file of files) {
  const key = objectKey(file);
  const put = await client.fetch(objectUrl(endpoint, key), {
    method: "PUT",
    headers: {
      "Content-Type": contentType(file),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
    body: readFileSync(file),
  });
  if (!put.ok) throw new Error(`${key}: R2 yazma hatası (${put.status})`);

  const publicResponse = await fetch(`${publicBase}/${key}`, {
    method: "HEAD",
    signal: AbortSignal.timeout(20000),
  });
  if (!publicResponse.ok) {
    throw new Error(`${key}: public doğrulama hatası (${publicResponse.status})`);
  }
  verifiedKeys.push(key);
  console.log(`  ok ${key}`);
}

writeFileSync(manifestPath, `${JSON.stringify(verifiedKeys, null, 2)}\n`, "utf8");
console.log(`Tamamlandı: ${verifiedKeys.length} R2 URL doğrulandı.`);
console.log(`Manifest güncellendi: ${relative(root, manifestPath)}`);
console.log("Yerel dosyalar korunuyor; silme bu betiğin parçası değil.");

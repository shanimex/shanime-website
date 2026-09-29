/**
 * `public/static/episode-covers/` klasörünü tarayıp `src/data/episode-cover-files.json`
 * dosyasını üretir — yani "bu klasörde GERÇEKTEN var olan kapak dosyaları" listesi.
 *
 * ── NEDEN VAR ────────────────────────────────────────────────────────────────
 * Arayüzdeki `localCoverPath(slug, sezon, bölüm)` eskiden yolu KÖRLEMESİNE
 * kuruyordu: `/static/episode-covers/<slug>-s<sezon>e<bölüm>.jpg`. Ama klasör
 * projede HİÇ YOKTU; bu yüzden her bölüm kartı bu adrese bir istek atıyor ve
 * %100 **404** alıyordu (tarayıcı konsolunda görünen 404'lerin kaynağı buydu).
 *
 * Artık `localCoverPath` yalnızca bu manifest'te KAYITLI yolu döndürür. Klasör
 * yoksa manifest boş liste olur ve hiçbir istek atılmaz → **0 404**.
 *
 * Kullanım:  npm run covers:manifest
 * (Yeni bir yerel kapak dosyası koyduysan bu betiği yeniden çalıştır.)
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coversDir = resolve(root, "public/static/episode-covers");
/** Arayüzün beklediği genel önek (Vite `public/` kökünde servis edilir). */
const URL_PREFIX = "/static/episode-covers/";
const ALLOWED_EXT = /\.(?:jpe?g|png|webp|avif)$/i;
const OUT = resolve(root, "src/data/episode-cover-files.json");

/** Klasörü (alt klasörler dâhil) tarar, URL yollarını sıralı döndürür. */
function collectFiles() {
  if (!existsSync(coversDir)) return [];
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (ALLOWED_EXT.test(entry.name)) {
        // Yol ayırıcıları URL'de "/" olmalı (Windows'ta "\" gelir).
        found.push(URL_PREFIX + relative(coversDir, full).split(/[\\/]/).join("/"));
      }
    }
  };
  walk(coversDir);
  return found.sort();
}

const files = collectFiles();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(files, null, 2)}\n`, "utf8");

if (files.length === 0) {
  console.log(
    `Yerel bölüm kapağı yok (${relative(root, coversDir)} klasörü ${existsSync(coversDir) ? "boş" : "yok"}) → boş liste yazıldı: ${relative(root, OUT)}`,
  );
} else {
  console.log(`${files.length} yerel kapak bulundu → ${relative(root, OUT)}`);
  for (const file of files) console.log(`  ${file}`);
}

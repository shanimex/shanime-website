/**
 * `public/static/anime-data/<slug>/anime-logo.<ext>` dosyalarını tarayıp
 * `src/data/anime-logo-files.json` dosyasını üretir — yani "GERÇEKTEN var olan
 * vitrin logosu dosyaları" listesi.
 *
 * ── NEDEN VAR ────────────────────────────────────────────────────────────────
 * Ana sayfadaki vitrin başlığı (`ShowLogo`) eskiden uzantıyı KÖRLEMESİNE
 * deniyordu: önce `anime-logo.png`, sonra `anime-logo.svg`. Bazı serilerde
 * yalnız `.svg` vardır (ör. `mushoku-tensei`); o seride tarayıcı önce
 * `anime-logo.png` isteyip %100 **404** alıyordu.
 *
 * Artık `logoCandidates()` yalnızca bu manifest'te KAYITLI yolu döndürür;
 * var olmayan uzantı hiç istenmez → **0 404**, logo yine görünür.
 *
 * Desen, diğer statik varlık manifestleriyle aynı yürüyüş kuralını kullanır.
 *
 * Kullanım:  npm run logos:manifest
 * (Yeni bir vitrin logosu koyduysan bu betiği yeniden çalıştır.)
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, "public/static/anime-data");
/** Arayüzün beklediği genel önek (Vite `public/` kökünde servis edilir). */
const URL_PREFIX = "/static/anime-data/";
/** Yalnızca vitrin logosu adı ve resim uzantıları. */
const LOGO_NAME = /^anime-logo\.(?:png|svg|jpe?g|webp|avif|gif)$/i;
const OUT = resolve(root, "src/data/anime-logo-files.json");

/** `anime-data` altındaki her seri klasöründe vitrin logosunu arar. */
function collectFiles() {
  if (!existsSync(dataDir)) return [];
  const found = [];
  for (const entry of readdirSync(dataDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const slugDir = join(dataDir, entry.name);
    for (const file of readdirSync(slugDir, { withFileTypes: true })) {
      if (!file.isFile() || !LOGO_NAME.test(file.name)) continue;
      // Yol ayırıcıları URL'de "/" olmalı (Windows'ta "\\" gelir).
      found.push(URL_PREFIX + [entry.name, file.name].join("/"));
    }
  }
  return found.sort();
}

const files = collectFiles();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(files, null, 2)}\n`, "utf8");

if (files.length === 0) {
  console.log(
    `Vitrin logosu yok (${relative(root, dataDir)} klasörü ${existsSync(dataDir) ? "boş" : "yok"}) → boş liste yazıldı: ${relative(root, OUT)}`,
  );
} else {
  console.log(`${files.length} vitrin logosu bulundu → ${relative(root, OUT)}`);
  for (const file of files) console.log(`  ${file}`);
}

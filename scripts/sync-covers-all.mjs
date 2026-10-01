/**
 * BÜTÜN KAPAK İŞLERİNİ TEK KOMUTTA ÇALIŞTIRIR — "BİR KEZ KUR, HEP ÇALIŞSIN".
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NE YAPAR (sırayla)
 * ═══════════════════════════════════════════════════════════════════════════
 *   1) resolve-season-mal-ids.mjs → sezon MAL kimlikleri (otomatik)
 *   2) sync-anizip-covers.mjs     → TVDB bölüm görselleri (`anizipCover` kaynağı)
 *   3) sync-anizip-local-covers.mjs → TVDB görselinden YEREL kapak dosyaları
 *   4) generate-episode-cover-manifest.mjs → arayüzün okuduğu liste
 *
 * NOT (TVDB-TEK KAYNAK): eski "oynatıcı kareleri" adımı (`sync-video-covers.mjs`)
 * zincirden ÇIKARILDI — video karesi başka bir kaynaktır ve bölüm kapakları
 * yalnızca TVDB'den gelir.
 *
 * Bu betik **prebuild** olarak bağlıdır (`package.json`): yani `npm run build`
 * her çalıştığında kapaklar YENİDEN ve OTOMATİK olarak tazelenir. Yeni bir anime
 * ya da bölüm eklendiğinde ek bir şey yapmak gerekmez — sıradaki derlemede
 * kapaklar kendiliğinden gelir.
 *
 * NEDEN GÜVENLİ: her adım `--best-effort` mantığıyla koşar. Ağ yoksa, `.env`
 * yoksa veya Supabase yanıt vermezse betik SESSİZCE atlar ve **0 ile çıkar**;
 * yani derlemeyi asla kırmaz. Kapaklar eksik kalırsa site yine çalışır, sadece
 * eski kapaklarla devam eder.
 *
 * KULLANIM
 *   node scripts/sync-covers-all.mjs            # hepsi, hata olsa da devam
 *   node scripts/sync-covers-all.mjs --strict   # hata olursa 1 ile çıkar (elle denetim)
 *   node scripts/sync-covers-all.mjs --quiet    # yalnızca özet
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const STRICT = args.includes("--strict");
const QUIET = args.includes("--quiet");

/** Sırayla çalışacak adımlar. `label` yalnızca günlük içindir. */
const steps = [
  // Sezon MAL kimlikleri ÖNCE çözülür: AniList'in PREQUEL/SEQUEL zincirinden
  // otomatik bulunur. Böylece çok sezonlu serilerin sonraki sezonları için
  // panele elle kimlik girmek GEREKMEZ (Jujutsu Kaisen S2/S3 gibi).
  { label: "Sezon MAL kimlikleri (otomatik)", script: "scripts/resolve-season-mal-ids.mjs" },
  { label: "TVDB bölüm görselleri", script: "scripts/sync-anizip-covers.mjs" },
  // Yalnızca TVDB görselinden yerel kapak dosyaları. TVDB'de görsel YOKSA dosya
  // yazılmaz (animecix / sağlayıcı karesi / seri posteri yedeği KALDIRILDI).
  { label: "TVDB'den yerel kapaklar", script: "scripts/sync-anizip-local-covers.mjs" },
  { label: "Manifest", script: "scripts/generate-episode-cover-manifest.mjs" },
];

function run(script) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [script], {
      cwd: root,
      stdio: QUIET ? "pipe" : "inherit",
    });
    child.on("error", () => done(-1));
    child.on("close", (code) => done(code ?? -1));
  });
}

console.log("kapak senkronu başlıyor…");
let failed = 0;
for (const step of steps) {
  const file = resolve(root, step.script);
  if (!existsSync(file)) {
    console.log(`  ! atlandı (dosya yok): ${step.script}`);
    failed += 1;
    continue;
  }
  console.log(`  → ${step.label}`);
  const code = await run(step.script);
  if (code !== 0) {
    console.log(`  ! ${step.label} hata verdi (çıkış ${code}) — devam ediliyor`);
    failed += 1;
  }
}

if (failed === 0) {
  console.log("kapak senkronu tamam.");
} else {
  console.log(`kapak senkronu ${failed} adımda sorunla bitti (derleme yine de devam eder).`);
}
// Derlemeyi kırmamak için varsayılan olarak 0 döner.
process.exit(STRICT && failed > 0 ? 1 : 0);

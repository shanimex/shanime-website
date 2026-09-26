/**
 * İçerik sağlık taraması — panel verisi bozuk mu?
 *
 * NEDEN VAR: "0. sezon 12 bölüm" görünümü ve "bazı linkler çalışmıyor"
 * şikâyetleri tek tek bakılarak bulunmuştu. Bu betik aynı kontrolleri tek
 * komuta indirir, böylece yeni içerik ekledikten sonra bir kez çalıştırmak yeter.
 *
 * KONTROLLER
 *   1. `watch_url` bozuk mu? ("https://...https//..." gibi karışmış adresler,
 *      geçersiz protokol, boşluk/ters bölü içeren değerler)
 *   2. `@sağlayici` direktifi tanınan bir sağlayıcı mı? (yazım hatası = boş oynatıcı)
 *   3. Bölümü olan ama `show_seasons` kaydı olmayan sezon var mı?
 *      ("0 sezon · N bölüm" görünümünün sebebi budur. Panelde
 *      "Sezon kaydını oluştur" düğmesiyle kalıcı hâle getirilir.)
 *   4. Hiç sezon kaydı olmayan dizi var mı?
 *   5. `site_settings` içinde hangi reklam slotu dolu/boş?
 *      (Panelde kodların "boş görünmesi" = satır hiç kaydedilmemiş demektir;
 *      o durumda site koddaki varsayılan reklam birimlerini gösterir.)
 *
 * Yalnızca OKUMA yapar — hiçbir kaydı değiştirmez. Anon anahtar yazamaz (RLS),
 * düzeltmeler panelden veya Supabase SQL Editor'den yapılır.
 *
 * Kullanım: node scripts/audit-content.mjs
 */
import { readFileSync } from "node:fs";

/** `embed-provider.ts` içindeki `EmbedProviderId` değerleriyle aynı olmalı. */
const KNOWN_PROVIDERS = ["none", "megaplay", "vidsrc", "videasy", "anizm"];

/** Panelin kullandığı reklam slotları (bkz. components/AdSlot.tsx). */
const AD_SLOTS = [
  "ad_home",
  "ad_detail_top",
  "ad_detail_bottom",
  "ad_watch_top",
  "ad_watch_bottom",
  "ad_preroll",
];

function readEnv() {
  const env = {};
  for (const name of [".env", ".env.local"]) {
    try {
      for (const line of readFileSync(name, "utf8").split("\n")) {
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
const URL_ = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
const KEY = env.SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!URL_ || !KEY) {
  console.error("Supabase adresi/anahtarı .env içinde bulunamadı.");
  process.exit(1);
}
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const get = async (path) => {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`Supabase ${res.status} (${path})`);
  return res.json();
};

/** `watch_url` sağlıklı mı? `@sağlayici` ya da geçerli bir https adresi olmalı. */
function urlStatus(value) {
  const v = String(value ?? "").trim();
  if (v === "") return { ok: false, why: "boş" };
  if (v.startsWith("@")) {
    const id = v.slice(1);
    return KNOWN_PROVIDERS.includes(id)
      ? { ok: true, why: "" }
      : { ok: false, why: `bilinmeyen sağlayıcı direktifi (@${id})` };
  }
  try {
    const parsed = new URL(v);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, why: "protokol http/https değil" };
    }
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(parsed.hostname)) {
      return { ok: false, why: "alan adı geçersiz" };
    }
    if (/https?\/\/|\\|\s/.test(v)) return { ok: false, why: "adres karışmış" };
    return { ok: true, why: "" };
  } catch {
    return { ok: false, why: "adres ayrıştırılamadı" };
  }
}

const [shows, seasons, episodes] = await Promise.all([
  get("shows?select=id,slug,title,mal_id&order=title"),
  get("show_seasons?select=id,show_id,number,title"),
  get("show_episodes?select=show_id,season,number,title,watch_url"),
]);

console.log(`Diziler: ${shows.length} · sezon kayıtları: ${seasons.length} · bölümler: ${episodes.length}\n`);

console.log("=== DİZİ ÖZETİ ===");
for (const show of shows) {
  const seasonRows = seasons.filter((s) => s.show_id === show.id);
  const eps = episodes.filter((e) => e.show_id === show.id);
  const flag = seasonRows.length === 0 && eps.length > 0 ? "  ⚠ SEZON KAYDI YOK" : "";
  console.log(
    `  ${show.slug.padEnd(32)} MAL=${String(show.mal_id ?? "-").padEnd(7)} ` +
      `sezon=${seasonRows.length} bölüm=${eps.length}${flag}`,
  );
}

console.log("\n=== 1) BOZUK / ÇALIŞMAYAN BAĞLANTI ===");
let broken = 0;
for (const show of shows) {
  for (const ep of episodes.filter((e) => e.show_id === show.id)) {
    const status = urlStatus(ep.watch_url);
    if (!status.ok) {
      broken += 1;
      console.log(
        `  ${show.slug} S${ep.season}B${ep.number} → ${status.why}: ${String(ep.watch_url).slice(0, 90)}`,
      );
    }
  }
}
if (broken === 0) console.log("  sorun yok");

console.log("\n=== 3) SEZON KAYDI EKSİK (bölümü var, sezon satırı yok) ===");
let virtualSeasons = 0;
for (const show of shows) {
  const seasonRows = new Set(seasons.filter((s) => s.show_id === show.id).map((s) => s.number));
  const epSeasons = [...new Set(episodes.filter((e) => e.show_id === show.id).map((e) => e.season))]
    .sort((a, b) => a - b);
  const missing = epSeasons.filter((n) => !seasonRows.has(n));
  if (missing.length > 0) {
    virtualSeasons += missing.length;
    console.log(`  ${show.slug}: eksik sezon → [${missing}] (panel: "Sezon kaydını oluştur")`);
  }
}
if (virtualSeasons === 0) console.log("  sorun yok");

console.log("\n=== 4) SAYI TUTARSIZLIĞI (sezon <= 0 / bölüm <= 0) ===");
let odd = 0;
for (const show of shows) {
  for (const s of seasons.filter((x) => x.show_id === show.id)) {
    if (!(Number(s.number) > 0)) {
      odd += 1;
      console.log(`  ${show.slug}: sezon kaydı number=${JSON.stringify(s.number)}`);
    }
  }
  for (const e of episodes.filter((x) => x.show_id === show.id)) {
    if (!(Number(e.season) > 0) || !(Number(e.number) > 0)) {
      odd += 1;
      console.log(`  ${show.slug}: bölüm S${e.season}B${e.number} numarası geçersiz`);
    }
  }
}
if (odd === 0) console.log("  sorun yok");

console.log("\n=== 5) REKLAM SLOTLARI (site_settings) ===");
const settings = await get("site_settings?select=key,value");
const map = new Map(settings.map((r) => [r.key, String(r.value ?? "")]));
for (const slot of AD_SLOTS) {
  const value = map.get(slot);
  console.log(
    `  ${slot.padEnd(18)} ${value === undefined ? "KAYIT YOK (kod varsayılanı gösterilir)" : `${value.length} karakter`}`,
  );
}
const others = settings.filter((r) => !AD_SLOTS.includes(r.key));
if (others.length > 0) {
  console.log(`  diğer anahtarlar: ${others.map((r) => r.key).join(", ")}`);
}

console.log(
  `\nÖZET: bozuk bağlantı ${broken} · eksik sezon kaydı ${virtualSeasons} · numara sorunu ${odd}`,
);
console.log("Düzeltmeler panelden yapılır (anon anahtar RLS nedeniyle yazamıyor).");

/**
 * Bölüm kapaklarını sağlayıcıdan çekip `src/data/episode-posters.json` dosyasına yazar.
 *
 * Neden gerekli: panelde bölüme yalnızca embed adresi girilir. Kapakların
 * adresini sağlayıcı üretiyor ama adres KODDAN TÜRETİLEMİYOR:
 *
 *   vidmoly  : https://vidmoly.org/embed-<kod>.html
 *              → og:image / player `image:` → https://<cdn>.vmwesa.online/i/01/02950/<kod>.jpg
 *                (CDN alan adı ve 01/02950 yolu sağlayıcıya özel)
 *   morencius: https://morencius.com/embed/<kod>  →  https://pixibay.cc/<kod>.jpg  (türetilebilir)
 *
 * Bu yüzden kapaklar BİR KEZ çekilip dosyaya yazılır; arayüz çalışma anında
 * dış istek yapmaz (tarayıcıda CORS engeli yok, sayfa yavaşlamaz).
 *
 * Kullanım:  node scripts/sync-episode-covers.mjs
 * Yeni bölüm ekledikten sonra bu betiği çalıştır.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(root, "src/data/episode-posters.json");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

/** .env içinden Supabase bağlantısını okur (bağımlılık eklememek için elle). */
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

if (!SUPA_URL || !SUPA_KEY) {
  console.error("Supabase adresi/anahtarı .env içinde bulunamadı.");
  process.exit(1);
}

const headers = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };

async function api(path) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

/** `embed-<kod>.html`, `embed/<kod>`, `<kod>.html` gibi biçimlerden kodu çıkarır. */
function codeFromWatchUrl(url) {
  if (!url) return "";
  const clean = url.split(/[?#]/)[0];
  const last = clean.split("/").filter(Boolean).pop() ?? "";
  const m = /embed-([a-z0-9]{6,})\.html$/i.exec(last) ?? /^([a-z0-9]{6,})\.html$/i.exec(last);
  if (m) return m[1];
  return /^[a-z0-9]{6,}$/i.test(last) ? last : "";
}

/** VidMoly kapak adresini embed sayfasından okur (og:image → player `image:`). */
async function vidmolyPoster(code) {
  const res = await fetch(`https://vidmoly.org/embed-${code}.html`, {
    headers: { "user-agent": UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return "";
  const html = await res.text();
  // Player yapılandırmasındaki `image:` en güvenilir kaynak; og:image bazen logo oluyor.
  const direct = /image\s*:\s*["']([^"']+_?\.(?:jpg|jpeg|png|webp))["']/i.exec(html);
  if (direct) return direct[1];
  const decoded = decodeURIComponent(html);
  const decodedMatch = /https:\/\/[^\s"'<>\\]+_p\.jpg/.exec(decoded);
  return decodedMatch?.[0] ?? "";
}

async function main() {
  const shows = await api("shows?select=id,slug,title");

  // Önceki çalıştırmanın sonucu. Tek tek çekim başarısız olursa (sağlayıcı geçici
  // olarak yanıt vermezse) o bölümün ESKİ kapağı korunur; aksi hâlde yarım bir
  // çalıştırma çalışan kapakları silerdi.
  let previous = {};
  try {
    previous = JSON.parse(readFileSync(OUT, "utf8"));
  } catch {
    /* ilk çalıştırma */
  }

  const store = {};
  let ok = 0;
  let kept = 0;
  let missing = 0;

  for (const show of shows) {
    if (!show.slug) continue;
    const eps = await api(
      `show_episodes?show_id=eq.${show.id}&select=season,number,watch_url&order=number.asc`,
    );
    for (const ep of eps) {
      const code = codeFromWatchUrl(ep.watch_url);
      if (!code) {
        missing += 1;
        continue;
      }
      let poster = "";
      try {
        poster = /vidmoly/i.test(ep.watch_url)
          ? await vidmolyPoster(code)
          : /morencius/i.test(ep.watch_url)
            ? `https://pixibay.cc/${code}.jpg`
            : "";
      } catch (error) {
        console.warn(`  ! ${show.slug} S${ep.season}B${ep.number}: ${error.message}`);
      }
      const key = `${show.slug}-s${ep.season}e${ep.number}`;
      if (poster) {
        store[key] = poster;
        ok += 1;
      } else if (previous[key]) {
        store[key] = previous[key];
        kept += 1;
        console.warn(`  ~ ${key}: yenisi alınamadı, eski kapak korundu (${code})`);
      } else {
        missing += 1;
        console.warn(`  ! ${key}: kapak bulunamadı (${code})`);
      }
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  console.log(
    `\n${ok} kapak yazıldı, ${kept} korundu, ${missing} eksik → src/data/episode-posters.json`,
  );
}

await main();

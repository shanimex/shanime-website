/**
 * Bölümler için anizm/puffy oynatıcı hash'lerini çözer ve
 * `src/data/anizm-hashes.json` dosyasına yazar.
 *
 * NEDEN: anizm/puffy hattı, Türkçe altyazısı GÖMÜLÜ + pre-roll'süz + pop-up'suz
 * bir oynatıcı veriyor (ölçüm: docs/SAGLAYICI-VE-KAPAK-ARASTIRMASI.md §23):
 *   https://anizmplayer.com/video/b5725710206a2753ff5a685c2a52365e
 *   → iframe'de oynuyor, 1080p, "advertising": [], 0 pop-up, oynatıcı watermark'ı yok.
 * Ama **hash bölüme özel** ve sarmalayıcı (`puffytr.com/player/<id>`) referer
 * korumalı: referer'sız 404, yalnızca `Referer: https://puffytr.com/` ile 302.
 * Bu betik o zinciri kurar.
 *
 * ZİNCİR (her bölüm için):
 *   1) https://puffytr.com/{slug}            → bölüm linkleri  ({slug}-{n}-bolum-izle)
 *   2) https://puffytr.com/{slug}-{n}-...    → episode/<id> + translator/<id>
 *   3) https://puffytr.com/episode/{id}/translator/{tid} → sunucu listesi (video/<vid>)
 *   4) HEAD /player/<vid>  (Referer: puffytr) → 302 → anizmplayer.com/video/<hash>
 *
 * ⚠️ DİKKAT — 4. adım bilinçli bir tercihtir: puffytr'ın hotlink (referer)
 * kontrolünü taklit eder. Tek satırlık bir değişiklikle kırılabilir; kırılırsa
 * betik bunu "çözülemedi" olarak raporlar, site tarafı boş kalır (oynatıcı
 * "video yok" der), hiçbir şey bozulmaz.
 *
 * KULLANIM
 *   node scripts/resolve-anizm-hashes.mjs                  # eksikleri çözer
 *   node scripts/resolve-anizm-hashes.mjs --slug erased    # tek dizi
 *   node scripts/resolve-anizm-hashes.mjs --limit 10       # en fazla 10 bölüm
 *   node scripts/resolve-anizm-hashes.mjs --dry            # yazmaz, ne bulduğunu söyler
 *   node scripts/resolve-anizm-hashes.mjs --force          # var olanları da yeniler
 *
 * Betik İDEMPOTENTTİR: var olan hash'i atlar (aksini `--force` söyler).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = resolve(root, "src/data/anizm-hashes.json");
const PUFFY = "https://puffytr.com";
const REFERER = `${PUFFY}/`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const FORCE = args.includes("--force");
const LIMIT = (() => {
  const at = args.indexOf("--limit");
  return at >= 0 ? Number(args[at + 1]) : Number.POSITIVE_INFINITY;
})();
const ONLY_SLUG = (() => {
  const at = args.indexOf("--slug");
  return at >= 0 ? String(args[at + 1] ?? "").trim() : "";
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

if (!SUPA_URL || !SUPA_KEY) {
  console.error("Supabase adresi/anahtarı .env içinde bulunamadı.");
  process.exit(1);
}

const supaHeaders = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };

async function supa(path) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: supaHeaders });
  if (!res.ok) throw new Error(`Supabase ${res.status} ${path}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sayfayı/JSON'u çeker. `redirect: "manual"` → 302'nin `location`'ı okunabilir. */
async function http(url, { method = "GET", referer } = {}) {
  const headers = { "User-Agent": UA, Accept: "text/html,application/json,*/*" };
  if (referer) headers["Referer"] = referer;
  const res = await fetch(url, { method, headers, redirect: "manual" });
  return {
    status: res.status,
    location: res.headers.get("location") ?? "",
    body: method === "HEAD" ? "" : await res.text(),
  };
}

/** Dizi sayfasından bölüm numarası → bölüm adresi haritası. */
function episodeLinks(html, slug) {
  const map = new Map();
  const re = new RegExp(`href="(?:https://puffytr\\.com)?/(${slug})-(\\d+)-bolum-izle"`, "g");
  for (const m of html.matchAll(re)) map.set(Number(m[2]), `${PUFFY}/${slug}-${m[2]}-bolum-izle`);
  return map;
}

/**
 * Tek bölüm için hash'i çözer.
 *
 * @param {string} episodeUrl  puffytr bölüm sayfası
 * @returns {Promise<{ok:boolean, hash?:string, server?:string, episodeId?:string,
 *                    translatorId?:string, titleNumber?:number, reason?:string}>}
 */
async function resolveEpisode(episodeUrl) {
  const page = await http(episodeUrl);
  if (page.status !== 200) return { ok: false, reason: `bölüm sayfası ${page.status}` };

  const episodeId = /episode\/(\d+)/.exec(page.body)?.[1];
  const translatorId = /translator\/(\d+)/.exec(page.body)?.[1];
  const titleNumber = Number(/(\d{1,4})\.\s*Bölüm/i.exec(page.body)?.[1] ?? 0) || undefined;
  if (!episodeId || !translatorId) return { ok: false, reason: "episode/translator id yok" };

  // Sunucu listesi AJAX'tan gelir. İlk çevirmen (fansub) sürümünde "Aincrad
  // (Reklamsız)" sunucusu bulunur; anizmplayer'a giden sunucu odur.
  const list = await http(`${PUFFY}/episode/${episodeId}/translator/${translatorId}`, {
    referer: REFERER,
  });
  if (list.status !== 200) {
    return { ok: false, reason: `sunucu listesi ${list.status}`, episodeId, translatorId };
  }

  // DİKKAT: gövde JSON'dur ve içindeki HTML kaçışlıdır
  // (`https:\/\/puffytr.com\/video\/1543980`, isimler `\u0131` gibi). Bu yüzden
  // önce JSON.parse edilir — regex'i ham gövdeye uygulamak eşleşmez.
  const markup = (() => {
    try {
      return String(JSON.parse(list.body)?.data ?? "");
    } catch {
      return "";
    }
  })();

  const servers = [
    ...markup.matchAll(
      /video="https:\/\/puffytr\.com\/video\/(\d+)"[^>]*?data-video-name="([^"]*)"/g,
    ),
  ].map((m) => ({ id: m[1], name: m[2] }));

  // Adında "Aincrad" geçen sunucu önce denenir, sonra diğerleri.
  const ordered = [
    ...servers.filter((s) => /aincrad/i.test(s.name)),
    ...servers.filter((s) => !/aincrad/i.test(s.name)),
  ];

  for (const server of ordered) {
    const head = await http(`${PUFFY}/player/${server.id}`, { method: "HEAD", referer: REFERER });
    const hash = /anizmplayer\.com\/video\/([0-9a-f]{16,})/i.exec(head.location)?.[1];
    if (hash) {
      return { ok: true, hash, server: server.name, episodeId, translatorId, titleNumber };
    }
    await sleep(250);
  }

  return {
    ok: false,
    reason: servers.length === 0 ? "sunucu bulunamadı" : "anizmplayer sunucusu yok",
    episodeId,
    translatorId,
    titleNumber,
  };
}

const store = existsSync(OUT_FILE) ? JSON.parse(readFileSync(OUT_FILE, "utf8")) : {};
const shows = await supa("shows?select=id,slug,title,mal_id");
const episodes = await supa("show_episodes?select=show_id,season,number");

let solved = 0;
let skipped = 0;
let failed = 0;
const problems = [];

for (const show of shows) {
  if (ONLY_SLUG && show.slug !== ONLY_SLUG) continue;

  const rows = episodes.filter((e) => e.show_id === show.id);
  if (rows.length === 0) continue;

  // puffytr sezonları SÜREKLİ numaralar ("Jujutsu Kaisen 25. Bölüm" = S2B1).
  // Bu yüzden (sezon, bölüm) → n eşlemesi kümülatif ofsetle kurulur.
  const bySeason = new Map();
  for (const e of rows) {
    if (!bySeason.has(e.season)) bySeason.set(e.season, []);
    bySeason.get(e.season).push(e);
  }
  const seasons = [...bySeason.keys()].sort((a, b) => a - b);

  let series = await http(`${PUFFY}/${show.slug}`);
  if (series.status !== 200 || !series.body.includes("bolum-izle")) {
    problems.push(`${show.slug}: puffytr dizi sayfası yok (${series.status})`);
    continue;
  }
  const links = episodeLinks(series.body, show.slug);
  if (links.size === 0) {
    problems.push(`${show.slug}: bölüm linki bulunamadı`);
    continue;
  }

  let offset = 0;
  for (const season of seasons) {
    const list = bySeason.get(season).sort((a, b) => a.number - b.number);
    for (const ep of list) {
      const n = offset + ep.number;
      const url = links.get(n);
      const key = `${show.mal_id ?? show.slug}-s${season}b${ep.number}`;

      if (!url) {
        problems.push(`${show.slug} S${season}B${ep.number}: puffytr'da ${n}. bölüm yok`);
        continue;
      }

      const previous = store[key];
      if (previous?.hash && !FORCE) {
        skipped += 1;
        continue;
      }
      if (solved >= LIMIT) continue;

      try {
        const found = await resolveEpisode(url);
        if (!found.ok) {
          failed += 1;
          problems.push(`${show.slug} S${season}B${ep.number} (n=${n}): ${found.reason}`);
        } else {
          if (found.titleNumber && found.titleNumber !== n) {
            problems.push(
              `${show.slug} S${season}B${ep.number}: başlık ${found.titleNumber}. bölüm diyor, beklenen ${n} — kayıt yine de yazıldı`,
            );
          }
          store[key] = {
            hash: found.hash,
            playerUrl: `https://anizmplayer.com/video/${found.hash}`,
            server: found.server,
            titleNumber: found.titleNumber ?? null,
            resolvedAt: new Date().toISOString().slice(0, 10),
          };
          solved += 1;
          console.log(
            `  ${show.slug} S${season}B${ep.number} → ${found.hash} (${found.server}, ${url})`,
          );
        }
      } catch (err) {
        failed += 1;
        problems.push(`${show.slug} S${season}B${ep.number}: ${err.message}`);
      }
      await sleep(600);
    }
    offset += list.length;
  }
}

if (!DRY) {
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, `${JSON.stringify(store, null, 2)}\n`);
  console.log(`\nYazıldı: ${OUT_FILE} (${Object.keys(store).length} kayıt)`);
} else {
  console.log("\n--dry: dosya YAZILMADI.");
}

console.log(`Özet: çözüldü=${solved} atlandı=${skipped} başarısız=${failed}`);
if (problems.length > 0) {
  console.log("\nSorunlar:");
  problems.slice(0, 25).forEach((p) => console.log("  - " + p));
}
console.log(
  "\nNot: bu adım puffytr'ın referer kontrolünü taklit eder. Kırılırsa yalnızca bu " +
    "kaynak boş kalır; megaplay + kendi altyazımız etkilenmez.",
);

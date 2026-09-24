// public/sitemap.xml dosyasını üretir: ana sayfa + tüm seri sayfaları.
//
// Kullanım:  npm run sitemap
// Yayına almadan önce bir kez çalıştır; seri ekledikçe tekrar çalıştır.
// Adres kökünü değiştirmek için:  SITE_URL=https://yenisite.com npm run sitemap

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = (process.env.SITE_URL ?? "https://shanime.xyz").replace(/\/+$/, "");

/** .env dosyasını okur (yoksa ortam değişkenleri kullanılır). */
function readEnv() {
  const out = {};
  try {
    for (const line of readFileSync(resolve(root, ".env"), "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      out[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env yok: ortam değişkenleriyle devam.
  }
  return out;
}

const env = readEnv();
const supabaseUrl = env.VITE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Supabase adresi/anahtarı bulunamadı. .env dosyasını kontrol et.");
  process.exit(1);
}

let shows = [];
try {
  const response = await fetch(`${supabaseUrl}/rest/v1/shows?select=slug,id&order=sort_order.asc`, {
    headers: { apikey: supabaseKey },
  });
  if (!response.ok) {
    console.error(`Supabase hatası (${response.status}): ${await response.text()}`);
    process.exit(1);
  }
  shows = await response.json();
} catch (error) {
  console.error("Supabase'e ulaşılamadı:", error instanceof Error ? error.message : error);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const entries = [
  { loc: `${SITE}/`, changefreq: "daily", priority: "1.0" },
  ...shows.map((show) => ({
    loc: `${SITE}/seri/${show.slug?.trim() ? show.slug : show.id}`,
    changefreq: "weekly",
    priority: "0.8",
  })),
];

const body = entries
  .map(
    (entry) =>
      `  <url>\n` +
      `    <loc>${entry.loc}</loc>\n` +
      `    <lastmod>${today}</lastmod>\n` +
      `    <changefreq>${entry.changefreq}</changefreq>\n` +
      `    <priority>${entry.priority}</priority>\n` +
      `  </url>`,
  )
  .join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;

writeFileSync(resolve(root, "public/sitemap.xml"), xml, "utf8");
console.log(`${entries.length} adres yazıldı → public/sitemap.xml (${SITE})`);

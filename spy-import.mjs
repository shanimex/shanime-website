// Spy x Family aktarimi — panel akisinin birebir aynisi (AnizipSyncPanel + AddShowButton).
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY);
const API = "http://localhost:8080";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[spy]", ...a);

// ---------- yardimcilar (panel ile ayni) ----------
function slugify(text) {
  const src = text.trim().toLocaleLowerCase("tr").replace(/[çğıöşü]/g, (c) => ({ ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" }[c]));
  return out_slug(src);
  function out_slug(s) {
    return s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "anime";
  }
}
const GENRE_TR = { Action: "Aksiyon", Adventure: "Macera", Comedy: "Komedi" };
function readTitle(v) {
  const pick = (x) => (typeof x === "string" ? x.trim() : "");
  const t = typeof v === "string" ? v.trim() : pick(v?.en) || pick(v?.x_jat) || pick(v?.ja) || pick(v?.tr);
  if (!t || /^episode\s*\d+$/i.test(t)) return "";
  return t;
}
async function anilistByMal(mal) {
  const q = `query ($m: Int) { Media(idMal: $m, type: ANIME) { idMal title { english romaji } format startDate { year } genres coverImage { extraLarge large } } }`;
  const r = await fetch("https://graphql.anilist.co", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q, variables: { m: mal } }) });
  const j = await r.json();
  return j.data?.Media ?? null;
}
async function catalog(mal) {
  const r = await fetch(`https://api.ani.zip/mappings?mal_id=${mal}`, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`anizip ${r.status}`);
  const j = await r.json();
  const map = new Map();
  for (const [key, ep] of Object.entries(j.episodes ?? {})) {
    const number = Number(ep.episodeNumber ?? key);
    if (!Number.isFinite(number) || number < 0) continue;
    const season = Number(ep.seasonNumber ?? 1);
    if (number === 0 && season !== 0) continue;
    const u = season + ":" + number;
    if (!map.has(u)) map.set(u, { season, number, title: readTitle(ep.title) });
  }
  return [...map.values()].sort((a, b) => a.season - b.season || a.number - b.number);
}

// ---------- 1) SERI BILGISI ----------
const media = await anilistByMal(50265);
if (!media) throw new Error("AniList 50265 yok");
const title = (media.title?.english || media.title?.romaji || "").trim();
const year = media.startDate?.year ? String(media.startDate.year) : "";
const genreRaw = (media.genres ?? []).map((g) => GENRE_TR[g] ?? g).join(", ");
const coverUrl = (media.coverImage?.extraLarge || media.coverImage?.large || "").trim();
log("baslik:", title, "| yil:", year);

// ---------- 2) SHOW SATIRI (kapak panelden: Storage RLS anon yazmaya kapali) ----------
// NOT: kapak yukleme girisli admin oturumu ister; image_path bos birakilir,
// kullanici ShowEditor'den tek tikla yukler. Geri kalan her sey aynen yazilir.
const genreRows = await sb.from("shows").select("genre");
const existingGenres = [...new Set((genreRows.data ?? []).flatMap((r) => String(r.genre ?? "").split(",").map((g) => g.trim())).filter(Boolean))];
const normExisting = new Map(existingGenres.map((g) => [g.toLocaleLowerCase("tr"), g]));
const genre = (media.genres ?? []).map((g) => {
  const tr = GENRE_TR[g] ?? g;
  return normExisting.get(tr.toLocaleLowerCase("tr")) ?? tr;
}).filter((g, i, a) => a.indexOf(g) === i).join(", ");
log("tur (normalize):", genre);
let showId = null;
{
  const payload = { title, subtitle: "", description: "", year, genre, image_path: "", sort_order: 7, slug: "spy-x-family", mal_id: 50265, kind: "series" };
  let { data, error } = await sb.from("shows").insert(payload).select("id").single();
  if (error && /kind|mal_id/i.test(error.message)) {
    log("kolon geri donusu:", error.message.slice(0, 80));
    const retry = { ...payload };
    if (/mal_id/i.test(error.message)) delete retry.mal_id;
    if (/kind/i.test(error.message)) delete retry.kind;
    ({ data, error } = await sb.from("shows").insert(retry).select("id").single());
  }
  if (error) throw new Error("shows insert: " + error.message);
  showId = data.id;
  log("show id:", showId);
}

// ---------- 3) SEZONLAR ----------
const SEASONS = [
  { number: 1, mal: 50265, parts: [{ malId: 50602, start: 13, count: 13 }] },
  { number: 2, mal: 53887, parts: [] },
  { number: 3, mal: 59027, parts: [] },
];
for (const s of SEASONS) {
  let { data, error } = await sb.from("show_seasons").insert({ show_id: showId, number: s.number, title: "", sort_order: s.number, mal_id: s.mal }).select("id").single();
  if (error && /mal_id/i.test(error.message)) {
    ({ data, error } = await sb.from("show_seasons").insert({ show_id: showId, number: s.number, title: "", sort_order: s.number }).select("id").single());
  }
  if (error) throw new Error("sezon insert: " + error.message);
  if (s.parts.length > 0) {
    const { error: pErr } = await sb.from("show_seasons").update({ parts: s.parts }).eq("id", data.id);
    if (pErr) log("parts UYARI:", pErr.message.slice(0, 100));
    else log("S" + s.number, "parts yazildi:", JSON.stringify(s.parts));
  }
  log("S" + s.number, "sezon id:", data.id);
}

// ---------- 4) BOLUMLER + KAYNAKLAR ----------
const puffyBase = "spy-x-family";
const ORD = { 2: "2nd", 3: "3rd" };
const puffyInputFor = (season) => (season <= 1 ? puffyBase : `${puffyBase}-${ORD[season] ?? season + "th"}-season`);
async function resolveSeasonSlug(season) {
  const p = new URLSearchParams({ puffy: puffyInputFor(season), base: puffyBase, season: String(season), show: "spy-x-family", title, mal: "50265" });
  const r = await fetch(`${API}/api/anizm?${p}`);
  const j = await r.json();
  return j.ok ? j.slug || puffyInputFor(season) : "";
}
async function resolveEpisode(seasonSlug, epNumber, seasonMin) {
  const p = new URLSearchParams({ puffy: seasonSlug, number: String(epNumber), min: String(seasonMin), base: puffyBase, show: "spy-x-family", title, mal: "50265" });
  const r = await fetch(`${API}/api/anizm?${p}`);
  if (!r.ok) return { ok: false, reason: "HTTP " + r.status };
  return await r.json();
}
let totalEp = 0, totalSrc = 0;
const problems = [];
for (const s of SEASONS) {
  const all = await catalog(s.mal);
  const own = all.filter((e) => e.season === s.number);
  let list = own;
  if (s.number === 1) {
    const part = await catalog(50602);
    const partEps = part.filter((e) => e.season === 1);
    // katalog zaten mutlak (13-25) -> offset 0, birebir panel kurali
    const startsAtOne = (partEps[0]?.number ?? 1) === 1;
    const numbered = startsAtOne ? partEps.map((e) => ({ ...e, number: e.number + 12 })) : partEps;
    list = [...own, ...numbered].sort((a, b) => a.number - b.number);
  }
  const seasonMin = Math.min(...list.map((e) => e.number));
  log(`S${s.number}: ${list.length} bolum (aralik ${list[0].number}-${list[list.length - 1].number})`);
  const seasonSlug = await resolveSeasonSlug(s.number);
  if (!seasonSlug) problems.push(`S${s.number}: Anizm sezon adresi cozulemedi`);
  log(`S${s.number} puffy:`, seasonSlug || "(YOK)");
  for (const ep of list) {
    let anizmUrl = "";
    if (seasonSlug) {
      const res = await resolveEpisode(seasonSlug, ep.number, seasonMin);
      if (res.ok && res.url) anizmUrl = res.url;
      else problems.push(`S${s.number}B${ep.number}: Anizm yok (${(res.reason || "").slice(0, 60)})`);
      await sleep(300);
    }
    const rows = [];
    if (anizmUrl) rows.push({ provider: "anizm", language: "tr", label: "Anizm", url: anizmUrl, sort_order: 0 });
    rows.push({ provider: "megaplay", language: "en", label: "MegaPlay", url: "@megaplay", sort_order: 2 });
    const watchUrl = rows[0].url;
    const { data: epRow, error: epErr } = await sb.from("show_episodes").insert({ show_id: showId, season: s.number, number: ep.number, title: ep.title, watch_url: watchUrl }).select("id").single();
    if (epErr) { problems.push(`S${s.number}B${ep.number}: bolum yazilamadi (${epErr.message.slice(0, 60)})`); continue; }
    const { error: srcErr } = await sb.from("episode_sources").upsert(rows.map((row) => ({ episode_id: epRow.id, ...row })), { onConflict: "episode_id,provider" });
    if (srcErr) { problems.push(`S${s.number}B${ep.number}: kaynak yazilamadi (${srcErr.message.slice(0, 60)})`); continue; }
    totalEp++;
    totalSrc += rows.length;
  }
  log(`S${s.number} bitti`);
}
log("TOPLAM bolum:", totalEp, "kaynak satiri:", totalSrc);
log("SORUNLAR (" + problems.length + "):");
for (const p of problems.slice(0, 20)) log(" -", p);

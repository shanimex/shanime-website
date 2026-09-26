/**
 * İçerik sağlığı kontrolleri — panelin "Veri sağlığı" kartı burada karar verir.
 *
 * NEDEN: bozuk `watch_url` (ör. `https://allorigins.winhttps//…` gibi karışmış
 * adres) ve "bölümü olan ama sezon kaydı olmayan" sezonlar sahada gerçekten
 * görüldü; ikisi de sitede boş oynatıcı ya da "0 sezon" görünümü üretiyor.
 * Aynı kontrollerin CLI karşılığı: `scripts/audit-content.mjs` (Node tarafında
 * TS import edemediği için orada kısa bir kopyası var — ikisini birlikte güncelle).
 *
 * Yazma işlemi YAPMAZ; yalnızca sorunları bulur. Düzeltmeyi panel, oturum sahibi
 * olarak yapar (anon anahtar RLS nedeniyle yazamıyor).
 */

/** `embed-provider.ts` içindeki `EmbedProviderId` değerleriyle aynı olmalı. */
const KNOWN_PROVIDERS = ["none", "megaplay", "vidsrc", "videasy", "anizm"];

/** Sorun yoksa `null`, varsa kısa sebep döner. */
export function watchUrlProblem(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (raw === "") return "boş";
  if (raw.startsWith("@")) {
    const id = raw.slice(1);
    return KNOWN_PROVIDERS.includes(id) ? null : `bilinmeyen sağlayıcı direktifi (@${id})`;
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "protokol geçersiz";
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(parsed.hostname)) return "alan adı geçersiz";
    if (/https?\/\/|\\|\s/.test(raw)) return "adres karışmış";
    return null;
  } catch {
    return "adres ayrıştırılamadı";
  }
}

export type BrokenEpisodeUrl = {
  showId: string;
  slug: string;
  season: number;
  number: number;
  bad: string;
  why: string;
};

export type MissingSeasonRow = {
  showId: string;
  slug: string;
  number: number;
};

type ShowRow = { id: string; slug: string };
type SeasonRow = { show_id: string; number: number };
type EpisodeRow = { show_id: string; season: number; number: number; watch_url: string | null };

/** Geçersiz `watch_url` taşıyan bölümler. */
export function findBrokenUrls(shows: ShowRow[], episodes: EpisodeRow[]): BrokenEpisodeUrl[] {
  const byId = new Map(shows.map((s) => [s.id, s.slug]));
  const out: BrokenEpisodeUrl[] = [];
  for (const ep of episodes) {
    const why = watchUrlProblem(ep.watch_url);
    if (!why) continue;
    out.push({
      showId: ep.show_id,
      slug: byId.get(ep.show_id) ?? "(bilinmeyen dizi)",
      season: ep.season,
      number: ep.number,
      bad: String(ep.watch_url ?? ""),
      why,
    });
  }
  return out;
}

/** Bölümü olan ama `show_seasons` satırı olmayan sezonlar ("0 sezon" görünümünün sebebi). */
export function findMissingSeasons(
  shows: ShowRow[],
  seasons: SeasonRow[],
  episodes: EpisodeRow[],
): MissingSeasonRow[] {
  const out: MissingSeasonRow[] = [];
  for (const show of shows) {
    const owned = new Set(seasons.filter((s) => s.show_id === show.id).map((s) => s.number));
    const needed = [...new Set(episodes.filter((e) => e.show_id === show.id).map((e) => e.season))];
    for (const number of needed.sort((a, b) => a - b)) {
      if (!owned.has(number)) out.push({ showId: show.id, slug: show.slug, number });
    }
  }
  return out;
}

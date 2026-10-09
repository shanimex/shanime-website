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
const KNOWN_PROVIDERS = ["none", "megaplay", "vidsrc", "videasy", "anizm", "animecix"];

/** Sorun yoksa `null`, varsa kısa sebep döner. */
function watchUrlProblem(value: string | null | undefined): string | null {
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
    /**
     * ŞEMA SONRASI gövdeye bakılır — baştaki "https://" her geçerli adreste
     * vardır, karışıklık İKİNCİ protokoldür (`...winhttps//...` gibi gerçek
     * vaka), ters bölü ya da boşluktur. Eskiden tüm gövdeye bakılıyordu ve
     * SAĞLAM 302 adresin tamamı "karışmış" sayılıyordu (Hepsini düzelt
     * hepsini bozardı).
     */
    const body = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    if (/https?:?\/{2}|\\|\s/.test(body)) return "adres karışmış";
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

export type MetadataHealthRow = {
  showId: string;
  slug: string;
  scope: "anime" | "episode";
  season?: number;
  number?: number;
  field: string;
  message: string;
};

export type InvalidSourceRow = {
  showId: string;
  slug: string;
  season: number;
  number: number;
  provider: string;
  url: string;
  message: string;
};

type RichShowRow = ShowRow & {
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  year?: string | null;
  genre?: string | null;
  image_path?: string | null;
};
type RichEpisodeRow = EpisodeWithId & {
  title?: string | null;
  summary?: string | null;
  duration?: string | null;
  thumbnail_path?: string | null;
};
type RichSourceRow = EpisodeSourceRow & { provider: string; url: string | null };

export type MissingEpisodeSourceRow = {
  showId: string;
  slug: string;
  season: number;
  number: number;
};

type EpisodeWithId = EpisodeRow & { id: string };
type EpisodeSourceRow = { episode_id: string; language: string | null };

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

/** Bölümü olup Türkçe `episode_sources` kaydı olmayan bölümler. */
export function findMissingTurkishSources(
  shows: ShowRow[],
  episodes: EpisodeWithId[],
  sources: EpisodeSourceRow[],
): MissingEpisodeSourceRow[] {
  const byId = new Map(shows.map((s) => [s.id, s.slug]));
  const trEpisodeIds = new Set(
    sources
      .filter((source) => String(source.language ?? "").toLocaleLowerCase() === "tr")
      .map((source) => source.episode_id),
  );
  return (
    episodes
      // 0. bölüm özel/ön bölüm kaydıdır; Anizm ve TauVideo bunu normal bölüm
      // gibi yayınlamaz. Sağlık taraması bunu eksik kaynak diye göstermemeli.
      .filter((episode) => episode.number > 0 && !trEpisodeIds.has(episode.id))
      .map((episode) => ({
        showId: episode.show_id,
        slug: byId.get(episode.show_id) ?? "(bilinmeyen dizi)",
        season: episode.season,
        number: episode.number,
      }))
  );
}

/** Anime ve bölüm kartlarında kullanıcıya gösterilen zorunlu alanlar. */
export function findMissingMetadata(
  shows: RichShowRow[],
  episodes: RichEpisodeRow[],
): MetadataHealthRow[] {
  const byId = new Map(shows.map((s) => [s.id, s.slug]));
  const out: MetadataHealthRow[] = [];
  const showFields: Array<[keyof RichShowRow, string, string]> = [
    ["title", "Başlık", "anime başlığı eksik"],
    ["subtitle", "İkinci ad", "ikinci ad eksik"],
    ["description", "Açıklama", "anime açıklaması eksik"],
    ["year", "Yıl", "anime yılı eksik"],
    ["genre", "Tür", "anime türü eksik"],
    ["image_path", "Kapak", "anime kapağı eksik"],
  ];
  for (const show of shows) {
    for (const [field, label, message] of showFields) {
      if (!String(show[field] ?? "").trim()) {
        out.push({ showId: show.id, slug: show.slug, scope: "anime", field: label, message });
      }
    }
  }
  for (const episode of episodes) {
    const slug = byId.get(episode.show_id) ?? "(bilinmeyen dizi)";
    // Özet ve süre katalog sağlayıcısına göre boş kalabilir; oynatmayı
    // engellemediği için sağlık raporunda kritik eksik sayılmaz. Başlık ise
    // bölüm listesinde doğrudan görünür ve zorunludur.
    const fields: Array<[keyof RichEpisodeRow, string, string]> = [
      ["title", "Bölüm başlığı", "bölüm başlığı eksik"],
    ];
    for (const [field, label, message] of fields) {
      if (!String(episode[field] ?? "").trim()) {
        out.push({
          showId: episode.show_id,
          slug,
          scope: "episode",
          season: episode.season,
          number: episode.number,
          field: label,
          message,
        });
      }
    }
  }
  return out;
}

/** Kaynak satırlarında boş/bozuk sağlayıcı veya URL değerleri. */
export function findInvalidSources(
  shows: ShowRow[],
  episodes: EpisodeWithId[],
  sources: RichSourceRow[],
): InvalidSourceRow[] {
  const byShow = new Map(shows.map((s) => [s.id, s.slug]));
  const byEpisode = new Map(episodes.map((e) => [e.id, e]));
  const out: InvalidSourceRow[] = [];
  for (const source of sources) {
    const episode = byEpisode.get(source.episode_id);
    if (!episode) continue;
    const url = String(source.url ?? "").trim();
    const provider = String(source.provider ?? "").trim();
    const validDirective = /^@[a-z0-9_-]+$/i.test(url);
    let message = "";
    if (!provider) message = "kaynak sağlayıcısı eksik";
    else if (!url) message = "kaynak adresi eksik";
    else if (!validDirective && !/^https?:\/\//i.test(url)) message = "kaynak adresi geçersiz";
    if (!message) continue;
    out.push({
      showId: episode.show_id,
      slug: byShow.get(episode.show_id) ?? "(bilinmeyen dizi)",
      season: episode.season,
      number: episode.number,
      provider,
      url,
      message,
    });
  }
  return out;
}

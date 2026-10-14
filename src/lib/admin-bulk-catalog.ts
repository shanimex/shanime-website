import { supabase } from "@/integrations/supabase/client";
import {
  fetchCatalogEpisodes,
  isPlaceholderTitle,
  numberPartEpisodes,
  type CatalogEpisode,
  type FranchiseDiscovery,
  type FranchiseRecord,
} from "@/lib/admin-anizip";
import { mapGenres, searchMal } from "@/lib/mal-search";
import { slugify, uniqueSlug } from "@/lib/admin";

// Şema tipleri üretilmediği için panelin diğer admin yardımcılarıyla aynı kaçış kapısı.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type ExistingEpisode = {
  id: string;
  number: number;
  title?: string | null;
  watch_url?: string | null;
};

type ExistingShow = {
  id: string;
  slug?: string | null;
  title?: string | null;
  mal_id?: number | null;
  kind?: string | null;
  animecix_id?: number | null;
};

export type BulkCatalogOptions = {
  /** Panelde düzenlenen kök dizi. */
  showId: string;
  /** Keşfin kök kaydı. */
  rootMalId: number;
  rootTitle: string;
  rootImagePath: string;
  rootSortOrder?: number;
  discovery: FranchiseDiscovery;
  /** AnimeciX başlık kimliği; boşsa başlıktan güvenli eşleşme aranır. */
  animecixId?: number | null;
  /** Migration öncesi başlık eşlemesiyle bulunan eski ek kayıtlar. */
  legacyExtraShowIds?: string[];
};

export type BulkCatalogReport = {
  seasons: number;
  specialGroups: number;
  attemptedEpisodes: number;
  episodes: number;
  failedEpisodes: number;
  relatedCreated: number;
  relatedReused: number;
  removedExtraShows: number;
  sourceRows: number;
  skipped: string[];
  warnings: string[];
};

type EpisodeWriteTarget = {
  showId: string;
  season: number;
  malId: number;
  title: string;
  episodes: CatalogEpisode[];
  /** Ek bölümün bağlı olduğu normal sezonun MAL kimliği. */
  seasonMalId?: number;
  parts?: { malId: number; start: number; count: number }[];
  sourceByNumber?: Map<number, DirectEpisodeSource>;
};

type DirectEpisodeSource = {
  url: string;
  thumbnail?: string;
};

type AnimecixProbe = DirectEpisodeSource & {
  number: number;
};

function formatLabel(record: FranchiseRecord): string {
  switch (record.category) {
    case "movie":
      return "Film";
    case "ova":
      return "OVA";
    case "ona":
      return "ONA";
    case "special":
      return "Special";
    default:
      return record.format || "Ek içerik";
  }
}

function positive(value: number | null | undefined): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function meaningfulEpisodes(catalog: CatalogEpisode[]): CatalogEpisode[] {
  return catalog.filter((episode) => episode.number > 0);
}

/** Ani.zip bir kaydı S1, S2 ya da 0 altında numaralandırabilir. */
function ownEpisodes(catalog: CatalogEpisode[], season: number | null): CatalogEpisode[] {
  const wanted = season === null ? [] : catalog.filter((episode) => episode.season === season);
  if (wanted.length > 0) return meaningfulEpisodes(wanted);
  const nonZeroSeasons = [...new Set(catalog.filter((ep) => ep.season > 0).map((ep) => ep.season))];
  if (nonZeroSeasons.length === 1) {
    return meaningfulEpisodes(catalog.filter((episode) => episode.season === nonZeroSeasons[0]));
  }
  return meaningfulEpisodes(catalog);
}

/** Yeni ve eski kayıtların sezon başlığı tek biçimde tutulur. */
function shortSeasonTitle(season: number): string {
  return `${season}. Sezon`;
}

function normalizeSearchTitle(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * AnimeciX kimliği kayıt üzerinde yoksa başlıktan en güvenli sonucu bulur.
 * Bu yalnızca kaynak keşfi içindir; eşleşme bulunamazsa Ani.zip importu yine
 * normal bölümlerle devam eder.
 */
async function resolveAnimecixId(
  provided: number | null | undefined,
  title: string,
): Promise<number | null> {
  const providedNumber = Number(provided ?? 0);
  if (Number.isInteger(providedNumber) && providedNumber > 0) return providedNumber;
  if (typeof window === "undefined" || title.trim().length < 2) return null;
  try {
    const response = await fetch(`/api/animecix?search=${encodeURIComponent(title.trim())}`);
    if (!response.ok) return null;
    const json = (await response.json()) as {
      results?: {
        id?: number;
        name?: string;
        english?: string;
        romanji?: string;
      }[];
    };
    const rows = (json.results ?? []).filter((row) => Number(row.id ?? 0) > 0);
    if (rows.length === 0) return null;
    const wanted = normalizeSearchTitle(title);
    const exact = rows.find((row) =>
      [row.name, row.english, row.romanji].some(
        (candidate) => normalizeSearchTitle(candidate ?? "") === wanted,
      ),
    );
    return Number((exact ?? rows[0])?.id ?? 0) || null;
  } catch {
    return null;
  }
}

/** AnimeciX/TauVideo bölüm adresini yalnızca geçerli bir embed olarak kabul eder. */
async function probeAnimecixEpisode(
  titleId: number,
  season: number,
  number: number,
): Promise<AnimecixProbe | null> {
  if (typeof window === "undefined" || !Number.isFinite(number) || number < 0) return null;
  try {
    const params = new URLSearchParams({
      titleId: String(titleId),
      season: String(season),
      episode: String(number),
    });
    const response = await fetch(`/api/animecix?${params.toString()}`);
    if (!response.ok) return null;
    const json = (await response.json()) as {
      ok?: boolean;
      best?: string;
      poster?: string;
      thumbnail?: string;
    };
    const url = String(json.best ?? "").trim();
    if (!json.ok || !/^https:\/\/tau-video\.xyz\/embed\/[0-9a-f]{16,}(?:\?vid=\d+)?$/i.test(url)) {
      return null;
    }
    return {
      number,
      url,
      thumbnail: String(json.thumbnail ?? json.poster ?? "").trim(),
    };
  } catch {
    // Bir adayın ağ hatası diğer bölüm adaylarını düşürmesin.
    return null;
  }
}

async function mapConcurrent<T, R>(
  values: T[],
  limit: number,
  task: (value: T) => Promise<R>,
): Promise<R[]> {
  const output: R[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor++;
      const value = values[index];
      if (value !== undefined) output[index] = await task(value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return output;
}

/**
 * AnimeciX'in kullandığı AnimeciX tarzı bölüm anahtarlarını bulur:
 * `11.5` gibi sezon içi ara numaralar ve normal sezonun sonrasındaki `26` gibi
 * numaralar. Ani.zip OVA kaydını boş döndürse bile asıl oynatıcı kaynağı burada
 * bulunduğu için kayıt kaybolmaz.
 */
async function discoverAnimecixExtras(
  titleId: number | null,
  season: number,
  normalMax: number,
  expectedCount: number,
): Promise<AnimecixProbe[]> {
  if (!titleId || expectedCount <= 0) return [];
  const max = Math.max(0, Math.min(100, Math.floor(normalMax)));
  const candidates = new Set<number>();
  for (let index = 0; index <= max; index += 1) {
    candidates.add(Number((index + 0.5).toFixed(2)));
  }
  // Re:Zero gibi kataloglarda ikinci OVA, normal final bölümden sonra 26 olarak
  // durur. Birkaç ek aday, tek bir eksik normal bölüm yüzünden OVA'nın kaçmasını
  // önler; beklenen özel içerik sayısı üst sınırını aşağıda koruyoruz.
  const trailing = Math.min(12, Math.max(2, expectedCount + 2));
  for (let offset = 1; offset <= trailing; offset += 1) {
    candidates.add(Math.max(1, Math.floor(normalMax)) + offset);
  }

  const probed = await mapConcurrent(
    [...candidates].sort((a, b) => a - b),
    6,
    (number) => probeAnimecixEpisode(titleId, season, number),
  );
  return probed
    .filter((item): item is AnimecixProbe => item !== null)
    .sort((a, b) => a.number - b.number)
    .slice(0, Math.max(1, Math.min(12, expectedCount)));
}

async function readShows(): Promise<ExistingShow[]> {
  let result = await db.from("shows").select("id,slug,title,mal_id,kind,animecix_id");
  if (result.error && /animecix_id/i.test(result.error.message ?? "")) {
    result = await db.from("shows").select("id,slug,title,mal_id,kind");
  }
  if (result.error) throw result.error;
  return (result.data ?? []) as ExistingShow[];
}

async function saveRelatedShow(
  record: FranchiseRecord,
  root: BulkCatalogOptions,
  shows: ExistingShow[],
  usedSlugs: string[],
  report: BulkCatalogReport,
): Promise<{ id: string; kind: "series" | "movie" }> {
  const existing = shows.find((show) => Number(show.mal_id ?? 0) === record.malId);
  if (existing) {
    report.relatedReused += 1;
    // Eski kayda ilişki/biçim yazılamazsa içe aktarım yine devam etsin. Migration
    // çalıştırılmadığında bu iki alanın yokluğu mevcut paneli bozmamalı.
    await db
      .from("shows")
      .update({ franchise_root_id: root.showId, media_format: record.format })
      .eq("id", existing.id)
      .then(() => undefined)
      .catch(() => undefined);
    return { id: existing.id, kind: existing.kind === "movie" ? "movie" : "series" };
  }

  let hit = null;
  try {
    hit = (await searchMal({ malId: record.malId }))[0] ?? null;
  } catch {
    // Metadata yardımcıdır; katalog kimliği zaten doğrulanmıştır.
  }

  const title = (hit?.title || record.english || record.title || `MAL ${record.malId}`).trim();
  const isSinglePart =
    record.category === "movie" ||
    ((record.category === "ova" || record.category === "ona" || record.category === "special") &&
      (record.episodes ?? 1) <= 1);
  const kind: "series" | "movie" = isSinglePart ? "movie" : "series";
  const slug = uniqueSlug(slugify(title), usedSlugs);
  usedSlugs.push(slug);
  const payload: Record<string, unknown> = {
    title,
    subtitle: `${formatLabel(record)} · ${root.rootTitle}`,
    description: hit?.description ?? "",
    year: hit?.year ? String(hit.year) : record.year ? String(record.year) : "",
    genre: hit ? mapGenres(hit.genres) : "",
    // AniList kapak adresi doğrudan kullanılabilir; Storage proxy'sine bağlı
    // kalmadan ilişkili kayıt da içe aktarılır. Kapağın yokluğunda ana seri kapağı
    // güvenli ve aynı aileyi koruyan yedektir.
    image_path: hit?.cover || root.rootImagePath,
    sort_order: (root.rootSortOrder ?? 0) + 1000 + report.relatedCreated,
    slug,
    mal_id: record.malId,
    kind,
    franchise_root_id: root.showId,
    media_format: record.format,
  };

  let result = await db.from("shows").insert(payload).select("id").single();
  if (result.error && /franchise_root_id|media_format/i.test(result.error.message ?? "")) {
    const fallback = { ...payload };
    delete fallback["franchise_root_id"];
    delete fallback["media_format"];
    result = await db.from("shows").insert(fallback).select("id").single();
  }
  if (result.error) throw result.error;
  const id = String(result.data?.id ?? "");
  if (!id) throw new Error(`${title}: yeni kayıt kimliği alınamadı`);
  shows.push({ id, slug, title, mal_id: record.malId, kind });
  report.relatedCreated += 1;
  return { id, kind };
}

async function ensureSeason(
  showId: string,
  season: number,
  malId: number,
  parts?: { malId: number; start: number; count: number }[],
) {
  const { data: existing, error: readError } = await db
    .from("show_seasons")
    .select("id,title")
    .eq("show_id", showId)
    .eq("number", season)
    .maybeSingle();
  if (readError) throw readError;

  const fields: Record<string, unknown> = {
    show_id: showId,
    number: season,
    title: shortSeasonTitle(season),
    sort_order: season,
    mal_id: malId,
  };
  if (parts && parts.length > 0) fields["parts"] = parts;

  if (existing?.id) {
    let update = await db.from("show_seasons").update(fields).eq("id", existing.id);
    if (update.error && /mal_id|parts/i.test(update.error.message ?? "")) {
      const fallback = { ...fields };
      delete fallback["mal_id"];
      delete fallback["parts"];
      update = await db.from("show_seasons").update(fallback).eq("id", existing.id);
    }
    if (update.error) throw update.error;
    return String(existing.id);
  }

  let insert = await db.from("show_seasons").insert(fields).select("id").single();
  if (insert.error && /mal_id|parts/i.test(insert.error.message ?? "")) {
    const fallback = { ...fields };
    delete fallback["mal_id"];
    delete fallback["parts"];
    insert = await db.from("show_seasons").insert(fallback).select("id").single();
  }
  if (insert.error) throw insert.error;
  return String(insert.data?.id ?? "");
}

async function writeEpisodeBatch(
  target: EpisodeWriteTarget,
  report: BulkCatalogReport,
): Promise<void> {
  if (target.episodes.length === 0) return;
  report.attemptedEpisodes += target.episodes.length;
  await ensureSeason(
    target.showId,
    target.season,
    target.seasonMalId ?? target.malId,
    target.parts,
  );

  const { data: oldRows, error: oldError } = await db
    .from("show_episodes")
    .select("id,number,title,watch_url")
    .eq("show_id", target.showId)
    .eq("season", target.season);
  if (oldError) throw oldError;
  const oldByNumber = new Map<number, ExistingEpisode>(
    ((oldRows ?? []) as ExistingEpisode[]).map((row) => [row.number, row]),
  );

  const rows = target.episodes.map((episode) => {
    const old = oldByNumber.get(episode.number);
    const oldTitle = old?.title?.trim() ?? "";
    const title = !isPlaceholderTitle(oldTitle) ? oldTitle : episode.title.trim();
    const directSource = target.sourceByNumber?.get(episode.number);
    const oldWatchUrl = old?.watch_url?.trim() ?? "";
    return {
      show_id: target.showId,
      season: target.season,
      number: episode.number,
      title,
      watch_url:
        directSource?.url && (!oldWatchUrl || oldWatchUrl === "@megaplay")
          ? directSource.url
          : oldWatchUrl || directSource?.url || "@megaplay",
    };
  });

  const CHUNK = 100;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    const { data, error } = await db
      .from("show_episodes")
      .upsert(chunk, { onConflict: "show_id,season,number" })
      .select("id,number,watch_url");
    if (error) {
      // Toplu yazımın tamamı hata verdiğinde eski akış bunu gerçek bir kayıt
      // gibi sayıyordu. Artık başarısız bölüm sayısı açıkça raporlanır ve diğer
      // sezon/ek içeriklerin yazımı devam eder.
      report.failedEpisodes += chunk.length;
      if (
        chunk.some((row) => !Number.isInteger(row.number)) &&
        /integer|numeric|decimal|invalid input/i.test(error.message ?? "")
      ) {
        report.warnings.push(
          "OVA ara numaraları yazılamadı: supabase/migrations/20261011_decimal_episode_numbers.sql çalıştırılmalı.",
        );
      }
      report.skipped.push(
        `${target.title || `S${target.season}`} · MAL ${target.malId}: ${error.message}`,
      );
      continue;
    }

    // `episode_sources` yardımcı tablodur. Ana `watch_url` zaten yazıldığı için
    // migration henüz uygulanmamışsa katalog içe aktarımı başarısız sayılmaz.
    try {
      const sourceRows = (
        (data ?? []) as { id: string; number: number; watch_url?: string }[]
      ).flatMap((row) => {
        const watchUrl = (row.watch_url ?? "").trim();
        if (watchUrl === "@megaplay") {
          return {
            episode_id: row.id,
            provider: "megaplay",
            language: "en",
            label: "MegaPlay",
            url: "@megaplay",
            sort_order: 2,
          };
        }
        if (/^https:\/\/tau-video\.xyz\/embed\//i.test(watchUrl)) {
          return {
            episode_id: row.id,
            provider: "animecix",
            language: "tr",
            label: "TauVideo",
            url: watchUrl,
            sort_order: 1,
          };
        }
        return [];
      });
      if (sourceRows.length > 0) {
        const source = await db
          .from("episode_sources")
          .upsert(sourceRows, { onConflict: "episode_id,provider" });
        if (source.error) throw source.error;
        report.sourceRows += sourceRows.length;
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : JSON.stringify(error);
      report.warnings.push(
        /episode_sources|relation|column/i.test(detail)
          ? "episode_sources tablosu/kolonu hazır değil; bölümler yine ana watch_url ile yazıldı."
          : `episode_sources yazılamadı; bölümler yine ana watch_url ile yazıldı (${detail}).`,
      );
    }
    report.episodes += ((data ?? []) as unknown[]).length || chunk.length;
  }
}

type ExtraCategory = "ova" | "ona" | "special";

/**
 * Kök animeyi ve keşfedilen film/OVA/ONA/Special kayıtlarını tek koşuda yazar.
 *
 * Normal bölümlerde mevcut `@megaplay` davranışı korunur. OVA/ONA/Special
 * için AnimeciX'in doğrulanmış TauVideo embed'i varsa bölümün kendisine yazılır;
 * böylece Ani.zip'in boş döndürdüğü Re:Zero OVA'ları da kaybolmaz.
 */
export async function importFranchiseCatalog(
  options: BulkCatalogOptions,
): Promise<BulkCatalogReport> {
  const report: BulkCatalogReport = {
    seasons: 0,
    specialGroups: 0,
    attemptedEpisodes: 0,
    episodes: 0,
    failedEpisodes: 0,
    relatedCreated: 0,
    relatedReused: 0,
    removedExtraShows: 0,
    sourceRows: 0,
    skipped: [],
    warnings: [],
  };
  const shows = await readShows();
  const usedSlugs = shows.map((show) => show.slug).filter((slug): slug is string => Boolean(slug));
  const writtenTvSeasons = new Set<number>();

  // Kök kimlik yeni keşfedildiyse önce mevcut seriye yazılır; bu, public player'ın
  // sezon kimliği bulunmadığında da güvenli fallback'ini korur.
  const rootUpdate = await db
    .from("shows")
    .update({ mal_id: options.rootMalId })
    .eq("id", options.showId);
  if (rootUpdate.error && /mal_id/i.test(rootUpdate.error.message ?? "")) {
    report.warnings.push(
      "shows.mal_id kolonu yok; sezon kimlikleri yine ayrı satırlara yazılacak.",
    );
  } else if (rootUpdate.error) {
    throw rootUpdate.error;
  }

  // Özellikle Film panelinde kök kayıt bir TV sezonu değildir; yine de başlıkla
  // keşif düğmesine basıldığında o filmin kendi tek bölümünü mevcut kayda yaz.
  const rootRecord = options.discovery.records.find((record) => record.malId === options.rootMalId);
  if (rootRecord && rootRecord.category !== "season") {
    try {
      const catalog = await fetchCatalogEpisodes(rootRecord.malId);
      const episodes = meaningfulEpisodes(catalog);
      const fallback = catalog.find((episode) => episode.number === 0) ?? catalog[0];
      const normalized =
        episodes.length > 0
          ? rootRecord.category === "movie"
            ? [{ ...episodes[0]!, number: 1 }]
            : episodes
          : fallback
            ? [{ ...fallback, number: 1 }]
            : [];
      if (normalized.length > 0) {
        await writeEpisodeBatch(
          {
            showId: options.showId,
            season: 1,
            malId: options.rootMalId,
            title: rootRecord.title,
            episodes: normalized.map((episode) => ({ ...episode, season: 1 })),
          },
          report,
        );
      } else {
        report.skipped.push(`MAL ${options.rootMalId}: kök kaydın katalog bölümü yok`);
      }
    } catch (error) {
      report.skipped.push(
        `MAL ${options.rootMalId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const seasonRecords = options.discovery.records
    .filter((record) => record.category === "season" && positive(record.season))
    .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.part ?? 0) - (b.part ?? 0));
  const baseCountBySeason = new Map<number, number>();
  const maxEpisodeBySeason = new Map<number, number>();
  const partsBySeason = new Map<number, { malId: number; start: number; count: number }[]>();

  for (const record of seasonRecords) {
    const season = record.season as number;
    try {
      const catalog = await fetchCatalogEpisodes(record.malId);
      const own = ownEpisodes(catalog, record.part === null ? season : null);
      if (own.length === 0) {
        report.skipped.push(`S${season} · MAL ${record.malId}: katalogda bölüm yok`);
        continue;
      }

      let episodes = own;
      let partEntry: { malId: number; start: number; count: number } | undefined;
      if (record.part !== null) {
        const baseCount = baseCountBySeason.get(season) ?? 0;
        const relative = own[0]?.number === 1 && baseCount > 0;
        episodes = relative ? numberPartEpisodes(own, baseCount) : own;
        const first = episodes[0]?.number ?? 0;
        if (first > 0) {
          partEntry = { malId: record.malId, start: first, count: episodes.length };
          const parts = partsBySeason.get(season) ?? [];
          parts.push(partEntry);
          partsBySeason.set(season, parts);
        }
      } else {
        baseCountBySeason.set(season, episodes.length);
      }

      const parts = partsBySeason.get(season) ?? [];
      await writeEpisodeBatch(
        {
          showId: options.showId,
          season,
          malId: record.malId,
          title: record.title,
          episodes,
          parts,
        },
        report,
      );
      maxEpisodeBySeason.set(
        season,
        Math.max(maxEpisodeBySeason.get(season) ?? 0, ...episodes.map((ep) => ep.number)),
      );
      writtenTvSeasons.add(season);
    } catch (error) {
      report.skipped.push(
        `S${season} · MAL ${record.malId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const movieRecords = options.discovery.records.filter(
    (record) => record.malId !== options.rootMalId && record.category === "movie",
  );
  for (const record of movieRecords) {
    try {
      const catalog = await fetchCatalogEpisodes(record.malId);
      const episodes = meaningfulEpisodes(catalog);
      const fallback = catalog.find((episode) => episode.number === 0) ?? catalog[0];
      // Film kaydı katalogda bazen 2, 3 gibi teknik numarayla gelir (sahne/video
      // kayıtları da aynı MAL eşlemesinde bulunabilir). Film tek parçadır; public
      // URL'nin daima S1/B1 olması için yalnız ilk anlamlı kaydı 1'e sabitleriz.
      const normalized =
        record.category === "movie"
          ? episodes[0]
            ? [{ ...episodes[0], number: 1 }]
            : fallback
              ? [{ ...fallback, number: 1 }]
              : []
          : episodes.length > 0
            ? episodes
            : fallback
              ? [{ ...fallback, number: 1 }]
              : [];
      if (normalized.length === 0) {
        report.skipped.push(`${formatLabel(record)} · MAL ${record.malId}: katalogda bölüm yok`);
        continue;
      }
      // Bölüm eşlemesi yoksa boş bir film/OVA satırı açma. Kaydı ancak gerçek
      // bir katalog bölümü bulunduğunda oluştur; böylece PV/duyuru gibi ilişki
      // kayıtları admin listesine boş içerik olarak sızmaz.
      const target = await saveRelatedShow(record, options, shows, usedSlugs, report);
      await writeEpisodeBatch(
        {
          showId: target.id,
          season: 1,
          malId: record.malId,
          title: record.title,
          episodes: normalized.map((episode) => ({ ...episode, season: 1 })),
        },
        report,
      );
    } catch (error) {
      report.skipped.push(
        `${formatLabel(record)} · MAL ${record.malId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // OVA/ONA/Special ayrı sezon DEĞİLDİR. AnimeciX, Re:Zero örneğinde olduğu
  // gibi bunları `11.5` ve `26` anahtarlarıyla normal sezon listesinin içine
  // koyuyor. Bu akış da önce aynı numara konumlarını AnimeciX'ten doğrular,
  // sonra doğrudan TauVideo adresiyle o sezonun içine yazar.
  const extraRecords = options.discovery.records.filter(
    (record): record is FranchiseRecord =>
      record.malId !== options.rootMalId &&
      (record.category === "ova" || record.category === "ona" || record.category === "special"),
  );
  const seasonByMalId = new Map<number, number>([[options.rootMalId, 1]]);
  for (const record of seasonRecords) {
    if (record.season !== null) seasonByMalId.set(record.malId, record.season);
  }
  const extrasBySeason = new Map<number, FranchiseRecord[]>();
  for (const record of extraRecords) {
    const targetSeason =
      record.season ?? seasonByMalId.get(record.parentMalId) ?? Math.min(...writtenTvSeasons, 1);
    const list = extrasBySeason.get(targetSeason) ?? [];
    list.push(record);
    extrasBySeason.set(targetSeason, list);
  }

  const animecixId = await resolveAnimecixId(options.animecixId, options.rootTitle);
  if (animecixId && !options.animecixId) {
    const saved = await db
      .from("shows")
      .update({ animecix_id: animecixId })
      .eq("id", options.showId);
    if (saved.error && !/animecix_id/i.test(saved.error.message ?? "")) {
      report.warnings.push(`AnimeciX kimliği kaydedilemedi: ${saved.error.message}`);
    }
  }

  for (const [season, records] of extrasBySeason) {
    const expectedCount = records.reduce(
      (total, record) => total + Math.max(1, Math.min(12, Number(record.episodes ?? 1))),
      0,
    );
    const normalMax = maxEpisodeBySeason.get(season) ?? 0;
    let probes = await discoverAnimecixExtras(animecixId, season, normalMax, expectedCount);

    if (probes.length === 0) {
      // AnimeciX bulunamazsa Ani.zip'in dolu olduğu eski/özel kayıtları yine ayrı
      // sezon açmadan aynı sezonun sonuna taşırız. Re:Zero gibi boş Ani.zip
      // kayıtları burada sessizce sahte bölüme çevrilmez.
      for (const record of records) {
        try {
          const catalog = meaningfulEpisodes(await fetchCatalogEpisodes(record.malId));
          if (catalog.length === 0) continue;
          const offset = maxEpisodeBySeason.get(season) ?? 0;
          probes = [
            ...probes,
            ...catalog.slice(0, 12).map((episode, index) => ({
              number: Number((offset + 0.5 + index * 0.01).toFixed(2)),
              url: "",
              thumbnail: episode.image,
            })),
          ];
        } catch {
          // Sağlayıcısı olmayan ek kaydı aşağıdaki açık uyarıyla raporlarız.
        }
      }
    }

    if (probes.length === 0) {
      report.skipped.push(
        `${records.map(formatLabel).join("/")} · S${season}: OVA/özel katalogda bölüm kaydı bulunamadı`,
      );
      continue;
    }

    const labels: string[] = [];
    const categoryCounters = new Map<ExtraCategory, number>();
    for (const record of records) {
      const category = record.category as ExtraCategory;
      const count = Math.max(1, Math.min(12, Number(record.episodes ?? 1)));
      const start = categoryCounters.get(category) ?? 0;
      for (let index = 0; index < count; index += 1) {
        labels.push(`${formatLabel(record)} ${start + index + 1}`);
      }
      categoryCounters.set(category, start + count);
    }

    const episodes = probes.map((probe, index) => ({
      season,
      number: probe.number,
      absolute: probe.number,
      title: labels[index] ?? `${formatLabel(records[0]!)} ${index + 1}`,
      image: probe.thumbnail ?? "",
    }));
    const sourceByNumber = new Map<number, DirectEpisodeSource>();
    for (const probe of probes) {
      if (probe.url) sourceByNumber.set(probe.number, probe);
    }
    const firstRecord = records[0];
    if (!firstRecord) continue;
    await writeEpisodeBatch(
      {
        showId: options.showId,
        season,
        malId: firstRecord.malId,
        seasonMalId:
          seasonRecords.find((record) => record.season === season)?.malId ??
          (season === 1 ? options.rootMalId : firstRecord.parentMalId),
        title: formatLabel(firstRecord),
        episodes,
        sourceByNumber,
      },
      report,
    );
    report.specialGroups += episodes.length;
  }

  report.seasons = writtenTvSeasons.size || report.seasons;

  if (options.discovery.ambiguous) {
    report.warnings.push(
      "AniList sezon zincirinde birden fazla devam bulundu; yalnızca kesin eşleşen sezonlar otomatik yazıldı.",
    );
  }
  return report;
}

type ExistingExtraShow = {
  id: string;
  title?: string | null;
  media_format?: string | null;
  kind?: string | null;
};

/**
 * Eski sürümün ayrı açtığı OVA/ONA/Special kartlarını kökten kaldırır.
 *
 * Bu işlem yalnız `franchise_root_id` ile bağlanmış ve biçimi açıkça ek içerik
 * olan kayıtları hedefler; filmlere, elle açılmış bağımsız dizilere veya başka
 * ailelere dokunmaz. `repairFranchiseCatalog` çağrısı sağlık panelindeki onay
 * penceresinden sonra yapılır.
 */
async function removeLegacyExtraShows(
  rootShowId: string,
  report: BulkCatalogReport,
  legacyExtraShowIds: string[] = [],
) {
  const result = await db
    .from("shows")
    .select("id,title,media_format,kind")
    .eq("franchise_root_id", rootShowId);
  if (result.error) {
    if (/franchise_root_id|media_format/i.test(result.error.message ?? "")) {
      for (const showId of legacyExtraShowIds) {
        if (showId === rootShowId) {
          report.warnings.push("Kök anime güvenlik nedeniyle silinmedi.");
          continue;
        }
        const fallbackDelete = await db.from("shows").delete().eq("id", showId);
        if (fallbackDelete.error) {
          report.warnings.push(
            `Eski ek içerik (${showId}) silinemedi: ${fallbackDelete.error.message}`,
          );
        } else {
          report.removedExtraShows += 1;
        }
      }
      if (legacyExtraShowIds.length === 0) {
        report.warnings.push(
          "Eski OVA kartları otomatik temizlenemedi; franchise migration çalıştırılmamış.",
        );
      }
      return;
    }
    throw result.error;
  }

  const extras = ((result.data ?? []) as ExistingExtraShow[]).filter((show) =>
    ["OVA", "ONA", "SPECIAL"].includes(String(show.media_format ?? "").toUpperCase()),
  );
  for (const extra of extras) {
    const { error } = await db.from("shows").delete().eq("id", extra.id);
    if (error) {
      report.warnings.push(`${extra.title ?? "Ek içerik"} silinemedi: ${error.message}`);
      continue;
    }
    report.removedExtraShows += 1;
  }
  const removedIds = new Set(extras.map((extra) => extra.id));
  for (const showId of legacyExtraShowIds) {
    if (showId === rootShowId) {
      report.warnings.push("Kök anime güvenlik nedeniyle silinmedi.");
      continue;
    }
    if (removedIds.has(showId)) continue;
    const { error } = await db.from("shows").delete().eq("id", showId);
    if (error) {
      report.warnings.push(`Eski ek içerik (${showId}) silinemedi: ${error.message}`);
    } else {
      report.removedExtraShows += 1;
    }
  }
}

/**
 * Kök kataloğu doğru modeliyle yeniden yazar ve eski ayrı OVA kayıtlarını
 * onaylı bir sağlık onarımının parçası olarak temizler.
 */
export async function repairFranchiseCatalog(
  options: BulkCatalogOptions,
): Promise<BulkCatalogReport> {
  const report = await importFranchiseCatalog(options);
  await removeLegacyExtraShows(options.showId, report, options.legacyExtraShowIds);
  return report;
}

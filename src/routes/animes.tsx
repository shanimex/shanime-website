/**
 * Dizi ve film kataloğu (`/animes`).
 *
 * Liste ana sayfanın kullandığı aynı önbellekten gelir. Arama ve filtreler
 * tarayıcıda çalışır; katalog ekranı için ek Supabase okuması yapılmaz.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, X } from "lucide-react";

import { LibraryStatusMenu } from "@/components/catalog/LibraryStatusMenu";
import { PAGE_CONTAINER } from "@/components/home/homeClass";
import { ControlSelect } from "@/components/site/ControlSelect";
import { useTranslatedTexts } from "@/lib/content-translate";
import { fetchShows, showSlug, type ShowWithImage } from "@/lib/content";
import { t as translate, useDocumentTitle, useLang, type Lang } from "@/lib/i18n";
import { cachedRead, TTL_CATALOG_SECONDS } from "@/lib/server-cache";

type CatalogKind = "all" | "series" | "movie";
type CatalogSort = "featured" | "newest" | "az";

function normalizedKind(show: ShowWithImage): Exclude<CatalogKind, "all"> {
  return String(show.kind ?? "series").toLowerCase() === "movie" ? "movie" : "series";
}

function splitGenres(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/[,/|·]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Supabase'deki mevcut Türkçe tür adları için anında ve tutarlı EN karşılığı. */
const EN_GENRE_LABELS: Record<string, string> = {
  aksiyon: "Action",
  "başka dünya": "Isekai",
  "bilim kurgu": "Sci-Fi",
  doğaüstü: "Supernatural",
  drama: "Drama",
  fantastik: "Fantasy",
  gerilim: "Thriller",
  gizem: "Mystery",
  "günlük yaşam": "Slice of Life",
  komedi: "Comedy",
  korku: "Horror",
  macera: "Adventure",
  psikolojik: "Psychological",
  shounen: "Shounen",
  seinen: "Seinen",
  josei: "Josei",
  romantik: "Romance",
  spor: "Sports",
  müzik: "Music",
  ecchi: "Ecchi",
};

function genreKey(value: string): string {
  return value.trim().toLocaleLowerCase("tr");
}

function knownGenreLabel(value: string, lang: Lang): string {
  return lang === "en" ? (EN_GENRE_LABELS[genreKey(value)] ?? "") : value;
}

/** Bilinen türleri anında çevirir, yeni/admin türlerini otomatik çeviri API'sine bırakır. */
function useCatalogGenreLabels(values: string[], lang: Lang): string[] {
  const unknownValues = useMemo(
    () =>
      lang === "en"
        ? Array.from(new Set(values.filter((value) => !EN_GENRE_LABELS[genreKey(value)])))
        : [],
    [lang, values],
  );
  const translatedUnknownValues = useTranslatedTexts(unknownValues);
  const translatedByKey = useMemo(
    () =>
      new Map(
        unknownValues.map((value, index) => [
          genreKey(value),
          translatedUnknownValues[index] ?? value,
        ]),
      ),
    [translatedUnknownValues, unknownValues],
  );

  return useMemo(
    () =>
      values.map(
        (value) => knownGenreLabel(value, lang) || translatedByKey.get(genreKey(value)) || value,
      ),
    [lang, translatedByKey, values],
  );
}

function normalizedYear(value: string | null | undefined): string {
  const text = String(value ?? "").trim();
  return text.match(/\d{4}/)?.[0] ?? text;
}

function yearNumber(show: ShowWithImage): number {
  const value = Number.parseInt(normalizedYear(show.year), 10);
  return Number.isFinite(value) ? value : 0;
}

export const Route = createFileRoute("/animes")({
  loader: () => cachedRead("public:catalog:shows", TTL_CATALOG_SECONDS, fetchShows),
  head: () => ({
    meta: [
      { title: `${translate("catalog.headingAll")} | shanime` },
      { name: "description", content: translate("meta.animesDescription") },
      { property: "og:title", content: `${translate("catalog.headingAll")} | shanime` },
      { property: "og:description", content: translate("meta.animesDescription") },
      { property: "og:url", content: "https://shanime.xyz/animes" },
    ],
    links: [{ rel: "canonical", href: "https://shanime.xyz/animes" }],
  }),
  component: Catalog,
});

function Catalog() {
  const { lang, t } = useLang();
  const loadedShows = Route.useLoaderData();
  const dbShows = useMemo(() => loadedShows ?? [], [loadedShows]);
  const [kindFilter, setKindFilter] = useState<CatalogKind>("all");
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("all");
  const [year, setYear] = useState("all");
  const [sort, setSort] = useState<CatalogSort>("featured");

  const heading =
    kindFilter === "movie"
      ? t("catalog.headingMovies")
      : kindFilter === "series"
        ? t("catalog.headingSeries")
        : t("catalog.headingAll");

  useDocumentTitle(`${heading} | shanime`);

  const counts = useMemo(() => {
    return dbShows.reduce(
      (result, show) => {
        result[normalizedKind(show)] += 1;
        return result;
      },
      { series: 0, movie: 0 },
    );
  }, [dbShows]);

  const genreOptions = useMemo(
    () =>
      Array.from(new Set(dbShows.flatMap((show) => splitGenres(show.genre))))
        .sort((a, b) => a.localeCompare(b, lang))
        .slice(0, 40),
    [dbShows, lang],
  );

  const yearOptions = useMemo(
    () =>
      Array.from(new Set(dbShows.map((show) => normalizedYear(show.year)).filter(Boolean))).sort(
        (a, b) => Number(b) - Number(a) || b.localeCompare(a, lang),
      ),
    [dbShows, lang],
  );
  const translatedGenreOptions = useCatalogGenreLabels(genreOptions, lang);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(lang);
    const selectedGenre = genre.toLocaleLowerCase(lang);

    const result = dbShows.filter((show) => {
      const showKind = normalizedKind(show);
      if (kindFilter !== "all" && showKind !== kindFilter) return false;

      if (needle) {
        const translatedGenres = splitGenres(show.genre)
          .map((item) => knownGenreLabel(item, lang))
          .join(" ");
        const searchable = `${show.title} ${show.subtitle} ${show.slug ?? ""} ${show.genre} ${translatedGenres}`;
        if (!searchable.toLocaleLowerCase(lang).includes(needle)) return false;
      }

      if (genre !== "all") {
        const matchesGenre = splitGenres(show.genre).some(
          (item) => item.toLocaleLowerCase(lang) === selectedGenre,
        );
        if (!matchesGenre) return false;
      }

      if (year !== "all" && normalizedYear(show.year) !== year) return false;
      return true;
    });

    if (sort === "newest") {
      return [...result].sort((a, b) => yearNumber(b) - yearNumber(a));
    }

    if (sort === "az") {
      return [...result].sort((a, b) => a.title.localeCompare(b.title, lang));
    }

    return result;
  }, [dbShows, genre, kindFilter, lang, query, sort, year]);

  const hasActiveFilters =
    kindFilter !== "all" ||
    query.trim() !== "" ||
    genre !== "all" ||
    year !== "all" ||
    sort !== "featured";

  const categoryOptions: Array<{ id: CatalogKind; label: string; count: number }> = [
    { id: "all", label: t("catalog.all"), count: dbShows.length },
    { id: "series", label: t("catalog.series"), count: counts.series },
    { id: "movie", label: t("catalog.movies"), count: counts.movie },
  ];

  function clearFilters() {
    setKindFilter("all");
    setQuery("");
    setGenre("all");
    setYear("all");
    setSort("featured");
  }

  return (
    <div className="min-h-screen pb-16">
      <div className={`${PAGE_CONTAINER} pt-8 sm:pt-12`}>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
          <h1 className="page-title font-display text-3xl font-extrabold tracking-[-0.04em] text-foreground sm:text-4xl">
            {heading}
          </h1>
          <span className="pb-1 text-sm text-muted-foreground">
            {t("catalog.cataloged", { count: dbShows.length })}
          </span>
        </div>

        <div className="relative mt-5 max-w-2xl">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("catalog.search")}
            aria-label={t("common.search")}
            className="h-11 w-full rounded-xl border border-border bg-input pl-10 pr-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("common.clearSearch")}
              className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <X aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>

        <div
          aria-label={t("catalog.filterAria")}
          className="mt-5 flex flex-wrap items-center gap-2 border-b border-border pb-5"
        >
          <div className="flex flex-wrap items-center gap-2" role="tablist">
            {categoryOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={kindFilter === option.id}
                onClick={() => setKindFilter(option.id)}
                className={`rounded-full border px-3.5 py-2 text-sm font-semibold transition ${
                  kindFilter === option.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary/60 hover:text-foreground"
                }`}
              >
                {option.label}
                <span className="ml-1.5 text-xs opacity-70">{option.count}</span>
              </button>
            ))}
          </div>

          <span aria-hidden className="hidden h-6 w-px bg-border sm:block" />

          <CatalogSelect
            label={t("catalog.genre")}
            value={genre}
            onChange={setGenre}
            options={[
              { value: "all", label: t("catalog.allGenres") },
              ...genreOptions.map((item, index) => ({
                value: item,
                label: translatedGenreOptions[index] ?? item,
              })),
            ]}
          />
          <CatalogSelect
            label={t("catalog.year")}
            value={year}
            onChange={setYear}
            options={[
              { value: "all", label: t("catalog.allYears") },
              ...yearOptions.map((item) => ({ value: item, label: item })),
            ]}
          />
          <CatalogSelect
            label={t("catalog.sort")}
            value={sort}
            onChange={(value) => setSort(value as CatalogSort)}
            options={[
              { value: "featured", label: t("catalog.sortFeatured") },
              { value: "newest", label: t("catalog.sortNewest") },
              { value: "az", label: t("catalog.sortAZ") },
            ]}
          />
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
            >
              <X aria-hidden className="size-3.5" />
              {t("catalog.clear")}
            </button>
          ) : null}
        </div>

        <div className="mt-7 flex items-center justify-between gap-4">
          <h2 className="font-display text-lg font-bold text-foreground">{heading}</h2>
          <span className="text-sm tabular-nums text-muted-foreground">{filtered.length}</span>
        </div>

        {filtered.length === 0 ? (
          <p className="py-20 text-center text-muted-foreground">{t("catalog.noResults")}</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filtered.map((show) => (
              <CatalogCard key={show.id || show.slug || show.title} show={show} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CatalogSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <ControlSelect
      ariaLabel={label}
      triggerLabel={label}
      variant="catalog"
      options={options.map((option) => ({
        key: option.value,
        label: option.label,
        active: option.value === value,
      }))}
      onSelect={onChange}
    />
  );
}

function CatalogCard({ show }: { show: ShowWithImage }) {
  const { lang, t } = useLang();
  const kind = normalizedKind(show);
  const genres = useMemo(() => splitGenres(show.genre), [show.genre]);
  const translatedGenres = useCatalogGenreLabels(genres, lang);
  const subtitleSource = useMemo(
    () => (lang === "en" && genres.length === 0 && show.subtitle.trim() ? [show.subtitle] : []),
    [genres.length, lang, show.subtitle],
  );
  const translatedSubtitle = useTranslatedTexts(subtitleSource)[0] ?? show.subtitle;
  const cardVisual = (
    <div className="absolute inset-0 overflow-hidden rounded-2xl bg-card shadow-xl transition duration-300">
      <img
        src={show.image}
        alt={t("home.coverAlt", { title: show.title })}
        width={768}
        height={1024}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 size-full object-cover transition duration-300 ease-out"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-300 group-hover:bg-black/35"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/95 via-black/20 to-transparent"
      />
      <div className="absolute inset-x-0 bottom-0 p-3">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/70">
          <span>{kind === "movie" ? t("catalog.movieKind") : t("catalog.seriesKind")}</span>
          {normalizedYear(show.year) ? <span>· {normalizedYear(show.year)}</span> : null}
        </div>
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-5 text-white">
          {show.title}
        </h3>
        <p className="mt-1 line-clamp-1 text-xs text-white/65">
          {translatedGenres.slice(0, 2).join(" · ") || translatedSubtitle}
        </p>
      </div>
    </div>
  );

  if (!show.id) {
    return <article className="group relative isolate aspect-[3/4]">{cardVisual}</article>;
  }

  return (
    <div className="group relative isolate aspect-[3/4]">
      <Link
        to="/anime/$slug"
        params={{ slug: showSlug(show) }}
        preload={false}
        className="absolute inset-0"
      >
        {cardVisual}
      </Link>
      <LibraryStatusMenu slug={showSlug(show)} />
    </div>
  );
}

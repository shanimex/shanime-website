import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronDown, Home, LayoutGrid, List, Play } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AdSlot } from "@/components/AdSlot";
import { EpisodeCard } from "@/components/EpisodeCard";
import { fetchShowDetail, showSlug, watchHref } from "@/lib/content";

/** Bir seferde gösterilen bölüm sayısı. 1000+ bölümlü seride sayfa kilitlenmesin. */
const GRID_PAGE_SIZE = 24;

export const Route = createFileRoute("/seri/$slug")({
  // Sayfa verisi loader'da çekilir. Kazanç: (1) sayfa sunucuda gerçek içerikle
  // render edilir, arama motoru bölümleri görür; (2) başlık/açıklama seriye
  // özel üretilebilir (eskiden TÜM seri sayfaları aynı başlığı taşıyordu).
  loader: ({ params }) => fetchShowDetail(params.slug),
  staleTime: 5 * 60_000,
  head: ({ loaderData }) => {
    const detail = loaderData;
    if (!detail) {
      return {
        meta: [{ title: "Seri bulunamadı | shanime" }, { name: "robots", content: "noindex" }],
      };
    }
    const { show, episodes, seasons } = detail;
    const title = `${show.title} izle | shanime`;
    const summary = (show.description ?? "").replace(/\s+/g, " ").trim();
    const description = summary
      ? `${summary.slice(0, 150)}${summary.length > 150 ? "…" : ""}`
      : `${show.title} tüm bölümleri Türkçe altyazılı izle.${
          seasons.length > 1 ? ` ${seasons.length} sezon,` : ""
        } ${episodes.length} bölüm.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "video.tv_show" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: ShowDetailPage,
  errorComponent: () => <Centered>Bu seri yüklenemedi.</Centered>,
  notFoundComponent: () => <Centered>Bu seri bulunamadı.</Centered>,
});

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-5 text-center">
      <div>
        <p className="text-sm text-muted-foreground">{children}</p>
        <Link to="/" className="mt-4 inline-flex text-sm font-extrabold text-primary">
          Ana sayfaya dön
        </Link>
      </div>
    </div>
  );
}

function seasonLabel(season: { number: number; title: string }): string {
  return season.title.trim() || `${season.number}. Sezon`;
}

function ShowDetailPage() {
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  // Varsayılan görünüm animecix tarzı SATIR düzeni; kapak ızgarası alternatif.
  const [view, setView] = useState<"row" | "grid">("row");
  const [visibleCount, setVisibleCount] = useState(GRID_PAGE_SIZE);
  // Uzun açıklama 3 satırda kısaltılır; sayfa "kompakt" kalsın diye.
  const [descOpen, setDescOpen] = useState(false);

  // Veri loader'dan gelir; sayfa sunucuda içerikle birlikte render edildiği
  // için ayrı bir "yükleniyor" ekranına gerek yok.
  const data = Route.useLoaderData();

  if (!data) return <Centered>Bu seri bulunamadı.</Centered>;

  const { show, episodes, seasons } = data;
  const playableSeasons = seasons.filter((season) => season.episodes.length > 0);
  // Boş sezonlar (henüz bölümü olmayan, panelde hazırlananlar) halka açık
  // sayfada görünmez; yalnızca içinde bölüm olan sezonlar listelenir.
  const activeSeason =
    playableSeasons.find((season) => season.number === selectedSeason) ??
    playableSeasons[0] ??
    null;
  const firstEpisode = playableSeasons[0]?.episodes[0] ?? null;
  const backdrop = show.banner_image || show.image;
  const activeEpisodes = activeSeason?.episodes ?? [];
  const visibleEpisodes = activeEpisodes.slice(0, visibleCount);
  const hiddenCount = activeEpisodes.length - visibleEpisodes.length;
  const description = show.description?.trim() ?? "";
  // Bu uzunluğun üstündeki açıklamalar 3 satırı aşar; "devamını oku" gösterilir.
  const longDescription = description.length > 280;

  // Sezon değişince liste başa döner; yoksa 2. sezona geçince 1. sezonun
  // açılmış "daha fazla" hâli kalıyor.
  function selectSeason(number: number) {
    setSelectedSeason(number);
    setVisibleCount(GRID_PAGE_SIZE);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-5 lg:px-8">
          <Link
            to="/"
            aria-label="shanime ana sayfa"
            className="flex items-center gap-2 rounded-full px-1 py-1"
          >
            <img
              src="/shanime-logo.png"
              alt="shanime logosu"
              width={800}
              height={187}
              loading="eager"
              decoding="async"
              className="h-9 w-auto object-contain sm:h-10"
            />
            <span className="sr-only">shanime</span>
          </Link>
          {/* "Geri" kaldırıldı: tarayıcıda zaten geri düğmesi var, burada
              tekrar etmek yerine her sayfada aynı olan ana sayfa bağlantısı
              duruyor. */}
          <Link
            to="/"
            className="flex items-center gap-1.5 text-sm font-bold text-muted-foreground transition-colors hover:text-accent"
          >
            <Home size={16} /> Anasayfa
          </Link>
        </div>
      </header>

      <section className="relative isolate overflow-hidden border-b border-border">
        {/* Vitrin bandı SABİT yükseklikte. Eskiden görsel `inset-0` idi: "Devamını
            oku" ile bölüm uzayınca görsel de büyüyor, kadraj değişiyordu
            (kullanıcı geri bildirimi: "üstteki resimle beraber büyüyor").
            Artık bandın yüksekliği içerikten bağımsız: mobil 240 px, masaüstü 320 px. */}
        <div className="absolute inset-x-0 top-0 -z-20 h-60 md:h-80">
          <img
            src={backdrop}
            alt=""
            aria-hidden
            className="size-full object-cover object-center opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/85 to-background/40" />
        </div>
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-9 md:flex-row md:gap-8 md:py-12 lg:px-8">
          <img
            src={show.image}
            alt={`${show.title} kapak görseli`}
            // self-start: masaüstünde flex satırı yükseldikçe (açıklama açılınca)
            // kapak da uzuyordu — `align-items: stretch` yüzünden. Kapak artık
            // satırın yüksekliğine uymaz, kendi poster oranında kalır.
            className="aspect-[2/3] w-32 shrink-0 self-start rounded-2xl object-cover shadow-2xl sm:w-44"
          />
          <div className="min-w-0">
            <h1 className="font-display text-3xl leading-none text-accent sm:text-5xl">
              {show.title}
            </h1>
            {show.subtitle && (
              <p className="mt-3 text-sm font-bold text-muted-foreground">{show.subtitle}</p>
            )}
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold text-muted-foreground">
              {show.year && (
                <span className="rounded-full border border-border bg-background px-3 py-1">
                  {show.year}
                </span>
              )}
              {show.genre && (
                <span className="rounded-full border border-border bg-background px-3 py-1">
                  {show.genre}
                </span>
              )}
              {episodes.length > 0 && (
                <span className="rounded-full border border-border bg-background px-3 py-1">
                  {episodes.length} Bölüm
                </span>
              )}
              {playableSeasons.length > 1 && (
                <span className="rounded-full border border-border bg-background px-3 py-1">
                  {playableSeasons.length} Sezon
                </span>
              )}
            </div>
            {description && (
              <>
                <p
                  className={`mt-4 max-w-2xl text-sm leading-6 text-foreground md:text-base md:leading-7 ${
                    descOpen || !longDescription ? "" : "line-clamp-3"
                  }`}
                >
                  {description}
                </p>
                {longDescription && (
                  // Blok sarmalayıcı: buton eskiden satır içi kalıyordu ve hemen
                  // altındaki "Şimdi izle" düğmesiyle AYNI satıra düşüp üst üste
                  // görünüyordu (mobilde okunmuyordu).
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => setDescOpen((open) => !open)}
                      // py-2: dokunma alani 20 px yuksekligindeydi, mobilde zor basılıyordu.
                      className="py-2 text-sm font-bold text-accent hover:underline"
                    >
                      {descOpen ? "Daha az göster" : "Devamını oku"}
                    </button>
                  </div>
                )}
              </>
            )}
            {firstEpisode ? (
              <Button asChild variant="hero" size="lg" className="mt-6 rounded-full">
                <a href={watchHref(show, firstEpisode.season, firstEpisode.number)}>
                  <Play size={17} fill="currentColor" /> Şimdi izle
                </a>
              </Button>
            ) : (
              <Button variant="hero" size="lg" className="mt-7 rounded-full" disabled>
                <Play size={17} fill="currentColor" /> Yakında
              </Button>
            )}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl space-y-12 px-5 py-12 lg:px-8">
        <AdSlot slot="ad_detail_top" className="flex justify-center" />
        {/* Katalog, sayfanın geri kalanından daha dar bir sütunda durur: satırlar
            kısalır, kapaklar sayfaya göre daha küçük kalır (animecix düzeni). */}
        <section className="mx-auto w-full max-w-4xl">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="font-display text-3xl text-foreground">Bölümler</h2>
            {activeSeason && (
              <p className="text-sm font-bold text-muted-foreground">
                {seasonLabel(activeSeason)} · {activeEpisodes.length} bölüm
              </p>
            )}
          </div>

          {playableSeasons.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Henüz bölüm eklenmedi.</p>
          ) : (
            <>
              {/* Araç çubuğu: solda sezon sekmeleri, sağda bölüme atlama + görünüm. */}
              <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-2" role="tablist" aria-label="Sezon seçimi">
                  {playableSeasons.map((season) => {
                    const active = activeSeason?.number === season.number;
                    return (
                      <button
                        key={season.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => selectSeason(season.number)}
                        className={`rounded-full border px-4 py-2 text-sm font-bold transition-colors ${
                          active
                            ? "border-accent/60 bg-accent/15 text-accent"
                            : "border-border text-muted-foreground hover:border-accent/60 hover:text-accent"
                        }`}
                      >
                        {seasonLabel(season)}
                        <span className="ml-2 text-xs font-normal opacity-70">
                          {season.episodes.length}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 rounded-full border border-border p-1">
                    <button
                      type="button"
                      aria-pressed={view === "row"}
                      aria-label="Satır görünümü"
                      onClick={() => setView("row")}
                      className={`grid size-8 place-items-center rounded-full transition-colors ${
                        view === "row"
                          ? "bg-accent/15 text-accent"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <List size={16} />
                    </button>
                    <button
                      type="button"
                      aria-pressed={view === "grid"}
                      aria-label="Izgara görünümü"
                      onClick={() => setView("grid")}
                      className={`grid size-8 place-items-center rounded-full transition-colors ${
                        view === "grid"
                          ? "bg-accent/15 text-accent"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <LayoutGrid size={16} />
                    </button>
                  </div>
                </div>
              </div>

              <div
                className={
                  view === "row"
                    ? "mt-6 flex flex-col gap-2"
                    : "mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
                }
              >
                {visibleEpisodes.map((episode) => (
                  <EpisodeCard
                    key={episode.id}
                    slug={showSlug(show)}
                    episode={episode}
                    variant={view}
                    href={watchHref(show, activeSeason?.number ?? episode.season, episode.number)}
                  />
                ))}
              </div>

              {hiddenCount > 0 && (
                <div className="mt-6 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => setVisibleCount((count) => count + GRID_PAGE_SIZE)}
                  >
                    <ChevronDown size={16} />
                    {hiddenCount} bölüm daha göster
                  </Button>
                </div>
              )}
            </>
          )}
        </section>

        <AdSlot slot="ad_detail_bottom" className="flex justify-center" />
      </main>

      <footer className="border-t border-border bg-secondary">
        <div className="mx-auto max-w-6xl px-5 py-8 text-center text-xs text-muted-foreground lg:px-8">
          © 2026 shanime · Anime keşfi için tasarlanmıştır.
        </div>
      </footer>
    </div>
  );
}

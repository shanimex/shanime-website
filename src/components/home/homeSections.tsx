/**
 * Hero ALTINDAKİ keşif alanı (index.tsx'ten bölündü, 01.10.2026).
 *
 * Ana sayfanın sade keşif akışı. Her bölüm kendi verisine bakar; veri getirmeyen
 * bölüm BAŞLIĞIYLA birlikte hiç çizilmez.
 *
 * Trendler artık sağ kolona sıkışmaz; ana akışın içinde çok sütunlu bir bantta
 * gösterilir. Böylece geniş ekran ile telefon düzeni aynı içerik sırasını izler.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { showSlug, type ShowWithImage } from "@/lib/content";
import {
  RANK_TABS,
  RANKED_LIMIT,
  TREND_WINDOWS,
  EMPTY_TREND_ACTIVITY,
  latestPerShowItems,
  LATEST_GRID_LIMIT,
  trendWindowCount,
  useLatestEpisodes,
  useTrendActivity,
  type RankTab,
} from "@/lib/home-feed";
import { cardSlug, type ContinueItem } from "@/lib/home-static";
import { useLang } from "@/lib/i18n";
import { ContinueRow } from "@/components/home/continueWatching";
import { PosterCard, RankedRow, TrendingMobileCard } from "@/components/home/homeLists";
import { DiscoveryRow } from "@/components/home/anilist";
import {
  HEAD_GAP_ROW,
  LATEST_GRID,
  HOME_CONTENT_CONTAINER,
  SECTION_GAP,
} from "@/components/home/homeClass";

export function HomeSections({
  shows,
  continueItems,
  continueItemsResolved,
  onContinueRemove,
}: {
  shows: ShowWithImage[];
  /** Cihazdaki izleme ilerlemesi (localStorage). */
  continueItems: ContinueItem[];
  /**
   * İlk istemci render'ında localStorage okunana kadar satırın yeri korunur.
   * Aksi halde Top Trending, Continue Watching'den önce yukarı sıçrar.
   */
  continueItemsResolved: boolean;
  /**
   * "İzlemeye devam et" kartını listeden çıkarır (referans: animex.one "Edit").
   * Liste verisi `Index`te tutulduğu için silme işi oraya devredilir.
   */
  onContinueRemove: (slug: string) => void;
}) {
  const { t } = useLang();
  /** Gotaku tarzı satır okları ve kart yönetimi için yatay kaydırma durumu. */
  const [continueEditing, setContinueEditing] = useState(false);
  const continueRowRef = useRef<HTMLDivElement | null>(null);
  const latestRowRef = useRef<HTMLDivElement | null>(null);
  const trendingMobileRowRef = useRef<HTMLDivElement | null>(null);
  const trendingDesktopRowRef = useRef<HTMLDivElement | null>(null);
  const scrollPagedRow = (row: HTMLDivElement | null, direction: -1 | 1) => {
    if (!row) return;
    const maxScrollLeft = Math.max(0, row.scrollWidth - row.clientWidth);
    const target = Math.min(
      maxScrollLeft,
      Math.max(0, row.scrollLeft + direction * Math.max(1, row.clientWidth)),
    );

    // Gotaku gibi her ok tıklamasında görünen sayfa ilerler; yarım kartta
    // kalmak yerine yumuşak, hizalı ve tekrar geri alınabilir bir akış.
    row.scrollTo({ left: target, behavior: "smooth" });
  };
  const scrollContinue = (direction: -1 | 1) => {
    scrollPagedRow(continueRowRef.current, direction);
  };
  const scrollLatest = (direction: -1 | 1) => {
    scrollPagedRow(latestRowRef.current, direction);
  };
  const scrollTrending = (direction: -1 | 1) => {
    const row = window.matchMedia("(min-width: 768px)").matches
      ? trendingDesktopRowRef.current
      : trendingMobileRowRef.current;
    scrollPagedRow(row, direction);
  };
  // Yeni eklenenler ve sezon/A-Z filtreleri katalog ekranında tutulur; ana sayfa
  // yalnızca devam et, son bölümler ve trend akışını taşır.
  // NOT: tür çip şeridi KULLANICI İSTEĞİYLE TÜMÜYLE SİLİNDİ: bu bileşende tür
  // filtresiyle ilgili hiçbir şey çizilmez.

  // Kenar çubuğu sıralama sekmeleri (GÜN / HAFTA / AY). Sekmeler yalnızca SIRAYI
  // değiştirir; ek ağ isteği doğmaz — pencere sayaçları TEK sorgudan
  // (`useTrendActivity`) gelir ve React Query önbelleğinde paylaşılır.
  const [rankTab, setRankTab] = useState<RankTab>("day");

  // Seri başına pencere sayaçları. Sorgu düşerse sabit boş nesne kullanılır:
  // sekmeler yine çalışır, liste özgün sıraya düşer ve sayfa bozulmaz.
  const trendQuery = useTrendActivity();
  const trendActivity = trendQuery.data ?? EMPTY_TREND_ACTIVITY;

  // Kenar çubuğunun ANA KÜMESİ: bölümü olan seriler.
  //
  // NEDEN "En Çok Bölüm" DEĞİL DE PENCERE: projede görüntülenme ya da puan
  // verisi YOK; "en popüler" demek uydurma olurdu. Sıralama, GERÇEK olan tek
  // zaman sinyaliyle yapılır: seriye seçili pencerede eklenen bölüm sayısı.
  // Bölümü olmayan seriler listeye girmez. KÜME TÜM SEKMELERDE AYNIDIR.
  const rankable = useMemo(
    () =>
      shows
        .filter((show) => Boolean(show.id) && show.episode_count > 0)
        .map((show, index) => ({ show, index })),
    [shows],
  );

  // Sekmeye göre yeniden sıralama — tamamen istemcide, ek istek yok.
  //
  // ÖLÇÜT: seçili PENCEREDE seriye eklenen bölüm sayısı (çok → az). Eşitlikte
  // seriye EN SON eklenen bölümün tarihi (yeni → eski), o da eşitse listenin
  // özgün sırası korunur (kararlı, zıplamayan liste).
  const ranked = useMemo(() => {
    const window = TREND_WINDOWS[rankTab];
    const rows = [...rankable];
    rows.sort((a, b) => {
      const aAct = trendActivity[a.show.id];
      const bAct = trendActivity[b.show.id];
      const aCount = trendWindowCount(aAct, window);
      const bCount = trendWindowCount(bAct, window);
      if (aCount !== bCount) return bCount - aCount;
      const aNewest = aAct?.newest ?? "";
      const bNewest = bAct?.newest ?? "";
      if (aNewest !== bNewest) return aNewest < bNewest ? 1 : -1;
      return a.index - b.index;
    });
    return rows.slice(0, RANKED_LIMIT);
  }, [rankable, rankTab, trendActivity]);

  // "Son Bölümler" ızgarası ile bandın "YENİ ÇIKANLAR" kolonu AYNI sorguya bakar
  // (`queryKey` aynı olduğu için React Query sonucu PAYLAŞIR).
  const latestQuery = useLatestEpisodes(shows);
  const latestLoading = latestQuery.isPending;
  // Liste SERİ BAŞINA TEK (en yeni) bölüme indirilir; indirgeme kuralı ortaktır
  // (`latestPerShowItems`) ki ızgara ile bant aynı satırları göstersin.
  const latestPerShow = useMemo(
    () => latestPerShowItems(latestQuery.data ?? []),
    [latestQuery.data],
  );

  const latestCards = latestPerShow.slice(0, LATEST_GRID_LIMIT);
  // Panel ancak sıralanacak seri (bölümü olan) varsa çizilir; yoksa başlık ve
  // boşluk da bırakılmaz.
  const hasSidebar = rankable.length > 0;
  const trendingRef = useRef<HTMLElement | null>(null);
  const [trendingRevealed, setTrendingRevealed] = useState(false);

  useEffect(() => {
    const section = trendingRef.current;
    if (
      !section ||
      !window.matchMedia("(hover: hover) and (prefers-reduced-motion: no-preference)").matches ||
      typeof IntersectionObserver === "undefined"
    )
      return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setTrendingRevealed(true);
        observer.disconnect();
      },
      { threshold: 0.15 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, [hasSidebar]);
  // ERKEN ÇIKIŞ YOK: veri yoksa yalnızca o bölüm (başlığıyla birlikte)
  // çizilmez, boş başlık/boşluk kalmaz.

  return (
    <div
      className={`home-sections ${HOME_CONTENT_CONTAINER} pt-10 sm:pt-12`}
      data-page-ready={continueItemsResolved ? "true" : "false"}
    >
      <div className="min-w-0">
        {/* ── `#anikoto-bookmark-alert` DUYURU ŞERİDİ (ÇİZİLMEDİ) ──
            Bizde duyuru metni/alanı BULUNMUYOR; cümle uydurmak yasak olduğu için
            şerit çizilmez. Panelden yönetilen gerçek bir duyuru alanı eklendiğinde
            bu konumda çizilir. */}

        {/* ── `#community-pinned.cpin` SABİTLENMİŞ DUYURU (ÇİZİLMEDİ) ──
            Projede topluluk gönderisi/yorum tablosu YOK; başlık kopyalamak ya da
            sayı uydurmak yasak. */}

        {/* PAYLAŞIM SATIRI KALDIRILDI (kullanıcı isteği). */}

        {/* "Kaldığın yerden devam et" → cihazdaki izleme kaydından dolar.
            LocalStorage henüz okunmadıysa iskelet aynı yüksekliği korur; böylece
            aşağıdaki bölümler ilk render'da yukarı sıçramaz. Kayıt yoksa okuma
            tamamlandıktan sonra blok tamamen yok olur. */}
        {!continueItemsResolved ? (
          <section
            aria-hidden="true"
            data-layout-reserved="continue"
            className={`${SECTION_GAP} home-section-layer min-h-[274px] animate-pulse select-none`}
          >
            <div className={`h-8 ${HEAD_GAP_ROW} w-44 rounded bg-secondary/35`} />
            <div className="grid auto-cols-[calc((100vw-2.5rem-0.75rem)/2)] grid-flow-col gap-3 overflow-hidden pb-2 md:auto-cols-[calc((100%_-_2rem)/3)] md:gap-4 lg:auto-cols-[calc((100%_-_3rem)/4)] xl:auto-cols-[calc((100%_-_4rem)/5)]">
              {[0, 1, 2, 3, 4].map((item) => (
                <div key={item} className="min-w-0">
                  <div className="aspect-video rounded-lg bg-secondary/35" />
                  <div className="mt-2 h-3 w-2/3 rounded bg-secondary/30" />
                  <div className="mt-2 h-3 w-1/2 rounded bg-secondary/25" />
                </div>
              ))}
            </div>
          </section>
        ) : continueItems.length > 0 ? (
          <section
            aria-label={t("home.continueAria")}
            className={`${SECTION_GAP} home-continue-section home-section-layer`}
          >
            <div
              className={`relative flex min-w-0 items-center justify-between gap-2 pb-3 pt-5 sm:gap-3 sm:pt-0 ${HEAD_GAP_ROW}`}
            >
              {/* Büyük başlık KALDIRILDI (kullanıcı isteği): üstteki kırmızı
                  etiket ("Keep watching") zaten söylüyor, tekrarı gereksiz. */}
              <h2 className="min-w-0 shrink whitespace-nowrap font-display text-[22px] font-extrabold leading-7 tracking-[-0.035em] text-foreground sm:text-[26px] sm:leading-8">
                {t("home.continueTag")}
              </h2>
              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                {/* Mobilde üst satırda okunur kalır; başlık ve oklar aynı flex satırındadır. */}
                <button
                  type="button"
                  onClick={() => setContinueEditing((open) => !open)}
                  className="absolute right-0 top-0 whitespace-nowrap text-xs font-medium text-muted-foreground transition-colors hover:text-foreground sm:static sm:order-first sm:shrink-0 sm:text-sm"
                >
                  {continueEditing ? t("home.continueDone") : t("home.continueHistory")}
                </button>
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    aria-label={t("home.continuePrevious")}
                    onClick={() => scrollContinue(-1)}
                    className="grid size-8 place-items-center rounded-full bg-secondary/55 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:size-9"
                  >
                    <ChevronLeft className="size-4 sm:size-[18px]" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("home.continueNext")}
                    onClick={() => scrollContinue(1)}
                    className="grid size-8 place-items-center rounded-full bg-secondary/55 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:size-9"
                  >
                    <ChevronRight className="size-4 sm:size-[18px]" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
            {/* Netflix tarzı sıra: telefonda tek satır ve sağa kaydırma;
                masaüstünde mevcut yoğun ızgara korunur. */}
            <div
              ref={continueRowRef}
              className="home-continue-row ince-kaydirma grid auto-cols-[calc((100vw-2.5rem-0.75rem)/2)] grid-flow-col grid-rows-1 gap-2 overflow-x-auto overscroll-x-contain pb-2 snap-x snap-mandatory md:auto-cols-[calc((100%_-_2rem)/3)] md:gap-3 lg:auto-cols-[calc((100%_-_3rem)/4)] xl:auto-cols-[calc((100%_-_4rem)/5)] xl:gap-4"
            >
              {continueItems.map(
                ({ show, season, episode, frame, fraction, position, duration, total, malId }) => (
                  <ContinueRow
                    key={show.slug ?? show.title}
                    // Doğrudan kaldığı bölümün izleme sayfasına gider.
                    slug={cardSlug(show)}
                    season={season}
                    episode={episode}
                    title={show.title}
                    image={show.image}
                    frame={frame}
                    fraction={fraction}
                    position={position}
                    duration={duration}
                    total={total}
                    malId={malId}
                    showKind={"kind" in show ? show.kind : null}
                    editing={continueEditing}
                    onRemove={onContinueRemove}
                    className="min-w-0 snap-start"
                  />
                ),
              )}
              <span
                aria-hidden
                className="hidden max-md:block max-md:w-[54vw] max-md:min-w-[54vw]"
              />
            </div>
          </section>
        ) : null}

        {/* ── `SECTION#recent-update` — "Son Bölümler": yoğun poster ızgarası
            (en fazla 12 kart). Kart, o bölümün izleme adresine gider.
            Sağdaki filtre şeridi ve oklar BİLEREK YOK (besleyecek veri yok). */}
        {latestLoading ? (
          <section
            aria-hidden="true"
            data-layout-reserved="latest"
            className={`${SECTION_GAP} home-section-layer min-h-[366px] animate-pulse`}
          >
            <div className={`h-8 ${HEAD_GAP_ROW} w-44 rounded bg-secondary/35`} />
            <div className={`${LATEST_GRID} opacity-80`}>
              {Array.from({ length: 7 }, (_, item) => (
                <div key={item} className="min-w-0">
                  <div className="aspect-[3/4] rounded-lg bg-secondary/35" />
                  <div className="mt-2 h-3 w-2/3 rounded bg-secondary/30" />
                  <div className="mt-2 h-3 w-1/2 rounded bg-secondary/25" />
                </div>
              ))}
            </div>
          </section>
        ) : latestCards.length > 0 ? (
          <DiscoveryRow
            title={t("home.latestEpisodes")}
            gridClassName={LATEST_GRID}
            className="home-section-layer"
            rowRef={latestRowRef}
            showTitleArrow={false}
            headerActions={
              <div className="flex shrink-0 items-center gap-3 sm:gap-4">
                <Link
                  to="/animes"
                  className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:text-[15px]"
                >
                  {t("common.seeAll")}
                </Link>
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    aria-label={t("home.latestPrevious")}
                    onClick={() => scrollLatest(-1)}
                    className="grid size-8 place-items-center rounded-full bg-secondary/55 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:size-9"
                  >
                    <ChevronLeft className="size-4 sm:size-[18px]" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("home.latestNext")}
                    onClick={() => scrollLatest(1)}
                    className="grid size-8 place-items-center rounded-full bg-secondary/55 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:size-9"
                  >
                    <ChevronRight className="size-4 sm:size-[18px]" aria-hidden="true" />
                  </button>
                </div>
              </div>
            }
          >
            {latestCards.map((item) => (
              <PosterCard
                key={item.id}
                // Bölüme doğrudan gider: /anime/<slug>/season/<s>/episode/<n>
                slug={showSlug(item.show)}
                season={item.season}
                episode={item.number}
                title={item.show.title}
                image={item.show.image}
                showKind={item.show.kind}
                // Filmler sezon/bölüm kodu taşımaz; kart yalnızca film adını
                // gösterir. Dizi bölümlerinde mevcut S1B5/S1E5 bilgisi korunur.
                meta={
                  item.show.kind === "movie"
                    ? undefined
                    : t("series.seasonEpisodeLabel", {
                        season: item.season,
                        number: item.number,
                      })
                }
                metaClassName="mb-1 w-full truncate text-[11px] font-medium leading-4 text-muted-foreground"
              />
            ))}
          </DiscoveryRow>
        ) : null}
      </div>

      {hasSidebar && (
        <section
          ref={trendingRef}
          id="home-sidebar"
          aria-label={t("home.rankingAria")}
          className={`${SECTION_GAP} home-section-layer trending-section ${trendingRevealed ? "is-revealed" : ""} min-w-0 scroll-mt-24`}
        >
          <div className="trending-panel relative w-full overflow-hidden rounded-2xl bg-gradient-to-br from-[#241519] via-[#151014] to-[#09090b] p-3 sm:p-4 md:p-5">
            {[1, 2, 3, 4, 5, 6].map((particle) => (
              <svg
                key={particle}
                aria-hidden="true"
                viewBox="0 0 40 40"
                className={`trending-particle trending-particle-${particle}`}
              >
                <polygon
                  points="20,3 37,15 30,36 10,36 3,15"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            ))}

            <div className="relative z-10">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
                <div className="flex min-w-0 flex-1 items-center gap-4">
                  <h2 className="shrink-0 font-display text-2xl font-extrabold tracking-[-0.03em] text-foreground">
                    {t("home.ranking")}
                  </h2>
                  <div
                    role="tablist"
                    aria-label={t("home.rankTabAria")}
                    className="ince-kaydirma flex min-w-0 items-center gap-4 overflow-x-auto"
                  >
                    {RANK_TABS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="tab"
                        aria-selected={rankTab === item.id}
                        title={t(item.hintKey)}
                        onClick={() => setRankTab(item.id)}
                        className={`relative shrink-0 px-1 pb-1 text-xs font-bold tracking-[0.16em] transition-colors after:absolute after:bottom-0 after:left-0 after:h-0.5 after:bg-primary after:transition-[width,opacity] ${
                          rankTab === item.id
                            ? "text-primary after:w-full after:opacity-100"
                            : "text-muted-foreground after:w-0 after:opacity-0 hover:text-foreground hover:after:w-1/2 hover:after:opacity-70"
                        }`}
                      >
                        {t(item.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    aria-label={t("home.trendingPrevious")}
                    onClick={() => scrollTrending(-1)}
                    className="grid size-8 place-items-center rounded-full bg-secondary/55 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:size-9"
                  >
                    <ChevronLeft className="size-4 sm:size-[18px]" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("home.trendingNext")}
                    onClick={() => scrollTrending(1)}
                    className="grid size-8 place-items-center rounded-full bg-secondary/55 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:size-9"
                  >
                    <ChevronRight className="size-4 sm:size-[18px]" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div
                ref={trendingMobileRowRef}
                className="ince-kaydirma mt-4 flex gap-3 overflow-x-auto pb-1 md:hidden"
              >
                {ranked.map(({ show }, index) => (
                  <TrendingMobileCard key={show.slug ?? show.title} show={show} rank={index + 1} />
                ))}
              </div>
              <div
                ref={trendingDesktopRowRef}
                className="ince-kaydirma mt-3 hidden auto-cols-[calc((100%_-_2rem)/3)] grid-flow-col gap-4 overflow-x-auto overscroll-x-contain pb-1 md:grid lg:auto-cols-[calc((100%_-_4rem)/5)] xl:auto-cols-[calc((100%_-_5rem)/6)]"
              >
                {ranked.map(({ show }, index) => (
                  <RankedRow key={show.slug ?? show.title} show={show} rank={index + 1} />
                ))}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

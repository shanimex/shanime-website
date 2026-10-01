/**
 * Hero ALTINDAKİ keşif alanı (index.tsx'ten bölündü, 01.10.2026).
 *
 * İki kolonlu düzen (solda geniş ana kolon, sağda dar kenar çubuğu). Her bölüm
 * kendi verisine bakar; veri getirmeyen bölüm BAŞLIĞIYLA birlikte hiç çizilmez.
 *
 * NOT (kenar çubuğu artık STICKY DEĞİL): referansta `fixed`/`sticky` olan TEK
 * eleman site header'ıdır; `aside.sidebar`ın `position` değeri `static`tir.
 * Davranış birebir aynıdır; yalnızca konum değişti.
 */
import { useMemo, useState } from "react";

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
import { PosterCard, RankedRow } from "@/components/home/homeLists";
import { DiscoveryRow, ScheduleSection, UpcomingSection } from "@/components/home/anilist";
import {
  DISCOVERY_GRID,
  DISCOVERY_GRID_CAPPED,
  HEAD_GAP_ROW,
  HEAD_ROW,
  PAGE_CONTAINER,
  SECTION_GAP,
} from "@/components/home/homeClass";

export function HomeSections({
  shows,
  continueItems,
  onContinueRemove,
}: {
  shows: ShowWithImage[];
  /** Cihazdaki izleme ilerlemesi (localStorage). Boşsa "devam et" satırı yoktur. */
  continueItems: ContinueItem[];
  /**
   * "İzlemeye devam et" kartını listeden çıkarır (referans: animex.one "Edit").
   * Liste verisi `Index`te tutulduğu için silme işi oraya devredilir — burada
   * yalnızca düzenleme kipi ve düğme çizilir.
   */
  onContinueRemove: (slug: string) => void;
}) {
  const { t } = useLang();
  /** "Düzenle" kipi: açıkken kartlar bağlantı olmaz, köşede "çıkar" düğmesi çıkar. */
  const [continueEditing, setContinueEditing] = useState(false);
  // NOT: "Yeni eklenenler" (`shows.created_at`) listesi BURADA DEĞİL, kompakt
  // banttadır (`HomeCompactBand`) — bant kullanıcı isteğiyle ana içeriğin SONUNA
  // taşındı. Liste tek yerde (bantta) hesaplanır ki iki yerde tutulup zamanla
  // birbirinden sapmasın.
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
  /**
   * Ana kolondaki ızgaraların sınıfı. Kenar çubuğu çizilirken ana kolon
   * içeriğin %75'i olur ve 6 sütun tam referans kartını verir. Kenar çubuğu
   * verisi yoksa kart genişliği sınırlı düzen kullanılır.
   */
  const mainGridClass = hasSidebar ? DISCOVERY_GRID : DISCOVERY_GRID_CAPPED;
  // ERKEN ÇIKIŞ YOK: veri yoksa yalnızca o bölüm (başlığıyla birlikte)
  // çizilmez, boş başlık/boşluk kalmaz.

  return (
    // İKİ KOLONLU SAYFA ALANI: solda GENİŞ ana kolon, sağda DAR kenar çubuğu.
    // `items-start` kritik: kenar çubuğu ana kolonun boyuna UZAMAZ.
    // KAP + KOLON RİTMİ (referanstan): kap max-width 1800 px + 10 px yan boşluk;
    // masaüstünde 4 birimlik ızgara → ana kolon 3/4 + kenar çubuğu 1/4.
    // HERO → İLK İÇERİK SATIRI üst boşluğu 119 px korunur.
    <div className={`${PAGE_CONTAINER} grid items-start gap-10 pt-[119px] lg:grid-cols-4 lg:gap-5`}>
      <div className={hasSidebar ? "min-w-0 lg:col-span-3" : "min-w-0 lg:col-span-4"}>
        {/* ── `#anikoto-bookmark-alert` DUYURU ŞERİDİ (ÇİZİLMEDİ) ──
            Bizde duyuru metni/alanı BULUNMUYOR; cümle uydurmak yasak olduğu için
            şerit çizilmez. Panelden yönetilen gerçek bir duyuru alanı eklendiğinde
            bu konumda çizilir. */}

        {/* ── `#community-pinned.cpin` SABİTLENMİŞ DUYURU (ÇİZİLMEDİ) ──
            Projede topluluk gönderisi/yorum tablosu YOK; başlık kopyalamak ya da
            sayı uydurmak yasak. */}

        {/* PAYLAŞIM SATIRI KALDIRILDI (kullanıcı isteği). */}

        {/* "Kaldığın yerden devam et" → cihazdaki izleme kaydından dolar.
            Kayıt yoksa blok tamamen yok olur. */}
        {continueItems.length > 0 && (
          <section aria-label={t("home.continueAria")} className={SECTION_GAP}>
            <div
              className={`flex items-end justify-between gap-3 border-b border-border pb-3 ${HEAD_GAP_ROW}`}
            >
              <div>
                <p className="text-[15px] font-semibold text-primary">{t("home.continueTag")}</p>
                <h2 className={`mt-1 ${HEAD_ROW}`}>{t("home.continueHeading")}</h2>
              </div>
              {/* "DÜZENLE" — düzenleme kipinde her kartın köşesinde "çıkar" düğmesi. */}
              <button
                type="button"
                onClick={() => setContinueEditing((open) => !open)}
                className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {continueEditing ? t("home.continueDone") : t("home.continueEdit")}
              </button>
            </div>
            {/* IZGARA (referans düzeni): kartlar yan yana 16:9 görsellerle;
                telefonda 2, masaüstünde 5 sütun. */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
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
                    editing={continueEditing}
                    onRemove={onContinueRemove}
                  />
                ),
              )}
            </div>
          </section>
        )}

        {/* ── `SECTION#recent-update` — "Son Bölümler": yoğun poster ızgarası
            (en fazla 12 kart). Kart, o bölümün izleme adresine gider.
            Sağdaki filtre şeridi ve oklar BİLEREK YOK (besleyecek veri yok). */}
        {latestCards.length > 0 && (
          <DiscoveryRow title={t("home.latestEpisodes")} gridClassName={mainGridClass}>
            {latestCards.map((item) => (
              <PosterCard
                key={item.id}
                // Bölüme doğrudan gider: /anime/<slug>/season/<s>/episode/<n>
                slug={showSlug(item.show)}
                season={item.season}
                episode={item.number}
                title={item.show.title}
                image={item.show.image}
                // Meta: "S1B5" (İngilizcede "S1E5") + varsa bölüm adı.
                meta={`${t("series.seasonEpisodeCode", {
                  season: item.season,
                  number: item.number,
                })}${item.title ? ` · ${item.title}` : ""}`}
              />
            ))}
          </DiscoveryRow>
        )}

        {/* ── `SECTION#upcoming-anime` — "GELECEK ANİMELER" (konum: ana kolon).
            Referansın "View more →" bağlantısı ÇİZİLMEZ (gidecek sayfa yok). */}
        <UpcomingSection shows={shows} gridClassName={mainGridClass} />

        {/* ── `DIV.top-tables.mb-3` ÜÇ KOLONLU BANT BURADAN KALDIRILDI ──
            Bant ana içeriğin EN SONUNDA durur (`Index()` sonundaki yerleşim). */}

        {/* ── "Estimated Schedule" ARTIK ANA KOLONDA DEĞİL ──
            Kenar çubuğunda Top Trending'in ALTINDA durur. Veri kaynağı DEĞİŞMEDİ. */}
      </div>

      {/* SAĞ: DAR KENAR ÇUBUĞU. Panel DIŞ kart kabuğu YOKTUR (referansta da yok).
          `self-start` sayesinde ana kolonun boyuna UZAMAZ. STICKY DEĞİL. */}
      {hasSidebar && (
        <aside aria-label={t("home.rankingAria")} className="min-w-0 lg:col-span-1 lg:self-start">
          <div>
            <div>
              {/* BAŞLIK ŞERİDİ: 27 px başlık + "pill" sekme grubu, tek satır. */}
              <div className="mb-[15px] flex flex-wrap items-center justify-between gap-x-2">
                <h2 className="pl-[5px] text-[27px] font-semibold tracking-normal text-foreground/90">
                  {t("home.ranking")}
                </h2>
                <div
                  role="tablist"
                  aria-label={t("home.rankTabAria")}
                  className="flex items-center gap-px rounded-[5px] bg-foreground/5 p-[2px]"
                >
                  {RANK_TABS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={rankTab === item.id}
                      title={t(item.hintKey)}
                      onClick={() => setRankTab(item.id)}
                      className={`rounded-[3px] px-1.5 py-0.5 text-[13.5px] font-semibold tracking-[-0.02em] transition-colors ${
                        rankTab === item.id
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t(item.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
              {/* Satır listesi: satırlar arası 12 px, çizgi YOK. */}
              <div className="space-y-3">
                {ranked.map(({ show }, index) => (
                  <RankedRow key={show.slug ?? show.title} show={show} rank={index + 1} />
                ))}
              </div>
            </div>
          </div>

          {/* ── "Estimated Schedule" — TOP TRENDING'İN HEMEN ALTINDA (24 px). */}
          <div className="mt-6">
            <ScheduleSection shows={shows} />
          </div>
          {/* ── "Discussion" paneli — ÇİZİLMEDİ (yorum sistemi yok). */}
        </aside>
      )}
    </div>
  );
}

/**
 * Liste satırları: keşif başlığı, kompakt bant, trend satırı (index.tsx'ten
 * bölündü, 01.10.2026).
 *
 * Üç bant kolonu aynı satırı kullanır; kenar çubuğu satırı banner önceliklidir
 * (önce `banner_image`, yoksa poster). İşaretleme ve ölçüler birebir aynıdır.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Calendar, ChevronRight, Layers, Tag, Tv } from "lucide-react";

import { showSlug, type ShowWithImage } from "@/lib/content";
import { latestPerShowItems, useLatestEpisodes, COMPACT_ROW_LIMIT } from "@/lib/home-feed";
import { plural, useLang, type Translate } from "@/lib/i18n";
import {
  BAND_BADGE,
  BAND_BADGE_BG,
  BAND_GRID,
  BAND_META_SEP,
  BAND_ROW,
  BAND_ROW_META,
  BAND_ROW_POSTER,
  BAND_ROW_TITLE,
  BAND_ROWS_GAP,
  HEAD_BAND,
  HEAD_GAP_BAND,
  HEAD_GAP_ROW,
  HEAD_ROW,
  SECTION_GAP,
} from "@/components/home/homeClass";

/**
 * Keşif satırı başlığı: solda büyük-harf başlık + ok, sağda isteğe bağlı
 * "Tümü" bağlantısı. Referanstaki satır başlığının tipografik ölçeğinin aynısı.
 *
 * NEDEN İKİ ÖLÇEK: referans ana kolon başlıklarını 27 px (600) ile, bant
 * kolonlarının başlıklarını ise 20.25 px BÜYÜK HARF ve soluk renkle çiziyor.
 * İki ölçek tek bileşende tutulur ki başlıklar site içinde birbirinden sapmasın.
 */
export function DiscoveryRowHeader({
  title,
  moreHref,
  variant = "row",
}: {
  title: string;
  // `| undefined`: `exactOptionalPropertyTypes` açık.
  moreHref?: string | undefined;
  /** "row" = ana kolon satırı, "band" = bant kolonu (küçük, büyük harf). */
  variant?: "row" | "band" | undefined;
}) {
  const { t } = useLang();
  const isBand = variant === "band";
  return (
    <div
      className={`flex items-center justify-between gap-3 border-b border-border pb-3 ${
        isBand ? HEAD_GAP_BAND : HEAD_GAP_ROW
      }`}
    >
      <h2 className={`flex items-center gap-2 ${isBand ? HEAD_BAND : HEAD_ROW}`}>
        {title}
        <ArrowRight size={isBand ? 16 : 20} aria-hidden="true" className="shrink-0 text-primary" />
      </h2>
      {moreHref ? (
        <a
          href={moreHref}
          className="group link-hover flex items-center gap-2 text-[15px] font-semibold text-muted-foreground transition-colors hover:text-accent"
        >
          {t("common.viewAll")}
          <ArrowRight
            size={15}
            aria-hidden="true"
            className="transition-transform group-hover:translate-x-1"
          />
        </a>
      ) : null}
    </div>
  );
}

/**
 * Kompakt bant satırı — referansın `section.top-table … .item` satırının
 * BİREBİR kopyası.
 *
 * SATIR: `display:flex`, 10 px dolgu, 5 px köşe; satırlar arasında 15 px boşluk
 * (kolon `space-y-[15px]`). Referansta AYIRICI ÇİZGİ YOKTUR.
 *
 * METİN ŞERİDİ: en solda ROZET (eğik zemin, 17.415 px yükseklik), sonra meta
 * öğeleri ve aralarında referansın `/` ayracı. TARİH şeridin SON öğesidir.
 *
 * NEDEN AYRI BİLEŞEN: üç bant kolonu aynı satırı kullanıyor; ayrı ayrı
 * yazılsaydı biri güncellenmeden kalırdı.
 */
export function CompactRow({
  slug,
  watch,
  image,
  title,
  badge,
  badgeTitle,
  meta,
}: {
  // `| undefined` bilerek: projede `exactOptionalPropertyTypes` açık.
  /** Hedef serinin slug'ı; boşsa satır bağlantısız çizilir. */
  slug?: string | undefined;
  /**
   * Verilirse satır İZLEME sayfasına (`/anime/<slug>/season/<n>/episode/<n>`),
   * verilmezse ANİME detayına (`/anime/<slug>`) gider.
   */
  watch?: { season: number; episode: number } | undefined;
  image: string;
  title: string;
  /** Sol baştaki rozet metni (ör. referanstaki bölüm numarası). Boşsa çizilmez. */
  badge?: string | undefined;
  /** Rozetin ipucu balonu (ör. "Bölüm sayısı"). */
  badgeTitle?: string | undefined;
  /** Rozetten SONRAKİ meta öğeleri; aralarına referansın `/` ayracı girer. */
  meta?: string[] | undefined;
}) {
  // Boş öğeler hiç çizilmez: şeritte başıboş ayraç kalmaz.
  const metaItems = (meta ?? []).filter(Boolean);
  // Satır sınıfı iki dalda da AYNI: yalnızca gezinme öğesi değişir.
  const rowClassName = BAND_ROW;
  const body = (
    <>
      {/* Kapak: 50 × 65 px (referans oranı %130), 3 px köşe. */}
      <img src={image} alt="" width={50} height={65} loading="lazy" className={BAND_ROW_POSTER} />
      <span className="min-w-0">
        <strong className={BAND_ROW_TITLE}>{title}</strong>
        {badge || metaItems.length > 0 ? (
          <span className={BAND_ROW_META}>
            {badge ? (
              <span className={BAND_BADGE} title={badgeTitle}>
                {/* Eğik renkli zemin: referans `skewX(345deg)`, renk bizim temadan. */}
                <span aria-hidden="true" className={BAND_BADGE_BG} />
                <span className="relative truncate">{badge}</span>
              </span>
            ) : null}
            {metaItems.map((part, index) => (
              // Anahtar konumla birlikte verilir: iki öğe aynı metni taşısa
              // React çakışan anahtar uyarısı vermez.
              <span key={`${part}-${index}`} className="flex min-w-0 items-center">
                <span aria-hidden="true" className={BAND_META_SEP}>
                  /
                </span>
                <span className="truncate">{part}</span>
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </>
  );
  // Hedef yoksa (yedek içerik) bugünkü davranış korunur: `href`siz `<a>`.
  if (!slug) {
    return <a className={rowClassName}>{body}</a>;
  }
  // Yoğun bir listedir → `preload={false}` (hover başına boşa okuma olmasın).
  return watch ? (
    <Link
      to="/anime/$slug/season/$season/episode/$episode"
      params={{ slug, season: String(watch.season), episode: String(watch.episode) }}
      preload={false}
      className={rowClassName}
    >
      {body}
    </Link>
  ) : (
    <Link to="/anime/$slug" params={{ slug }} preload={false} className={rowClassName}>
      {body}
    </Link>
  );
}

/**
 * Serinin veritabanına eklenme zamanı (`shows.created_at`).
 *
 * Kolon tip tanımında yer almıyor; `fetchShows` `select("*")` kullandığı için
 * değer çalışma anında gelir. Değer yoksa boş metin döner ve "en yeni"
 * sıralamasında o seriler listenin SONUNA düşer.
 */
function seriesCreatedAt(show: ShowWithImage): string {
  return (show as { created_at?: string }).created_at ?? "";
}

function seriesMetaParts(show: ShowWithImage): string[] {
  const year = (show.year ?? "").trim();
  const genre = (show.genre ?? "").split(",")[0]?.trim() ?? "";
  return [year, genre].filter(Boolean);
}

/**
 * Kenar çubuğu satırının meta şeridi: YIL · BÖLÜM · SEZON · İLK TÜR.
 *
 * Referans "★ puan · biçim · bölümler" ritmini taşır. Bizde puan/süre YOK;
 * uydurmak yerine elimizdeki DÖRT alan aynı ritimde yazılır. Boş alan çizilmez.
 */
type RankMeta = { year: string; episode: string; season: string; genre: string };

function rankMeta(show: ShowWithImage, t: Translate): RankMeta {
  // Tür alanı "Aksiyon, Dram, Fantastik" biçiminde; şeritte yalnızca İLK tür
  // gösterilir. NOT: tür adı veritabanı içeriğidir, bilerek ÇEVRİLMEZ.
  const firstGenre = (show.genre ?? "").split(",")[0]?.trim() ?? "";
  return {
    year: show.year ?? "",
    // `plural`: İngilizcede "1 episode" tekil yazılır; Türkçede ek almaz.
    episode:
      show.episode_count > 0
        ? plural(t, show.episode_count, "home.episodeCountOne", "home.episodeCount")
        : "",
    season:
      show.season_count > 0
        ? plural(t, show.season_count, "home.seasonCountOne", "home.seasonCount")
        : "",
    genre: firstGenre,
  };
}

/**
 * Kenar çubuğu satırının ARKA PLAN görseli.
 *
 * KURAL: ÖNCE serinin BANNER'ı, banner yoksa/boşsa ESKİ davranış olan POSTER.
 * Poster yalnızca banner gerçekten yokken çizilir; hiçbir satır görselsiz kalmaz.
 */
function rankArtwork(show: ShowWithImage): string {
  const banner = (show.banner_image ?? "").trim();
  return banner || show.image;
}

/**
 * Kenar çubuğu satırı — referans "Top Trending" satırının BİREBİR kopyası.
 *
 * Yapı (soldan sağa): 100 px satır, arkada tam kaplama kapak (banner öncelikli,
 * yıkamalı + iki gradyan), 48 px kutuda iki katmanlı sıra numarası, başlık +
 * meta şeridi, sağda hover'da gelen "seriye git" oku.
 */
export function RankedRow({ show, rank }: { show: ShowWithImage; rank: number }) {
  const { t } = useLang();
  const meta = rankMeta(show, t);
  return (
    // KENAR ÇUBUĞU SATIRI — İSTEMCİ İÇİ gezinme (`Link`), önden çekme KAPALI
    // (hover başına hedef rotanın 4 tabloluk okuması yanmasın diye).
    <Link
      to="/anime/$slug"
      params={{ slug: showSlug(show) }}
      preload={false}
      className="group relative block h-[100px] w-full overflow-hidden rounded-[12px] border border-foreground/5 bg-background text-left transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:translate-x-2 hover:border-foreground/20"
    >
      {/* Hover parıltısı. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-[800ms] group-hover:opacity-100"
        style={{ boxShadow: "inset 40px 0 80px -40px var(--primary)" }}
      />
      {/* GÖRSEL: satırın arkasına gömülü tam kaplama (banner öncelikli). */}
      <img
        src={rankArtwork(show)}
        alt=""
        width={1280}
        height={720}
        loading="lazy"
        className="absolute inset-0 z-0 size-full object-cover object-center opacity-[0.35] mix-blend-screen grayscale-[0.35] transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-110 group-hover:opacity-80 group-hover:grayscale-0"
      />
      {/* İki perde: soldan sağa + alttan yukarı. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-r from-background via-background/90 to-transparent"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-t from-background via-transparent to-transparent"
      />
      {/* Hover'da soldan çıkan vurgu çubuğu (6 px, ana renk + parıltı). */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-0 bottom-0 left-0 z-10 w-1.5 bg-primary opacity-0 transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:opacity-100"
        style={{ boxShadow: "0 0 20px var(--primary)" }}
      />
      <div className="relative z-10 flex h-full items-center px-4">
        {/* SIRA NUMARASI: 80 px kontur (CSS ile, DOM'da tek metin) + 30 px dolu. */}
        <span className="relative flex w-12 shrink-0 items-center justify-center">
          <span
            aria-hidden="true"
            data-rank={rank}
            className="absolute top-1/2 -left-3 -translate-y-1/2 text-[80px] leading-none font-black text-transparent italic opacity-10 transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] before:content-[attr(data-rank)] group-hover:translate-x-1 group-hover:-translate-y-1/2 group-hover:scale-[1.15] group-hover:opacity-30"
            style={{ WebkitTextStroke: "2px var(--primary)" }}
          />
          <span className="relative z-10 text-3xl font-black text-foreground italic drop-shadow-md transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1 group-hover:scale-[1.15] group-hover:text-primary">
            {rank}
          </span>
        </span>
        {/* METİN: başlık + meta şeridi (araları 6 px). */}
        <div className="ml-5 flex min-w-0 flex-1 flex-col justify-center gap-1.5">
          <h3 className="line-clamp-1 text-[15px] font-bold text-foreground/90 drop-shadow-sm transition-colors duration-300 group-hover:text-foreground">
            {show.title}
          </h3>
          {/* Meta şeridi: 10 px boşluk, 12 px / 600. */}
          <span className="flex flex-wrap items-center gap-2.5 text-xs font-semibold">
            {/* 1) YIL */}
            {meta.year ? (
              <span
                className="flex items-center gap-1 text-primary"
                style={{
                  filter:
                    "drop-shadow(0 0 8px color-mix(in oklab, var(--primary) 30%, transparent))",
                }}
              >
                <Calendar size={12} aria-hidden="true" className="shrink-0" />
                <span>{meta.year}</span>
              </span>
            ) : null}
            {/* 2) BÖLÜM / SEZON */}
            {meta.episode || meta.season ? (
              <span className="flex items-center gap-1.5 rounded-[4px] bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground/70 transition-colors group-hover:bg-foreground/10 group-hover:text-foreground">
                {meta.episode ? (
                  <span className="flex items-center gap-1" title={t("home.episodeCountTitle")}>
                    <Tv
                      size={12}
                      aria-hidden="true"
                      className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground/70"
                    />
                    <span>{meta.episode}</span>
                  </span>
                ) : null}
                {meta.episode && meta.season ? (
                  <span className="text-foreground/20 transition-colors group-hover:text-foreground/40">
                    /
                  </span>
                ) : null}
                {meta.season ? (
                  <span className="flex items-center gap-1" title={t("home.seasonCountTitle")}>
                    <Layers
                      size={12}
                      aria-hidden="true"
                      className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground/70"
                    />
                    <span>{meta.season}</span>
                  </span>
                ) : null}
              </span>
            ) : null}
            {/* 3) İLK TÜR */}
            {meta.genre ? (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Tag size={12} aria-hidden="true" className="shrink-0" />
                <span className="line-clamp-1">{meta.genre}</span>
              </span>
            ) : null}
          </span>
        </div>
        {/* Sağdaki 40×40 daire: "seriye git" oku (hover'da gelir). */}
        <span className="flex size-10 shrink-0 translate-x-4 items-center justify-center rounded-full bg-foreground/20 text-foreground opacity-0 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:translate-x-0 group-hover:bg-foreground/20 group-hover:opacity-100">
          <ChevronRight size={20} aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}

/** Bant kolonu: küçük büyük-harf başlık + ok ve altında dikey kompakt satırlar. */
export function CompactColumn({
  title,
  moreHref,
  children,
}: {
  title: string;
  // `| undefined`: `exactOptionalPropertyTypes` açık.
  moreHref?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      {/* Bant kolonu başlığı referansta daha küçük ve BÜYÜK HARF çizilir. */}
      <DiscoveryRowHeader title={title} moreHref={moreHref} variant="band" />
      {/* Satır arası boşluk referanstan 15 px. AYIRICI ÇİZGİ YOK. */}
      <div className={BAND_ROWS_GAP}>{children}</div>
    </div>
  );
}

/**
 * ISO tarihi GÜN.AY.YIL biçimine çevirir.
 *
 * NEDEN METİRDEN DİLİMLENİR (`Intl` YERİNE): sayfa sunucuda da render edilir;
 * `Intl` sunucu (UTC) ile tarayıcı (yerel saat) arasında bir gün kaydırıp
 * hidrasyon uyuşmazlığı doğuruyordu. Damga bozuksa boş metin döner.
 */
function isoDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  return year && month && day ? `${day}.${month}.${year}` : "";
}

/**
 * "TAMAMLANANLAR" İÇİN VEKİL ÖLÇÜT — şemada tamamlanma kolonu YOK.
 * Serinin EN SON bölümü en yeni bölüm tarihinden 30 günden eski eklenmişse
 * "bitmiş görünüyor" kabul edilir. Vekil boş kalırsa en çok bölümlü serilere
 * düşülür. (Kalıcı çözüm: `shows` tablosuna gerçek durum kolonu.)
 */
const COMPLETED_STALE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO damgasının GÜN kısmını UTC gece yarısına çevirir; geçersizse `0` döner. */
function isoDayMs(iso: string): number {
  const day = iso.slice(0, 10);
  if (day.length !== 10) return 0;
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * ============================================================================
 * KOMPAKT BANT — "YENİ ÇIKANLAR | YENİ EKLENENLER | TAMAMLANANLAR"
 * ============================================================================
 * Üç kolon 1200 px ve üzerinde yan yana, altında alt alta. ÜÇ KOLONUN KAYNAĞI:
 *   1) YENİ ÇIKANLAR   → en yeni BÖLÜMLER (en yeni önce).
 *   2) YENİ EKLENENLER → `shows.created_at`e göre en yeni SERİLER.
 *   3) TAMAMLANANLAR   → VEKİL ölçüt (yukarıdaki nota bak).
 *
 * Hiçbir kolonda veri yoksa bant, başlıklarıyla BİRLİKTE hiç çizilmez.
 */
export function HomeCompactBand({ shows }: { shows: ShowWithImage[] }) {
  const { t } = useLang();
  // "Son Bölümler" ızgarasıyla AYNI sorgu anahtarı: sonuç paylaşılır, ikinci bir
  // ağ okuması doğmaz.
  const latestQuery = useLatestEpisodes(shows);
  const latestPerShow = useMemo(
    () => latestPerShowItems(latestQuery.data ?? []),
    [latestQuery.data],
  );
  // Bant kolonlarındaki satır sayısı referanstan: ~5 satır.
  const newReleases = latestPerShow.slice(0, COMPACT_ROW_LIMIT);

  // Seri başına EN SON bölüm: TAMAMLANANLAR vekilinin tarih kaynağı.
  const lastEpisodeByShow = useMemo(
    () => new Map(latestPerShow.map((item) => [item.show.id, item])),
    [latestPerShow],
  );

  // YENİ EKLENENLER: `shows.created_at` yeni → eski. EK SORGU YOK.
  const newestSeries = useMemo(
    () =>
      shows
        .filter((show) => Boolean(show.id))
        .map((show, index) => ({ show, at: seriesCreatedAt(show), index }))
        .sort((a, b) => (a.at === b.at ? a.index - b.index : a.at < b.at ? 1 : -1))
        .slice(0, COMPACT_ROW_LIMIT),
    [shows],
  );

  /**
   * TAMAMLANANLAR — VEKİL. Sıra: önce "uzun süredir yeni bölüm gelmeyen"
   * seriler, bölüm sayısı çok → az. Vekil boş kalırsa en çok bölümlülere düşülür.
   */
  const completedSeries = useMemo(() => {
    const withEpisodes = shows.filter((show) => Boolean(show.id) && show.episode_count > 0);
    const byEpisodeCount = (a: ShowWithImage, b: ShowWithImage) =>
      b.episode_count - a.episode_count;
    // "Şimdi" = eldeki en yeni bölüm (sunucu/istemci aynı sonucu versin diye).
    const newestStamp = latestPerShow.reduce(
      (max, item) => Math.max(max, isoDayMs(item.createdAt)),
      0,
    );
    const cutoff = newestStamp - COMPLETED_STALE_DAYS * DAY_MS;
    const stale = withEpisodes.filter((show) => {
      const last = lastEpisodeByShow.get(show.id);
      // Son bölümü bilinmeyen seri "bitmiş" sayılmaz: kanıt yok.
      if (!last) return false;
      const at = isoDayMs(last.createdAt);
      return at > 0 && at < cutoff;
    });
    const source = stale.length > 0 ? stale : withEpisodes;
    return source.sort(byEpisodeCount).slice(0, COMPACT_ROW_LIMIT);
  }, [shows, latestPerShow, lastEpisodeByShow]);

  if (newReleases.length === 0 && newestSeries.length === 0 && completedSeries.length === 0) {
    return null;
  }

  return (
    <section aria-label={t("home.bandAria")} className={SECTION_GAP}>
      {/* Üç kolon, referansın kendi düzeninde; kolon arası 20 px. */}
      <div className={BAND_GRID}>
        {newReleases.length > 0 && (
          <CompactColumn title={t("home.newReleases")}>
            {newReleases.map((item) => (
              <CompactRow
                key={item.id}
                // Bölüme doğrudan gider: /anime/<slug>/season/<s>/episode/<n>
                slug={showSlug(item.show)}
                watch={{ season: item.season, episode: item.number }}
                image={item.show.image}
                title={item.show.title}
                // Rozet: sezon+bölüm kodu ("S1B5"), harf dile bağlı.
                badge={t("series.seasonEpisodeCode", {
                  season: item.season,
                  number: item.number,
                })}
                // Tarih, referansta olduğu gibi şeridin SON öğesidir.
                meta={[isoDate(item.createdAt)]}
              />
            ))}
          </CompactColumn>
        )}
        {newestSeries.length > 0 && (
          <CompactColumn title={t("home.newlyAdded")} moreHref="#series">
            {newestSeries.map(({ show }) => (
              <CompactRow
                key={show.slug ?? show.title}
                // Seri detayına gider; kaydı olmayanda bağlantı çizilmez.
                slug={show.id ? showSlug(show) : ""}
                image={show.image}
                title={show.title}
                // Rozet: bölüm SAYISI. İpucu balonu anlamı söyler.
                badge={show.episode_count > 0 ? String(show.episode_count) : undefined}
                badgeTitle={show.episode_count > 0 ? t("home.episodeCountTitle") : undefined}
                // Meta: yıl, ilk tür ve `shows.created_at` tarihi.
                meta={[...seriesMetaParts(show), isoDate(seriesCreatedAt(show))]}
              />
            ))}
          </CompactColumn>
        )}
        {completedSeries.length > 0 && (
          <CompactColumn title={t("home.justCompleted")}>
            {completedSeries.map((show) => {
              const last = lastEpisodeByShow.get(show.id);
              return (
                <CompactRow
                  key={show.slug ?? show.title}
                  slug={showSlug(show)}
                  image={show.image}
                  title={show.title}
                  // Rozet: bölüm sayısı (vekile göre "bitmiş" serinin büyüklüğü).
                  badge={String(show.episode_count)}
                  badgeTitle={t("home.episodeCountTitle")}
                  // Meta: sezon sayısı ve EN SON bölümün tarihi.
                  meta={[
                    show.season_count > 0
                      ? plural(t, show.season_count, "home.seasonCountOne", "home.seasonCount")
                      : "",
                    last ? isoDate(last.createdAt) : "",
                  ]}
                />
              );
            })}
          </CompactColumn>
        )}
      </div>
    </section>
  );
}

/**
 * Liste satırları: keşif başlığı, kompakt bant, trend satırı (index.tsx'ten
 * bölündü, 01.10.2026).
 *
 * Üç bant kolonu aynı satırı kullanır; kenar çubuğu satırı banner önceliklidir
 * (önce `banner_image`, yoksa poster). İşaretleme ve ölçüler birebir aynıdır.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Calendar, Layers, Play, Tag, Tv } from "lucide-react";

import { LibraryStatusMenu } from "@/components/catalog/LibraryStatusMenu";
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
  showTitleArrow = true,
  endContent,
}: {
  title: string;
  // `| undefined`: `exactOptionalPropertyTypes` açık.
  moreHref?: string | undefined;
  /** "row" = ana kolon satırı, "band" = bant kolonu (küçük, büyük harf). */
  variant?: "row" | "band" | undefined;
  /** Başlığın yanındaki kırmızı yön oku. */
  showTitleArrow?: boolean | undefined;
  /** Başlığın sağındaki özel içerik (See all + gezinme okları gibi). */
  endContent?: ReactNode | undefined;
}) {
  const { t } = useLang();
  const isBand = variant === "band";
  return (
    <div
      className={`flex items-center justify-between gap-3 pb-3 ${
        isBand ? HEAD_GAP_BAND : HEAD_GAP_ROW
      }`}
    >
      <h2 className={`flex items-center gap-2 ${isBand ? HEAD_BAND : HEAD_ROW}`}>
        {title}
        {showTitleArrow ? (
          <ArrowRight
            size={isBand ? 16 : 20}
            aria-hidden="true"
            className="shrink-0 text-primary"
          />
        ) : null}
      </h2>
      {endContent ??
        (moreHref ? (
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
        ) : null)}
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
 * Ana kolondaki TÜM poster ızgaralarının ("devam et" ve "Son Bölümler") ortak
 * kartı. Sınıflar ana ızgaradaki kartla birebir aynıdır: 2:3 poster,
 * `group-hover:scale-105`, altta kalın başlık + küçük meta satırı. Tek fark:
 * alt satırın metni çağıran tarafından verilir (ör. yalnızca "S1B5" ya da
 * "S1B5'ten devam et").
 */
export function PosterCard({
  slug,
  season,
  episode,
  title,
  image,
  showKind,
  meta,
  metaClassName,
  className,
}: {
  /**
   * Hedef serinin slug'ı. Boşsa kart BAĞLANTISIZ çizilir (veritabanı kaydı
   * olmayan yedek içerikte gidilecek bir sayfa yoktur).
   */
  slug?: string | undefined;
  /**
   * Kartın açacağı sezon. İzleme adresi YOL olarak kurulur
   * (`/anime/<slug>/season/<n>/episode/<n>`); değer verilmezse 1 yazılır.
   */
  season?: number | undefined;
  /** Kartın açacağı bölüm; yol adresi budur. */
  episode?: number | undefined;
  title: string;
  image: string;
  showKind?: string | null | undefined;
  meta?: string | undefined;
  metaClassName?: string | undefined;
  className?: string | undefined;
}) {
  const { t } = useLang();
  // Kart sınıfı iki dalda da AYNI tutulur: değişen tek şey gezinme öğesidir.
  const cardClassName = `group poster-card card-hover mobile-no-hover relative overflow-hidden rounded-2xl bg-card ${
    className ?? ""
  }`;
  const body = (
    <>
      {/* Poster kart oranı Latest Updates referansıyla korunur. */}
      <div className="relative aspect-[3/4] overflow-hidden bg-muted">
        <img
          src={image}
          alt={t("home.coverAlt", { title })}
          width={768}
          height={1152}
          loading="lazy"
          className="poster-card-image size-full object-cover transition-transform duration-500 ease-out [@media(hover:hover)]:group-hover:scale-105"
        />
        <div
          aria-hidden
          className="poster-card-shade mobile-no-hover-overlay pointer-events-none absolute inset-0 z-10 bg-black/35 opacity-0 transition-opacity duration-300 [@media(hover:hover)]:group-hover:opacity-100"
        />
        <div
          aria-hidden
          className="poster-card-details mobile-no-hover-overlay pointer-events-none absolute inset-x-0 bottom-0 z-10 flex translate-y-full items-end justify-start bg-gradient-to-t from-black/90 via-black/65 to-transparent px-3 pb-3 pt-16 opacity-0 transition-[transform,opacity] duration-300 ease-out [@media(hover:hover)]:group-hover:translate-y-0 [@media(hover:hover)]:group-hover:opacity-100"
        >
          <span className="flex flex-col items-start gap-2">
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white backdrop-blur-sm">
              {showKind === "movie" ? t("catalog.movieKind") : t("catalog.seriesKind")}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/75 px-3.5 py-2 text-xs font-bold text-black shadow-xl backdrop-blur-sm">
              <Play aria-hidden className="size-3.5 fill-current" />
              {t("common.watch")}
            </span>
          </span>
        </div>
      </div>
      {/* Yazı bloğu ölçüsü referanstan: 12 px boşluk, başlık 16.2 px / 500. */}
      <div className="px-3 pt-3 pb-2.5">
        {meta ? (
          <p
            className={
              metaClassName ??
              "mb-1 line-clamp-2 text-[11px] font-medium leading-4 text-muted-foreground"
            }
          >
            {meta}
          </p>
        ) : null}
        <h3 className="truncate text-[16px] font-medium leading-5 text-foreground">{title}</h3>
      </div>
    </>
  );
  // Hedef yoksa (yedek içerik) bugünkü davranış korunur: `href`siz `<a>`.
  if (!slug) {
    return <div className={cardClassName}>{body}</div>;
  }
  // İSTEMCİ İÇİ GEZİNME (`Link`) — ÖNDEN ÇEKME (preload) BİLEREK KAPALI
  // (hover başına hedef rotanın yükleyicisi yanmasın diye).
  return (
    <div className={cardClassName}>
      <Link
        to="/anime/$slug/season/$season/episode/$episode"
        params={{ slug, season: String(season ?? 1), episode: String(episode ?? 1) }}
        preload={false}
        className="block"
      >
        {body}
      </Link>
      <LibraryStatusMenu slug={slug} />
    </div>
  );
}

/**
 * Ana sayfadaki güncel bölümler için yatay seçki bandı.
 *
 * Referanslardaki sezon paneli fikrini alır; renk, içerik hiyerarşisi ve kart
 * davranışı shanime'ye aittir. Çocuk kartları dışarıdan aldığı için aynı veri
 * kaynağı hem doğrudan bölüm bağlantısını hem de kitaplık düğmesini korur.
 */
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
 * Masaüstü Top Trending kartının posteri.
 *
 * Dikey kart düzeninde yatay banner yerine serinin posterini tercih eder.
 */
function rankArtwork(show: ShowWithImage): string {
  return show.image;
}

/**
 * Masaüstü Top Trending kartı — Netflix'teki dikey sıralı poster düzeni.
 *
 * Mevcut sıralama, kırmızı tema, hover hareketi ve iki katmanlı numara korunur;
 * yalnızca masaüstü kartı dikey poster kompozisyonuna taşınır.
 */
export function RankedRow({ show, rank }: { show: ShowWithImage; rank: number }) {
  const { t } = useLang();
  const meta = rankMeta(show, t);
  return (
    <Link
      to="/anime/$slug"
      params={{ slug: showSlug(show) }}
      preload={false}
      className="group trending-card mobile-no-hover relative block min-w-0 overflow-visible rounded-2xl text-left transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-1"
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl border border-foreground/10 bg-card shadow-[0_12px_30px_-18px_rgba(0,0,0,0.9)] transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:border-primary/60 group-hover:shadow-[0_18px_36px_-16px_color-mix(in_oklab,var(--primary)_55%,transparent)]">
        <img
          src={rankArtwork(show)}
          alt=""
          width={420}
          height={630}
          loading="lazy"
          className="absolute inset-0 size-full object-cover object-center transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-110"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent opacity-90"
        />
        <span
          aria-hidden="true"
          className="mobile-no-hover-overlay pointer-events-none absolute inset-0 bg-primary/10 opacity-0 transition-opacity duration-[800ms] group-hover:opacity-100"
        />
        {/* Hover'da görünen kırmızı vurgu çubuğu ve parıltı. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1 bg-primary opacity-80 transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:h-1.5 group-hover:opacity-100"
          style={{ boxShadow: "0 0 20px var(--primary)" }}
        />
        {/* SIRA NUMARASI: büyük kırmızı kontur + mevcut dolu numara animasyonu. */}
        <span className="absolute inset-x-0 bottom-0 z-10 h-28">
          <span
            aria-hidden="true"
            data-rank={rank}
            className="absolute bottom-[-18px] left-[-7px] text-[112px] leading-none font-black tracking-[-0.08em] text-transparent italic opacity-70 transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] before:content-[attr(data-rank)] group-hover:translate-x-1 group-hover:scale-[1.08] group-hover:opacity-100"
            style={{
              WebkitTextStroke: "3px var(--primary)",
              filter: "drop-shadow(0 0 10px color-mix(in oklab, var(--primary) 35%, transparent))",
            }}
          />
          <span className="absolute bottom-2 left-4 text-5xl font-black leading-none text-foreground/90 italic drop-shadow-[0_3px_8px_rgba(0,0,0,0.9)] transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1 group-hover:scale-110 group-hover:text-primary">
            {rank}
          </span>
        </span>
      </div>
      {/* Poster altındaki bilgiler korunur; yalnızca yerleşim dikeyleşir. */}
      <div className="min-h-[76px] px-1.5 pt-2.5">
        <h3 className="line-clamp-2 text-[15px] font-bold leading-5 text-foreground/90 transition-colors duration-300 group-hover:text-foreground">
          {show.title}
        </h3>
        <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold">
          {meta.year ? (
            <span
              className="flex items-center gap-1 text-primary"
              style={{
                filter: "drop-shadow(0 0 8px color-mix(in oklab, var(--primary) 30%, transparent))",
              }}
            >
              <Calendar size={11} aria-hidden="true" className="shrink-0" />
              <span>{meta.year}</span>
            </span>
          ) : null}
          {meta.episode || meta.season ? (
            <span className="flex min-w-0 max-w-full flex-wrap items-center gap-1 rounded-[4px] bg-foreground/10 px-1.5 py-0.5 font-medium text-foreground/70 transition-colors group-hover:text-foreground">
              {meta.episode ? (
                <span
                  className="flex min-w-0 items-center gap-1"
                  title={t("home.episodeCountTitle")}
                >
                  <Tv
                    size={11}
                    aria-hidden="true"
                    className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground/70"
                  />
                  <span className="truncate">{meta.episode}</span>
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
                    size={11}
                    aria-hidden="true"
                    className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground/70"
                  />
                  <span>{meta.season}</span>
                </span>
              ) : null}
            </span>
          ) : null}
          {meta.genre ? (
            <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
              <Tag size={11} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{meta.genre}</span>
            </span>
          ) : null}
        </span>
      </div>
    </Link>
  );
}

/**
 * Mobil Top Trending görünümü. Masaüstündeki sıralı satırlar telefonda fazla
 * yatay alan tükettiği için aynı veriyi poster karuseli olarak sunar.
 */
export function TrendingMobileCard({ show, rank }: { show: ShowWithImage; rank: number }) {
  const { t } = useLang();
  const meta = rankMeta(show, t);
  return (
    <Link
      to="/anime/$slug"
      params={{ slug: showSlug(show) }}
      preload={false}
      className="group trending-card mobile-no-hover relative block w-[142px] shrink-0 overflow-hidden rounded-2xl bg-card"
    >
      <div className="relative aspect-[3/4] overflow-hidden">
        <img
          src={show.image}
          alt=""
          width={420}
          height={560}
          loading="lazy"
          className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/15 to-transparent"
        />
        <span className="absolute left-2 top-2 grid size-7 place-items-center rounded-full bg-black/65 text-sm font-black italic text-white backdrop-blur-sm">
          {rank}
        </span>
        <span className="absolute inset-x-2 bottom-2 line-clamp-2 text-sm font-bold leading-4 text-white">
          {show.title}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 px-2.5 py-2 text-[10px] text-muted-foreground">
        <span className="truncate">{meta.genre || t("common.anime")}</span>
        <span className="shrink-0 text-primary">{meta.year}</span>
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
 *   2) TAMAMLANANLAR   → VEKİL ölçüt (yukarıdaki nota bak).
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

  if (newReleases.length === 0 && completedSeries.length === 0) {
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
                // Sezon/bölüm kodu kapak altında tekrarlanmaz; başlık ve tarih yeterli.
                badge={undefined}
                // Tarih, referansta olduğu gibi şeridin SON öğesidir.
                meta={[isoDate(item.createdAt)]}
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

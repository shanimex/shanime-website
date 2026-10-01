/**
 * Seri kartı + A-Z listesi (index.tsx'ten bölündü, 01.10.2026).
 *
 * Harf çipleri kendi devresinde çalışır (`filter` durumu bu dosyadadır);
 * arama/tür süzmesiyle bağı yoktur. İşaretleme ve ölçüler birebir aynıdır.
 */
import { memo, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import type { HeroCard } from "@/lib/home-static";
import { showSlug } from "@/lib/content";
import { useLang } from "@/lib/i18n";
import { BRAND_LOGO_HEIGHT, BRAND_LOGO_SRC, BRAND_LOGO_WIDTH } from "@/lib/brand";
import {
  DISCOVERY_GRID_CAPPED,
  HEAD_GAP_ROW,
  HEAD_ROW,
  PAGE_CONTAINER,
} from "@/components/home/homeClass";

/**
 * SERİ KARTI — ana ızgaraların ("Bu sezon" ve "A-Z Listesi") ORTAK kartı.
 *
 * NEDEN TEK BİLEŞEN: aynı kart eskiden "Bu sezon" ızgarasının İÇİNDE satır içi
 * yazılıydı. A-Z bölümü de seri listesini çizdiği için işaretleme kopyalanınca
 * iki ızgara zamanla birbirinden sapardı; tek bileşen bunu önler.
 */
export function SeriesCard({ show }: { show: HeroCard }) {
  const { t } = useLang();
  const cardClassName =
    "group card-hover relative block overflow-hidden rounded-2xl bg-card shadow-2xl";
  const body = (
    <>
      {/* Bölümü olmayan seriler ana sayfadan belli olsun. */}
      {show.id && show.episode_count === 0 && (
        <span className="absolute left-2 top-2 z-10 rounded-full bg-background/95 px-2.5 py-1 text-[11px] font-extrabold text-accent">
          {t("common.comingSoon")}
        </span>
      )}
      {/* Ölçüler keşif kartlarıyla aynı tutuldu (poster 1:1.4, yazı 16 px / 500,
          meta 13.5 px) ki sayfadaki tüm posterler tek boyutta görünsün. */}
      <div className="aspect-[5/7] overflow-hidden bg-muted">
        <img
          src={show.image}
          alt={t("home.coverAlt", { title: show.title })}
          width={768}
          height={1152}
          loading="lazy"
          className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
        />
      </div>
      <div className="px-3 pt-3 pb-2.5">
        <h3 className="truncate text-[16px] font-medium leading-5 text-foreground">{show.title}</h3>
        <p className="mt-1 line-clamp-2 text-[13.5px] leading-[18px] text-muted-foreground">
          {show.subtitle}
        </p>
      </div>
    </>
  );
  // Veritabanı kaydı yoksa (yedek içerik) gidilecek sayfa yoktur: `href`siz <a>.
  if (!show.id) {
    return <a className={cardClassName}>{body}</a>;
  }
  // İSTEMCİ İÇİ GEZİNME; ÖNDEN ÇEKME (preload) KAPALI — hover başına boşa
  // Supabase okuması olmasın diye (kota/egress gerekçesi).
  return (
    <Link
      to="/anime/$slug"
      params={{ slug: showSlug(show) }}
      preload={false}
      className={cardClassName}
    >
      {body}
    </Link>
  );
}

/**
 * ============================================================================
 * A-Z LİSTESİ — referansın `DIV.azlist` bloğu (blueprint §4).
 * ============================================================================
 * NEREDE DURUR: referansta A-Z listesi footer'ın içindedir
 * (`FOOTER > DIV.container > DIV.azlist`). Bu yüzden bölüm main'den
 * çıkarılıp footer'ın İLK bloğu olarak çizilir.
 *
 * Bizde bu bölüm YENİ VERİ İSTEMEZ: çipler, hâlihazırda yüklü olan seri
 * listesini (`shows`) başlığın İLK HARFİNE göre İSTEMCİDE süzer.
 * (Referans çipe basınca `/az-list/<harf>` sayfasına GİDER; bizde ayrı liste
 * sayfası olmadığı için aynı süzme sayfa içinde yapılır.)
 *
 * ÇİP DAVRANIŞI (referansın `ALL # 0-9 A…Z` sırası korunur):
 *   · ALL → tüm seriler.
 *   · 0-9 → başlığı RAKAMLA başlayanlar.
 *   · #   → başlığı HARF OLMAYAN karakterle başlayanlar.
 *   · A…Z → o harfle başlayanlar.
 *
 * TÜRKÇE HARFLER: başlığın ilk harfi önce Türkçe büyütülür, sonra ASCII tabanına
 * indirgenir (Ç→C, Ğ→G, İ→I, Ö→O, Ş→S, Ü→U).
 */
/** Çip kimlikleri: sabitler + tek harfler (A…Z). Tek harf değerleri sabitlerle çakışmaz. */
const AZ_ALL = "all";
const AZ_HASH = "hash";
const AZ_DIGITS = "digits";

/** A-Z çip satırındaki 26 harf (referans sırası: A…Z). */
const AZ_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** Başlığın İLK harfini Türkçe büyütüp ASCII tabanına indirger. */
function azFirstLetter(title: string): string {
  const first = (title ?? "").trim().charAt(0);
  if (!first) return "";
  const upper = first.toLocaleUpperCase("tr");
  const folded: Record<string, string> = { Ç: "C", Ğ: "G", İ: "I", Ö: "O", Ş: "S", Ü: "U" };
  return folded[upper] ?? upper;
}

/** Seçili çipin bir seriyi gösterip göstermediği. */
function azMatches(title: string, filter: string): boolean {
  if (filter === AZ_ALL) return true;
  const base = azFirstLetter(title);
  if (filter === AZ_DIGITS) return /^[0-9]$/.test(base);
  // "#" = harf olmayan (rakam ya da simge). Boş başlık da bu kovaya düşer.
  if (filter === AZ_HASH) return !/^[A-Z]$/.test(base);
  return base === filter;
}

/**
 * A-Z bölümü: başlık + alt başlık + harf çipleri + süzülmüş seri ızgarası.
 * `shows` çağırandan gelir (ana sayfada zaten yüklü liste); ek okuma yoktur.
 */
export function AzList({ shows }: { shows: HeroCard[] }) {
  const { t } = useLang();
  // Seçili çip; varsayılan ALL (bölüm açıldığında tüm seriler görünür).
  const [filter, setFilter] = useState<string>(AZ_ALL);
  // Çip listesi SABİTTİR (ALL, #, 0-9, A…Z) — veriden türetilmez.
  const chips = useMemo(
    () => [
      { id: AZ_ALL, label: t("home.azAll") },
      { id: AZ_HASH, label: "#" },
      { id: AZ_DIGITS, label: "0-9" },
      ...AZ_LETTERS.map((letter) => ({ id: letter, label: letter })),
    ],
    [t],
  );
  // Süzme İSTEMCİDE: liste `shows` ile zaten elde, ek sorgu YOK.
  const filteredShows = useMemo(
    () => shows.filter((show) => azMatches(show.title, filter)),
    [shows, filter],
  );
  return (
    <section id="az" aria-label={t("home.azAria")} className={`${PAGE_CONTAINER} pt-12 pb-10`}>
      {/* Başlık + alt başlık (referansın bu bölümdeki kendi düzeni). */}
      <div className={HEAD_GAP_ROW}>
        <h2 className={HEAD_ROW}>{t("home.azHeading")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("home.azSubtitle")}</p>
      </div>
      {/* ÇİP SATIRI — referans: `ALL # 0-9 A B C … Z`; dar ekranda sarar. */}
      <div aria-label={t("home.azFilterAria")} className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            aria-pressed={filter === chip.id}
            onClick={() => setFilter(chip.id)}
            className={`ui-hover min-w-[36px] rounded-md border px-3 py-1.5 text-sm font-bold ${
              filter === chip.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:border-accent hover:text-accent"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>
      {/* SONUÇ IZGARASI: süzülen seriler. Hiç sonuç yoksa bilgi satırı. */}
      {filteredShows.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">{t("home.azEmpty")}</p>
      ) : (
        <div className={`mt-6 ${DISCOVERY_GRID_CAPPED}`}>
          {filteredShows.map((show) => (
            <MemoSeriesCard key={show.slug ?? show.title} show={show} />
          ))}
        </div>
      )}
    </section>
  );
}

const MemoSeriesCard = memo(SeriesCard);

/**
 * "Bu sezon" bölümü + #series ızgarası. Başlık, kartlar, `#series` kimliği ve
 * süzme davranışı (arama/tür) DEĞİŞMEDİ. Kap, başlık ölçeği ve bölüm boşlukları
 * hero altındaki bölümlerle AYNI.
 */
export function SeasonGrid({
  shows,
  filtered,
  isFiltering,
  onClearFilter,
}: {
  shows: HeroCard[];
  filtered: HeroCard[];
  isFiltering: boolean;
  onClearFilter: () => void;
}) {
  const { t } = useLang();
  return (
    <section id="season" className={`${PAGE_CONTAINER} py-10`}>
      <div className={`flex items-end justify-between ${HEAD_GAP_ROW}`}>
        <div>
          <p className="text-[15px] font-semibold text-primary">{t("home.seasonTag")}</p>
          <h2 className={`mt-1 ${HEAD_ROW}`}>{t("common.thisSeason")}</h2>
        </div>
        <a
          href="#series"
          className="group link-hover ui-hover flex items-center gap-2 text-[15px] font-semibold"
        >
          {t("common.seeAll")}{" "}
          <ArrowRight size={17} className="transition-transform group-hover:translate-x-1" />
        </a>
      </div>
      {/* Kart genişliği sınırlı düzen: tam kap genişliğinde sabit 6 sütun kartı
          gereğinden büyük çıkarıyordu; sütun sayısı sığdığı kadar artar. */}
      <div id="series" className={DISCOVERY_GRID_CAPPED}>
        {(isFiltering ? filtered : shows).map((show) => (
          <MemoSeriesCard key={show.slug ?? show.title} show={show} />
        ))}
      </div>
      {isFiltering && filtered.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-muted-foreground">{t("home.noFilterMatch")}</p>
          <button
            type="button"
            onClick={onClearFilter}
            className="ui-hover mt-4 rounded-full border border-border px-5 py-2 text-sm font-bold text-foreground hover:border-accent hover:text-accent"
          >
            {t("home.clearFilter")}
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Alt alan: A-Z listesi (footer'ın ilk bloğu) + logo/etiket + bağlantılar +
 * telif satırı. Çipler ve süzme DAVRANIŞI DEĞİŞMEDİ.
 */
export function SiteFooter({ shows }: { shows: HeroCard[] }) {
  const { t } = useLang();
  return (
    <footer className="border-t border-border bg-secondary text-foreground">
      <MemoAzList shows={shows} />

      {/* Footer de aynı kabı kullanır: içerikle aynı hizada başlar. */}
      <div className={`${PAGE_CONTAINER} grid gap-10 py-12 md:grid-cols-2`}>
        <div>
          <p className="font-display text-2xl">
            <img
              src={BRAND_LOGO_SRC}
              alt={t("common.logoAlt")}
              width={BRAND_LOGO_WIDTH}
              height={BRAND_LOGO_HEIGHT}
              loading="lazy"
              decoding="async"
              className="h-12 w-auto object-contain"
            />
            <span className="sr-only">shanime</span>
          </p>
          <p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">
            {t("footer.tagline")}
          </p>
        </div>
        <div>
          <p className="text-sm font-extrabold">{t("footer.explore")}</p>
          <div className="mt-4 flex flex-col gap-1 text-sm text-muted-foreground">
            {/* py-2: dokunmatikte en az ~36 px yükseklik. */}
            <a href="#season" className="link-hover w-fit py-2">
              {t("common.thisSeason")}
            </a>
            <a href="#series" className="link-hover w-fit py-2">
              {t("footer.allSeries")}
            </a>
            {/* GENRES çip şeridi silindiği için `#genres` yerine `#series`. */}
            <a href="#series" className="link-hover w-fit py-2">
              {t("footer.genres")}
            </a>
          </div>
        </div>
      </div>
      <div className="border-t border-border px-5 py-5 text-center text-xs text-muted-foreground">
        {t("footer.copyright")}
      </div>
    </footer>
  );
}

const MemoAzList = memo(AzList);

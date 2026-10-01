/**
 * Ana sayfa ÖLÇÜ sabitleri (index.tsx'ten bölündü, 01.10.2026).
 *
 * Referans sitelerden (reanime.to, anikoto) tarayıcıyla ölçülen kap/ızgara/
 * başlık değerleri TEK yerdedir; üç ayrı bölüm aynı ölçeği kullanır, tek
 * yerde tutulmazsa başlıklar birbirinden sapar. Davranış/değer değişmedi,
 * yalnızca konum değişti.
 */

/** Şerit ve sayfa içeriğinin ortak kabı (ana sayfadaki ölçümün aynısı). */
export const PAGE_CONTAINER = "mx-auto w-full max-w-[1800px] px-2.5";

/**
 * Ana kolondaki poster ızgaralarının ortak düzeni (referansın kendi kuralı:
 * `.ani.items .item{width:16.667%}` → masaüstünde 6 sütun).
 *
 * NEDEN 6 SÜTUN: referansta HOME'daki TÜM poster ızgaraları iki kolonlu alanın
 * %75'lik ana kolonundadır ve 20 px boşlukla 6 sütun, ölçülen kart genişliğini
 * tam verir.
 */
export const DISCOVERY_GRID = "grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6";

/**
 * Kabı referansın ana kolonundan GENİŞ olan ızgaralar için düzen. Kart
 * genişliği sınırlanır: `repeat(auto-fill, minmax(160px,1fr))` → kart asla
 * referansın kartından büyük olmaz, sütun sayısı sığdığı kadar artar.
 */
export const DISCOVERY_GRID_CAPPED =
  "grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]";

/**
 * Bölüm başlıklarının tipografik ölçeği (referanstan ölçüldü):
 *   · ana kolon başlığı : 27 px (2rem), 600, letter-spacing normal
 *   · bant kolonu başlığı: 20.25 px (1.5rem), BÜYÜK HARF, soluk renk
 *   · başlık altı boşluk : 15 px (bantta 10 px)
 *   · bölümler arası      : 40 px
 */
export const HEAD_ROW = "text-[27px] font-semibold tracking-normal text-foreground";
export const HEAD_BAND =
  "text-[20px] font-semibold tracking-normal text-muted-foreground uppercase";
/** Başlığın altındaki boşluk: referans `section .head` margin-bottom 15 px. */
export const HEAD_GAP_ROW = "mb-[15px]";
/** Bant başlığının altındaki boşluk: referans `section.top-table .head` 10 px. */
export const HEAD_GAP_BAND = "mb-2.5";
/** Bölümler arası boşluk: referans `section { margin-bottom: 40px }`. */
export const SECTION_GAP = "mb-10";

/**
 * BANT SATIRI ÖLÇÜLERİ — anikototv.to/home'un ALT BANDI (referans ölçüleri;
 * renkler bizim temaya bağlıdır: satır `bg-card`, hover `bg-secondary`,
 * rozet `bg-primary`, soluk meta `muted-foreground`).
 */
export const BAND_ROW =
  "group flex items-center gap-2.5 rounded-[5px] bg-card p-2.5 transition-colors hover:bg-secondary";
export const BAND_ROW_POSTER = "h-[65px] w-[50px] shrink-0 rounded-[3px] object-cover";
export const BAND_ROW_TITLE =
  "mb-1.5 line-clamp-2 text-[16.2px] font-medium leading-[18.9px] text-foreground transition-colors group-hover:text-primary";
export const BAND_ROW_META =
  "flex items-center text-[13.5px] leading-[20.25px] text-muted-foreground";
/** Meta öğeleri arasındaki referans ayracı: `/` , 5 px sol / 8 px sağ, %10 opak. */
export const BAND_META_SEP = "ml-[5px] mr-2 select-none text-foreground/10";
export const BAND_BADGE =
  "relative inline-flex h-[17.415px] items-center rounded-[1.5px] px-[3px] pl-1 text-[12.15px] font-semibold leading-[17.415px] text-primary-foreground/80";
/** Rozetin EĞİK zemini — referansta `skewX(345deg)`. */
export const BAND_BADGE_BG =
  "absolute inset-0 [transform:skewX(-15deg)] rounded-[1.5px] bg-primary";
/** Satırlar arası boşluk: referans `.item { margin-bottom: 15px }` (çizgi yok). */
export const BAND_ROWS_GAP = "space-y-[15px]";
/** Üç kolon 1200 px ve üzerinde yan yana, altında alt alta. */
export const BAND_GRID = "grid gap-5 min-[1200px]:grid-cols-3";

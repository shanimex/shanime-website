/**
 * Font Awesome 6 Free — SOLID ikonları (gömülü SVG).
 *
 * NEDEN VAR: referans site (anikoto) oynatıcı altı şeridinde `fa-solid` ikonlarını
 * kullanıyor. Lucide karşılıkları ince çizgiyle çizildiği için 12–13 px boyutta
 * "boş/soluk" görünüyordu; kullanıcı birebir aynı ikonları istedi. Burada aynı
 * gliflerin SVG yolu gömülü — dış CDN, webfont ya da ek paket gerekmez.
 *
 * KAYNAK/LİSANS: Font Awesome Free 6.7.2 — https://fontawesome.com/license/free
 * (ikonlar CC BY 4.0, kod MIT). Glifler yalnızca bu dosyada, kullanıldığı yerde durur.
 *
 * BOYUT: referansta ikon yüksekliği metnin 1em'i kadardır (html 13.5px iken
 * `.ctrl` yazısı .95rem = 12.825px, ikon da o ölçekte çizilir). Bu yüzden
 * yükseklik `1em`, genişlik glifin en-boy oranından gelir.
 */
const FA_ICONS = {
  /** Dolu kare — "kapalı" durumu (referans: `fa-square`). */
  square: {
    width: 448,
    d: "M0 96C0 60.7 28.7 32 64 32H384c35.3 0 64 28.7 64 64V416c0 35.3-28.7 64-64 64H64c-35.3 0-64-28.7-64-64V96z",
  },
  /** Kalın tik — "açık" durumu (referans: `fa-check`). */
  check: {
    width: 448,
    d: "M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z",
  },
  /*
   * `fa-expand` / `fa-compress` SÖZLÜKTEN KALDIRILDI (kullanıcı isteği,
   * 05.10.2026): şeritteki "Tam ekran" düğmesi istemedi ("bu butonu yok
   * etmiştik, kaldır şunu"), onunla birlikte bu iki simge de kullanılmaz oldu.
   */
  /** Dolu ampul (referans: `fa-lightbulb`). */
  lightbulb: {
    width: 384,
    d: "M272 384c9.6-31.9 29.5-59.1 49.2-86.2c0 0 0 0 0 0c5.2-7.1 10.4-14.2 15.4-21.4c19.8-28.5 31.4-63 31.4-100.3C368 78.8 289.2 0 192 0S16 78.8 16 176c0 37.3 11.6 71.9 31.4 100.3c5 7.2 10.2 14.3 15.4 21.4c0 0 0 0 0 0c19.8 27.1 39.7 54.4 49.2 86.2l160 0zM192 512c44.2 0 80-35.8 80-80l0-16-160 0 0 16c0 44.2 35.8 80 80 80zM112 176c0 8.8-7.2 16-16 16s-16-7.2-16-16c0-61.9 50.1-112 112-112c8.8 0 16 7.2 16 16s-7.2 16-16 16c-44.2 0-80 35.8-80 80z",
  },
  /** Çubuğa yaslı sol üçgen (referans: `fa-backward-step`). */
  backwardStep: {
    width: 320,
    d: "M267.5 440.6c9.5 7.9 22.8 9.7 34.1 4.4s18.4-16.6 18.4-29l0-320c0-12.4-7.2-23.7-18.4-29s-24.5-3.6-34.1 4.4l-192 160L64 241 64 96c0-17.7-14.3-32-32-32S0 78.3 0 96L0 416c0 17.7 14.3 32 32 32s32-14.3 32-32l0-145 11.5 9.6 192 160z",
  },
  /** Çubuğa yaslı sağ üçgen (referans: `fa-forward-step`). */
  forwardStep: {
    width: 320,
    d: "M52.5 440.6c-9.5 7.9-22.8 9.7-34.1 4.4S0 428.4 0 416L0 96C0 83.6 7.2 72.3 18.4 67s24.5-3.6 34.1 4.4l192 160L256 241l0-145c0-17.7 14.3-32 32-32s32 14.3 32 32l0 320c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-145-11.5 9.6-192 160z",
  },
  /** Altyazı rozeti — "CC" kutusu (referans sunucu satırındaki SUB ikonu). */
  closedCaptioning: {
    width: 576,
    d: "M0 96C0 60.7 28.7 32 64 32l448 0c35.3 0 64 28.7 64 64l0 320c0 35.3-28.7 64-64 64L64 480c-35.3 0-64-28.7-64-64L0 96zM200 208c14.2 0 27 6.1 35.8 16c8.8 9.9 24 10.7 33.9 1.9s10.7-24 1.9-33.9c-17.5-19.6-43.1-32-71.5-32c-53 0-96 43-96 96s43 96 96 96c28.4 0 54-12.4 71.5-32c8.8-9.9 8-25-1.9-33.9s-25-8-33.9 1.9c-8.8 9.9-21.6 16-35.8 16c-26.5 0-48-21.5-48-48s21.5-48 48-48zm144 48c0-26.5 21.5-48 48-48c14.2 0 27 6.1 35.8 16c8.8 9.9 24 10.7 33.9 1.9s10.7-24 1.9-33.9c-17.5-19.6-43.1-32-71.5-32c-53 0-96 43-96 96s43 96 96 96c28.4 0 54-12.4 71.5-32c8.8-9.9 8-25-1.9-33.9s-25-8-33.9 1.9c-8.8 9.9-21.6 16-35.8 16c-26.5 0-48-21.5-48-48z",
  },
  /** Dil simgesi (referans sunucu satırlarındaki dil ikonu). */
  language: {
    width: 640,
    d: "M0 128C0 92.7 28.7 64 64 64l192 0 48 0 16 0 256 0c35.3 0 64 28.7 64 64l0 256c0 35.3-28.7 64-64 64l-256 0-16 0-48 0L64 448c-35.3 0-64-28.7-64-64L0 128zm320 0l0 256 256 0 0-256-256 0zM178.3 175.9c-3.2-7.2-10.4-11.9-18.3-11.9s-15.1 4.7-18.3 11.9l-64 144c-4.5 10.1 .1 21.9 10.2 26.4s21.9-.1 26.4-10.2l8.9-20.1 73.6 0 8.9 20.1c4.5 10.1 16.3 14.6 26.4 10.2s14.6-16.3 10.2-26.4l-64-144zM160 233.2L179 276l-38 0 19-42.8zM448 164c11 0 20 9 20 20l0 4 44 0 16 0c11 0 20 9 20 20s-9 20-20 20l-2 0-1.6 4.5c-8.9 24.4-22.4 46.6-39.6 65.4c.9 .6 1.8 1.1 2.7 1.6l18.9 11.3c9.5 5.7 12.5 18 6.9 27.4s-18 12.5-27.4 6.9l-18.9-11.3c-4.5-2.7-8.8-5.5-13.1-8.5c-10.6 7.5-21.9 14-34 19.4l-3.6 1.6c-10.1 4.5-21.9-.1-26.4-10.2s.1-21.9 10.2-26.4l3.6-1.6c6.4-2.9 12.6-6.1 18.5-9.8l-12.2-12.2c-7.8-7.8-7.8-20.5 0-28.3s20.5-7.8 28.3 0l14.6 14.6 .5 .5c12.4-13.1 22.5-28.3 29.8-45L448 228l-72 0c-11 0-20-9-20-20s9-20 20-20l52 0 0-4c0-11 9-20 20-20z",
  },
  /** Dolu daire içinde oynatma üçgeni — sunucu çiplerinin başındaki glif
   *  (referans CSS: `.servers .type ul li:before{content:"\\f144"}`). */
  circlePlay: {
    width: 512,
    d: "M0 256a256 256 0 1 1 512 0A256 256 0 1 1 0 256zM188.3 147.1c-7.6 4.2-12.3 12.3-12.3 20.9l0 176c0 8.7 4.7 16.7 12.3 20.9s16.8 4.1 24.3-.5l144-88c7.1-4.4 11.5-12.1 11.5-20.5s-4.4-16.1-11.5-20.5l-144-88c-7.4-4.5-16.7-4.7-24.3-.5z",
  },
  /** Dolu ünlem üçgeni (referans: `fa-triangle-exclamation`). */
  triangleExclamation: {
    width: 512,
    d: "M256 32c14.2 0 27.3 7.5 34.5 19.8l216 368c7.3 12.4 7.3 27.7 .2 40.1S486.3 480 472 480L40 480c-14.3 0-27.6-7.7-34.7-20.1s-7-27.8 .2-40.1l216-368C228.7 39.5 241.8 32 256 32zm0 128c-13.3 0-24 10.7-24 24l0 112c0 13.3 10.7 24 24 24s24-10.7 24-24l0-112c0-13.3-10.7-24-24-24zm32 224a32 32 0 1 0 -64 0 32 32 0 1 0 64 0z",
  },
  /** Büyüteç — başlık şeridindeki arama düğmesi (referans: `fa-solid fa-magnifying-glass`).
   *  Yol verisi Font Awesome Free 6.7.2 `svgs/solid/magnifying-glass.svg` dosyasından
   *  birebir alındı (uydurulmadı). */
  magnifyingGlass: {
    width: 512,
    d: "M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z",
  },
} as const;

export type FaSolidName = keyof typeof FA_ICONS;

export function FaSolid({
  name,
  className,
  size,
}: {
  name: FaSolidName;
  className?: string;
  /**
   * Piksel cinsinden KARE boyut. Verilmezse `1em` (yanındaki yazıyla ölçeklenir).
   *
   * NEDEN: oynatıcı şeridinde ikonlar `12.5px` gibi ondalıklı em ölçeğiyle
   * çiziliyordu; cihaz pikseline tam oturmayınca bulanık görünüyordu (kullanıcı:
   * "çok bulanık duruyor 144p gibi"). Sabit piksel verilince glif piksel
   * ızgarasına hizalanır ve net kalır.
   */
  size?: number;
}) {
  const icon = FA_ICONS[name];
  return (
    // Yükseklik 1em: ikon, yanındaki yazının boyutuyla büyür/küçülür. `fill`
    // currentColor olduğu için renk metinden (dolayısıyla kapsayıcı sınıftan) gelir.
    // `verticalAlign: -0.125em` — Font Awesome'ın kendi SVG hizalaması.
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${icon.width} 512`}
      fill="currentColor"
      className={className}
      style={
        size
          ? {
              width: `${(size * icon.width) / 512}px`,
              height: `${size}px`,
              flexShrink: 0,
              verticalAlign: "-0.125em",
            }
          : {
              width: `${(icon.width / 512).toFixed(4)}em`,
              height: "1em",
              flexShrink: 0,
              verticalAlign: "-0.125em",
            }
      }
    >
      <path d={icon.d} />
    </svg>
  );
}

/**
 * Kaynak listesi — `id` alanları `lib/embed-provider.ts` içindeki sağlayıcı
 * kimlikleriyle BİREBİR aynı olmalı (`@id` olarak `watch_url`'e yazılır).
 *
 * NEDEN AYRI DOSYADA: liste hem tek bölümün kaynak seçicisinde (SeasonsPanel) hem
 * de katalog panelinde (AnizipSyncPanel) kullanılıyor. İki kopya tutulduğunda biri
 * güncellenip öteki unutuluyordu (yeni sağlayıcı eklenince panelde görünmüyordu);
 * artık tek kaynak burasıdır.
 */
export type EmbedSourceItem = { id: string; label: string; note: string };

export const SOURCE_GROUPS: { group: string; items: EmbedSourceItem[] }[] = [
  {
    group: "Türkçe kaynak",
    items: [
      {
        id: "anizm",
        label: "Anizm — Türkçe altyazı videoda",
        note: "Altyazı videoya gömülü gelir: 1080p, reklamsız, pop-up yok.",
      },
      {
        // TauVideo: animecix.tv'nin kullandığı oynatıcı (ölçüm: docs §17/§19).
        // Embed biçimi bölüme özel olduğu için (hash + vid animecix sayfasından
        // gelir) kaynak seçilince "elle embed adresi" kutusu açılır.
        id: "tauvideo",
        label: "TauVideo — elle embed adresi",
        note: "https://tau-video.xyz/embed/<hash>?vid=<vid> · 720p, Türkçe hardsub, pop-up yok.",
      },
    ],
  },
  {
    group: "İngilizce kaynak",
    items: [
      {
        id: "megaplay",
        label: "MegaPlay — orijinal Japonca ses",
        note: "Altyazı oynatıcının kendi CC menüsünden seçilir. (Varsayılan kaynak)",
      },
      // VidSrc ve Videasy 27.09.2026'da bu listeden ÇIKARILDI (kullanıcı isteği:
      // pop-up yoğun). Bu liste yalnızca "panelde NE SEÇİLEBİLİR"i belirler; tanımları
      // `lib/embed-provider.ts` içinde DURUYOR, çünkü eski bölüm satırları `@vidsrc` /
      // `@videasy` direktifi taşıyor olabilir ve oynatıcı onları çözmeye devam etmeli.
    ],
  },
];

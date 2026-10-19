import { prerollVastUrls } from "@/lib/mybid";

/** Admin panelinde gösterilen site_settings reklam slotları. */
export const AD_SLOTS = [
  { key: "ad_home", label: "Ana sayfa (tek banner)" },
  { key: "ad_detail_top", label: "Detay sayfası - üst" },
  { key: "ad_detail_bottom", label: "Detay sayfası - alt" },
  { key: "ad_watch_top", label: "İzleme sayfası - üst" },
  { key: "ad_watch_bottom", label: "İzleme sayfası - alt" },
  { key: "ad_preroll", label: "Video öncesi 5 sn (tek banner)" },
] as const;

/**
 * Reklam slotlarının **koddaki varsayılan** kaynağı — tek doğruluk kaynağı.
 *
 * NEDEN AYRI DOSYA: reklam anahtarları ve çalışan varsayılan kod, admin
 * panelindeki salt okunur "şu anda hangi kod çalışıyor" kutusunda gösterilir.
 * Tek kaynakta tutulmaları, anahtarların iki dosyada ayrışmasını önler.
 *
 * ÇALIŞMA MANTIĞI:
 *   · `site_settings`'te slot kodu VARSA → panelde kayıtlı kod gösterilir,
 *   · YOKSA                             → buradaki varsayılan kod gösterilir.
 *
 * PANEL SALT OKUNUR: kullanıcı isteğiyle kodlar görünür ama düzenlenemez.
 */

/** Adsterra birim anahtarları. */
export const ADSTERRA_KEYS = {
  leaderboard: "58f6928e3bd225665ca3d3141314d61e",
  rectangle: "8a5dc100511ee4d17b59adeaf586abcd",
  native: "42bcaa59193806d090844b6e622e8495",
} as const;

/** Adsterra barındırıcıları. */
export const ADSTERRA_HOSTS = {
  banner: "https://www.highrevenueformat.com",
  native: "https://pl31353754.profitableratecpmnetwork.com",
} as const;

/** Slot → hangi tür varsayılan birim. */
const DEFAULT_AD_UNITS: Record<string, "leaderboard" | "native" | "vast"> = {
  ad_home: "leaderboard",
  ad_detail_top: "leaderboard",
  ad_detail_bottom: "native",
  ad_watch_top: "leaderboard",
  ad_watch_bottom: "native",
  // Video öncesi kapı Adsterra banner'ı değil, MyBid VAST etiketleriyle çalışır
  // (ad-pod: her etiket ayrı açık artırma). Adresler `src/lib/mybid.ts`'te.
  ad_preroll: "vast",
};

/**
 * Slotun varsayılan kodunu, panelde gösterilebilecek okunur bir metin olarak döner.
 * Panelde kayıt yoksa "şu an çalışan" kod budur.
 */
export function defaultAdSource(slot: string): string {
  const unit = DEFAULT_AD_UNITS[slot];
  if (unit === "leaderboard") {
    return [
      "<!-- Adsterra Leaderboard: masaüstü 728x90, mobil 300x250 -->",
      `<script src="${ADSTERRA_HOSTS.banner}/${ADSTERRA_KEYS.leaderboard}/invoke.js" data-cfasync="false" async></script>`,
      `<!-- dar ekran (300x250) anahtarı: ${ADSTERRA_KEYS.rectangle} -->`,
    ].join("\n");
  }
  if (unit === "native") {
    return [
      "<!-- Adsterra Native Banner -->",
      `<div id="container-${ADSTERRA_KEYS.native}"></div>`,
      `<script src="${ADSTERRA_HOSTS.native}/${ADSTERRA_KEYS.native}/invoke.js" data-cfasync="false" async></script>`,
    ].join("\n");
  }
  if (unit === "vast") {
    const urls = prerollVastUrls();
    return [
      `<!-- MyBid VAST (ad-pod) — ${urls.length} etiket -->`,
      ...urls.map((url) => `VAST: ${url}`),
    ].join("\n");
  }
  return "";
}

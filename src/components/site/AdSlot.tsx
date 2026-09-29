import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { siteSettingsQueryOptions } from "@/lib/site-settings";

/** Admin panelinden yönetilen reklam slotları (site_settings key'leri). */
export const AD_SLOTS = [
  { key: "ad_home", label: "Ana sayfa (tek banner)" },
  { key: "ad_detail_top", label: "Detay sayfası - üst" },
  { key: "ad_detail_bottom", label: "Detay sayfası - alt" },
  { key: "ad_watch_top", label: "İzleme sayfası - üst" },
  { key: "ad_watch_bottom", label: "İzleme sayfası - alt" },
  { key: "ad_preroll", label: "Video öncesi 5 sn (tek banner)" },
] as const;

/**
 * Reklam slotlarının `site_settings` anahtar kümesi — paylaşımlı okumanın anahtarı.
 *
 * Modül düzeyinde bir kez hesaplanır: her `useAdCode` çağrısı AYNI kümeyi verir,
 * böylece React Query anahtarı değişmez ve tek önbellek girdisi paylaşılır.
 */
const AD_SETTING_KEYS = AD_SLOTS.map((slot) => slot.key);

/**
 * Bir slotun reklam kodunu okur.
 *
 * `isFetched === true` iken `code` boşsa slot gerçekten boştur (panelde kod
 * girilmemiş). Oynatıcı sayfası bu ayrımı kullanıyor: kod yokken boş bir
 * "reklam" ekranı bekletmiyor, video hemen başlıyor.
 *
 * NEDEN ORTAK GİRDİ (kota/egress): eskiden her slot KENDİ sorgusunu atıyordu
 * (`["ad-slot", key]`), yani iki reklamlı bir sayfa `site_settings`e iki okuma
 * yapıyordu. Artık TÜM slotlar tek anahtar kümesini paylaşır (bkz.
 * lib/site-settings.ts): sayfada kaç slot olursa olsun satırlar TEK istekte okunur
 * ve `QUERY_STALE_MS` boyunca yeniden okunmaz.
 */
// eslint-disable-next-line react-refresh/only-export-components -- tek bir hook için ayrı dosya açmak gereksiz
export function useAdCode(slot: string): { code: string; isFetched: boolean } {
  const { data, isFetched } = useQuery(siteSettingsQueryOptions(AD_SETTING_KEYS));
  return { code: data?.[slot] ?? "", isFetched };
}

/**
 * Admin'in site_settings'e yapıştırdığı reklam kodunu (Adsterra banner vb.)
 * sayfaya enjekte eder. Kod boşsa hiçbir şey çizmez; popunder asla kullanılmaz.
 */
export function AdSlot({ slot, className }: { slot: string; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { code } = useAdCode(slot);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    if (!code) return;
    const parsed = new DOMParser().parseFromString(code, "text/html");
    // <script> etiketleri innerHTML ile çalışmaz; elle yeniden oluşturulur.
    for (const old of Array.from(parsed.querySelectorAll("script"))) {
      const script = document.createElement("script");
      for (const attr of Array.from(old.attributes)) script.setAttribute(attr.name, attr.value);
      script.textContent = old.textContent ?? "";
      host.appendChild(script);
    }
    for (const node of Array.from(parsed.body.childNodes)) {
      if (node.nodeName === "SCRIPT") continue;
      host.appendChild(document.importNode(node, true));
    }
  }, [code]);

  if (!code) return null;
  // w-full + overflow-hidden: 728x90 gibi geniş bannerlar mobilde taşıp sayfayı bozmasın.
  // İçerideki iframe/img/ins de %100'den büyük çizemesin.
  const cls = [
    "w-full max-w-full overflow-hidden",
    "[&>iframe]:max-w-full [&>img]:max-w-full [&>ins]:max-w-full [&>div]:max-w-full",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <div ref={hostRef} className={cls} aria-hidden="true" />;
}

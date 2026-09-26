import { useEffect, useRef, useState } from "react";
import { ADSTERRA_HOSTS, ADSTERRA_KEYS } from "@/lib/ad-defaults";

/**
 * Adsterra reklam birimleri.
 *
 * Kapsam: yalnızca `leaderboard` (masaüstü 728×90 / mobil 300×250) ve `native`
 * birimleri kullanılır — sitede pop-up ve katman (interstitial) reklamı
 * istenmiyor. `AdsterraSocialBar` dışa aktarılır ama hiçbir sayfaya bağlanmamıştır.
 *
 * Sınıf adları bilinçli olarak OKUNAKLI tutuldu ("adsterra-unit", "--leaderboard").
 * Reklam kutusunu AdBlock filtrelerinden gizlemek için isimleri rastgeleleştirmek
 * yapılmadı: kullanıcıyı yanıltıcı bir gizleme olur ve reklam ağının şartlarına
 * aykırıdır (hesap riski).
 *
 * Not (aynı sayfada iki birim): highrevenueformat.com birimleri `window.atOptions`
 * global'ini okur. Bu yüzden her birim, betiği eklemeden hemen önce kendi
 * `atOptions` değerini atar ve sayfada aynı anda yalnızca BİR highrevenueformat
 * birimi bulunur (728×90 masaüstünde, 300×250 mobilde — ikisi aynı anda değil).
 * Native birim farklı bir alan adı ve kapsayıcı-kimliği mekanizması kullanır,
 * global çakışması yoktur.
 */

/**
 * Birim anahtarları ve barındırıcılar `lib/ad-defaults.ts`'te tutulur: aynı
 * bilgiyi admin panelindeki kilitli "çalışan kod" kutusu da gösteriyor, iki
 * yerde kopyalanınca kaçınılmaz olarak ayrışıyordu.
 */
const {
  leaderboard: LEADERBOARD_KEY,
  rectangle: RECTANGLE_KEY,
  native: NATIVE_KEY,
} = ADSTERRA_KEYS;
const BANNER_HOST = ADSTERRA_HOSTS.banner;
const NATIVE_HOST = ADSTERRA_HOSTS.native;

/**
 * Sosyal Bar birimi — kasıtlı olarak BAĞLANMADI.
 * Sayfada yüzen/katmanlı reklam ürettiği için "pop-up istemiyoruz" kuralına girer.
 */
export const ADSTERRA_SOCIAL_BAR_SRC =
  "https://pl31353753.profitableratecpmnetwork.com/62/00/a7/6200a7ece2b6394ea94eec1bd2f6d9c9.js";

/** Viewport en az `px` genişlikte mi? (SSR'de ilk değer false.) */
function useMinWidth(px: number): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${px}px)`);
    setMatches(query.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [px]);
  return matches;
}

/**
 * Masaüstünde 728×90, mobilde 300×250.
 *
 * Neden iki birim: 728 px genişlik 390 px'lik telefonda kırpılır — kullanıcı
 * banner'ın yarısını görür, reklam da boşa gider. Bu yüzden dar ekranda Adsterra'nın
 * aynı panelde duran 300×250 birimine geçilir.
 */
export function AdsterraLeaderboard({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const isDesktop = useMinWidth(768);
  const key = isDesktop ? LEADERBOARD_KEY : RECTANGLE_KEY;
  const width = isDesktop ? 728 : 300;
  const height = isDesktop ? 90 : 250;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    // atOptions, invoke.js çalışmadan önce hazır olmalı.
    const globalWindow = window as unknown as Record<string, unknown>;
    globalWindow["atOptions"] = {
      key,
      format: "iframe",
      height,
      width,
      params: {},
    };
    const script = document.createElement("script");
    script.src = `${BANNER_HOST}/${key}/invoke.js`;
    script.async = true;
    script.setAttribute("data-cfasync", "false");
    host.appendChild(script);
    return () => host.replaceChildren();
  }, [key, width, height]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      // minHeight: reklam yüklenene kadar yer ayırır — sayfa sonradan zıplamasın (CLS).
      style={{ minHeight: height }}
      className={[
        "adsterra-unit adsterra-unit--leaderboard",
        "mx-auto flex w-full max-w-full justify-center overflow-hidden",
        "[&>iframe]:max-w-full",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

/**
 * Native Banner (içerik akışına karışan birim).
 *
 * Adsterra bu birimi "önce kapsayıcı div, sonra invoke.js" düzeninde veriyor;
 * kapsayıcı kimliği anahtara bağlı olduğu için burada üretilir.
 */
export function AdsterraNative({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();

    const container = document.createElement("div");
    container.id = `container-${NATIVE_KEY}`;
    host.appendChild(container);

    const script = document.createElement("script");
    script.src = `${NATIVE_HOST}/${NATIVE_KEY}/invoke.js`;
    script.async = true;
    script.setAttribute("data-cfasync", "false");
    host.appendChild(script);

    return () => host.replaceChildren();
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className={[
        "adsterra-unit adsterra-unit--native",
        "w-full max-w-full overflow-hidden",
        "[&>iframe]:max-w-full [&>img]:max-w-full [&_ins]:max-w-full",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

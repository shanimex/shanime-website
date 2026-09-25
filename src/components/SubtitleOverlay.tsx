import { useEffect, useMemo, useRef, useState } from "react";
import { cueAt, parseSubtitles, type Cue } from "@/lib/subtitles";

/**
 * Sağlayıcı iframe'inin ÜSTÜNE çizilen kendi altyazı katmanımız.
 *
 * NEDEN BÖYLE: hiçbir ücretsiz embed "Japonca ses" ve "Türkçe altyazı"yı birlikte
 * vermiyor (ölçüm: docs/SAGLAYICI-VE-KAPAK-ARASTIRMASI.md §14). megaplay orijinal
 * Japonca sesi veriyor ama altyazı listesinde Türkçe yok; ayrıca oynatıcısına
 * dışarıdan altyazı sokmanın iki yolu da kapalı (ne URL parametresi ne postMessage
 * komutu var — §15.1).
 *
 * ÇÖZÜM: megaplay'in köprüsü (`lib/handle-bridge.min.js`) oynatma zamanını
 * `postMessage` ile ana sayfaya bildiriyor. Biz de o zamanı kullanıp **kendi
 * altyazımızı kendi katmanımızda** çiziyoruz. Böylece:
 *   · ses      → megaplay (orijinal Japonca),
 *   · altyazı  → bizim dosyamız (Türkçe, `scripts/sync-tr-subtitles.mjs` üretir),
 *   · görünüm  → tamamen bizim,
 *   · video YÜKLEMEK GEREKMİYOR.
 *
 * ÖLÇÜLEN HAM YÜKLER (25.09.2026, gerçek tarayıcı, iframe bağlamı):
 *   {"channel":"megacloud","event":"time","time":1324.27742,"duration":1435.022,...,"percent":92.28}
 *   {"event":"CURRENT_TIME","time":1324.27742,"duration":1435.022,"active":false,...}
 *
 * KONUM NOTU: metin, sağlayıcının KENDİ altyazı satırının **üstüne** konumlanır
 * (`bottom-[15%]`). Sağlayıcının İngilizce izini kapatmanın bir yolu yok, bu
 * yüzden ikisi ekranda birlikte görünür; bizimki onun üstünde durur.
 *
 * Aç/kapa düğmesi burada DEĞİL: oynatıcının içine konduğunda sağlayıcının kendi
 * CC/ayar simgeleriyle karışıyordu, oynatıcının kontrol çubuğunun parçası gibi
 * görünüyordu. Düğme artık sayfada, oynatıcının ALTINDA
 * (`izle.$slug.tsx` → "Türkçe altyazı açık/kapalı").
 */
export function SubtitleOverlay({
  frameRef,
  url,
  active,
  on,
  onAvailable,
}: {
  /** Sağlayıcı iframe'inin ref'i — köprüye komut göndermek için. */
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  /** .vtt / .srt adresi. Boşsa katman hiç çizilmez. */
  url: string;
  /** Yalnızca köprüyü destekleyen sağlayıcıda (megaplay) çalışır. */
  active: boolean;
  /** Türkçe altyazı açık mı? (Sayfadaki düğmeden gelir.) */
  on: boolean;
  /** Altyazı yüklenebildiyse true — sayfa düğmeyi o zaman gösterir. */
  onAvailable: (available: boolean) => void;
}) {
  const [cues, setCues] = useState<Cue[]>([]);
  const [time, setTime] = useState(0);
  const frameRefStable = useRef(frameRef);
  const onAvailableRef = useRef(onAvailable);
  onAvailableRef.current = onAvailable;

  // Altyazı dosyasını bir kez indir ve çöz.
  useEffect(() => {
    if (!url || !active) {
      setCues([]);
      onAvailableRef.current(false);
      return;
    }
    let alive = true;
    fetch(url, { credentials: "omit" })
      .then((res) => (res.ok ? res.text() : ""))
      .then((text) => {
        if (!alive) return;
        const parsed = text ? parseSubtitles(text) : [];
        setCues(parsed);
        onAvailableRef.current(parsed.length > 0);
      })
      .catch(() => {
        // CORS ya da ağ hatası: altyazı sessizce devre dışı kalır, video etkilenmez.
        if (!alive) return;
        setCues([]);
        onAvailableRef.current(false);
      });
    return () => {
      alive = false;
    };
  }, [url, active]);

  // Köprüden zaman akışı: `time` olayı sürekli gelir, `CURRENT_TIME` yoklama yanıtı.
  useEffect(() => {
    if (!active || cues.length === 0) return;
    const onMessage = (event: MessageEvent) => {
      const frame = frameRefStable.current.current;
      // Yalnızca kendi iframe'imizden gelen mesajları kabul et.
      if (!frame || event.source !== frame.contentWindow) return;
      let data: unknown = event.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (!data || typeof data !== "object") return;
      const payload = data as { event?: unknown; time?: unknown };
      if (payload.event !== "time" && payload.event !== "CURRENT_TIME") return;
      if (typeof payload.time !== "number" || !Number.isFinite(payload.time)) return;
      setTime(payload.time);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [active, cues.length]);

  // Yedek yoklama: `time` olayı seyrek gelirse zamanı 1 sn'de bir sorar.
  useEffect(() => {
    if (!active || cues.length === 0) return;
    const timer = window.setInterval(() => {
      const frame = frameRefStable.current.current;
      if (!frame) return;
      try {
        frame.contentWindow?.postMessage(JSON.stringify({ cmd: "GET_TIME" }), "*");
      } catch {
        /* köprü yoksa sessizce geç */
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active, cues.length]);

  const current = useMemo(() => cueAt(cues, time), [cues, time]);

  if (!active || !on || cues.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[15%] z-20 flex justify-center px-6 text-center">
      {current ? (
        <span className="whitespace-pre-line text-[15px] font-semibold leading-snug text-white [text-shadow:0_1px_2px_rgba(0,0,0,.95),0_0_6px_rgba(0,0,0,.85)] sm:text-[19px]">
          {current.text}
        </span>
      ) : null}
    </div>
  );
}

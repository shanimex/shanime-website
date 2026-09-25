import { useEffect, useMemo, useRef, useState } from "react";
import { cueAt, parseSubtitles, type Cue } from "@/lib/subtitles";

/**
 * Sağlayıcı iframe'inin ÜSTÜNE çizilen kendi altyazı katmanımız.
 *
 * NEDEN BÖYLE: hiçbir ücretsiz embed "Japonca ses" ve "Türkçe altyazı"yı birlikte
 * vermiyor (ölçüm: docs/SAGLAYICI-VE-KAPAK-ARASTIRMASI.md §14). megaplay orijinal
 * Japonca sesi veriyor ama altyazı listesinde Türkçe yok; oynatıcısına dışarıdan
 * altyazı sokmanın üç yolu da kapalı:
 *   · menü verisi onların sunucusundan gelir (`/stream/getSources` → tracks)
 *   · URL parametresi yok (kabul ettiği tek parametreler: s, time, unix)
 *   · köprü komutu yok (SEEK/GET_TIME/GET_PIP/SKP_DATA/PLAY_TOGGLE/MUTE)
 * Bu yüzden altyazı bizim katmanımızda çizilir ve dil seçimi SİTENİN kendi
 * menüsünden yapılır (bkz. `izle.$slug.tsx` → "Altyazı" menüsü).
 *
 * Oynatma zamanı SAĞLAYICI KÖPRÜSÜNDEN gelir (ölçülmüş çalışan protokol):
 *   biz → `{cmd:"GET_TIME"}` · sağlayıcı → `{event:"time", time, duration}` (≈1/s)
 * Bu yüzden altyazı bölüm videoyla senkron ilerler.
 *
 * GÖRÜNÜM: arkaplan yok, altta (%15) — metin yalnızca gölgeyle okunur kalır.
 */
export function SubtitleOverlay({
  frameRef,
  url,
  active,
}: {
  /** Sağlayıcı iframe'inin ref'i — köprüye komut bununla gönderilir. */
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  /** Seçili altyazı dosyası (.vtt / .srt). Boş = altyazı kapalı. */
  url: string;
  /** Sağlayıcı köprüyü destekliyor mu (yalnızca megaplay). */
  active: boolean;
}) {
  const [cues, setCues] = useState<Cue[]>([]);
  const [time, setTime] = useState(0);

  // Seçili dosya değişince indir ve çöz. Dosya yoksa istek 404 döner, katman
  // sessizce kapanır — hiçbir şey bozulmaz.
  useEffect(() => {
    if (!url) {
      setCues([]);
      return;
    }
    let alive = true;
    void fetch(url)
      .then((res) => (res.ok ? res.text() : ""))
      .then((text) => (alive ? parseSubtitles(text) : []))
      .then((parsed) => {
        if (alive) setCues(parsed);
      })
      .catch(() => {
        if (alive) setCues([]);
      });
    return () => {
      alive = false;
    };
  }, [url]);

  // Oynatma zamanı: köprüden gelen "time" olayları + yedek GET_TIME sorgusu.
  // İkisi birlikte ~250 ms çözünürlük verir.
  useEffect(() => {
    if (!active || !url) return;

    const onMessage = (event: MessageEvent) => {
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

    const poll = window.setInterval(() => {
      try {
        frameRef.current?.contentWindow?.postMessage(JSON.stringify({ cmd: "GET_TIME" }), "*");
      } catch {
        /* iframe henüz hazır değil */
      }
    }, 1000);

    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(poll);
    };
  }, [active, url, frameRef]);

  const current = useMemo(() => cueAt(cues, time), [cues, time]);

  if (!active || cues.length === 0) return null;

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

/** Yalnızca ölü kod uyarısını önlemek için değil — katmanın kendi ref tipi. */
export type SubtitleFrameRef = React.RefObject<HTMLIFrameElement | null>;

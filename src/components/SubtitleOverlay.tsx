import { useEffect, useMemo, useRef, useState } from "react";
import { cueAt, parseSubtitles, type Cue } from "@/lib/subtitles";

/**
 * Sağlayıcı iframe'inin ÜSTÜNE çizilen kendi altyazı katmanımız.
 *
 * NEDEN BÖYLE: hiçbir ücretsiz embed "Japonca ses" ve "Türkçe altyazı"yı birlikte
 * vermiyor (ölçüm: docs/SAGLAYICI-VE-KAPAK-ARASTIRMASI.md §14). megaplay orijinal
 * Japonca sesi veriyor ama altyazı listesinde Türkçe yok; oynatıcısına dışarıdan
 * altyazı sokmanın iki yolu da kapalı (URL parametresi ve postMessage komutu yok).
 *
 * Oynatma zamanı SAĞLAYICI KÖPRÜSÜNDEN gelir (ölçülmüş çalışan protokol):
 *   biz → `{cmd:"GET_TIME"}` · sağlayıcı → `{event:"time", time, duration}` (≈1/s)
 * Bu yüzden altyazı bölüm videoyla senkron ilerler.
 *
 * TASARIM: **arkaplan yok, alt tarafta** — metin yalnızca gölgeyle okunur kalsın
 * diye. Metni kapatıp sağlayıcının satırını gizleme denemesi yapıldı ve
 * kullanıcı istemedi (kalın siyah şerit videoyu kapatıyordu), o yüzden
 * varsayılan bu sade görünüm.
 *
 * DİKKAT: sağlayıcının KENDİ altyazısı ayrı bir satır olarak görünmeye devam
 * eder; kapatma komutu yok (protokolde sadece SEEK/GET_TIME/PLAY_TOGGLE/MUTE/
 * SKP_DATA/GET_PIP var). İzleyici isterse oynatıcının CC düğmesinden kapatır.
 */
export function SubtitleOverlay({
  frameRef,
  url,
  active,
  on,
  onAvailable,
}: {
  /** Sağlayıcı iframe'inin ref'i — köprüye komut bununla gönderilir. */
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  /** Altyazı dosyasının adresi (.vtt / .srt). Boşsa katman hiç çalışmaz. */
  url: string;
  /** Sağlayıcı köprüyü destekliyor mu (yalnızca megaplay). */
  active: boolean;
  /** Katman açık mı? Düğme oynatıcının ALTINDA durur. */
  on: boolean;
  /** Dosya yüklenip satır çıktıysa true — düğme yalnızca o zaman gösterilir. */
  onAvailable: (available: boolean) => void;
}) {
  const [cues, setCues] = useState<Cue[]>([]);
  const [time, setTime] = useState(0);
  const availableRef = useRef(onAvailable);
  availableRef.current = onAvailable;

  // Altyazı dosyasını bir kez indir ve çöz.
  useEffect(() => {
    if (!url) {
      setCues([]);
      availableRef.current(false);
      return;
    }
    let alive = true;
    void fetch(url)
      .then((res) => (res.ok ? res.text() : ""))
      .then((text) => (alive ? parseSubtitles(text) : []))
      .then((parsed) => {
        if (!alive) return;
        setCues(parsed);
        availableRef.current(parsed.length > 0);
      })
      .catch(() => {
        if (!alive) return;
        setCues([]);
        availableRef.current(false);
      });
    return () => {
      alive = false;
    };
  }, [url]);

  // Oynatma zamanı: sağlayıcının köprüsünden gelen "time" olayları + yedek
  // olarak GET_TIME sorgusu. İkisi birlikte ~250 ms çözünürlük verir.
  useEffect(() => {
    if (!active || !on) return;

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
  }, [active, on, frameRef]);

  const current = useMemo(() => (on ? cueAt(cues, time) : null), [cues, time, on]);

  if (!active || cues.length === 0) return null;

  return (
    /**
     * KONUM — **kullanıcının onayladığı özgün hâl**: arkaplan yok, altta (%15).
     *
     * NOT: "sağlayıcının satırının tam altına hizala" denemesi yapıldı (alt %28,
     * koyu zemin) ve kullanıcı bunu İSTEMEDİĞİNİ söyledi — istenen şey altyazı
     * katmanının yerini değiştirmek değil, oynatıcının CC menüsüne bir satır
     * eklemekti. O yüzden konum bu ilk hâline geri alındı.
     *
     * İNCE AYAR: tek sayı — `bottom-[15%]`. Büyütürsen satır yukarı, küçültürsen
     * aşağı kayar.
     */
    <div className="pointer-events-none absolute inset-x-0 bottom-[15%] z-20 flex justify-center px-6 text-center">
      {current ? (
        <span className="whitespace-pre-line text-[15px] font-semibold leading-snug text-white [text-shadow:0_1px_2px_rgba(0,0,0,.95),0_0_6px_rgba(0,0,0,.85)] sm:text-[19px]">
          {current.text}
        </span>
      ) : null}
    </div>
  );
}

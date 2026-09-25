import { useEffect, useRef } from "react";

import { prerollVastUrls } from "@/lib/mybid";

/**
 * Fluid Player sarmalayıcısı (React / TanStack Start).
 *
 * Neden imperatif kurulum:
 * Fluid Player, verilen <video> öğesinin çevresine kendi DOM'unu kurar ve
 * öğeyi kendi kapsayıcısına taşır. <video> React tarafından yönetilirse React
 * bu mutasyonu görür ve unmount sırasında "removeChild" hatası fırlatabilir.
 * Bu yüzden <video> React JSX'i ile değil, aşağıdaki effect içinde kurulur;
 * React yalnızca boş kapsayıcıyı yönetir.
 *
 * Kaynak değişimi:
 * Fluid Player dokümanı "switching sources dynamically is not supported —
 * recreate the Fluid Player instance" diyor
 * (docs.fluidplayer.com/integration/using-fluid-player-with-react).
 * Bu bileşen kaynak değişince söküp yeniden kurar; çağıran taraf ayrıca
 * `key` vermek zorunda değildir.
 */

type FluidPlayerInstance = {
  play?: () => void;
  pause?: () => void;
  destroy?: () => void;
};

type FluidPlayerFactory = (id: string, config?: Record<string, unknown>) => FluidPlayerInstance;

/** Fluid Player'ın resmî CDN adresi (doküman: Integration → quick setup → CDN). */
const FLUID_CDN = "https://cdn.fluidplayer.com/v3/current/fluidplayer.min.js";

export type FluidSubtitle = {
  /**
   * Altyazı dosyası adresi.
   *
   * DİKKAT: Fluid Player altyazıyı HTML5 <track> ile okur; <track> yalnızca
   * WebVTT (.vtt) destekler — .srt tarayıcıda çalışmaz. .srt dosyaları önce
   * .vtt'ye çevrilmelidir (ya da altyazıyı sağlayıcının kendi parametresiyle
   * vermek gerekir).
   */
  src: string;
  /** Menüde görünecek dil adı, ör. "Türkçe". */
  label: string;
  /** BCP-47 dil kodu, ör. "tr". */
  srclang?: string;
  /** Başlangıçta açık gelsin mi? */
  isDefault?: boolean;
};

let loader: Promise<FluidPlayerFactory> | null = null;

function fluidPlayerGlobal(): FluidPlayerFactory | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { fluidPlayer?: FluidPlayerFactory }).fluidPlayer;
}

/** Fluid Player betiğini tek sefer yükler (aynı sayfada tekrar istenirse aynı söz döner). */
function loadFluidPlayer(): Promise<FluidPlayerFactory> {
  const existing = fluidPlayerGlobal();
  if (existing) return Promise.resolve(existing);
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Fluid Player yalnızca tarayıcıda yüklenebilir."));
  }
  if (!loader) {
    loader = new Promise<FluidPlayerFactory>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = FLUID_CDN;
      script.async = true;
      script.onload = () => {
        const factory = fluidPlayerGlobal();
        if (factory) resolve(factory);
        else reject(new Error("Fluid Player betiği yüklendi ama global bulunamadı."));
      };
      script.onerror = () => {
        loader = null;
        reject(new Error("Fluid Player betiği CDN'den yüklenemedi."));
      };
      document.head.appendChild(script);
    });
  }
  return loader;
}

export function FluidPlayer({
  src,
  poster,
  subtitles = [],
  title,
  className,
}: {
  /** Doğrudan oynatılabilir adres: .mp4 (progressive) veya .m3u8 (HLS). */
  src: string;
  poster?: string | undefined;
  subtitles?: FluidSubtitle[];
  title?: string | undefined;
  className?: string | undefined;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Diziyi referans yerine içeriğe göre karşılaştır: her render'da yeni dizi
  // üretilse bile oynatıcı boşuna yeniden kurulmasın.
  const subsKey = JSON.stringify(subtitles);
  const vastKey = prerollVastUrls().join("|");

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !src) return;

    let disposed = false;
    let instance: FluidPlayerInstance | null = null;

    // 1) <video> + kaynak + altyazı izleri elle kurulur.
    host.replaceChildren();
    const video = document.createElement("video");
    video.id = `fluid-${Math.random().toString(36).slice(2, 10)}`;
    video.className = "w-full";
    video.setAttribute("playsinline", "");
    video.setAttribute("controls", "");
    if (poster) video.poster = poster;
    if (title) video.setAttribute("title", title);

    const source = document.createElement("source");
    source.src = src;
    source.type = /\.m3u8(\?|#|$)/i.test(src) ? "application/x-mpegURL" : "video/mp4";
    video.appendChild(source);

    for (const sub of subtitles) {
      const track = document.createElement("track");
      // Fluid Player dokümanı açıkça kind="metadata" istiyor: kind="subtitles"
      // bazı tarayıcılarda çalışmıyor. (docs.fluidplayer.com/configuration/subtitles)
      track.kind = "metadata";
      track.src = sub.src;
      track.label = sub.label;
      track.srclang = sub.srclang ?? "tr";
      if (sub.isDefault) track.default = true;
      video.appendChild(track);
    }
    host.appendChild(video);

    // 2) Reklam listesi: VAST etiketi başına bir preRoll = ad-pod.
    // Fluid Player birden fazla preRoll'u sırayla oynatır
    // (docs.fluidplayer.com/configuration/advertisements → "multiple preRoll Ads").
    const adList = prerollVastUrls().map((vastTag, index) => ({
      roll: "preRoll",
      vastTag,
      adText: index === 0 ? "Reklam · siteyi ayakta tutan gelir" : "Reklam",
      adTextPosition: index === 0 ? "top left" : "top right",
    }));

    const config: Record<string, unknown> = {
      layoutControls: {
        fillToContainer: true,
        autoPlay: false,
        playButtonShowing: true,
        playPauseAnimation: true,
        allowTheatre: false,
        allowDownload: false,
        subtitlesEnabled: subtitles.length > 0,
        subtitlesOnByDefault: true,
        keyboardControl: true,
        title: title ?? "",
      },
      vastOptions: {
        adList,
        vastTimeout: 5000,
        showPlayButton: false,
        maxAllowedVastTagRedirects: 3,
        // "Reklamı Geç" düğmesinin metinleri. Geri sayımın KAÇ saniyeden sonra
        // bittiği oynatıcıda sabitlenemez: Fluid Player atlama noktasını VAST
        // yanıtındaki `skipoffset` alanından okur. MyBid yanıtı skipoffset
        // göndermiyorsa atlama düğmesi hiç çıkmaz.
        skipButtonCaption: "Reklamı geç: [seconds]",
        skipButtonClickCaption: "Reklama geç",
        adCTAText: false,
        adClickable: false,
      },
    };

    // 3) Oynatıcıyı kur (önceki örnek sökülürken iptal bayrağı kontrol edilir).
    loadFluidPlayer()
      .then((factory) => {
        if (disposed) return;
        try {
          instance = factory(video.id, config);
        } catch (error) {
          console.error("Fluid Player başlatılamadı:", error);
        }
      })
      .catch((error: unknown) => {
        console.error(error);
      });

    return () => {
      disposed = true;
      // destroy() her sürümde garanti değil; yoksa tüm alt ağaç zaten aşağıda
      // boşaltılıyor.
      try {
        instance?.destroy?.();
      } catch {
        /* yoksay */
      }
      host.replaceChildren();
    };
    // subsKey: dizinin içeriği; vastKey: reklam etiketleri.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, poster, title, subsKey, vastKey]);

  if (!src) return null;

  return (
    <div
      ref={hostRef}
      // bg-black: oynatıcı kendi kapsayıcısını boyayana kadar tarayıcının
      // varsayılan beyaz zeminini göstermemek için (iframe'de de aynı çözüm).
      className={["aspect-video w-full bg-black", "[&_video]:h-full [&_video]:w-full", className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

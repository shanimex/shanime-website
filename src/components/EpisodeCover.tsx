import { useEffect, useRef, useState } from "react";

type EpisodeCoverProps = {
  /**
   * Sırayla denenecek kapak adresleri. Bir adres yüklenemezse otomatik olarak
   * sonrakine geçilir; hepsi tükenirse bölüm numarası gösterilir.
   */
  candidates: string[];
  /** Hiçbir kapak gelmezse ortada gösterilecek bölüm numarası. */
  number: number;
  /** Numaranın görünümü; paneldeki küçük kapaklar daha ufak yazı kullanır. */
  numberClassName?: string;
};

/**
 * Bölüm kapağı + yedek zinciri.
 *
 * Neden zincir: kapak üç ayrı kaynaktan gelebiliyor — panelden yüklenen kapak,
 * yerelde üretilmiş kare (`public/static/episode-covers/…`) ve oynatıcının
 * yayınladığı kare. Sağlayıcı bazı bölümler için görsel vermiyor; o durumda
 * kart boş kalmamalı, sıradaki kaynak denenmeli.
 *
 * `onLoad`'a tek başına GÜVENİLMEZ: görsel tarayıcı önbelleğinden gelirse olay
 * hiç ateşlenmez ve kapak sonsuza kadar gizli kalır. Bu yüzden her kaynak
 * değişiminde durum `complete` + `naturalWidth` ile elle doğrulanır.
 */
export function EpisodeCover({
  candidates,
  number,
  numberClassName = "font-display text-3xl text-foreground/80",
}: EpisodeCoverProps) {
  const list = candidates.filter(Boolean);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const source = list[index] ?? "";

  useEffect(() => {
    setLoaded(false);
    const node = imgRef.current;
    if (!node || !node.complete) return;
    if (node.naturalWidth > 0) setLoaded(true);
    else setIndex((value) => value + 1);
  }, [source]);

  const numberBadge = !loaded ? (
    <span aria-hidden className={`absolute inset-0 grid place-items-center ${numberClassName}`}>
      {number}
    </span>
  ) : null;

  if (!source) return numberBadge;

  return (
    <>
      {numberBadge}
      <img
        ref={imgRef}
        // Kaynak değişince <img> yeniden kurulsun; yoksa tarayıcı hatayı taşır.
        key={source}
        src={source}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setIndex((value) => value + 1)}
        className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
    </>
  );
}

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
  /**
   * Statik adaylar tükendiğinde çağrılır; GÜNCEL kapak adresini döndürmesi
   * beklenir (bkz. `resolvePosterForEpisode`).
   *
   * Neden gerekli: sağlayıcının CDN adresi dönüyor
   * (`…/i/01/…` → `box-1659-u.vmbox.space/i/03/…`), bu yüzden kayıtlı adres
   * gün içinde geçersiz kalabiliyor. Bu geri çağırma olmadan kapak kalıcı olarak
   * kırık kalırdı; bununla kendini onarıyor.
   */
  resolveFallback?: () => Promise<string>;
};

/**
 * Bölüm kapağı + yedek zinciri.
 *
 * Neden zincir: kapak dört ayrı kaynaktan gelebiliyor — panelden yüklenen kapak,
 * sağlayıcıdan çözülmüş kapak (dosya/veritabanı), yerelde üretilmiş kare ve
 * çalışma anında yeniden çözülen adres. Sağlayıcı adresleri zamanla geçersiz
 * kaldığı için son adım şart.
 *
 * `onLoad`'a tek başına GÜVENİLMEZ: görsel tarayıcı önbelleğinden gelirse olay
 * hiç ateşlenmez ve kapak sonsuza kadar gizli kalır. Bu yüzden her kaynak
 * değişiminde durum `complete` + `naturalWidth` ile elle doğrulanır.
 */
export function EpisodeCover({
  candidates,
  number,
  numberClassName = "font-display text-3xl text-foreground/80",
  resolveFallback,
}: EpisodeCoverProps) {
  const staticList = candidates.filter(Boolean);
  // Çalışma anında çözülen adres, listenin SONUNA eklenir.
  const [extra, setExtra] = useState<string[]>([]);
  const list = [...staticList, ...extra];
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const source = list[index] ?? "";

  // Geri çağırma her çizimde yeniden üretilebilir; efektin buna takılıp
  // tekrar tekrar çözümleme yapmaması için ref'te tutulur.
  const resolverRef = useRef(resolveFallback);
  resolverRef.current = resolveFallback;

  useEffect(() => {
    setLoaded(false);
    const node = imgRef.current;
    if (!node || !node.complete) return;
    if (node.naturalWidth > 0) setLoaded(true);
    else setIndex((value) => value + 1);
  }, [source]);

  // Statik adaylar tükendi → adresi çalışma anında yeniden çöz (CDN dönüyor).
  useEffect(() => {
    if (extra.length > 0 || index < staticList.length) return;
    const resolve = resolverRef.current;
    if (!resolve) return;
    let alive = true;
    void resolve()
      .then((url) => {
        if (alive && url) setExtra([url]);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [index, staticList.length, extra.length]);

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

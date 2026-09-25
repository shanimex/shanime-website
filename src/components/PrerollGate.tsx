import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchVastAds, fireBeacons, type VastAd } from "@/lib/vast";

/**
 * Video öncesi reklam kapısı (gerçek video reklamı).
 *
 * Akış: poster + "Oynat" → VAST reklamı oynar ("Reklamı geç" geri sayımıyla) →
 * istenirse ikinci reklam → `onFinish()` → bölüm oynatıcısı yüklenir.
 *
 * Kritik: reklam yüklenemez / dolgu yoksa `onFinish()` HEMEN çağrılır. Ziyaretçi
 * asla reklam yüzünden videoyu izleyemez durumda kalmaz.
 *
 * ÖNEMLİ (bu dosyada bir kez düzeltilen hata): <video> elementi TEK ve HER
 * durumda basılmalıdır. Daha önce <video> yalnızca `started === true` olan
 * render dalında basılıyordu; "Oynat" tıklandığında `videoRef.current` henüz
 * null olduğu için `startAd()` erken çıkıyor, `started` hiç true olmuyor ve
 * dolayısıyla video bir daha basılmıyordu — kilitli döngü, reklam da bölüm de
 * açılmıyordu. Artık video hep DOM'da; poster/overlay onun üzerine çizilir.
 */
const MAX_ADS = 2;
/** VAST skipoffset vermediyse kullanılacak atlama süresi (saniye). */
const DEFAULT_SKIP_SECONDS = 5;

export function PrerollGate({
  vastUrls,
  poster,
  title,
  onFinish,
}: {
  /** VAST etiket adresleri; ilk dolu olan kullanılır. */
  vastUrls: string[];
  poster?: string | undefined;
  title: string;
  /** Reklam(lar) bitince ya da reklam yoksa çağrılır — bir kez. */
  onFinish: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const finishedRef = useRef(false);
  const countedRef = useRef<Set<number>>(new Set());

  const [ads, setAds] = useState<VastAd[] | null>(null);
  const [index, setIndex] = useState(0);
  const [started, setStarted] = useState(false);
  const [skippable, setSkippable] = useState(false);
  const [remaining, setRemaining] = useState(DEFAULT_SKIP_SECONDS);
  const [muted, setMuted] = useState(false);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinish();
  }, [onFinish]);

  // Etiketi sayfa açılır açılmaz (kullanıcı "Oynat"a basmadan) çek: tıklama
  // anında reklam hazır olur ve unmuted oynatma izni korunur.
  useEffect(() => {
    let alive = true;
    const first = vastUrls.find((url) => /^https?:\/\//i.test(url));
    if (!first) {
      finish();
      return;
    }
    void fetchVastAds(first, { timeoutMs: 3000 })
      .then((result) => {
        if (!alive) return;
        setAds(result);
        if (result.length === 0) finish();
      })
      .catch(() => {
        if (alive) finish();
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vastUrls.join("|")]);

  const visibleAds = ads ? ads.slice(0, MAX_ADS) : [];
  const current = ads?.[index];

  /** Reklamı başlatır. Tıklama hareketinden çağrıldığı için unmuted oynatma izinlidir. */
  const startAd = useCallback(
    (adIndex: number) => {
      const ad = ads?.[adIndex];
      const video = videoRef.current;
      if (!ad) {
        finish();
        return;
      }
      if (!video) return;

      if (!countedRef.current.has(adIndex)) {
        countedRef.current.add(adIndex);
        fireBeacons(ad.impressions);
      }

      video.src = ad.mediaFile;
      const skipAt = ad.skipOffsetSeconds ?? DEFAULT_SKIP_SECONDS;
      setRemaining(Math.max(1, Math.ceil(skipAt)));
      setSkippable(false);
      setIndex(adIndex);
      setStarted(true);

      const attempt = video.play();
      if (attempt) {
        attempt.catch(() => {
          // Tarayıcı sesli oynatmayı reddetti: sessiz başlat, kullanıcı sesi
          // açsın. Reklam yine oynar ve gösterim sayılır.
          video.muted = true;
          setMuted(true);
          void video.play().catch(() => finish());
        });
      }
    },
    [ads, finish],
  );

  // Geri sayım: video zamanına göre — sekme arka plandayken de doğru kalır.
  useEffect(() => {
    if (!started || !current) return;
    const skipAt = current.skipOffsetSeconds ?? DEFAULT_SKIP_SECONDS;

    const tick = () => {
      const video = videoRef.current;
      if (!video) return;
      const left = Math.max(0, Math.ceil(skipAt - video.currentTime));
      setRemaining(left);
      setSkippable(left <= 0);
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [started, current]);

  const goNext = useCallback(() => {
    const nextIndex = index + 1;
    if (nextIndex < visibleAds.length) startAd(nextIndex);
    else finish();
  }, [finish, index, startAd, visibleAds.length]);

  // Etiket çekilene kadar kısa bir bekleme ekranı (video elementi henüz gerekmez).
  if (ads === null) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 bg-black px-6 text-center">
        <p className="text-sm text-muted-foreground">Reklam yükleniyor…</p>
      </div>
    );
  }

  return (
    <div className="relative aspect-video w-full bg-black">
      {/* Tek <video> — durum değişince unmount OLMAMALI, yoksa oynayan reklam ölür. */}
      <video
        ref={videoRef}
        className="h-full w-full bg-black"
        playsInline
        muted={muted}
        onEnded={goNext}
        onError={goNext}
        controls={false}
        disablePictureInPicture
      />

      {started ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
          <span className="rounded bg-black/70 px-2 py-1 text-[11px] font-medium text-white/90">
            Reklam {index + 1}/{Math.min(visibleAds.length, MAX_ADS)}
          </span>
          <div className="pointer-events-auto flex items-center gap-2">
            {muted ? (
              <button
                type="button"
                className="rounded bg-black/70 px-2 py-1 text-[11px] font-medium text-white/90"
                onClick={() => {
                  const video = videoRef.current;
                  if (!video) return;
                  video.muted = false;
                  setMuted(false);
                }}
              >
                Sesi aç
              </button>
            ) : null}
            {skippable ? (
              <button
                type="button"
                className="rounded bg-white/90 px-3 py-1 text-[12px] font-medium text-black"
                onClick={goNext}
              >
                Reklamı geç
              </button>
            ) : (
              <span className="rounded bg-black/70 px-2 py-1 text-[11px] font-medium text-white/90">
                Reklamı geç: {remaining}
              </span>
            )}
          </div>
        </div>
      ) : (
        // Reklam başlamadan önce: poster + "Oynat". Poster overlay'i üstte
        // olduğu için altta duran reklam sayacı görünmez.
        <div className="absolute inset-0">
          {poster ? (
            <img
              src={poster}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-60"
              loading="eager"
            />
          ) : null}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <Button
              size="lg"
              className="rounded-full"
              onClick={() => startAd(0)}
              aria-label={`${title} bölümünü oynat`}
            >
              Oynat
            </Button>
            <p className="text-xs text-muted-foreground">
              Önce {Math.min(visibleAds.length, MAX_ADS)} kısa reklam oynayacak
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

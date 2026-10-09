import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/lib/i18n";
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
/**
 * Tek VAST reklamı bulmak için en fazla kaç tur istek atılır (ilk tur + ek turlar).
 *
 * Neden: her etiket AYRI bir açık artırma açar ve bazen biri BOŞ döner. Ölçümde
 * aynı sayfa bir açılışta "Reklam 1/1", başka açılışta "Reklam 1/1" verdi.
 * Ek tur, boş dönen slotu yeniden dener ve ikinci reklamı bulma şansını artırır.
 *
 * Üst sınır bilinçli: kapı asla reklam yüzünden takılı kalmamalı. Tur başına
 * maliyet ~0,5 sn; hepsi zaman aşımına düşse bile kapı `finish()` ile açılır.
 * Aynı kreatif ikinci kez oynatılmaz (bkz. `seen` kümesi).
 */
const MAX_ADS_ROUNDS = 3;
/**
 * Tek reklam politikasında kreatif tekrarına izin verilmez.
 *
 * Ölçüm (25.09.2026, sayfa bağlamı — sunucu tarafı değil): iki MyBid spotu da
 * DOLU dönüyor (6/6 örnekte `ads=1, noad=false, HTTP 200`) ama **çoğu zaman AYNI
 * kreatifi** veriyor — birebir aynı `mediaFile` (`i.imgkcdn.com/...mp4`, ikisi de
 * 15 sn, skip 5 sn).
 *
 *  - `false` → ikinci kopya elenir; pod 1 reklama düşer, sayaç **"Reklam 1/1"**.
 *  - `true`  → iki slot da oynar, sayaç **"Reklam 1/1"**; ama aynı video
 *               iki kez görünebilir.
 *
 * KURAL: **tek reklam gösterilir; dolgu yoksa kapı hemen açılır.**
 *
 *  1. Turlar boyunca FARKLI kreatifler toplanır (aynı mp4 tekrarı bir kenara
 *     ayrılır, atılmaz).
 *  Tek reklam bulunamazsa tekrar oynatılmaz; video doğrudan açılır.
 *
 * Böylece: MyBid iki farklı reklam verirse **2 farklı reklam** oynar; yalnızca tek
 * reklam bulunamazsa pod tek reklamda kalır ve video açılır.
 *
 * `false` yapılırsa tekrar hiç kullanılmaz → tek kreatif olduğunda pod **1 reklama
 * düşer** (`1/1`). Bu bir kez yanlışlıkla yapıldı ve 2 reklam kayboldu; varsayılan
 * bu yüzden `true`.
 */
const ALLOW_REPEAT_CREATIVE = true;
/** VAST skipoffset vermediyse kullanılacak atlama süresi (saniye). */
const DEFAULT_SKIP_SECONDS = 5;

/**
 * "Reklamı geç" düğmesinin görünebileceği EN GEÇ saniye.
 *
 * KULLANICI GERİ BİLDİRİMİ (09.10.2026): "videoyu açıyorum, reklam geç oluyor,
 * direkt 5 saniye kuralı falan yok." Ölçüm: reklam ağı kendi `skipoffset`'ini
 * 15–30 sn olarak verebiliyor ve o değer aynen uygulanıyordu; izleyici 5 saniyede
 * atlayamıyordu.
 *
 * KURAL: ağın verdiği süre 5 saniyeden KISAYSA o korunur (daha erken atlanabilir),
 * UZUNSA 5 saniyeye çekilir. Reklam, atlanmadığı sürece SONUNA KADAR oynar ve
 * gösterim sayacı reklam BAŞLARKEN tetiklenir — yani bu tavan reklam gelirini
 * düşürmez; yalnızca izleyiciye "5 saniye sonra atla" hakkını verir.
 */
const MAX_SKIP_SECONDS = 5;

/** Bir reklamın "atlanabilir" olacağı saniye — 5 saniyeyi AŞMAZ. */
function skipSecondsFor(ad: VastAd): number {
  const declared = ad.skipOffsetSeconds;
  if (declared === undefined) return DEFAULT_SKIP_SECONDS;
  return Math.max(0, Math.min(declared, MAX_SKIP_SECONDS));
}

export function PrerollGate({
  vastUrls,
  poster,
  title,
  onFinish,
  onAdStarted,
}: {
  /** VAST etiket adresleri — ad-pod: her etiket ayrı bir reklam üretir. */
  vastUrls: string[];
  poster?: string | undefined;
  title: string;
  /** Reklam(lar) bitince ya da reklam yoksa çağrılır — bir kez. */
  onFinish: () => void;
  /**
   * GERÇEKTEN bir reklam oynatılmaya başlandığında çağrılır (gösterim sayacıyla
   * aynı anda). Çağıran taraf bunu "bu bölümün kapısı geçildi" diye kaydeder.
   *
   * NEDEN AYRI: `onFinish` dolgu YOKKEN de çalışır (kapı beklemeden açılır). O an
   * "geçildi" yazılsaydı, reklam ağı sonradan dolgu vermeye başlasa bile aynı
   * oturumda gösterim kaçardı. Kayıt yalnızca gerçek bir reklam başladığında tutulur.
   */
  onAdStarted?: (() => void) | undefined;
}) {
  const { t } = useLang();
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
    // AD-POD: HER etiket AYRI bir açık artırma açar. Daha önce yalnızca İLK etiket
    // çekiliyordu (`vastUrls.find(...)`) — bu yüzden canlıda sayaç hep "Reklam 1/1"
    // kalıyordu ve ikinci spot hiç kullanılmıyordu.
    const urls = vastUrls.filter((url) => /^https?:\/\//i.test(url));
    if (urls.length === 0) {
      finish();
      return;
    }
    // `collected`: oynatılacak reklamlar.
    // `seen`      : görülen kreatifler (farklı olanı tercih etmek için).
    // `repeats`   : farklı kreatif bulunamazsa pod'u doldurmak için ayrılan tekrarlar.
    const collected: VastAd[] = [];
    const seen = new Set<string>();
    const repeats: VastAd[] = [];

    const collect = async (): Promise<void> => {
      for (let round = 0; round < MAX_ADS_ROUNDS; round += 1) {
        const before = collected.length;
        const groups = await Promise.all(
          urls.map((url) =>
            // Tek etiketin hatası ad-pod'un tamamını düşürmemeli.
            fetchVastAds(url, { timeoutMs: 3000 }).catch((): VastAd[] => []),
          ),
        );
        if (!alive) return;
        for (const ad of groups.flat()) {
          if (collected.length >= MAX_ADS) return;
          if (seen.has(ad.mediaFile)) {
            // Farklı kreatif tercih edilir; tekrar atılmaz, yedeğe alınır.
            if (ALLOW_REPEAT_CREATIVE) repeats.push(ad);
            continue;
          }
          seen.add(ad.mediaFile);
          collected.push(ad);
        }
        if (collected.length >= MAX_ADS) return;
        // Bu tur hiç YENİ farklı kreatif getirmediyse ek tur denemek boşuna.
        if (collected.length === before) break;
      }
    };

    void collect()
      .then(() => {
        // Tek reklam politikasında yedek kreatif oynatılmaz.
        while (alive && collected.length < MAX_ADS && repeats.length > 0) {
          const next = repeats.shift();
          if (next) collected.push(next);
        }
      })
      .catch(() => undefined)
      .then(() => {
        if (!alive) return;
        setAds(collected);
        if (collected.length === 0) finish();
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
        onAdStarted?.();
      }

      video.src = ad.mediaFile;
      const skipAt = skipSecondsFor(ad);
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
    [ads, finish, onAdStarted],
  );

  // Geri sayım: video zamanına göre — sekme arka plandayken de doğru kalır.
  useEffect(() => {
    if (!started || !current) return;
    const skipAt = skipSecondsFor(current);

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
        <p className="text-sm text-muted-foreground">{t("watch.prerollLoading")}</p>
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
            {t("watch.prerollCounter", {
              index: index + 1,
              total: Math.min(visibleAds.length, MAX_ADS),
            })}
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
                {t("watch.prerollUnmute")}
              </button>
            ) : null}
            {skippable ? (
              <button
                type="button"
                className="rounded bg-white/90 px-3 py-1 text-[12px] font-medium text-black"
                onClick={goNext}
              >
                {t("watch.prerollSkip")}
              </button>
            ) : (
              <span className="rounded bg-black/70 px-2 py-1 text-[11px] font-medium text-white/90">
                {t("watch.prerollSkipCountdown", { seconds: remaining })}
              </span>
            )}
          </div>
        </div>
      ) : (
        // Reklam başlamadan önce: poster + "Oynat". Poster overlay'i üstte
        // olduğu için altta duran reklam sayacı görünmez.
        <div className="absolute inset-0">
          {/* OKUNABİLİRLİK (04.10.2026): poster açık renkliyken "Oynat" ve
              altındaki sayaç yazısı kayboluyordu (kullanıcı şikâyeti).
              DENGE (05.10.2026): ilk önlem fazla kaçtı — kullanıcı "arka plan
              çok karanlık" dedi. Poster yeniden NET görünür (`opacity-80`),
              gradyan yalnızca yazıların arkasını yumuşakça koyulaştırır.
              Okunabilirliği gölge (text-shadow) garanti eder. */}
          {poster ? (
            <>
              <img
                src={poster}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-80"
                loading="eager"
              />
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-black/40"
              />
            </>
          ) : (
            <div className="absolute inset-0 bg-black" />
          )}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <Button
              size="lg"
              className="rounded-full [text-shadow:0_1px_3px_rgba(0,0,0,0.55)]"
              onClick={() => startAd(0)}
              aria-label={t("watch.playEpisodeAria", { title })}
            >
              {t("watch.play")}
            </Button>
            <p className="text-xs font-medium text-white/80 [text-shadow:0_1px_4px_rgba(0,0,0,0.9)]">
              {t("watch.prerollUpcoming", { count: Math.min(visibleAds.length, MAX_ADS) })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

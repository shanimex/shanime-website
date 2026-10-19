/**
 * "Kaldığın yerden devam et" kartı (index.tsx'ten bölündü, 01.10.2026).
 *
 * Kayıt cihazda (localStorage) durur; bu dosya yalnızca ÇİZİMİ yapar.
 * Zaman damgası ve kalan süre YALNIZCA gerçek konum kaydı varsa yazılır —
 * uydurma "%0" ya da "0:00" gösterilmez. Davranış birebir aynıdır.
 */
import { Link } from "@tanstack/react-router";
import { Play, X } from "lucide-react";

import { EpisodeCover } from "@/components/site/EpisodeCover";
import {
  anizipCover,
  anizipCoverForSeason,
  anizipCoverFromChain,
  resolveSeasonMalId,
} from "@/lib/anizip-covers";
import { episodeCoverUrl } from "@/lib/content";
import { formatClock } from "@/lib/home-static";
import { useLang } from "@/lib/i18n";

/**
 * "İZLEMEYE DEVAM ET" KARTI — referans (animex.one `#continue-watching`) düzeni.
 *
 * REFERANS DÜZENİ (Gotaku ekranından ölçüldü):
 *   · kompakt 16:9 görsel; üstünde gereksiz süre rozeti veya ağır gradient yok
 *   · hover'da kapağın tamamını kaplayan kısa karartma
 *   · ilerleme çubuğu görselin EN ALT KENARINDA, tam genişlikte
 *   · görselin altında: bölüm bilgisi ve kalan süre
 *   · sonra tek satırlık seri adı
 */
export function ContinueRow({
  slug,
  season,
  episode,
  title,
  image,
  frame,
  fraction,
  position,
  duration,
  total,
  malId,
  editing,
  onRemove,
  className,
}: {
  /** Hedef serinin slug'ı; boşsa (veritabanı kaydı olmayan yedek içerik) bağlantı çizilmez. */
  slug?: string | undefined;
  season: number;
  episode: number;
  title: string;
  /** Yedek görsel: yakalanmış kare yoksa seri posteri. */
  image: string;
  /** Yakalanmış gerçek kare (data URL) ya da boş metin. */
  frame: string;
  /** 0..1 ilerleme; `null` ise çubuk çizilmez. */
  fraction: number | null;
  /** Kayıtlı son saniye (0 = kayıt yok). */
  position: number;
  /** Toplam süre saniye (0 = bilinmiyor). */
  duration: number;
  /** Serinin toplam bölüm sayısı (0 = bilinmiyor). */
  total: number;
  /** Serinin MAL kimliği — bölüm kapağını çözer (yoksa zincir boş döner). */
  malId: number | null;
  /** Film kartlarında sezon/bölüm rozeti gösterilmez. */
  showKind?: string | null;
  /** Düzenleme kipi: kart bağlantı olmaz, köşede "çıkar" düğmesi çıkar. */
  editing: boolean;
  onRemove: (slug: string) => void;
  /** Dış listenin responsive yerleşimi için ek sınıflar. */
  className?: string;
}) {
  const { t } = useLang();
  const percent = fraction === null ? 0 : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  // Kalan süre YALNIZCA iki değer de biliniyorsa ve anlamlıysa yazılır.
  const remainingMinutes =
    position > 0 && duration > position
      ? Math.max(1, Math.round((duration - position) / 60))
      : null;

  /**
   * Kaldığın yer kartı, bölüm listesindekiyle aynı kapak zincirini kullanır.
   *
   * Önce kendi oynatıcımızdan yakalanmış gerçek son kareyi deneriz. Embed
   * sağlayıcılarda bu kare tarayıcı güvenliği nedeniyle alınamıyorsa, aynı
   * bölümün TVDB/ani.zip kapağına; en sonda seri posterine düşeriz. Önceden
   * `frame` prop'u karta kadar taşınıyor ama burada hiç kullanılmıyordu; bu
   * yüzden her kart seri posterine dönüyordu.
   */
  const seasonMalId = resolveSeasonMalId(malId, season, null);
  const coverCandidates = [
    frame,
    anizipCoverForSeason(seasonMalId, season, episode),
    anizipCover(malId, season, episode),
    anizipCoverFromChain(malId, season, episode, seasonMalId),
    episodeCoverUrl(slug ?? "", season, episode),
    image,
  ];

  const body = (
    <div className="flex min-w-0 flex-col">
      <span className="continue-cover relative block aspect-video w-full overflow-hidden rounded-xl bg-secondary">
        <EpisodeCover
          number={episode}
          numberClassName="font-display text-2xl text-foreground/70"
          candidates={coverCandidates}
        />
        {/* Süre ve alt kenar okunurluğu için sabit, aşağıdan yukarı yükselen gölge. */}
        <span
          aria-hidden
          className="continue-cover-gradient pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[58%]"
        />
        {/* Gotaku'daki hover karartması: sabit gradient değil, yalnızca imleçte açılır. */}
        <span
          aria-hidden
          className="continue-cover-shade pointer-events-none absolute inset-0 z-[2]"
        />
        {duration > 0 && (
          <span className="continue-duration absolute bottom-1 right-1 z-[4] rounded-[5px] bg-black/55 px-1 py-[3px] text-[9px] font-medium leading-none tabular-nums text-white/95 sm:bottom-1.5 sm:right-1.5 sm:text-[10px]">
            {formatClock(position)} / {formatClock(duration)}
          </span>
        )}
        {/* Oynat düğmesi Gotaku'daki gibi yalnızca hover/focus durumunda görünür. */}
        <span
          aria-hidden
          className="continue-play-layer pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
        >
          <span className="continue-play grid size-[46px] place-items-center rounded-full bg-white/42 text-[#b30d27]">
            <Play className="ml-0.5 size-5 fill-current" />
          </span>
        </span>
        {/* İLERLEME ÇUBUĞU — Gotaku ile aynı 2 px kalınlıkta, kapağın alt kenarında. */}
        {fraction !== null && (
          <span
            role="progressbar"
            aria-label={t("home.continueHeading")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="absolute inset-x-0 bottom-0 z-[3] block h-0.5 bg-black/25"
          >
            <span className="block h-full bg-[#b30d27]" style={{ width: `${percent}%` }} />
          </span>
        )}
      </span>

      <span className="mt-2 flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-2 text-[11px] font-medium leading-4">
          <span className="text-muted-foreground">
            {t("common.episode")} {episode}
          </span>
          {remainingMinutes !== null && (
            <span className="ml-auto shrink-0 font-normal text-muted-foreground">
              {t("home.minLeftShort", { min: remainingMinutes })}
            </span>
          )}
        </span>
        {/* show.title VERİTABANI içeriğidir → bilerek ÇEVRİLMEZ. */}
        <strong className="mt-1 truncate text-[13px] font-semibold leading-5 text-foreground">
          {title}
        </strong>
      </span>
    </div>
  );

  // DÜZENLEME KİPİ: kart bağlantı DEĞİL (iç içe etkileşimli öğe geçersiz olurdu)
  // ve çıkarma düğmesi çizilir.
  if (editing) {
    return (
      <div className={`group continue-card relative ${className ?? ""}`}>
        {body}
        <button
          type="button"
          onClick={() => slug && onRemove(slug)}
          aria-label={t("home.continueRemove", { title })}
          className="continue-remove continue-remove--editing absolute right-2 top-2 grid size-6 place-items-center rounded-full text-white/90"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    );
  }

  // Hedef yoksa (yedek içerik) bağlantı çizilmez: bugünkü davranış korunur.
  if (!slug) return <div className={`group continue-card ${className ?? ""}`}>{body}</div>;
  // Yoğun kart listesi → `preload={false}` (hover başına boşa okuma olmasın).
  return (
    <div className={`group continue-card relative ${className ?? ""}`}>
      <Link
        to="/anime/$slug/season/$season/episode/$episode"
        params={{ slug, season: String(season), episode: String(episode) }}
        preload={false}
        className="block"
      >
        {body}
      </Link>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove(slug);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        aria-label={t("home.continueRemove", { title })}
        className="continue-remove absolute right-2 top-2 z-20 grid size-6 place-items-center text-white/90 focus-visible:opacity-100 focus-visible:outline-none"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

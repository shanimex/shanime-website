/**
 * "Kaldığın yerden devam et" kartı (index.tsx'ten bölündü, 01.10.2026).
 *
 * Kayıt cihazda (localStorage) durur; bu dosya yalnızca ÇİZİMİ yapar.
 * Zaman damgası ve kalan süre YALNIZCA gerçek konum kaydı varsa yazılır —
 * uydurma "%0" ya da "0:00" gösterilmez. Davranış birebir aynıdır.
 */
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";

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
 * REFERANS DÜZENİ (ekran görüntüsünden ölçüldü):
 *   · 16:9 görsel; zaman damgası görselin SAĞ ALTINDA ("0:55 / 23:40")
 *   · ilerleme çubuğu görselin EN ALT KENARINDA, tam genişlikte
 *   · görselin altında: kalan süre ("23 dk kaldı")
 *   · sonra "Seri Adı | Bölüm 1"
 *   · en altta "Bölüm 1 / 19"
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
  showKind,
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
  const isMovie = String(showKind ?? "").toLowerCase() === "movie";
  const percent = fraction === null ? 0 : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  // Kalan süre YALNIZCA iki değer de biliniyorsa ve anlamlıysa yazılır.
  const remainingMinutes =
    position > 0 && duration > position
      ? Math.max(1, Math.round((duration - position) / 60))
      : null;

  /**
   * KAPAK ZİNCİRİ — kullanıcı isteği (01.10.2026): "kaldığım bölümün kapağı
   * olsun daima". Sıra bölüm listesiyle AYNIDIR: önce sezonun kendi MAL kaydı,
   * sonra seri kaydı, sonra zincirdeki kardeş kayıt, sonra R2 bölüm kapağı.
   *
   * ESKİDEN NEYDİ: yalnızca `[fra, image]` deneniyordu; yakalanmış kare yoksa
   * doğrudan SERİ POSTERİNE düşüyordu — bu yüzden kart "hep aynı görsel" gibi
   * görünüyordu. Poster artık EN SON çaredir.
   */
  const seasonMalId = resolveSeasonMalId(malId, season, null);
  const coverCandidates = [
    // Filmde banner yatay kapak ilk sıradadır; dizide bölüm kapağı zinciri korunur.
    isMovie ? image : "",
    // Güncel yatay vitrin kapağı; bölüm/TVDB kapağı yalnızca yedektir.
    anizipCoverForSeason(seasonMalId, season, episode),
    anizipCover(malId, season, episode),
    anizipCoverFromChain(malId, season, episode, seasonMalId),
    episodeCoverUrl(slug ?? "", season, episode),
    frame,
    image,
  ];

  const body = (
    <div className="flex min-w-0 flex-col">
      <span className="relative block aspect-video w-full overflow-hidden rounded-lg bg-secondary">
        <EpisodeCover
          number={episode}
          numberClassName="font-display text-2xl text-foreground/70"
          candidates={coverCandidates}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[68%] bg-gradient-to-t from-black/95 via-black/50 to-transparent"
        />
        {!isMovie ? (
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap font-ui text-[10px] font-medium tracking-wide text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)] sm:text-xs">
            {t("series.seasonEpisodeOverlay", {
              season: String(season),
              number: String(episode),
            })}
          </span>
        ) : null}
        {/* ZAMAN DAMGASI — görselin sağ altı (referans ölçüsü: 11 px, yarı saydam
            siyah zemin). `tabular-nums` rakam genişliğini sabitler ki sayaç
            oynarken metin zıplamasın. */}
        {duration > 0 && (
          <span className="absolute bottom-2 right-1.5 rounded-full bg-black/80 px-1.5 py-[2px] text-[9px] font-semibold leading-none tabular-nums text-white shadow-sm backdrop-blur-[2px] sm:px-1.5 sm:py-0.5 sm:text-[10px]">
            {formatClock(position)} / {formatClock(duration)}
          </span>
        )}
        {/* İLERLEME ÇUBUĞU — görselin en alt kenarında, tam genişlikte. */}
        {fraction !== null && (
          <span
            role="progressbar"
            aria-label={t("home.continueHeading")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="absolute inset-x-0 bottom-0 block h-1 bg-white/25"
          >
            <span className="block h-full bg-primary" style={{ width: `${percent}%` }} />
          </span>
        )}
      </span>

      <span className="mt-2 flex min-w-0 flex-col">
        {remainingMinutes !== null && (
          <span className="text-[13px] font-semibold text-primary">
            {t("home.minLeft", { min: remainingMinutes })}
          </span>
        )}
        {/* show.title VERİTABANI içeriğidir → bilerek ÇEVRİLMEZ. */}
        <strong className="mt-0.5 truncate text-sm font-bold text-foreground">{title}</strong>
        {/* KULLANICI İSTEĞİ (01.10.2026): "1. Sezon 1. Bölüm" yazacak —
            "Bölüm 1 / 85" gibi bir sayaç DEĞİL. */}
        <span className="mt-0.5 text-xs text-muted-foreground">
          {t("common.seasonEpisode", { season, n: episode })}
        </span>
      </span>
    </div>
  );

  // DÜZENLEME KİPİ: kart bağlantı DEĞİL (iç içe etkileşimli öğe geçersiz olurdu)
  // ve çıkarma düğmesi çizilir.
  if (editing) {
    return (
      <div className={`group relative ${className ?? ""}`}>
        {body}
        <button
          type="button"
          onClick={() => slug && onRemove(slug)}
          aria-label={t("home.continueRemove", { title })}
          className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-black/80 text-white transition-colors hover:bg-primary"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    );
  }

  // Hedef yoksa (yedek içerik) bağlantı çizilmez: bugünkü davranış korunur.
  if (!slug) return <div className={`group ${className ?? ""}`}>{body}</div>;
  // Yoğun kart listesi → `preload={false}` (hover başına boşa okuma olmasın).
  return (
    <Link
      to="/anime/$slug/season/$season/episode/$episode"
      params={{ slug, season: String(season), episode: String(episode) }}
      preload={false}
      className={`group ${className ?? ""}`}
    >
      {body}
    </Link>
  );
}

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
      <span className="continue-cover relative block aspect-video w-full overflow-hidden rounded-lg bg-secondary">
        <EpisodeCover
          number={episode}
          numberClassName="font-display text-2xl text-foreground/70"
          candidates={coverCandidates}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[68%] bg-gradient-to-t from-black/85 via-black/40 to-transparent"
        />
        {/* Gotaku tarzı hover katmanı: kartın ana bağlantısı değişmez, yalnızca
            izleme eylemini görsel olarak belirginleştirir. */}
        <span
          aria-hidden
          className="mobile-no-hover-overlay pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/15 opacity-0 transition-[opacity,background-color] duration-300 ease-out group-hover:opacity-100"
        >
          <span className="continue-play grid size-[46px] place-items-center rounded-full bg-white/42 text-[#b30d27]">
            <Play className="ml-0.5 size-5 fill-current" />
          </span>
        </span>
        {/* ZAMAN DAMGASI — görselin sağ altı (referans ölçüsü: 11 px, yarı saydam
            siyah zemin). `tabular-nums` rakam genişliğini sabitler ki sayaç
            oynarken metin zıplamasın. */}
        {duration > 0 && (
          <span className="absolute bottom-2 right-1.5 z-[2] rounded bg-black/55 px-1.5 py-[2px] text-[9px] font-medium leading-none tabular-nums text-white sm:py-0.5 sm:text-[10px]">
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
            className="absolute inset-x-0 bottom-0 z-[2] block h-[2px] bg-black/35"
          >
            <span className="block h-full bg-[#b30d27]" style={{ width: `${percent}%` }} />
          </span>
        )}
      </span>

      <span className="mt-2 flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-2 text-[11px] font-normal leading-4">
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
        <strong className="mt-1.5 truncate text-[13px] font-semibold leading-5 text-foreground">
          {title}
        </strong>
      </span>
    </div>
  );

  // DÜZENLEME KİPİ: kart bağlantı DEĞİL (iç içe etkileşimli öğe geçersiz olurdu)
  // ve çıkarma düğmesi çizilir.
  if (editing) {
    return (
      <div className={`group continue-card mobile-no-hover relative ${className ?? ""}`}>
        {body}
        <button
          type="button"
          onClick={() => slug && onRemove(slug)}
          aria-label={t("home.continueRemove", { title })}
          className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-black/55 text-white/90 shadow-lg backdrop-blur-sm transition-colors hover:bg-black/75"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    );
  }

  // Hedef yoksa (yedek içerik) bağlantı çizilmez: bugünkü davranış korunur.
  if (!slug)
    return <div className={`group continue-card mobile-no-hover ${className ?? ""}`}>{body}</div>;
  // Yoğun kart listesi → `preload={false}` (hover başına boşa okuma olmasın).
  return (
    <div className={`group continue-card mobile-no-hover relative ${className ?? ""}`}>
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
        className="absolute right-2 top-2 z-20 grid size-6 translate-y-1 scale-90 place-items-center rounded-full bg-black/55 text-white/90 opacity-0 shadow-lg backdrop-blur-sm transition-[opacity,transform,background-color] delay-75 duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:translate-y-0 hover:scale-100 hover:bg-black/75 focus-visible:translate-y-0 focus-visible:scale-100 focus-visible:opacity-100 focus-visible:outline-none sm:group-hover:translate-y-0 sm:group-hover:scale-100 sm:group-hover:opacity-100"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

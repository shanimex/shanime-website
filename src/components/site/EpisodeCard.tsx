import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";
import { EpisodeCover } from "@/components/site/EpisodeCover";
import { episodeCoverFromWatchUrl, localCoverPath, type Episode } from "@/lib/content";
import { resolvePosterForEpisode } from "@/lib/episode-covers";
import { anizipCover } from "@/lib/anizip-covers";
import { useLang } from "@/lib/i18n";

type EpisodeCardProps = {
  /** Serinin slug'ı; yerel kapak yolunu üretmek için gerekir. */
  slug: string;
  episode: Episode;
  /** `row`: animecix tarzı satır düzeni · `grid`: kapak ızgarası. */
  variant?: "row" | "grid";
  /**
   * Kartın açacağı SEZON. İzleme adresi (`/anime/<slug>/season/<n>/episode/<n>`)
   * buradan kurulur; bölüm numarası `episode.number`dan gelir.
   *
   * NEDEN HAZIR ADRES (`href`) DEĞİL: kart artık istemci içi gezinme yapan
   * `Link` çizer (tam sayfa yüklemesi yok → sunucu yeniden çizilmez, reklam
   * slotları ve sorgu önbelleği korunur). Adresi `Link` kurduğu için çağıran
   * tarafın adres dizesi üretmesine gerek kalmaz.
   */
  watchSeason: number;
  /**
   * Serinin ana posteri. Zincirin **son** adımı.
   *
   * Neden gerekli: sağlayıcı embed'iyle (megaplay) gelen bölümlerde `watch_url`
   * boş olduğu için sağlayıcı kapağı ÜRETİLEMİYOR (megaplay poster/thumb servis
   * etmiyor — ağ kaydında görsel isteği yok). O durumda kart tamamen boş/kırık
   * kalıyordu. Seri posteri, kırık görsel yerine tutarlı bir kapak verir.
   *
   * NOT: Bu gerçek bir "videodan kare" DEĞİLDİR. Cross-origin iframe'in
   * içindeki videodan kare alınamaz; gerçek kare ancak videoyu kendimiz
   * barındırırsak (R2 + kendi oynatıcı) üretilebilir.
   */
  seriesPoster?: string | undefined;
  /**
   * Serinin MyAnimeList kimliği. Verilirse kart, o bölüme ait **gerçek bölüm
   * görselini** (`episode-thumbs.json`, ani.zip/TVDB) kullanır.
   *
   * Neden gerekli: embed sağlayıcıları bölüm kapağı yayınlamıyor ve `watch_url`
   * boş olduğu için türetme de çalışmıyor; kart seri posterine düşüyordu (tüm
   * bölümler aynı görsel). Bkz. `src/lib/anizip-covers.ts`.
   */
  malId?: number | null | undefined;
};

/**
 * Bölüm kartı.
 *
 * Kapak zinciri: panelden yüklenen kapak → sağlayıcı kapağı → bölüme ait GERÇEK
 * görsel (ani.zip/TVDB, `episode-thumbs.json`) → adresten türetilen kapak →
 * yerelde üretilmiş kare → seri posteri → bölüm numarası. Hiçbiri gelmezse kart
 * bulanık bir görsele değil, düz bir "numara kartına" düşer: gerçek kapakların
 * yanında bulanık görsel "bozuk/yarım yüklenmiş" izlenimi veriyordu.
 */
export function EpisodeCard({
  slug,
  episode,
  variant = "row",
  watchSeason,
  seriesPoster,
  malId,
}: EpisodeCardProps) {
  const { t } = useLang();
  // İzleme hedefi: kardeşlerle aynı `Link` kalıbı. `preload={false}`: ızgara ve
  // satır listeleri yoğundur, fareyle üzerinden geçmek tıklama değildir; önden
  // çekme hover başına boşa okuma (kota/egress) üretirdi. Gezinme yine anındadır.
  const watchClassName =
    variant === "grid"
      ? "group block rounded-2xl focus-visible:outline-none"
      : "group flex gap-3 rounded-2xl border border-border bg-card p-2.5 transition-colors hover:border-accent/60 focus-visible:border-accent focus-visible:outline-none sm:gap-4 sm:p-3";
  // `episode.title` / `episode.summary` VERİTABANI içeriğidir, bilerek ÇEVRİLMEZ;
  // yalnızca başlık yoksa yazılan yedek etiket bizim metnimizdir ve çevrilir.
  const label = episode.title?.trim() || t("series.episodeLabel", { number: episode.number });
  const summary = episode.summary?.trim();

  const media = (
    <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-secondary via-secondary to-background">
      <EpisodeCover
        number={episode.number}
        // Sıra önemli: panelden yüklenen kapak → sağlayıcının karesi (dosyadan,
        // anında) → morencius türetmesi → yerel dosya. İlk ikisi çoğu bölümde
        // tutar, gereksiz istek olmaz.
        // ÖNCELİK SIRASI (29.09.2026):
        //   (a) panelden yüklenen kapak → (b) animecix bölüm kapağı →
        //   (c) sağlayıcı-türetimi (harita/Voe/VidMoly/Morencius) →
        //   (d) ani.zip/TVDB → (e) manifest'te VARSA yerel dosya → (f) seri posteri.
        // İlk dördü çoğu bölümde tutar; gereksiz istek olmaz.
        candidates={[
          episode.thumbnail ?? "",
          // animecix'ten BÖLÜME ÖZEL kapak (sunucuda çözülür, bölüm nesnesiyle
          // gelir; yalnızca başka kaynaktan kapağı olmayan bölümler için doludur).
          episode.animecixC ?? "",
          // Sağlayıcı kapağı bölüm nesnesiyle gelir (sunucuda çözülür) — modül
          // durumundan okunursa sunucu/istemci farkı hydration hatası veriyor.
          episode.poster ?? "",
          // Bölüme ait GERÇEK görsel (ani.zip/TVDB, derleme zamanında gömülü).
          // Sağlayıcı kapağı olmayan bölümlerin asıl çözümü budur; alttaki türetme
          // ve seri posteri yalnızca yedektir.
          anizipCover(malId, episode.season, episode.number),
          episodeCoverFromWatchUrl(episode.watch_url),
          // Yerel dosya: YALNIZCA manifest'te kayıtlıysa döner (aksi hâlde ""),
          // böylece var olmayan `/static/episode-covers/*` isteği → 404 olmaz.
          localCoverPath(slug, episode.season, episode.number),
          // Son çare: seri posteri. Sağlayıcı kapağı üretilemeyen bölümlerde
          // (megaplay) kırık görsel yerine tutarlı bir kapak gösterir.
          seriesPoster ?? "",
        ]}
        // Kayıtlı adres bayatlamışsa (sağlayıcı CDN'i dönüyor) güncelini çeker.
        resolveFallback={() => resolvePosterForEpisode(episode.watch_url)}
      />

      {/* Karartma: etiket ve oynat düğmesi okunur kalsın. */}
      <span
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent opacity-80"
      />

      {/* animecix'teki gibi kapağın altında sezon/bölüm etiketi ("S1 B1"). */}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-background/95 to-transparent"
      />
      <span className="absolute inset-x-0 bottom-1 text-center text-[10px] font-bold tracking-widest text-foreground/90">
        {/* Kısa bölüm etiketi ("S1 B1" / "S1 E1"): kısaltma dile bağlı olduğu
            için metin sözlükten gelir, burada harf birleştirilmez. */}
        {t("series.seasonEpisodeBadge", { season: episode.season, number: episode.number })}
      </span>

      {/* Hover'da oynat düğmesi. */}
      <span
        aria-hidden
        className="absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        <span className="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg">
          <Play size={17} fill="currentColor" />
        </span>
      </span>
    </div>
  );

  const badges = (
    <div className="flex shrink-0 items-center gap-2">
      <span className="rounded-lg border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-bold text-accent">
        {t("series.episodeLabel", { number: episode.number })}
      </span>
      {episode.duration ? (
        <span className="rounded-lg border border-border px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
          {episode.duration}
        </span>
      ) : null}
    </div>
  );

  if (variant === "grid") {
    return (
      <Link
        to="/anime/$slug/season/$season/episode/$episode"
        params={{ slug, season: String(watchSeason), episode: String(episode.number) }}
        preload={false}
        className={watchClassName}
      >
        <div className="relative overflow-hidden rounded-2xl border border-border bg-secondary transition-colors duration-200 group-hover:border-accent/60 group-focus-visible:border-accent">
          {media}
        </div>
        <p className="mt-2 line-clamp-1 text-sm font-bold text-foreground">{label}</p>
      </Link>
    );
  }

  return (
    <Link
      to="/anime/$slug/season/$season/episode/$episode"
      params={{ slug, season: String(watchSeason), episode: String(episode.number) }}
      preload={false}
      className={watchClassName}
    >
      <div className="w-32 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-secondary sm:w-48">
        {media}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 py-1">
        {/* Rozetler başlığın yanında durur. animecix'te bunlar en sağa yaslı;
            orada ortayı bölüm açıklaması dolduruyor. Bizde açıklama alanı boş
            olduğu için sağa yaslamak satırın ortasını kocaman bir boşluk gibi
            gösteriyordu. Açıklama girilirse alt satır kendiliğinden dolar. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="text-sm font-bold text-foreground sm:text-base">{label}</p>
          {badges}
        </div>
        {summary ? (
          <p className="line-clamp-2 text-xs text-muted-foreground sm:text-sm">{summary}</p>
        ) : null}
      </div>
    </Link>
  );
}

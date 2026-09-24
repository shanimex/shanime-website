import { Play } from "lucide-react";
import { EpisodeCover } from "@/components/EpisodeCover";
import {
  episodeCoverFromWatchUrl,
  localCoverPath,
  posterCoverPath,
  type Episode,
} from "@/lib/content";

type EpisodeCardProps = {
  /** Serinin slug'ı; yerel kapak yolunu üretmek için gerekir. */
  slug: string;
  episode: Episode;
  /** `row`: animecix tarzı satır düzeni · `grid`: kapak ızgarası. */
  variant?: "row" | "grid";
  href: string;
};

/**
 * Bölüm kartı.
 *
 * Kapak zinciri: panelden yüklenen kapak → yerelde üretilmiş kare → oynatıcının
 * yayınladığı kare → bölüm numarası. Hiçbiri gelmezse kart bulanık bir görsele
 * değil, düz bir "numara kartına" düşer: gerçek kapakların yanında bulanık
 * görsel "bozuk/yarım yüklenmiş" izlenimi veriyordu.
 */
export function EpisodeCard({ slug, episode, variant = "row", href }: EpisodeCardProps) {
  const label = episode.title?.trim() || `Bölüm ${episode.number}`;
  const summary = episode.summary?.trim();

  const media = (
    <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-secondary via-secondary to-background">
      <EpisodeCover
        number={episode.number}
        // Sıra önemli: panelden yüklenen kapak → sağlayıcının karesi (dosyadan,
        // anında) → morencius türetmesi → yerel dosya. İlk ikisi çoğu bölümde
        // tutar, gereksiz istek olmaz.
        candidates={[
          episode.thumbnail ?? "",
          posterCoverPath(slug, episode.season, episode.number),
          episodeCoverFromWatchUrl(episode.watch_url),
          localCoverPath(slug, episode.season, episode.number),
        ]}
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
        S{episode.season} B{episode.number}
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
        {episode.number}. Bölüm
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
      <a href={href} className="group block rounded-2xl focus-visible:outline-none">
        <div className="relative overflow-hidden rounded-2xl border border-border bg-secondary transition-colors duration-200 group-hover:border-accent/60 group-focus-visible:border-accent">
          {media}
        </div>
        <p className="mt-2 line-clamp-1 text-sm font-bold text-foreground">{label}</p>
      </a>
    );
  }

  return (
    <a
      href={href}
      className="group flex gap-3 rounded-2xl border border-border bg-card p-2.5 transition-colors hover:border-accent/60 focus-visible:border-accent focus-visible:outline-none sm:gap-4 sm:p-3"
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
    </a>
  );
}

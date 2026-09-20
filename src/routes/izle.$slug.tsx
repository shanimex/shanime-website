import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AdSlot } from "@/components/AdSlot";
import { fetchShowDetail, showSlug } from "@/lib/content";

export const Route = createFileRoute("/izle/$slug")({
  head: () => ({
    meta: [{ title: "shanime | İzle", name: "robots", content: "noindex" }],
  }),
  component: WatchPage,
});

/** Video öncesi bekleme: sadece bu tek sayaç, max 5 sn, başka reklam/popup yok. */
const PREROLL_SECONDS = 5;

function WatchPage() {
  const { slug } = useParams({ from: "/izle/$slug" });
  const navigate = useNavigate();
  const {
    data: detail,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["show-detail", slug],
    queryFn: () => fetchShowDetail(slug),
    staleTime: 60_000,
  });
  const [countdown, setCountdown] = useState(PREROLL_SECONDS);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [countdown]);

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  if (isError || !detail) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-5 text-center">
        <div>
          <h1 className="font-display text-2xl text-foreground">Bölüm bulunamadı</h1>
          <Button className="mt-5 rounded-full" onClick={() => navigate({ to: "/" })}>
            Ana sayfaya dön
          </Button>
        </div>
      </div>
    );
  }

  const { show, episodes } = detail;
  const current = new URLSearchParams(window.location.search).get("b");
  const currentEp = episodes.find((e) => String(e.number) === current) ?? episodes[0];
  const currentIndex = currentEp ? episodes.indexOf(currentEp) : -1;
  const prevEp = currentIndex > 0 ? episodes[currentIndex - 1] : null;
  const nextEp =
    currentIndex >= 0 && currentIndex < episodes.length - 1 ? episodes[currentIndex + 1] : null;
  const base = `/izle/${showSlug(show)}`;
  const watching = Boolean(currentEp?.watch_url) && countdown <= 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-20 max-w-6xl items-center gap-4 px-4 lg:px-8">
          <a href="/" className="flex items-center gap-2 rounded-full px-1 py-1">
            <img
              src="/shanime-logo.png"
              alt="shanime logosu"
              width={800}
              height={400}
              loading="eager"
              decoding="async"
              className="h-14 w-auto object-contain sm:h-16"
            />
            <span className="sr-only">shanime</span>
          </a>
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-muted-foreground">
            {show.title}
          </span>
          <a
            href={`/seri/${showSlug(show)}`}
            className="flex shrink-0 items-center gap-1 text-sm font-bold text-accent"
          >
            <ArrowLeft size={15} /> Detay
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 lg:px-8">
        <WatchBody
          watching={watching}
          countdown={countdown}
          showTitle={show.title}
          epNumber={currentEp?.number ?? 0}
          epUrl={currentEp?.watch_url ?? ""}
          onSkip={() => setCountdown(0)}
        />
        <EpisodeNav
          base={base}
          prevEp={prevEp ? { number: prevEp.number } : null}
          nextEp={nextEp ? { number: nextEp.number } : null}
        />
        {episodes.length > 0 && (
          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="rounded-full px-1 py-1">Bölümler</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {episodes.map((ep) => (
                <a
                  key={ep.id}
                  href={`${base}?b=${ep.number}`}
                  className={`rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${
                    currentEp?.number === ep.number
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:border-accent hover:text-accent"
                  }`}
                >
                  {ep.number}
                </a>
              ))}
            </div>
          </section>
        )}
        <AdSlot slot="ad_watch_bottom" className="flex justify-center" />
      </main>
    </div>
  );
}

function WatchBody({
  watching,
  countdown,
  showTitle,
  epNumber,
  epUrl,
  onSkip,
}: {
  watching: boolean;
  countdown: number;
  showTitle: string;
  epNumber: number;
  epUrl: string;
  onSkip: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-black">
      {watching ? (
        <iframe
          src={epUrl}
          title={`${showTitle} bölüm ${epNumber}`}
          loading="lazy"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen
          className="aspect-video w-full"
        />
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 bg-black/90 px-6 text-center">
          {epUrl ? (
            <>
              <AdSlot slot="ad_preroll" className="flex justify-center" />
              <p className="text-sm font-bold text-foreground">
                Video {countdown} saniye içinde başlayacak
              </p>
              <Button size="sm" className="rounded-full" onClick={onSkip}>
                Reklamı geç
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Bu bölüm için video henüz eklenmedi.</p>
          )}
        </div>
      )}
    </div>
  );
}

function EpisodeNav({
  base,
  prevEp,
  nextEp,
}: {
  base: string;
  prevEp: { number: number } | null;
  nextEp: { number: number } | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      {prevEp ? (
        <a
          href={`${base}?b=${prevEp.number}`}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-input bg-background px-3 text-sm font-bold text-foreground transition-colors hover:bg-secondary"
        >
          <ArrowLeft size={15} /> Önceki bölüm
        </a>
      ) : (
        <span />
      )}
      {nextEp ? (
        <a
          href={`${base}?b=${nextEp.number}`}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Sonraki bölüm <ArrowRight size={15} />
        </a>
      ) : (
        <span />
      )}
    </div>
  );
}

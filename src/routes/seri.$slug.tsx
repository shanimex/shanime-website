import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdSlot } from "@/components/AdSlot";
import { fetchShowDetail } from "@/lib/content";

export const Route = createFileRoute("/seri/$slug")({
  head: () => ({
    meta: [
      { title: "shanime | Seri detayı" },
      { name: "description", content: "Serinin bölümleri, karakterleri ve görselleri." },
      { property: "og:title", content: "shanime | Seri detayı" },
      { property: "og:description", content: "Serinin bölümleri, karakterleri ve görselleri." },
      { property: "og:type", content: "video.tv_show" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ShowDetailPage,
  errorComponent: () => <Centered>Bu seri yüklenemedi.</Centered>,
  notFoundComponent: () => <Centered>Bu seri bulunamadı.</Centered>,
});

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-5 text-center">
      <div>
        <p className="text-sm text-muted-foreground">{children}</p>
        <Link to="/" className="mt-4 inline-flex text-sm font-extrabold text-primary">
          Ana sayfaya dön
        </Link>
      </div>
    </div>
  );
}

function ShowDetailPage() {
  const { slug } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["show-detail", slug],
    queryFn: () => fetchShowDetail(slug),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="animate-spin text-primary" size={30} />
      </div>
    );
  }

  if (!data) return <Centered>Bu seri bulunamadı.</Centered>;

  const { show, episodes, characters, gallery } = data;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-5 lg:px-8">
          <Link
            to="/"
            aria-label="shanime ana sayfa"
            className="flex items-center gap-2 rounded-full px-1 py-1"
          >
            <img
              src="/shanime-logo.png"
              alt="shanime logosu"
              width={800}
              height={187}
              loading="eager"
              decoding="async"
              className="h-9 w-auto object-contain sm:h-10"
            />
            <span className="sr-only">shanime</span>
          </Link>
          <Link
            to="/"
            className="flex items-center gap-2 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={16} /> Geri
          </Link>
        </div>
      </header>

      <section className="relative isolate overflow-hidden border-b border-border">
        <img
          src={show.image}
          alt=""
          aria-hidden
          className="absolute inset-0 -z-20 size-full object-cover object-center opacity-40"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-background via-background/85 to-background/40" />
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 md:flex-row md:py-16 lg:px-8">
          <img
            src={show.image}
            alt={`${show.title} kapak görseli`}
            className="w-40 shrink-0 rounded-3xl object-cover shadow-2xl sm:w-52"
          />
          <div className="min-w-0">
            <h1 className="font-display text-4xl leading-none text-accent sm:text-6xl">
              {show.title}
            </h1>
            {show.subtitle && (
              <p className="mt-3 text-sm font-bold text-muted-foreground">{show.subtitle}</p>
            )}
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold text-muted-foreground">
              {show.year && (
                <span className="rounded-full border border-border bg-background px-3 py-1">
                  {show.year}
                </span>
              )}
              {show.genre && (
                <span className="rounded-full border border-border bg-background px-3 py-1">
                  {show.genre}
                </span>
              )}
              {episodes.length > 0 && (
                <span className="rounded-full border border-border bg-background px-3 py-1">
                  {episodes.length} Bölüm
                </span>
              )}
            </div>
            {show.description && (
              <p className="mt-5 max-w-2xl text-sm leading-7 text-foreground md:text-base">
                {show.description}
              </p>
            )}
            {episodes.length > 0 ? (
              <Button asChild variant="hero" size="lg" className="mt-7 rounded-full">
                <a href={`/izle/${show.slug || show.id}?b=${episodes[0]?.number ?? 1}`}>
                  <Play size={17} fill="currentColor" /> Şimdi izle
                </a>
              </Button>
            ) : (
              <Button variant="hero" size="lg" className="mt-7 rounded-full" disabled>
                <Play size={17} fill="currentColor" /> Yakında
              </Button>
            )}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-6xl space-y-16 px-5 py-14 lg:px-8">
        <AdSlot slot="ad_detail_top" className="flex justify-center" />
        <section>
          <h2 className="font-display text-3xl text-foreground">Bölümler</h2>
          {episodes.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Henüz bölüm eklenmedi.</p>
          ) : (
            <ol className="mt-6 divide-y divide-border overflow-hidden rounded-3xl bg-card">
              {episodes.map((ep) => (
                <li key={ep.id} className="flex flex-wrap items-center gap-4 px-6 py-5">
                  <span className="font-display text-3xl text-primary">
                    {String(ep.number).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-extrabold text-foreground">
                      {ep.title || `Bölüm ${ep.number}`}
                    </p>
                    {ep.summary && (
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{ep.summary}</p>
                    )}
                  </div>
                  {ep.duration && (
                    <span className="text-xs font-bold text-muted-foreground">{ep.duration}</span>
                  )}
                  {ep.watch_url && (
                    <Button asChild size="sm" className="rounded-full">
                      <a href={`/izle/${show.slug || show.id}?b=${ep.number}`}>
                        <Play size={14} fill="currentColor" /> İzle
                      </a>
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section>
          <h2 className="font-display text-3xl text-foreground">Karakterler</h2>
          {characters.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Henüz karakter eklenmedi.</p>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
              {characters.map((character) => (
                <article key={character.id} className="overflow-hidden rounded-3xl bg-card">
                  <div className="aspect-[3/4] bg-muted">
                    {character.image && (
                      <img
                        src={character.image}
                        alt={character.name}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="text-sm font-extrabold text-foreground">{character.name}</h3>
                    {character.role && (
                      <p className="mt-1 text-xs text-muted-foreground">{character.role}</p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="font-display text-3xl text-foreground">Görseller</h2>
          {gallery.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Henüz görsel eklenmedi.</p>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3">
              {gallery.map((image) => (
                <figure key={image.id} className="overflow-hidden rounded-3xl bg-card">
                  <img
                    src={image.image}
                    alt={image.caption || show.title}
                    loading="lazy"
                    className="aspect-video w-full object-cover"
                  />
                  {image.caption && (
                    <figcaption className="px-4 py-3 text-xs text-muted-foreground">
                      {image.caption}
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          )}
        </section>

        <AdSlot slot="ad_detail_bottom" className="flex justify-center" />
      </main>

      <footer className="border-t border-border bg-secondary">
        <div className="mx-auto max-w-6xl px-5 py-8 text-center text-xs text-muted-foreground lg:px-8">
          © 2026 shanime · Anime keşfi için tasarlanmıştır.
        </div>
      </footer>
    </div>
  );
}

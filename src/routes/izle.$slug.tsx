import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Home, Loader2, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AdSlot, useAdCode } from "@/components/AdSlot";
import { EpisodeCover } from "@/components/EpisodeCover";
import {
  episodeCoverFromWatchUrl,
  fetchShowDetail,
  localCoverPath,
  showSlug,
  type Episode,
  type SeasonWithEpisodes,
} from "@/lib/content";
import { resolvePosterForEpisode } from "@/lib/episode-covers";

type WatchSearch = { sezon?: number | undefined; b?: number | undefined };

/** Sorgu parametresini pozitif tam sayıya çevirir; geçersizse undefined döner. */
function toPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

export const Route = createFileRoute("/izle/$slug")({
  validateSearch: (search: Record<string, unknown>): WatchSearch => ({
    sezon: toPositiveInt(search["sezon"]),
    b: toPositiveInt(search["b"]),
  }),
  head: () => ({
    meta: [{ title: "shanime | İzle", name: "robots", content: "noindex" }],
  }),
  component: WatchPage,
});

/**
 * Video öncesi bekleme.
 *
 * Bu bekleme YALNIZCA `ad_preroll` slotunda gerçek bir reklam kodu varsa
 * uygulanır. Kod yokken kullanıcı boş bir "reklam" ekranında bekletilmez;
 * aşağıdaki etki geri sayımı sıfıra çeker ve video hemen başlar.
 */
const PREROLL_SECONDS = 5;

function seasonLabel(season: SeasonWithEpisodes): string {
  return season.title.trim() || `${season.number}. Sezon`;
}

function WatchPage() {
  const { slug } = Route.useParams();
  const { sezon, b } = Route.useSearch();
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

  // Panelde `ad_preroll` kodu var mı? Geri sayım kararı buna bağlı.
  const preroll = useAdCode("ad_preroll");
  const prerollHasAd = preroll.isFetched && Boolean(preroll.code);

  // Geri sayım VARSAYILAN OLARAK 0: kod yokken ziyaretçi boş bir "Reklamı geç"
  // ekranında bekletilmez, video hemen başlar. Kod girilmişse bekleme geri gelir.
  const [countdown, setCountdown] = useState(0);

  // Sezonu bölümü olan sezonlar üzerinden çöz: boş bir sezon seçilirse
  // izleyici "bölüm yok" ekranında kalmaz, ilk dolu sezona düşer.
  const playableSeasons: SeasonWithEpisodes[] = (detail?.seasons ?? []).filter(
    (season) => season.episodes.length > 0,
  );
  const ordered = playableSeasons.flatMap((season) =>
    season.episodes.map((episode) => ({ season: season.number, episode })),
  );
  const activeSeason =
    playableSeasons.find((season) => season.number === sezon) ??
    playableSeasons.find((season) => season.episodes.some((episode) => episode.number === b)) ??
    playableSeasons[0] ??
    null;
  const currentEpisode: Episode | null =
    activeSeason?.episodes.find((episode) => episode.number === b) ??
    activeSeason?.episodes[0] ??
    null;
  const currentIndex = currentEpisode
    ? ordered.findIndex((item) => item.episode.id === currentEpisode.id)
    : -1;
  const previous = currentIndex > 0 ? (ordered[currentIndex - 1] ?? null) : null;
  const upcoming =
    currentIndex >= 0 && currentIndex < ordered.length - 1
      ? (ordered[currentIndex + 1] ?? null)
      : null;
  const multipleSeasons = playableSeasons.length > 1;

  // Bölüm değişince (istemci içi geçişte de) bekleme yeniden ayarlanır: geri
  // sayım yalnızca panelde gerçek bir `ad_preroll` kodu varsa kurulur.
  const currentKey = currentEpisode ? `${currentEpisode.season}-${currentEpisode.number}` : "yok";
  useEffect(() => {
    setCountdown(prerollHasAd ? PREROLL_SECONDS : 0);
  }, [currentKey, prerollHasAd]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  // Sekme başlığı: rota başlığı statik ("shanime | İzle") olduğu için seri ve
  // bölüm bilgisi veri hazır olunca burada yazılır.
  useEffect(() => {
    if (!detail) return;
    document.title = currentEpisode
      ? `${detail.show.title} ${currentEpisode.number}. Bölüm izle | shanime`
      : `${detail.show.title} izle | shanime`;
  }, [detail, currentEpisode]);

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
          <Button className="mt-5 rounded-full" onClick={() => void navigate({ to: "/" })}>
            Ana sayfaya dön
          </Button>
        </div>
      </div>
    );
  }

  const { show } = detail;
  const watching = Boolean(currentEpisode?.watch_url) && countdown <= 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-[72px] w-full max-w-[1440px] items-center gap-4 px-4 lg:px-8">
          {/* Yatay dolgu YOK: logonun sol kenarı oynatıcının sol kenarıyla tam
              hizalansın (px-1 iken 3-4 px sağda kalıyordu). */}
          <Link to="/" className="flex items-center gap-2 rounded-full py-1">
            <img
              src="/shanime-logo.png"
              alt="shanime logosu"
              width={800}
              height={187}
              loading="eager"
              decoding="async"
              className="h-9 w-auto object-contain sm:h-10"
            />
            <span className="sr-only">shanime ana sayfa</span>
          </Link>
          {/* Seri adı detay sayfasına götürür. Sağdaki ayrı "Detay" bağlantısı
              kaldırıldı: aynı işi görüyordu ve üst şeridi kalabalıklaştırıyordu. */}
          <Link
            to="/seri/$slug"
            params={{ slug: showSlug(show) }}
            // flex-1 YOK: bu bağlantı eskiden satırın ortasına kadar uzanan boş
            // alanı da tıklanabilir yapıyordu — metnin çok sağında bile imleç
            // "tıklanabilir" görünüyordu. Artık tıklama alanı metnin kendisi.
            className="min-w-0 max-w-[60%] truncate text-sm font-bold text-muted-foreground transition-colors hover:text-accent"
          >
            {show.title}
            {activeSeason && multipleSeasons ? ` · ${seasonLabel(activeSeason)}` : ""}
          </Link>
          <Link
            to="/"
            className="ml-auto flex shrink-0 items-center gap-1.5 text-sm font-bold text-muted-foreground transition-colors hover:text-accent"
          >
            <Home size={16} /> Anasayfa
          </Link>
        </div>
      </header>

      {/* Genişlik, üst şeritle AYNI kapsayıcıyı kullanır: oynatıcının sol kenarı
          logoyla, panelin sağ kenarı "Anasayfa" ile aynı hizada durur. */}
      <main className="mx-auto w-full max-w-[1440px] px-4 py-6 lg:px-8">
        <h1 className="sr-only">
          {show.title}
          {currentEpisode ? ` ${currentEpisode.number}. Bölüm izle` : " izle"}
        </h1>
        <AdSlot slot="ad_watch_top" className="mb-5 flex justify-center" />

        {/* Kapak alanı: oynatıcı normal akışta durur ve YÜKSEKLİĞİ O BELİRLER;
            panel masaüstünde sağa mutlak konumlanır ve `inset-y-0` ile tam
            oynatıcının yüksekliğine oturur — ikisinin alt kenarı birebir denk
            gelir. (Izgara/flex ile "uzatma" denendi: panel içeriği uzun olduğu
            için satırı kendisi büyütüyor ve videonun altında ~890 px boş siyah
            alan kalıyordu.) Sağdaki 340 px dolgu, panelin (320 px) + 20 px
            boşluğun yerini ayırır. */}
        <div className="relative lg:pr-[340px]">
          <PlayerBox
            watching={watching}
            countdown={countdown}
            showTitle={show.title}
            epNumber={currentEpisode?.number ?? 0}
            epUrl={currentEpisode?.watch_url ?? ""}
            onSkip={() => setCountdown(0)}
          />

          {activeSeason && currentEpisode && (
            <EpisodeSidebar
              slug={showSlug(show)}
              seasons={playableSeasons}
              activeSeason={activeSeason}
              currentEpisodeId={currentEpisode.id}
              multipleSeasons={multipleSeasons}
            />
          )}
        </div>

        {/* Bilgi satırı + reklam: oynatıcının altında, oynatıcı genişliğinde. */}
        <div className="mt-4 space-y-4 lg:pr-[340px]">
          {/* Oynatıcının altındaki bilgi satırı (animecix düzeni). */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-foreground sm:text-base">
                {currentEpisode
                  ? `${currentEpisode.number}. Bölüm${currentEpisode.title ? ` · ${currentEpisode.title}` : ""}`
                  : "Bölüm yok"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {show.title}
                {activeSeason && multipleSeasons ? ` · ${seasonLabel(activeSeason)}` : ""}
              </p>
            </div>
            <EpisodeNav
              slug={showSlug(show)}
              multipleSeasons={multipleSeasons}
              previous={previous}
              upcoming={upcoming}
            />
          </div>

          <AdSlot slot="ad_watch_bottom" className="flex justify-center" />
        </div>
      </main>
    </div>
  );
}

/** Oynatıcı + geri sayım ekranı. */
function PlayerBox({
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
          // `sandbox` bilinçli olarak YOK — denendi, geri alındı.
          //
          // Amaç sağlayıcının popunder'ını (yeni sekme açma, sayfa başlığını
          // değiştirme) engellemekti. Ölçüm sonucu: VidMoly oynatıcısı sandbox
          // altında çalışmayı reddediyor ve kutuda "The embed could not be
          // loaded." çıkıyor. Kanıt: aynı iframe, aynı adres, tek fark sandbox —
          // sandbox'sız hâli hem 390×844 hem 1600×1000'de sorunsuz oynuyor,
          // sandbox'lı hâli her iki genişlikte de hata veriyor. Yani bu
          // sağlayıcıyla popunder'ı dışarıdan engellemenin yolu yok; reklamlar
          // sağlayıcının kendi belgesinde kaldığı sürece bu davranış kabul.
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

/** Sağdaki bölüm paneli: sezon seçimi + kaydırılabilir bölüm listesi. */
function EpisodeSidebar({
  slug,
  seasons,
  activeSeason,
  currentEpisodeId,
  multipleSeasons,
}: {
  slug: string;
  seasons: SeasonWithEpisodes[];
  activeSeason: SeasonWithEpisodes;
  currentEpisodeId: string;
  multipleSeasons: boolean;
}) {
  // Ref doğrudan <li> üzerinde tutulur: `Link` bileşeninin ref'i DOM düğümüne
  // iletilmediği için kaydırma çalışmıyordu.
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const navigate = useNavigate();

  // Liste açılırken mevcut bölüm görünür olsun (1000 bölümlük seride şart).
  //
  // `scrollIntoView` BURADA ÇALIŞMIYOR: effect, yerleşim oturmadan çalışıyor ve
  // hiç kaydırma yapmıyor. Bu yüzden kaydırma iki adımda elle yapılır — önce
  // çizimin tamamlanması beklenir, sonra kapsayıcının scrollTop'u hesaplanır.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const list = listRef.current;
      const row = activeRef.current;
      if (!list || !row) return;
      // Mutlak konum yerine fark kullanılır: offsetTop, konumlanmış bir üst
      // öğeye göreli olabilir.
      const offset =
        row.getBoundingClientRect().top -
        list.getBoundingClientRect().top +
        list.scrollTop -
        (list.clientHeight - row.clientHeight) / 2;
      list.scrollTop = Math.max(0, offset);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentEpisodeId]);

  return (
    // Panel, ızgaranın 1. satırında durur; yüksekliğini oynatıcı belirler ve
    // panel ona uzar (alt kenarlar denk gelir). İçerideki liste kalan alanı
    // doldurup kendi içinde kaydırılır — bu yüzden `min-h-0` şart, yoksa liste
    // taşar ve paneli uzatır.
    <aside className="mt-5 flex max-h-[60vh] flex-col lg:absolute lg:inset-y-0 lg:right-0 lg:mt-0 lg:max-h-none lg:w-[320px]">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-extrabold text-foreground">Bölümler</h2>
          {multipleSeasons ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="sr-only">Sezon seç</span>
              <select
                value={activeSeason.number}
                onChange={(event) => {
                  // Sezon değişince o sezonun ilk bölümüne gidilir.
                  const target = seasons.find(
                    (season) => season.number === Number(event.target.value),
                  );
                  const first = target?.episodes[0];
                  if (!first || !target) return;
                  void navigate({
                    to: "/izle/$slug",
                    params: { slug },
                    search: { sezon: target.number, b: first.number },
                  });
                }}
                className="h-8 rounded-lg border border-border bg-background px-2 text-xs font-bold text-foreground outline-none focus:border-accent"
              >
                {seasons.map((season) => (
                  <option key={season.id} value={season.number}>
                    {seasonLabel(season)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="text-xs font-bold text-muted-foreground">
              {activeSeason.episodes.length} bölüm
            </span>
          )}
        </div>

        <div
          ref={listRef}
          // Mobilde liste ekranın %60'ıyla sınırlı; masaüstünde panel zaten
          // oynatıcı yüksekliğinde olduğu için ayrıca sınır gerekmez.
          className="ince-kaydirma max-h-[60vh] min-h-0 flex-1 overflow-y-auto p-1.5 lg:max-h-none"
        >
          <ul className="space-y-0.5">
            {activeSeason.episodes.map((episode) => {
              const active = episode.id === currentEpisodeId;
              return (
                <li key={episode.id} ref={active ? activeRef : undefined}>
                  <Link
                    to="/izle/$slug"
                    params={{ slug }}
                    search={{ sezon: activeSeason.number, b: episode.number }}
                    aria-current={active ? "page" : undefined}
                    // Aktif satır yalnızca dolgu ile belirtilir; çerçeve (ring)
                    // kaldırıldı — çok kalın duruyordu. Renk altın (accent)
                    // kalıyor: sayfadaki KIRMIZI aksiyonlara (oynat, sonraki
                    // bölüm) ayrılmış durumda, seçili durumun onlarla
                    // yarışmaması için altın kullanılıyor.
                    className={`flex items-center gap-2.5 rounded-lg p-1.5 transition-colors ${
                      active ? "bg-accent/15" : "hover:bg-secondary focus-visible:bg-secondary"
                    }`}
                  >
                    <SidebarCover slug={slug} episode={episode} />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-xs font-bold ${active ? "text-accent" : "text-foreground"}`}
                      >
                        {episode.number}. Bölüm
                      </span>
                      {episode.title ? (
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {episode.title}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </aside>
  );
}

/**
 * Paneldeki küçük kapak: oynatıcının karesi, yoksa düz zemin + numara.
 * `onLoad`'a güvenilmez; görsel önbellekten gelirse durum `complete` ile
 * doğrulanır (bkz. EpisodeCard).
 */
function SidebarCover({ slug, episode }: { slug: string; episode: Episode }) {
  return (
    <span className="relative grid aspect-video w-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary">
      <EpisodeCover
        number={episode.number}
        numberClassName="text-[11px] font-bold text-muted-foreground"
        candidates={[
          episode.thumbnail ?? "",
          // Sağlayıcı kapağı bölüm nesnesiyle gelir (sunucuda çözülür).
          episode.poster ?? "",
          episodeCoverFromWatchUrl(episode.watch_url),
          localCoverPath(slug, episode.season, episode.number),
        ]}
        // Kayıtlı adres bayatlamışsa (sağlayıcı CDN'i dönüyor) güncelini çeker.
        resolveFallback={() => resolvePosterForEpisode(episode.watch_url)}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100"
      >
        <span className="grid size-6 place-items-center rounded-full bg-primary/90 text-primary-foreground">
          <Play size={11} fill="currentColor" />
        </span>
      </span>
    </span>
  );
}

/** Önceki / sonraki bölüm düğmeleri. */
function EpisodeNav({
  slug,
  multipleSeasons,
  previous,
  upcoming,
}: {
  slug: string;
  multipleSeasons: boolean;
  previous: { season: number; episode: Episode } | null;
  upcoming: { season: number; episode: Episode } | null;
}) {
  const label = (target: { season: number; episode: Episode }) =>
    multipleSeasons
      ? `S${target.season} · ${target.episode.number}. bölüm`
      : `${target.episode.number}. bölüm`;

  return (
    <div className="flex shrink-0 items-center gap-2">
      {previous ? (
        <Link
          to="/izle/$slug"
          params={{ slug }}
          search={{ sezon: previous.season, b: previous.episode.number }}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-input bg-background px-3 text-sm font-bold text-foreground transition-colors hover:bg-secondary"
        >
          <ArrowLeft size={15} /> Önceki bölüm
          <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
            {label(previous)}
          </span>
        </Link>
      ) : null}
      {upcoming ? (
        <Link
          to="/izle/$slug"
          params={{ slug }}
          search={{ sezon: upcoming.season, b: upcoming.episode.number }}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <span className="hidden text-xs font-normal opacity-80 sm:inline">{label(upcoming)}</span>
          Sonraki bölüm <ArrowRight size={15} />
        </Link>
      ) : null}
    </div>
  );
}

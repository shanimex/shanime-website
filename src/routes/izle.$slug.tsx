import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Home, Loader2, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AdSlot, useAdCode } from "@/components/AdSlot";
import { AdsterraLeaderboard, AdsterraNative } from "@/components/AdsterraUnit";
import { EpisodeCover } from "@/components/EpisodeCover";
import { FluidPlayer, type FluidSubtitle } from "@/components/FluidPlayer";
import { PrerollGate } from "@/components/PrerollGate";
import { SubtitleOverlay } from "@/components/SubtitleOverlay";
import { conventionSubtitlePath } from "@/lib/subtitles";
import { buildProviderUrl, resolveEpisodeEmbed } from "@/lib/embed-provider";
import { prerollVastUrls } from "@/lib/mybid";
import {
  episodeCoverFromWatchUrl,
  fetchShowDetail,
  localCoverPath,
  showSlug,
  type Episode,
  type SeasonWithEpisodes,
} from "@/lib/content";
import { resolvePosterForEpisode } from "@/lib/episode-covers";
import { anizipCover, tmdbIdForMal } from "@/lib/anizip-covers";

/**
 * İzleyicinin seçtiği kaynak.
 *
 * NEDEN VAR: hiçbir sağlayıcı "Japonca ses" ve "Türkçe altyazı"yı birlikte
 * vermiyor (ölçüm 25.09.2026):
 *   · vidsrc.to → altyazı menüsünde Türkçe VAR, ses İngilizce dublaj
 *   · megaplay  → orijinal Japonca ses, altyazı listesinde Türkçe YOK
 *     (4 dizide 12 bölüm tarandı: JJK'da 9 dil var, Türkçe yok)
 * Bu yüzden seçim izleyiciye bırakılır; varsayılan `ACTIVE_EMBED_PROVIDER`.
 */
type WatchSource = "megaplay" | "vidsrc";

type WatchSearch = {
  sezon?: number | undefined;
  b?: number | undefined;
  kaynak?: WatchSource | undefined;
};

/**
 * Kaldırıldı: "Türkçe altyazı" (vidsrc.to) düğmesi.
 *
 * NEDEN: kullanıcı istemedi — o oynatıcı İngilizce dublaj veriyor ve zinciri
 * agresif pop-up açıyor. Türkçe altyazı artık bizden geldiği için
 * (`SubtitleOverlay` + `scripts/sync-tr-subtitles.mjs`) bu seçeneğe gerek yok.
 * `kaynak` parametresi yalnızca elle zorlama için (ör. `?kaynak=vidsrc`) duruyor;
 * arayüzde düğmesi YOK.
 */
function toWatchSource(value: unknown): WatchSource | undefined {
  return value === "megaplay" || value === "vidsrc" ? value : undefined;
}

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
    kaynak: toWatchSource(search["kaynak"]),
  }),
  head: () => ({
    meta: [{ title: "shanime | İzle", name: "robots", content: "noindex" }],
  }),
  component: WatchPage,
});

/**
 * Video öncesi reklam (VAST) etiketleri — MyBid **çift spot** (ad-pod).
 *
 * Kapı GERÇEK video reklamı oynatır: etiket çekilir, reklam mp4'ü oynatılır,
 * "Reklamı geç" geri sayımı biter ve ancak ondan sonra bölüm oynatıcısı yüklenir.
 * Reklam gelmezse kapı beklemeden açılır (ziyaretçi asla reklam yüzünden
 * videoyu izleyemez durumda kalmaz).
 *
 * Adreslerin TEK kaynağı `src/lib/mybid.ts`: gömülü varsayılanlar orada ve
 * `.env` içindeki VITE_MYBID_VAST_1 / VITE_MYBID_VAST_2 onları geçersiz kılar.
 */
const PREROLL_VAST_URLS = prerollVastUrls();

function seasonLabel(season: SeasonWithEpisodes): string {
  return season.title.trim() || `${season.number}. Sezon`;
}

/**
 * Bölümün DOĞRUDAN oynatma adresi (mp4 / m3u8).
 *
 * Fluid Player bir iframe oynatamaz; yalnızca kendi oynatabildiği bir dosya ya
 * da HLS akışıyla çalışır. Bölüm kaydında böyle bir alan yoksa (bugünkü durum)
 * boş döner ve aşağıdaki oynatıcı sağlayıcının embed'ine düşer — yani bu yol
 * eklenmeden hiçbir şey bozulmaz.
 *
 * Devreye almak için `episodes` tablosuna `play_url` (text) kolonu eklenip
 * kendi barındırdığın dosyanın/ HLS adresinin yazılması gerekir.
 */
function directSourceOf(episode: Episode | null): string {
  if (!episode) return "";
  const value = (episode as unknown as { play_url?: unknown }).play_url;
  return typeof value === "string" && /^https?:\/\//i.test(value) ? value : "";
}

/**
 * Bölümün altyazı listesi.
 *
 * `episodes.subtitles` alanı şu biçimde bir JSON dizisi olmalıdır:
 *   [{ "src": "https://.../bolum-1.vtt", "label": "Türkçe", "srclang": "tr" }]
 *
 * DİKKAT: Fluid Player altyazıyı HTML5 <track> ile okur ve <track> yalnızca
 * .vtt destekler; .srt tarayıcıda çalışmaz. .srt dosyaları önce .vtt'ye
 * çevrilmelidir.
 */
function subtitlesOf(episode: Episode | null): FluidSubtitle[] {
  if (!episode) return [];
  const value = (episode as unknown as { subtitles?: unknown }).subtitles;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as { src?: unknown; label?: unknown; srclang?: unknown };
    // Göreli yol da kabul edilir ("/subs/bolum-1.vtt"): dosyayı `public/subs/`
    // altına koymak yeterli olur — kendi alan adımızdan servis edildiği için
    // CORS engeli de çıkmaz. (Sağlayıcıya enjekte edilirken tam adrese çevrilir.)
    const src = typeof entry.src === "string" ? entry.src.trim() : "";
    if (!/^(?:https?:\/\/|\/)/i.test(src)) return [];
    return [
      {
        src,
        label: typeof entry.label === "string" && entry.label ? entry.label : "Altyazı",
        srclang: typeof entry.srclang === "string" && entry.srclang ? entry.srclang : "tr",
        isDefault: index === 0,
      },
    ];
  });
}

function WatchPage() {
  const { slug } = Route.useParams();
  const { sezon, b, kaynak } = Route.useSearch();
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

  // Oynatıcının üstü/altı: panelde kod varsa PANEL kazanır, yoksa koddaki
  // Adsterra birimi devreye girer. Böylece panelden kod değiştirmek yayın
  // gerektirmez, kod boşken de reklam alanı boş kalmaz.
  const watchTop = useAdCode("ad_watch_top");
  const watchBottom = useAdCode("ad_watch_bottom");

  // Video öncesi reklam kapısı: gerçek VAST reklamları oynadıktan sonra açılır.
  const [gateDone, setGateDone] = useState(false);

  // Türkçe altyazı durumu. `available` yalnızca katman dosyayı gerçekten
  // yükleyebildiğinde true olur; düğme o zaman gösterilir (altyazısı olmayan
  // bölümde arayüz sade kalsın). Kanca sırası için BURADA, erken `return`lerden
  // önce tanımlanır.
  const [trSubsAvailable, setTrSubsAvailable] = useState(false);
  const [trSubsOn, setTrSubsOn] = useState(true);

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

  // Oynatıcı kaynağı: doğrudan adres varsa Fluid Player, yoksa sağlayıcı embed'i.
  const directSrc = directSourceOf(currentEpisode);
  const episodeSubtitles = subtitlesOf(currentEpisode);

  // Bölüm değişince (istemci içi geçişte de) reklam kapısı yeniden kurulur.
  const currentKey = currentEpisode ? `${currentEpisode.season}-${currentEpisode.number}` : "yok";
  useEffect(() => {
    setGateDone(false);
  }, [currentKey]);

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

  // Bölümün oynatılacak adresi: ÖNCE kayıttaki `watch_url`, BOŞSA aktif embed
  // sağlayıcısından (megaplay) MAL kimliğiyle üretilir.
  //
  // `watch_url` dolu olduğu sürece `resolveEpisodeEmbed` birebir aynı değeri
  // döndürür → mevcut yayın davranışı değişmez. Sağlayıcı yalnızca watch_url'i
  // boş olan bölümlerde devreye girer (ör. yalnızca MAL kimliğiyle eklenen yeni
  // bölümler).
  const episodeRequest = currentEpisode
    ? {
        malId: show.mal_id ?? null,
        // TMDB kimliği: vidsrc.to şablonu bunu ister (MAL kimliği işe yaramaz).
        // Eşleme `src/data/mal-tmdb.json` içinde derleme zamanında gömülü.
        tmdbId: tmdbIdForMal(show.mal_id),
        season: currentEpisode.season,
        episode: currentEpisode.number,
        // Panelden girilen altyazılar (aynı `episodes.subtitles` alanı) sağlayıcıya
        // da geçirilir: vidsrc.to `?sub.info=` ile KENDİ dosyamızı kabul ediyor.
        // Böylece Türkçe altyazı menüde hazır olur — sağlayıcının yerleşik
        // listesinden Türkçe'yi varsayılan yapmanın başka yolu yok.
        subtitles: episodeSubtitles.map((track) => ({ file: track.src, label: track.label })),
      }
    : null;

  // Kaynak seçimi: izleyici açıkça seçtiyse o kazanır (watch_url ve `@` direktifi
  // yok sayılır), seçmediyse mevcut çözümleme sırası işler.
  const episodeEmbed =
    currentEpisode && episodeRequest
      ? ((kaynak ? buildProviderUrl(kaynak, episodeRequest) : null) ??
        resolveEpisodeEmbed(currentEpisode.watch_url, episodeRequest))
      : null;

  const watching = Boolean(episodeEmbed) && gateDone;

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
        {watchTop.isFetched && watchTop.code ? (
          <AdSlot slot="ad_watch_top" className="mb-5 flex justify-center" />
        ) : (
          <AdsterraLeaderboard className="mb-5" />
        )}

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
            showTitle={show.title}
            epNumber={currentEpisode?.number ?? 0}
            epUrl={episodeEmbed ?? ""}
            directSrc={directSrc}
            subtitles={episodeSubtitles}
            subsOn={trSubsOn}
            onSubsAvailable={setTrSubsAvailable}
            subtitleUrl={
              episodeSubtitles[0]?.src ||
              (currentEpisode
                ? conventionSubtitlePath(
                    showSlug(show),
                    currentEpisode.season,
                    currentEpisode.number,
                  )
                : "")
            }
            vastUrls={PREROLL_VAST_URLS}
            onGateFinish={() => setGateDone(true)}
          />

          {activeSeason && currentEpisode && (
            <EpisodeSidebar
              slug={showSlug(show)}
              seasons={playableSeasons}
              activeSeason={activeSeason}
              currentEpisodeId={currentEpisode.id}
              multipleSeasons={multipleSeasons}
              seriesPoster={show.image}
              malId={show.mal_id ?? null}
            />
          )}
        </div>

        {/* Bilgi satırı + reklam: oynatıcının altında, oynatıcı genişliğinde. */}
        <div className="mt-4 space-y-4 lg:pr-[340px]">
          {/* Altyazı düğmesi — oynatıcının İÇİNDE DEĞİL, ALTINDA durur.
              Neden: oynatıcının içine konduğunda sağlayıcının kendi CC/ayar
              simgeleriyle karışıyordu ("TR altyazı açık" yazısı oynatıcının
              kontrol çubuğunun parçası gibi görünüyordu). Türkçe altyazı dosyası
              olan bölümlerde çıkar; olmayanlarda arayüz sade kalır. */}
          {trSubsAvailable && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setTrSubsOn((value) => !value)}
                className={
                  trSubsOn
                    ? "rounded-full border border-accent bg-accent/15 px-3 py-1 text-[12px] font-bold text-accent"
                    : "rounded-full border border-border px-3 py-1 text-[12px] font-bold text-muted-foreground transition-colors hover:border-accent/60 hover:text-accent"
                }
              >
                {trSubsOn ? "Türkçe altyazı açık" : "Türkçe altyazı kapalı"}
              </button>
              <span className="text-[11px] text-muted-foreground">
                Altyazı oynatıcının kendi altyazısının üstünde gösterilir.
              </span>
            </div>
          )}

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

          {watchBottom.isFetched && watchBottom.code ? (
            <AdSlot slot="ad_watch_bottom" className="flex justify-center" />
          ) : (
            <AdsterraNative className="flex justify-center" />
          )}
        </div>
      </main>
    </div>
  );
}

/** Oynatıcı + video öncesi reklam kapısı. */
function PlayerBox({
  watching,
  showTitle,
  epNumber,
  epUrl,
  directSrc,
  subtitles,
  subtitleUrl,
  subsOn,
  onSubsAvailable,
  vastUrls,
  onGateFinish,
}: {
  watching: boolean;
  showTitle: string;
  epNumber: number;
  epUrl: string;
  /** Doğrudan oynatılabilir adres (mp4/HLS). Varsa Fluid Player kullanılır. */
  directSrc: string;
  /** Fluid Player için VTT altyazı listesi (boş olabilir). */
  subtitles: FluidSubtitle[];
  /**
   * Sağlayıcı iframe'inin ÜSTÜNE çizilecek kendi altyazımız (.vtt/.srt adresi).
   * Bkz. `src/components/SubtitleOverlay.tsx`: megaplay köprüsünden gelen oynatma
   * zamanıyla senkronlanır — yani Türkçe altyazı için video yüklemek gerekmez.
   */
  subtitleUrl: string;
  /** Türkçe altyazı katmanı açık mı? (Düğme oynatıcının ALTINDA durur.) */
  subsOn: boolean;
  /** Altyazı dosyası yüklenebildiyse true — düğme o zaman gösterilir. */
  onSubsAvailable: (available: boolean) => void;
  /** Video öncesi reklam (VAST) etiketleri. */
  vastUrls: string[];
  /** Reklamlar bitince çağrılır; bölüm oynatıcısı o zaman yüklenir. */
  onGateFinish: () => void;
}) {
  // Sağlayıcı iframe'inin ref'i: own altyazı katmanı köprüye bununla komut gönderir.
  const iframeRef = useRef<HTMLIFrameElement>(null);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-black">
      {watching ? (
        directSrc ? (
          // Kendi oynatıcımız. YALNIZCA bölümün doğrudan (mp4/HLS) adresi
          // varsa kullanılır: Fluid Player bir iframe oynatamaz, bu yüzden
          // sağlayıcı embed'leri aşağıdaki dala düşer.
          <FluidPlayer
            src={directSrc}
            title={`${showTitle} bölüm ${epNumber}`}
            subtitles={subtitles}
          />
        ) : (
          // NOT: sağlayıcının üst şeridini ("S01 E01" yazan) KAPATMAK için kendi
          // şeridimizi çizme denemesi yapıldı (25.09.2026) — kullanıcı istemedi,
          // kaldırıldı. Sağlayıcının yazısı cross-origin iframe'in içinde; bizim
          // katmanımız onu boyuyor ve çirkin duruyor. Metin değiştirilemez.
          // `relative` sarmalayıcı: kendi altyazı katmanımız iframe'in üstüne
          // konumlanıyor (bkz. SubtitleOverlay). Üst şerit denemesi gibi bir
          // kaplama DEĞİL — yalnızca altyazı satırı ve küçük bir aç/kapa düğmesi.
          <div className="relative">
            <iframe
              ref={iframeRef}
              src={epUrl}
              title={`${showTitle} bölüm ${epNumber}`}
              loading="lazy"
              // `sandbox` YOK — popunder'ı engellemek için DENENDİ ve BAŞARISIZ OLDU.
              //
              // Ölçüm (25.09.2026 · aynı URL + aynı sayfa + aynı referrer,
              // TEK değişken `sandbox`):
              //   sandbox="allow-scripts allow-same-origin allow-forms
              //            allow-presentation allow-orientation-lock"
              //   → Streamtape: "Client blocked! / Your browser or the embed you are
              //     viewing are doing nasty things!"  (sandbox'ı ALGILIYOR)
              //   → VidMoly:    "The embed could not be loaded."
              //   → sandbox'SIZ aynı iframe: VidMoly gerçek oynatıcıyı yüklüyor
              //     (poster + play), Streamtape CAPTCHA kapısına geliyor.
              //
              // Yani sağlayıcılar sandbox'lı embed'i reddediyor → "popup engelle +
              // video oynat" birlikte MÜMKÜN DEĞİL. Embed'in kendi belgesi içindeki
              // davranış dışarıdan kontrol edilemiyor. Kanıt: OYNATICI-FLUIDPLAYER.md §6.
              //
              // vidsrc.to için de DENENDİ (25.09.2026) — İKİ AYRI ENGEL var:
              //  1) Zincirin ikinci halkası `vsembed.ru`, `/assets/sbx.js` adlı bir
              //     "Sandbox-embed blocker" yüklüyor (kendi yorumu birebir:
              //     "If that page is loaded inside an <iframe sandbox> ... this frame
              //      is redirected to /sandbox.php?ref=<embedding host>").
              //  2) A/B ölçümü (aynı sayfa, 3 hücre: sandbox'suz · allow-same-origin'li
              //     sandbox · allow-same-origin'siz sandbox): HER İKİ sandbox
              //     varyantında en içteki oynatıcı şunu yazdı —
              //     "This content can't be embedded in a sandboxed frame /
              //      The player was loaded inside an <iframe sandbox>, which isn't
              //      permitted."
              //     (sandbox'suz aynı adres gerçek oynatıcıyı getirdi.)
              // Sonuç: vidsrc'te pop-up'ı sandbox ile engellemek MÜMKÜN DEĞİL.
              // Pop, sağlayıcının kendi belgesi içinde oluşturuluyor (window.open
              // hook'u + gizli iframe + localStorage 60 sn soğuma).
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
              // bg-black: iframe kendi belgesini boyayana kadar geçen sürede
              // tarayıcının varsayılan BEYAZ zeminini görmemek için (iOS'ta beyaz
              // kenar/çerçeve gibi görünüyordu). Sarmalayıcı da siyah.
              className="aspect-video w-full bg-black"
            />

            {/* Kendi Türkçe altyazı katmanımız. Yalnızca köprüyü destekleyen
              sağlayıcıda (megaplay) ve altyazı adresi varsa çalışır. */}
            <SubtitleOverlay
              frameRef={iframeRef}
              url={subtitleUrl}
              active={epUrl.includes("megaplay.buzz")}
              on={subsOn}
              onAvailable={onSubsAvailable}
            />
          </div>
        )
      ) : epUrl ? (
        <PrerollGate
          vastUrls={vastUrls}
          title={`${showTitle} bölüm ${epNumber}`}
          onFinish={onGateFinish}
        />
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 bg-black/90 px-6 text-center">
          <p className="text-sm text-muted-foreground">Bu bölüm için video henüz eklenmedi.</p>
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
  seriesPoster,
  malId,
}: {
  slug: string;
  seasons: SeasonWithEpisodes[];
  activeSeason: SeasonWithEpisodes;
  currentEpisodeId: string;
  multipleSeasons: boolean;
  /** Seri posteri: kapağı üretilemeyen bölümler için son çare (bkz. EpisodeCard). */
  seriesPoster?: string | undefined;
  /** MAL kimliği: bölüme ait gerçek görseli (ani.zip) kullanmak için (bkz. EpisodeCard). */
  malId?: number | null | undefined;
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
                    <SidebarCover
                      slug={slug}
                      episode={episode}
                      seriesPoster={seriesPoster}
                      malId={malId}
                    />
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
function SidebarCover({
  slug,
  episode,
  seriesPoster,
  malId,
}: {
  slug: string;
  episode: Episode;
  /** Zincirin son adımı — bkz. EpisodeCard'daki `seriesPoster` açıklaması. */
  seriesPoster?: string | undefined;
  /** Bölüme ait gerçek görsel (ani.zip) — bkz. `src/lib/anizip-covers.ts`. */
  malId?: number | null | undefined;
}) {
  return (
    <span className="relative grid aspect-video w-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary">
      <EpisodeCover
        number={episode.number}
        numberClassName="text-[11px] font-bold text-muted-foreground"
        candidates={[
          episode.thumbnail ?? "",
          // Sağlayıcı kapağı bölüm nesnesiyle gelir (sunucuda çözülür).
          episode.poster ?? "",
          // Bölüme ait GERÇEK görsel (ani.zip/TVDB, derleme zamanında gömülü).
          anizipCover(malId, episode.season, episode.number),
          episodeCoverFromWatchUrl(episode.watch_url),
          localCoverPath(slug, episode.season, episode.number),
          // Son çare: seri posteri (sağlayıcı kapağı üretilemeyen bölümler için).
          seriesPoster ?? "",
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

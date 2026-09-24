import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ChevronLeft, ChevronRight, Menu, Play, Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { AdSlot } from "@/components/AdSlot";
import { fetchShowDetail, fetchShows, showSlug, type ShowWithImage } from "@/lib/content";

/**
 * Statik dosya düzeni (public/static/anime-data/<slug>/):
 *   anime-cover.jpg   → grid kartı kapağı (veritabanındaki image_path ile aynı)
 *   anime-header.jpg  → vitrin arka planı (geniş, dikey kapak hero'da kırpılır)
 *   anime-header.mp4  → vitrin arka plan videosu (varsa)
 *   anime-logo.png    → vitrin başlığı (yoksa .svg, o da yoksa düz yazı)
 * Klasör adı her zaman seri slug'ıdır; harita/liste tutulmaz.
 */
const STATIC_DIR = "/static/anime-data";

/**
 * Vitrinde her slaytın ekranda kalma süresi.
 *
 * Süre dağılımı: ilk 6 sn fotoğraf + yazı (HERO_VIDEO_DELAY), sonrasında video
 * görünür. 6 → 24 sn arası = **video 18 saniye** ekranda kalır. Video bundan
 * uzun olsa bile bu sürede kesilir; fazlası indirilmez (aşağıdaki nota bak).
 */
const HERO_AUTO_MS = 24_000; // 24 sn (video 18 sn görünür)

/**
 * Logo uzantısı seriden seriye değişiyor (.png veya .svg). Vitrin slaytı her
 * döndüğünde `ShowLogo` yeniden kurulduğu için, bulunan adres burada hatırlanır:
 * aynı tarayıcı oturumunda her seri için en fazla bir kez deneme yapılır.
 *
 * (Yalnızca statik dosya yollarını tutar; kişisel veri saklamaz. Sunucuda her
 * istek kendi modül örneğini kullandığı için istekler arası sızma olmaz.)
 */
const LOGO_RESOLVED = new Map<string, string>();

/**
 * Vitrinin koyu zemininde HARFLERİ KAYBOLAN logolar. Beyaz kontur yalnızca
 * bunlara uygulanır; renkli/aydınlık logolarda kontur görüntüyü bozuyordu.
 * Yeni bir koyu logo eklenirse slug'ını buraya yazmak yeterli.
 */
const LOGO_NEEDS_OUTLINE = new Set(["mushoku-tensei"]);

/** Vitrin başlığı: `.png` → `.svg` → düz yazı. Her seri kendi logosunu taşır. */
function ShowLogo({
  slug,
  title,
  className,
}: {
  slug?: string | null;
  title: string;
  className?: string;
}) {
  // Sıra tek yerde tutulur, seri listesi tutulmaz.
  const sources = useMemo(
    () =>
      slug ? [`${STATIC_DIR}/${slug}/anime-logo.png`, `${STATIC_DIR}/${slug}/anime-logo.svg`] : [],
    [slug],
  );
  // Kaçıncı kaynakta olduğumuz: 0 = .png, 1 = .svg, 2+ = logo yok (düz yazı).
  // Daha önce bulunmuşsa doğrudan oradan başlanır; boşa istek gitmez.
  const [step, setStep] = useState(() => {
    const known = slug ? LOGO_RESOLVED.get(slug) : undefined;
    const index = known ? sources.indexOf(known) : -1;
    return index > 0 ? index : 0;
  });

  const source = sources[step];
  const imgRef = useRef<HTMLImageElement>(null);
  // SSR'da sunucu HTML'e ilk kaynağı (.png) koyar. O dosya yoksa tarayıcı hatayı
  // React hidrasyondan ÖNCE alır ve `onError` hiç çalışmaz → ekranda kırık resim
  // simgesi + alt metin kalır (nadiren, tamamen yarışa bağlı). Bu yüzden kaynak
  // her değiştiğinde durum elle de kontrol edilir.
  useEffect(() => {
    const node = imgRef.current;
    if (node && node.complete && node.naturalWidth === 0) {
      setStep((value) => value + 1);
    }
  }, [source]);

  if (!source) {
    // Logosu olmayan seri: beyaz, kalın ve gölgeli düz yazı başlık.
    // (Sayfanın tek h1'i kendisine ait; bu yüzden burada başlık değil metin.)
    return <span className="hero-title">{title.toLocaleUpperCase("tr")}</span>;
  }
  return (
    <img
      // Kaynak değişince <img> yeniden kurulsun; yoksa tarayıcı hatayı taşır.
      key={source}
      ref={imgRef}
      src={source}
      alt={`${title} logosu`}
      width={800}
      height={187}
      loading="eager"
      decoding="async"
      onLoad={() => {
        if (slug) LOGO_RESOLVED.set(slug, source);
      }}
      onError={() => setStep((value) => value + 1)}
      className={`${className ?? ""}${
        slug && LOGO_NEEDS_OUTLINE.has(slug) ? " hero-logo--outline" : ""
      }`}
    />
  );
}

/** Vitrin arka planı: dikey kapaklar hero'da kötü kırpılıyor, geniş header'lar kullanılır. */
function heroBackdrop(slug: string | null | undefined, fallback: string): string {
  return slug ? `${STATIC_DIR}/${slug}/anime-header.jpg` : fallback;
}

/** Vitrin arka plan videoları: eski sitede hero'da video oynatıyordu.
 *  Sadece aktif slaytın videosu indirilir/oynatılır; dosya yoksa jpg kalır. */
function heroVideo(slug: string | null | undefined): string | undefined {
  return slug ? `${STATIC_DIR}/${slug}/anime-header.mp4` : undefined;
}

// No head() here: the home route inherits title/description/og/twitter from
// __root.tsx, and ships no og:image so serve-time hosting can inject the
// project's social preview (explicit og:image or latest screenshot).
export const Route = createFileRoute("/")({
  // Vitrin verisi loader'da gelir; sayfa SUNUCUDA gerçek slaytlarla render edilir.
  // Böylece ilk anda projedeki yedek/statik görseller görünüp sonra gerçek slayta
  // atlamaz — "yenileyince önce başka slayt, sonra başlangıç slaytı" hatasının
  // ve eski görsellerin göz kırpması gibi görünmesinin sebebi buydu.
  loader: () => fetchShows(),
  staleTime: 5 * 60_000,
  head: () => ({
    meta: [
      { title: "Ana Sayfa - shanime" },
      {
        name: "description",
        content: "Sezonun öne çıkan anime serilerini keşfet ve yeni favorini bul.",
      },
      { property: "og:title", content: "shanime | Anime keşfi" },
      {
        property: "og:description",
        content: "Sezonun öne çıkan anime serilerini keşfet ve yeni favorini bul.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

// Veritabanı boşsa veya yüklenemediyse gösterilen yedek içerik.
// slug'lar gerçek seri slug'larıyla aynı tutulur ki hero logosu ve
// seri bağlantıları yedek modda da çalışsın. Görseller demo değil, sitenin
// kendi static dosyalarıdır (veritabanındaki yollarla birebir aynı).
const fallbackHero = {
  id: undefined,
  slug: "jujutsu-kaisen",
  title: "Jujutsu Kaisen",
  subtitle: "Lanetler, büyücüler ve büyük bir hesaplaşma",
  image: `${STATIC_DIR}/jujutsu-kaisen/anime-cover.jpg`,
  banner_image: undefined,
  is_featured: false,
  episode_count: 0,
  year: "2020",
  genre: "Aksiyon, Shounen, Korku, Doğaüstü, Fantastik",
  description:
    "Lanetli enerjiyle örülü bir dünyada, genç bir büyücü her savaştan sonra kendine biraz daha yaklaşır.",
};

const fallbackShows = [
  fallbackHero,
  {
    id: undefined,
    slug: "re-zero",
    title: "Re:Zero",
    subtitle: "Başka bir dünyada sıfırdan başlamak",
    image: `${STATIC_DIR}/re-zero/anime-cover.jpg`,
    banner_image: undefined,
    episode_count: 0,
    is_featured: false,
    year: "2016",
    genre: "Başka Dünya, Drama, Psikolojik, Fantastik, Gerilim",
    description:
      "Öldükçe aynı güne dönen Subaru, sevdiklerini kurtarmak için zaman döngüsünün acı gerçeğini çözmek zorundadır.",
  },
  {
    id: undefined,
    slug: "mushoku-tensei",
    title: "Mushoku Tensei",
    subtitle: "İkinci bir hayat, sınırsız bir dünya",
    image: `${STATIC_DIR}/mushoku-tensei/anime-cover.jpg`,
    banner_image: undefined,
    episode_count: 0,
    is_featured: false,
    year: "2021",
    genre: "Başka Dünya, Drama, Aksiyon, Macera, Fantastik",
    description:
      "İşsiz, umutsuz bir adam yeni bir dünyada bebek olarak doğar; bu kez hatalarını telafi etmeye kararlıdır.",
  },
  {
    id: undefined,
    slug: "erased",
    title: "Erased",
    subtitle: "Geçmişe uzanan karanlık bir gizem",
    image: `${STATIC_DIR}/erased/anime-cover.jpg`,
    banner_image: undefined,
    episode_count: 0,
    is_featured: false,
    year: "2016",
    genre: "Drama, Psikolojik, Gerilim",
    description:
      "Geçmişe dönebilen bir manga yazarı, çocukluğunda yaşanan bir faciayı önlemek için zamana karşı yarışır.",
  },
];

/** Vitrinde gösterilen kart: veritabanından gelen seri ya da yedek içerik. */
type HeroCard = ShowWithImage | typeof fallbackHero;

/** Tür filtresinin "hepsi" etiketi. */
const ALL_GENRES = "Tümü";
function Index() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState(ALL_GENRES);
  const searchRef = useRef<HTMLInputElement>(null);
  const desktopSearchRef = useRef<HTMLDivElement>(null);
  const mobileSearchRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  // Veri loader'dan gelir (sunucuda çekilmiş) — "yükleniyor" ara durumu yok.
  const dbShows = Route.useLoaderData();
  const shows: HeroCard[] = dbShows && dbShows.length > 0 ? dbShows : fallbackShows;

  // Vitrin slider'ı: panelde "Vitrin'de göster" işaretli seriler döner.
  // Hiçbiri işaretli değilse tüm seriler sırayla gösterilir.
  const featuredShows = shows.filter((show) => show.is_featured);
  const heroShows: HeroCard[] = featuredShows.length > 0 ? featuredShows : shows;

  const [heroIndex, setHeroIndex] = useState(0);
  // Sürükleme sırasında slaytların yatay kayması (yüzde) ve tutma durumu.
  const [dragX, setDragX] = useState<number | null>(null);
  const [heroDragging, setHeroDragging] = useState(false);
  // Eski sitedeki gibi: veri tasarrufu / çok yavaş bağlantı / dokunmatik
  // cihazlarda ve hareket azaltma modunda hero videosu hiç indirilmez.
  const [allowVideo, setAllowVideo] = useState(false);
  useEffect(() => {
    const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } })
      .connection;
    const skip =
      conn?.saveData === true ||
      conn?.effectiveType === "2g" ||
      window.matchMedia("(hover: none)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!skip) setAllowVideo(true);
  }, []);
  const heroRef = useRef<HTMLElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const safeIndex = heroShows.length > 0 ? heroIndex % heroShows.length : 0;
  // Header görseli ya da videosu olmayan seride 404 isteğiyle uğraşmamak için
  // hata alınan dosya kaydedilir ve kapak görseline düşülür.
  const [brokenBackdrops, setBrokenBackdrops] = useState<Record<string, boolean>>({});
  const [brokenVideos, setBrokenVideos] = useState<Record<string, boolean>>({});
  // Akış: slayt açılır → bir süre FOTOĞRAF görünür → açıklama bilgileri
  // animasyonla kapanır (grid-template-rows 0fr + opacity, 0.6 sn) → tam o anda
  // video medya olarak devreye girer (opacity 0.6 sn); geriye logo + butonlar kalır.
  // Vitrin medya akışı (sonanime.com'da ölçülerek eşlendi):
  //   1. AŞAMA — slayt aktif olur, önce SADECE fotoğraf görünür, yazı açık.
  //   2. AŞAMA — 3 sn sonra video DOM'a girer.
  //   3. AŞAMA — video GERÇEKTEN oynamaya başladığı an yazı animasyonla kapanır
  //               ve video görünür olur (ikisi senkron).
  // Fotoğraf + yazı bu süre boyunca görünür; sonra video girip yazı kapanır.
  const HERO_VIDEO_DELAY = 6000;
  const [videoArmed, setVideoArmed] = useState(false);
  const [videoPhase, setVideoPhase] = useState<"waiting" | "playing">("waiting");
  const [videoVisibleKey, setVideoVisibleKey] = useState<string | null>(null);
  useEffect(() => {
    // Yeni slaytın yazısı hemen açılsın.
    setVideoArmed(false);
    setVideoPhase("waiting");
    let armTimer: number | undefined;
    if (allowVideo) {
      armTimer = window.setTimeout(() => setVideoArmed(true), HERO_VIDEO_DELAY);
    }
    // ÇIKAN slaytın videosu fade (1.2 sn) boyunca ekranda kalsın. Hemen
    // sıfırlarsak geçiş anında video kayboluyor, yerine eski fotoğraf geliyor
    // ve "video kapandı, resim geri geldi" görüntüsü oluşuyor.
    const clearTimer = window.setTimeout(() => setVideoVisibleKey(null), 1300);
    return () => {
      if (armTimer) window.clearTimeout(armTimer);
      window.clearTimeout(clearTimer);
    };
  }, [safeIndex, allowVideo]);

  // Geçiş: sonanime.com'da ölçtüğüm gibi opacity FADE (1.2 sn, CSS'te tanımlı).
  // Kayma yok; sürükleme sırasında slaytlar yine parmağı takip eder.

  // Nokta, ok, parmak ve klavye aynı fade geçişinden geçsin diye tek kapı: goTo.
  const goTo = useCallback(
    (target: number) => {
      if (heroShows.length < 2) return;
      setHeroIndex(((target % heroShows.length) + heroShows.length) % heroShows.length);
    },
    [heroShows.length],
  );
  const goNext = useCallback(() => goTo(safeIndex + 1), [goTo, safeIndex]);
  const goPrev = useCallback(() => goTo(safeIndex - 1), [goTo, safeIndex]);

  // Otomatik dönüş: her slayt ekranda kalır. Sonanime'de video oynarken de
  // dönüş devam ediyor; bu yüzden burada SADECE sürükleme durdurur.
  useEffect(() => {
    if (heroShows.length < 2 || heroDragging) return;
    const timer = window.setTimeout(goNext, HERO_AUTO_MS);
    return () => window.clearTimeout(timer);
  }, [heroShows.length, heroDragging, goNext]);

  // Vitrin ekrandayken ←/→ tuşları slaytı çevirir (metin alanlarında devre dışı).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      const rect = heroRef.current?.getBoundingClientRect();
      if (!rect || rect.bottom < 80 || rect.top > window.innerHeight) return;
      event.preventDefault();
      if (event.key === "ArrowLeft") goPrev();
      else goNext();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrev]);

  /** Sürükleme bırakıldığında slayt değişsin diye gereken eşik (hero genişliğinin %'si). */
  const DRAG_THRESHOLD = 10;

  /** Fare/parmağın hero genişliğine göre yatay kayması (yüzde). */
  function dragPercent(clientX: number) {
    const width = heroRef.current?.getBoundingClientRect().width ?? 1;
    return ((clientX - (dragStart.current?.x ?? clientX)) / width) * 100;
  }

  function onHeroPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (heroShows.length < 2) return;
    // Bağlantı ve butonlar kendi tıklamasını alsın: sürükleme görselin üstünde başlar.
    const target = event.target as HTMLElement | null;
    if (target?.closest("a, button")) return;
    dragStart.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    setHeroDragging(true);
    setDragX(0);
  }

  function onHeroPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const start = dragStart.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // Dokunmatikte dikey hareket sayfa kaydırmadır: sürüklemeyi bırak.
    // Farede böyle bir çakışma yok; dikey titreme sürüklemeyi iptal etmemeli,
    // çünkü iptal edilince el (grabbing) imleci de bir anda kayboluyordu.
    if (event.pointerType !== "mouse" && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 24) {
      dragStart.current = null;
      setHeroDragging(false);
      setDragX(null);
      return;
    }
    setDragX(Math.max(-100, Math.min(100, dragPercent(event.clientX))));
  }

  function onHeroPointerUp() {
    const start = dragStart.current;
    dragStart.current = null;
    setHeroDragging(false);
    const shift = dragX ?? 0;
    setDragX(null);
    if (!start || Math.abs(shift) < DRAG_THRESHOLD) return;
    if (shift < 0) goNext();
    else goPrev();
  }

  function onHeroPointerCancel() {
    dragStart.current = null;
    setHeroDragging(false);
    setDragX(null);
  }

  // Sürükleme sırasında aktif slayt parmağı takip eder, komşu slayt kenardan girer.
  function backdropDragStyle(index: number): CSSProperties | undefined {
    if (dragX === null || heroShows.length < 2) return undefined;
    const total = heroShows.length;
    const prev = (safeIndex - 1 + total) % total;
    const next = (safeIndex + 1) % total;
    // DİKKAT: slaytlar normalde `visibility: hidden` (CSS). Sürükleme sırasında
    // komşu slaytın görünmesi için burada açıkça `visible` yapılmalı; yoksa
    // parmakla kaydırınca aktif slayt çekilir ve yerinde SİYAH kalır.
    if (index === safeIndex) {
      return {
        transform: `translateX(${dragX}%)`,
        opacity: 1,
        visibility: "visible",
        transition: "none",
      };
    }
    if (dragX > 0 && index === prev) {
      return {
        transform: `translateX(${dragX - 100}%)`,
        opacity: 1,
        visibility: "visible",
        transition: "none",
      };
    }
    if (dragX < 0 && index === next) {
      return {
        transform: `translateX(${dragX + 100}%)`,
        opacity: 1,
        visibility: "visible",
        transition: "none",
      };
    }
    // Sürüklenmeyen komşular kendi hâlinde (gizli) kalır.
    return { transition: "none" };
  }

  // Not: içerik artık slaytın İÇİNDE olduğu için ayrı bir sürükleme stiline gerek
  // yok; slaytın kendi `translateX`'i yazıyı da birlikte taşıyor.

  // Türler serilerin kendi verisinden türetilir; sahte sabit liste yok.
  const genreOptions = useMemo(() => {
    const set = new Set<string>();
    for (const show of shows) {
      for (const part of (show.genre ?? "").split(",")) {
        const value = part.trim();
        if (value) set.add(value);
      }
    }
    return [ALL_GENRES, ...Array.from(set).sort((a, b) => a.localeCompare(b, "tr"))];
  }, [shows]);

  const filtered = shows.filter((show) => {
    const matchesQuery = show.title.toLocaleLowerCase("tr").includes(query.toLocaleLowerCase("tr"));
    const matchesGenre =
      genre === ALL_GENRES ||
      (show.genre ?? "")
        .split(",")
        .map((part) => part.trim())
        .includes(genre);
    return matchesQuery && matchesGenre;
  });

  const isFiltering = query.trim().length > 0 || genre !== ALL_GENRES;

  const openSearch = () => {
    setSearchOpen(true);
    // Panel açılır açılmaz odağı kutuya ver (mobil klavye de açılır).
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  // Arama açıkken ESC ile kapat + dışarı tıklayınca kapat.
  useEffect(() => {
    if (!searchOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSearchOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      const inDesktop = desktopSearchRef.current?.contains(target) ?? false;
      const inMobile = mobileSearchRef.current?.contains(target) ?? false;
      if (!inDesktop && !inMobile) setSearchOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [searchOpen]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between gap-5 px-5 lg:px-8">
          <a
            href="#top"
            aria-label="shanime ana sayfa"
            className="ui-hover flex items-center gap-2 rounded-full px-1 py-1"
          >
            <img
              src="/shanime-logo.png"
              alt="shanime logosu"
              width={800}
              height={187}
              loading="eager"
              decoding="async"
              className="h-10 w-auto object-contain sm:h-12"
            />
            <span className="sr-only">shanime</span>
          </a>
          <nav aria-label="Ana navigasyon" className="hidden items-center gap-8 md:flex">
            <a href="#top" className="link-hover text-base font-extrabold text-accent">
              Ana sayfa
            </a>
            <a
              href="#series"
              className="link-hover text-base font-bold text-muted-foreground transition-colors hover:text-foreground"
            >
              Seriler
            </a>
            <a
              href="#season"
              className="link-hover text-base font-bold text-muted-foreground transition-colors hover:text-foreground"
            >
              Bu sezon
            </a>
          </nav>
          <div className="relative hidden items-center gap-3 md:flex">
            <Button
              variant="ghost"
              size="icon"
              className={`search-button rounded-full bg-secondary ${searchOpen ? "is-open" : ""}`}
              aria-label={searchOpen ? "Aramayı kapat" : "Anime ara"}
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen((open) => !open)}
            >
              <Search className="search-button-icon" size={18} />
            </Button>
            <Button
              onClick={() =>
                document.querySelector("#genres")?.scrollIntoView({ behavior: "smooth" })
              }
              className="ui-hover hero-btn"
            >
              Keşfet
            </Button>
            {searchOpen && (
              <div className="absolute right-16 top-14 z-50 w-80 rounded-3xl border border-border bg-popover p-4 shadow-2xl motion-safe:animate-pop-in motion-reduce:animate-none">
                <div className="flex items-center gap-2 rounded-full border-2 border-primary px-4">
                  <Search size={17} className="text-muted-foreground" />
                  <label className="sr-only" htmlFor="search">
                    Anime ara
                  </label>
                  <input
                    id="search"
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Anime ara..."
                    className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />
                </div>
                <div className="mt-3 space-y-1">
                  {(query ? filtered : shows).map((show) => (
                    <a
                      href="#series"
                      key={show.title}
                      className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-secondary"
                    >
                      <img
                        src={show.image}
                        alt=""
                        width={40}
                        height={52}
                        className="h-12 w-9 rounded-md object-cover"
                      />
                      <span>
                        <strong className="block text-sm">{show.title}</strong>
                        <span className="text-xs text-muted-foreground">Anime · Seri</span>
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden icon-btn"
            aria-label={menuOpen ? "Menüyü kapat" : "Menüyü aç"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span
              key={menuOpen ? "close" : "menu"}
              className="grid place-items-center motion-safe:animate-[icon-swap_200ms_cubic-bezier(0.22,1,0.36,1)_both]"
            >
              {menuOpen ? (
                <X size={21} aria-hidden="true" />
              ) : (
                <Menu size={21} aria-hidden="true" />
              )}
            </span>
          </Button>
        </div>
        {menuOpen && (
          <nav
            ref={mobileSearchRef}
            className="flex flex-col border-t border-border px-5 py-4 motion-safe:animate-pop-in motion-reduce:animate-none md:hidden"
          >
            <a className="py-3 font-bold text-primary" href="#top">
              Ana sayfa
            </a>
            <a className="py-3 font-bold" href="#series">
              Seriler
            </a>
            <a className="py-3 font-bold" href="#season">
              Bu sezon
            </a>
          </nav>
        )}
      </header>

      <main id="top">
        <section
          ref={heroRef}
          aria-label="Vitrin"
          className={`hero-section ${heroDragging ? "hero-dragging is-dragging" : ""}`}
          onPointerDown={onHeroPointerDown}
          onPointerMove={onHeroPointerMove}
          onPointerUp={onHeroPointerUp}
          onPointerCancel={onHeroPointerCancel}
        >
          {/* Sayfanın tek h1'i: vitrindeki seri başlıkları h1 değil, vitrin
              içeriği olduğu için h1 kirliliği yapmaz. */}
          <h1 className="sr-only">shanime — sezonun öne çıkan anime serileri</h1>
          {heroShows.map((show, index) => {
            const key = show.slug ?? show.title;
            // Dikey kapak hero'da kırpılıyor: önce geniş header, dosya yoksa kapak.
            // Öncelik: admin'den yüklenen vitrin banner'ı → statik header → kapak.
            const backdrop = brokenBackdrops[key]
              ? show.image
              : show.banner_image || heroBackdrop(show.slug, show.image);
            const uploaded =
              "banner_video" in show && show.banner_video ? show.banner_video : undefined;
            const videoUrl = brokenVideos[key] ? undefined : uploaded || heroVideo(show.slug);
            const active = index === safeIndex;
            const slideHasVideo = Boolean(videoUrl) && allowVideo && !brokenVideos[key];
            // Aktif slayt: 6 sn sonra video girer.
            // Çıkan slayt: fade bitene kadar videosu takılı kalsın (videoVisibleKey
            // ile işaretli); yoksa geçiş anında video kaybolup eski fotoğraf görünür.
            const videoActive =
              slideHasVideo && ((active && videoArmed) || videoVisibleKey === key);
            // Yazı, video GERÇEKTEN oynamaya başlayınca kapanır. Çıkan slaytta ise
            // fade bitene kadar kapalı kalır; yoksa fade sırasında yazı yeniden
            // açılıp görüntü bozuluyor.
            const contentCollapsed =
              slideHasVideo && (active ? videoPhase === "playing" : videoVisibleKey === key);
            return (
              <div
                key={key}
                aria-hidden={!active}
                style={backdropDragStyle(index)}
                className={`hero-slide ${active ? "active" : ""}`}
              >
                <img
                  src={backdrop}
                  alt={active ? `${show.title} sahnesi` : ""}
                  width={1536}
                  height={864}
                  loading={index === 0 ? "eager" : "lazy"}
                  fetchPriority={index === 0 ? "high" : "low"}
                  decoding="async"
                  draggable={false}
                  onError={() => setBrokenBackdrops((map) => ({ ...map, [key]: true }))}
                  className="hero-image"
                />
                {/* Video, görselin üstüne biner; oynamaya başlayınca yumuşakça görünür. */}
                {videoActive && (
                  <video
                    className={`hero-video ${videoVisibleKey === key ? "is-visible" : ""}`}
                    src={videoUrl}
                    muted
                    loop
                    playsInline
                    autoPlay
                    preload="metadata"
                    tabIndex={-1}
                    aria-hidden="true"
                    onPlaying={() => {
                      // Görünürlük + yazının kapanması aynı anda tetiklenir.
                      setVideoVisibleKey(key);
                      setVideoPhase("playing");
                    }}
                    onError={() => {
                      setBrokenVideos((map) => ({ ...map, [key]: true }));
                      setVideoVisibleKey((k) => (k === key ? null : k));
                    }}
                  />
                )}
                {/* Karartma: soldan yatay + alttan yumuşak geçiş (sert çizgi yok).
                    Slaytın İÇİNDE: böylece karartma da yazıyla birlikte soluyor. */}
                <div className="hero-gradient pointer-events-none" />
                {/* YAZI SLAYTIN İÇİNDE — kritik nokta bu. Eskiden içerik slaytların
                    kardeşiydi ve slayt değişiminde anında değişiyordu; resim 1.2 sn
                    solarken yeni yazı eski sahnenin üstünde beliriyordu. Artık
                    slaytın parçası olduğu için resimle AYNI anda soluyor. */}
                <div className={`hero-content ${contentCollapsed ? "is-video-playing" : ""}`}>
                  <span className="hero-featured-badge">Öne çıkanlar</span>
                  <ShowLogo slug={show.slug} title={show.title} className="hero-logo" />
                  <div className="hero-details">
                    <div className="hero-details-inner">
                      {/* sonanime'deki "yıl · bölüm sayısı" satırının karşılığı. */}
                      <div className="hero-meta">
                        {show.year && <span>{show.year}</span>}
                        {show.id && show.episode_count > 0 && (
                          <span>{show.episode_count} bölüm</span>
                        )}
                      </div>
                      {show.genre && (
                        <div className="hero-genres">
                          {show.genre
                            .split(",")
                            .map((part) => part.trim())
                            .filter(Boolean)
                            .slice(0, 4)
                            .map((genreName) => (
                              <span key={genreName} className="hero-genre-chip">
                                {genreName}
                              </span>
                            ))}
                        </div>
                      )}
                      <p className="hero-description">{show.description}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <a
                      href={show.id ? `/izle/${showSlug(show)}` : "#series"}
                      className="home-cta-pill"
                    >
                      <Play size={17} fill="currentColor" /> Şimdi izle
                    </a>
                    <a
                      href={show.id ? `/seri/${showSlug(show)}` : "#series"}
                      className="ui-hover rounded-full border border-border bg-secondary px-5 py-3 text-sm font-bold text-foreground hover:border-accent hover:text-accent"
                    >
                      Seri detayı
                    </a>
                  </div>
                </div>
              </div>
            );
          })}

          {heroShows.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Önceki seri"
                onClick={goPrev}
                className="hero-nav hero-nav-prev"
              >
                <ChevronLeft size={24} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Sonraki seri"
                onClick={goNext}
                className="hero-nav hero-nav-next"
              >
                <ChevronRight size={24} aria-hidden="true" />
              </button>
            </>
          )}

          {/* Slayt göstergeleri: alt ortada; aktif olan pembe çizgi, diğerleri nokta. */}
          {heroShows.length > 1 && (
            <div
              className="absolute bottom-[30px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-2"
              role="tablist"
              aria-label="Vitrin seçimi"
            >
              {heroShows.map((s, i) => (
                <button
                  key={s.slug}
                  type="button"
                  role="tab"
                  aria-selected={i === safeIndex}
                  aria-label={`${s.title} slaytına git`}
                  onClick={() => goTo(i)}
                  className={`hero-dot ${i === safeIndex ? "active" : ""}`}
                />
              ))}
            </div>
          )}
        </section>

        <section id="season" className="mx-auto max-w-7xl px-5 py-16 lg:px-8">
          <div className="mx-auto mb-8 flex max-w-4xl items-end justify-between">
            <div>
              <p className="text-sm font-extrabold text-primary">Yeni seçkiler</p>
              <h2 className="mt-1 font-display text-3xl text-foreground">Bu sezon</h2>
            </div>
            <a
              href="#series"
              className="group link-hover ui-hover flex items-center gap-2 text-sm font-extrabold"
            >
              Tümünü gör{" "}
              <ArrowRight size={17} className="transition-transform group-hover:translate-x-1" />
            </a>
          </div>
          {/* Kartlar: en fazla 4 sütun ve max-w-4xl ile sınırlı; az seri olsa da
              posterler ekranı kaplamaz, hepsi aynı boyutta kalır. */}
          <div
            id="series"
            className="mx-auto grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4"
          >
            {(isFiltering ? filtered : shows).map((show) => {
              const href = show.id ? `/seri/${showSlug(show)}` : undefined;
              return (
                <a
                  key={show.slug ?? show.title}
                  href={href}
                  // Fareyle üzerine gelindiğinde detay verisi önden çekilir:
                  // tıklayınca sayfa beklemeden açılır.
                  onMouseEnter={() => {
                    if (!show.id) return;
                    const slug = showSlug(show);
                    void queryClient.prefetchQuery({
                      queryKey: ["show-detail", slug],
                      queryFn: () => fetchShowDetail(slug),
                      staleTime: 5 * 60_000,
                    });
                  }}
                  className="group card-hover relative block overflow-hidden rounded-2xl bg-card shadow-2xl"
                >
                  {/* Bölümü olmayan seriler ana sayfadan belli olsun. */}
                  {show.id && show.episode_count === 0 && (
                    <span className="absolute left-2 top-2 z-10 rounded-full bg-background/85 px-2.5 py-1 text-[11px] font-extrabold text-accent backdrop-blur">
                      Yakında
                    </span>
                  )}
                  <div className="aspect-[2/3] overflow-hidden bg-muted">
                    <img
                      src={show.image}
                      alt={`${show.title} kapak görseli`}
                      width={768}
                      height={1152}
                      loading="lazy"
                      className="size-full object-cover transition-transform duration-500 ease-out will-change-transform group-hover:scale-105"
                    />
                  </div>
                  <div className="p-3">
                    <h3 className="truncate text-sm font-extrabold text-foreground">
                      {show.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                      {show.subtitle}
                    </p>
                  </div>
                </a>
              );
            })}
          </div>
          {isFiltering && filtered.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-muted-foreground">Bu filtreye uygun seri bulunamadı.</p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setGenre(ALL_GENRES);
                }}
                className="ui-hover mt-4 rounded-full border border-border px-5 py-2 text-sm font-bold text-foreground hover:border-accent hover:text-accent"
              >
                Filtreyi temizle
              </button>
            </div>
          )}
        </section>

        <AdSlot slot="ad_home" className="flex justify-center" />

        <section id="genres" className="mx-auto max-w-7xl px-5 py-16 lg:px-8">
          <div className="rounded-3xl bg-card p-8 md:p-12">
            <p className="text-sm font-extrabold text-primary">Rotanı seç</p>
            <h2 className="mt-1 font-display text-3xl">Türlere göre keşfet</h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-muted-foreground">
              Bir tür seç; listedeki seriler anında ona göre süzülür.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {genreOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={genre === option}
                  onClick={() => {
                    setGenre(option);
                    document
                      .getElementById("series")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  className={`ui-hover rounded-lg border px-5 py-3 text-sm font-bold ${
                    genre === option
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:border-accent hover:text-accent"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-secondary text-foreground">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 md:grid-cols-2 lg:px-8">
          <div>
            <p className="font-display text-2xl">
              <img
                src="/shanime-logo.png"
                alt="shanime logosu"
                width={800}
                height={187}
                loading="lazy"
                decoding="async"
                className="h-10 w-auto object-contain"
              />
              <span className="sr-only">shanime</span>
            </p>
            <p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">
              Yeni serini bul: sezonun öne çıkan anime başlıkları, bölümleri ve detayları tek yerde.
            </p>
          </div>
          <div>
            <p className="text-sm font-extrabold">Keşfet</p>
            <div className="mt-4 flex flex-col gap-1 text-sm text-muted-foreground">
              {/* py-2: dokunmatikte en az ~36 px yükseklik (eskiden 20 px idi). */}
              <a href="#season" className="link-hover w-fit py-2">
                Bu sezon
              </a>
              <a href="#series" className="link-hover w-fit py-2">
                Tüm seriler
              </a>
              <a href="#genres" className="link-hover w-fit py-2">
                Türler
              </a>
            </div>
          </div>
        </div>
        <div className="border-t border-border px-5 py-5 text-center text-xs text-muted-foreground">
          © 2026 shanime · Anime keşfi için tasarlanmıştır.
        </div>
      </footer>
    </div>
  );
}

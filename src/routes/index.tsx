import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
import { fetchHeroImage, fetchShows, type ShowWithImage } from "@/lib/content";

/**
 * Statik dosya düzeni (public/static/anime-data/<slug>/):
 *   anime-cover.jpg   → grid kartı kapağı (veritabanındaki image_path ile aynı)
 *   anime-header.jpg  → vitrin arka planı (geniş, dikey kapak hero'da kırpılır)
 *   anime-header.mp4  → vitrin arka plan videosu (varsa)
 *   anime-logo.png    → vitrin başlığı (yoksa .svg, o da yoksa düz yazı)
 * Klasör adı her zaman seri slug'ıdır; harita/liste tutulmaz.
 */
const STATIC_DIR = "/static/anime-data";

/** Vitrinde her slaytın ekranda kalma süresi (sonanime.com ile aynı: 10 sn). */
const HERO_AUTO_MS = 10_000;

/** Vitrin başlığı: logosu varsa logo, yoksa yazı. Her seri kendi logosunu taşır. */
function ShowLogo({
  slug,
  title,
  className,
}: {
  slug?: string | null;
  title: string;
  className?: string;
}) {
  // Logo uzantısı seriden seriye değişiyor: önce .png, olmazsa .svg, o da
  // olmazsa düz yazı başlık. Sıra tek yerde tutulur, seri listesi tutulmaz.
  const sources = useMemo(
    () =>
      slug ? [`${STATIC_DIR}/${slug}/anime-logo.png`, `${STATIC_DIR}/${slug}/anime-logo.svg`] : [],
    [slug],
  );
  const [logoState, setLogoState] = useState<{ src: string; failed: boolean }>({
    src: sources[0] ?? "",
    failed: false,
  });

  useEffect(() => {
    setLogoState({ src: sources[0] ?? "", failed: false });
  }, [sources]);

  const logo = logoState.failed ? sources[1] : sources[0];
  if (!sources.length || logoState.failed || !logo) {
    // Logosu olmayan seri: beyaz, kalın ve gölgeli düz yazı başlık.
    return <h1 className="hero-title">{title.toLocaleUpperCase("tr")}</h1>;
  }
  return (
    <img
      key={logo}
      src={logo}
      alt={`${title} logosu`}
      width={640}
      height={200}
      loading="eager"
      decoding="async"
      onError={() => setLogoState((state) => ({ ...state, failed: true }))}
      className={`w-full max-w-md object-contain drop-shadow-[0_10px_30px_rgba(0,0,0,0.55)] ${className ?? ""}`}
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
  const { data: dbShows } = useQuery({
    queryKey: ["shows"],
    queryFn: fetchShows,
    staleTime: 60_000,
  });
  const { data: heroUrl } = useQuery({
    queryKey: ["hero-image"],
    queryFn: fetchHeroImage,
    staleTime: 60_000,
  });
  const shows: HeroCard[] = dbShows && dbShows.length > 0 ? dbShows : fallbackShows;

  // Vitrin slider'ı: tüm seriler aynı sırayla (sort_order) döner; ayrıcalıklı
  // sabit liste yok.
  const heroShows: HeroCard[] = shows;

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
  const current: HeroCard = heroShows[safeIndex] ?? fallbackHero;
  // Header görseli ya da videosu olmayan seride 404 isteğiyle uğraşmamak için
  // hata alınan dosya kaydedilir ve kapak görseline düşülür.
  const [brokenBackdrops, setBrokenBackdrops] = useState<Record<string, boolean>>({});
  const [brokenVideos, setBrokenVideos] = useState<Record<string, boolean>>({});

  // Geçiş efekti: yeni slayt üstten fade-in olur, eski slayt 1.3 sn boyunca
  // altında kalmaya devam eder. Crossfade'de iki arka plan yarı saydam
  // üst üste binip karışıyordu; bu yöntemle karışma olmaz.
  const [leavingIndex, setLeavingIndex] = useState<number | null>(null);
  const lastIndexRef = useRef(0);
  useEffect(() => {
    if (lastIndexRef.current === safeIndex) return;
    setLeavingIndex(lastIndexRef.current);
    lastIndexRef.current = safeIndex;
    const timer = window.setTimeout(() => setLeavingIndex(null), 1300);
    return () => window.clearTimeout(timer);
  }, [safeIndex]);

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

  // Otomatik dönüş: her slayt 10 saniye ekranda kalır, sürükleme sırasında durur.
  useEffect(() => {
    if (heroShows.length < 2 || heroDragging) return;
    const timer = window.setTimeout(() => {
      setHeroIndex((index) => (index + 1) % heroShows.length);
    }, HERO_AUTO_MS);
    return () => window.clearTimeout(timer);
  }, [heroShows.length, safeIndex, heroDragging]);

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
    // Dikey hareket sayfa kaydırmadır: sürüklemeyi bırak.
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 24) {
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
    if (index === safeIndex) {
      return { transform: `translateX(${dragX}%)`, opacity: 1, transition: "none" };
    }
    if (dragX > 0 && index === prev) {
      return { transform: `translateX(${dragX - 100}%)`, opacity: 1, transition: "none" };
    }
    if (dragX < 0 && index === next) {
      return { transform: `translateX(${dragX + 100}%)`, opacity: 1, transition: "none" };
    }
    return { opacity: 0, transition: "none" };
  }

  // İçerik, arka planın yarısı kadar kayar ve sürükleme derinliğiyle soluklaşır.
  const contentDragStyle: CSSProperties | undefined =
    dragX === null
      ? undefined
      : {
          transform: `translateX(${dragX * 0.5}%)`,
          opacity: Math.max(0.15, 1 - Math.abs(dragX) / 130),
          transition: "none",
        };

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
  /** Vitrin kartında gösterilen ilk tür; boşsa etiket çizilmez. */
  const primaryGenre = (current.genre ?? "").split(",")[0]?.trim() ?? "";

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
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-5 px-5 lg:px-8">
          <a
            href="#top"
            aria-label="shanime ana sayfa"
            className="ui-hover flex items-center gap-2 rounded-full px-1 py-1"
          >
            <img
              src="/shanime-logo.png"
              alt="shanime logosu"
              width={1983}
              height={793}
              loading="eager"
              decoding="async"
              className="h-12 w-auto object-contain sm:h-14"
            />
            <span className="sr-only">shanime</span>
          </a>
          <nav aria-label="Ana navigasyon" className="hidden items-center gap-8 md:flex">
            <a href="#top" className="link-hover text-sm font-extrabold text-accent">
              Ana sayfa
            </a>
            <a
              href="#series"
              className="link-hover text-sm font-bold text-muted-foreground transition-colors hover:text-foreground"
            >
              Seriler
            </a>
            <a
              href="#season"
              className="link-hover text-sm font-bold text-muted-foreground transition-colors hover:text-foreground"
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
          className={`hero-slide relative isolate min-h-[520px] select-none overflow-hidden md:min-h-[620px] ${
            heroDragging ? "is-dragging" : ""
          }`}
          onPointerDown={onHeroPointerDown}
          onPointerMove={onHeroPointerMove}
          onPointerUp={onHeroPointerUp}
          onPointerCancel={onHeroPointerCancel}
        >
          {/* Arka planlar + karartma tek katmanda; içerik her zaman üstte kalır. */}
          <div className="pointer-events-none absolute inset-0 -z-10">
            {heroShows.map((show, index) => {
              const key = show.slug ?? show.title;
              // Dikey kapak hero'da kırpılıyor: önce geniş header, dosya yoksa kapak.
              const backdrop = brokenBackdrops[key]
                ? show.image
                : heroBackdrop(show.slug, heroUrl ?? show.image);
              const videoUrl = brokenVideos[key] ? undefined : heroVideo(show.slug);
              const active = index === safeIndex;
              return (
                <div
                  key={key}
                  aria-hidden={!active}
                  style={backdropDragStyle(index)}
                  className={`absolute inset-0 ${
                    active
                      ? "z-[2] motion-safe:animate-hero-fade-in"
                      : index === leavingIndex
                        ? "z-[1]"
                        : "z-0 opacity-0"
                  }`}
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
                    style={heroDragging ? { transition: "none" } : undefined}
                    className={`hero-backdrop size-full object-cover object-center ${
                      active ? "is-active" : ""
                    }`}
                  />
                  {/* Video, görselin üstüne biner; eski sitedeki hero gibi canlı arka plan.
                      Sadece aktif slaytın videosu indirilir, oynatmaya hazır olunca görünür. */}
                  {active && allowVideo && videoUrl && (
                    <video
                      className="absolute inset-0 size-full object-cover object-center motion-safe:animate-hero-fade-in"
                      src={videoUrl}
                      autoPlay
                      muted
                      loop
                      playsInline
                      // Videoyu baştan indirmesin: oynatmaya başlarken parça parça getirsin,
                      // gelene kadar alttaki jpg arka plan görünür.
                      preload="metadata"
                      tabIndex={-1}
                      aria-hidden="true"
                      onError={() => setBrokenVideos((map) => ({ ...map, [key]: true }))}
                    />
                  )}
                </div>
              );
            })}
            {/* Karartma: soldan yatay + alttan yumuşak geçiş (sert çizgi yok).
                Aktif slayt z-[2] olduğu için gölge onun ÜSTÜNDE kalmalı (z-[3]). */}
            <div className="hero-shade absolute inset-0 z-[3]" />
          </div>
          <div className="mx-auto flex min-h-[520px] max-w-7xl items-end px-5 py-12 md:min-h-[620px] md:items-center lg:px-8">
            <div
              key={current.slug}
              style={contentDragStyle}
              className={`max-w-xl ${heroDragging ? "" : "motion-safe:animate-hero-fade-in"}`}
            >
              <p className="mb-3 inline-flex rounded-full border border-border bg-secondary px-3 py-1 text-xs font-extrabold text-muted-foreground">
                Popüler animeler
              </p>
              <p className="mb-2 text-sm font-bold text-muted-foreground">Öne çıkan seri</p>
              <ShowLogo
                slug={current.slug}
                title={current.title}
                className="-ml-1 max-w-sm sm:max-w-md"
              />
              <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold text-muted-foreground">
                {current.year && (
                  <span className="rounded-full border border-border bg-background px-3 py-1">
                    {current.year}
                  </span>
                )}
                {primaryGenre && (
                  <span className="rounded-full border border-border bg-background px-3 py-1">
                    {primaryGenre}
                  </span>
                )}
              </div>
              {/* min-h: slaytlar arasında butonlar zıplamasın (açıklama uzunlukları farklı). */}
              <p className="mt-5 max-w-lg text-sm leading-7 text-foreground md:min-h-[5.5rem] md:text-base">
                {current.description}
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-4">
                <Button asChild variant="hero" size="lg" className="rounded-full hero-btn">
                  <a
                    href={
                      current.id
                        ? `/izle/${current.slug && current.slug.trim() ? current.slug : current.id}?b=1`
                        : "#series"
                    }
                  >
                    <Play size={17} fill="currentColor" /> Şimdi izle
                  </a>
                </Button>
                <a
                  href={
                    current.id
                      ? `/seri/${current.slug && current.slug.trim() ? current.slug : current.id}`
                      : "#series"
                  }
                  className="ui-hover rounded-full border border-border bg-secondary px-5 py-3 text-sm font-bold text-foreground hover:border-accent hover:text-accent"
                >
                  Seri detayı
                </a>
              </div>
            </div>
          </div>

          {heroShows.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Önceki seri"
                onClick={goPrev}
                className="hero-arrow is-prev"
              >
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Sonraki seri"
                onClick={goNext}
                className="hero-arrow is-next"
              >
                <ChevronRight size={20} aria-hidden="true" />
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
                  className={`h-1.5 rounded-full transition-[width,background-color] duration-300 ease-out active:scale-90 ${
                    i === safeIndex
                      ? "w-[26px] bg-primary"
                      : "w-1.5 bg-foreground/35 hover:bg-foreground/70"
                  }`}
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
              const href = show.id
                ? `/seri/${show.slug && show.slug.trim() ? show.slug : show.id}`
                : undefined;
              return (
                <a
                  key={show.slug ?? show.title}
                  href={href}
                  className="group card-hover block overflow-hidden rounded-2xl bg-card shadow-2xl"
                >
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
                width={1983}
                height={793}
                loading="lazy"
                decoding="async"
                className="h-9 w-auto object-contain"
              />
              <span className="sr-only">shanime</span>
            </p>
            <p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">
              Yeni serini bul: sezonun öne çıkan anime başlıkları, bölümleri ve detayları tek yerde.
            </p>
          </div>
          <div>
            <p className="text-sm font-extrabold">Keşfet</p>
            <div className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground">
              <a href="#season" className="link-hover w-fit">
                Bu sezon
              </a>
              <a href="#series" className="link-hover w-fit">
                Tüm seriler
              </a>
              <a href="#genres" className="link-hover w-fit">
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

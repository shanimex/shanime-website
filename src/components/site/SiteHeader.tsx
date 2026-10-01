/**
 * ORTAK BAŞLIK ŞERİDİ — sitenin HER sayfasında AYNI.
 *
 * KULLANICI GERİ BİLDİRİMİ (01.10.2026): "header her yerde aynı olsun ...
 * ayrıca en önemli şey her sayfada header farklı".
 *
 * SORUN NEYDİ: her rota kendi şeridini çiziyordu ve üçü BİRBİRİNDEN FARKLI
 * tasarımlardı —
 *   · ana sayfa (`/`)            → `#sh-header` (hamburger + logo + arama +
 *                                   rastgele + dil), 60 px
 *   · seri detayı (`/anime/$slug`) → 72 px Tailwind şeridi (logo + "Anasayfa")
 *   · oynatıcı (`/anime/.../episode/...`) → 72 px Tailwind şeridi (logo + seri adı)
 * Aynı site içinde geçiş yapınca şerit bir anda değişiyordu. Artık TEK bileşen
 * var ve `__root.tsx` içinden bir kez çizilir; sayfalar kendi şeridini ÇİZMEZ.
 *
 * ÖLÇÜ/RENK KAYNAĞI: `styles.css` içindeki `#sh-header` bloğu (referanstan
 * okundu). Burada YALNIZCA yapı ve durum vardır.
 *
 * `/admin` ve `/auth` şeridi GÖRMEZ: panel ve giriş ekranı site gezinmesinin
 * parçası değildir; oraya arama/hamburger koymak yanlış olurdu (bkz. `__root.tsx`
 * içindeki yol denetimi).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { Search } from "lucide-react";

import { FaSolid } from "@/components/site/FaSolid";
import { QuickAccessGlyph, RandomGlyph } from "@/components/site/HeaderGlyphs";
import { LanguageToggle } from "@/components/site/LanguageToggle";
import { fetchShows } from "@/lib/content";
import { useLang } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { BRAND_LOGO_HEIGHT, BRAND_LOGO_SRC, BRAND_LOGO_WIDTH } from "@/lib/brand";

/** Şerit, sayfa içeriğiyle AYNI kabı kullanır (ana sayfadaki ölçümün aynısı). */
const PAGE_CONTAINER = "mx-auto w-full max-w-[1800px] px-2.5";

/** Öneri panelinde gösterilecek EN FAZLA sonuç sayısı. */
const SEARCH_SUGGESTION_LIMIT = 5;

/**
 * Arama ve "rastgele" için gereken EN AZ alanlar.
 *
 * NEDEN GENİŞ TİP DEĞİL: ana sayfa, yedeğe düşmüş (`fallbackHero`) kartları da
 * geçebiliyor; dar bir yapısal tip iki kaynağı da kabul eder ve şeridi ana
 * sayfanın iç tipine bağlamaz.
 */
export type HeaderShow = {
  id?: string | null;
  slug?: string | null;
  title: string;
  image: string;
};

/**
 * Katalog sorgusunun anahtarı.
 *
 * NEDEN TEMBEL: şerit kök düzeyde durur ve gezinen her ziyaretçide çalışır.
 * Katalog listesi YALNIZCA kullanıcı aramayı ya da hamburger menüyü AÇTIĞINDA
 * istenir (`catalogWanted`); sadece sayfa geziyorsa hiç okuma yapılmaz. Sonuç
 * istemci önbelleğinde 5 dakika kalır, yani oturum başına en fazla bir okuma.
 */
const CATALOG_QUERY_KEY = ["site-header", "catalog"] as const;

/** Öneri panelindeki satırların ortak sınıfı (masaüstü/mobil aynı görünüm). */
const SUGGESTION_ROW_CLASS =
  "group flex items-center gap-2.5 rounded-xl p-2 transition-colors hover:bg-secondary";

function cardSlug(show: HeaderShow): string {
  const slug = show.slug;
  return slug && slug.trim() ? slug : (show.id ?? "");
}

/**
 * Arama önerisi paneli.
 *
 * Kutunun hemen ALTINDA uçan kart; görsel kabuğu `styles.css` içindeki
 * `.sh-suggest` verir (kutuyla TEK kart oluşacak şekilde birleşir — kullanıcı
 * geri bildirimi 01.10.2026: "simsiyah arka plan headere uygun değil, boşluk
 * yiyor altta, birleşse mi"). Yazı boşsa ya da eşleşme yoksa HİÇ çizilmez.
 */
function SearchSuggestionPanel({
  query,
  items,
  className,
  onNavigate,
}: {
  query: string;
  items: HeaderShow[];
  className?: string;
  /**
   * Bir sonuca tıklanınca çağrılır.
   *
   * NEDEN GEREKLİ: şerit kök düzeyde durduğu için sayfa değişince UNMOUNT
   * olmaz; panel "dışarı tıklama" ile de kapanmaz (tıklama kutunun kendi
   * kapsayıcısının içindedir). Bu geri çağrı olmadan panel yeni sayfada açık
   * kalırdı.
   */
  onNavigate: () => void;
}) {
  const { t } = useLang();
  if (!query.trim() || items.length === 0) return null;
  return (
    <div className={`sh-suggest ${className ?? ""}`}>
      {/* Üst satır: büyüteç + yazılan metin (kullanıcının gördüğü satır). */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search size={15} aria-hidden="true" className="shrink-0 text-muted-foreground" />
        <span className="truncate text-sm text-muted-foreground">{query}</span>
      </div>
      <ul className="p-1.5">
        {items.map((show) => {
          const slug = cardSlug(show);
          const body = (
            <>
              <img
                src={show.image}
                alt=""
                width={40}
                height={56}
                loading="lazy"
                className="h-14 w-10 shrink-0 rounded-[3px] object-cover"
              />
              <span className="min-w-0">
                {/* show.title VERİTABANI içeriğidir → bilerek ÇEVRİLMEZ. */}
                <strong className="block truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">
                  {show.title}
                </strong>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {t("home.resultKind")}
                </span>
              </span>
            </>
          );
          return (
            <li key={show.slug ?? show.title}>
              {/* Veritabanı kaydı olmayan yedek içerikte gidilecek sayfa yoktur:
                  bağlantısız gösterilir. */}
              {show.id ? (
                <Link
                  to="/anime/$slug"
                  params={{ slug }}
                  preload={false}
                  className={SUGGESTION_ROW_CLASS}
                  onClick={onNavigate}
                >
                  {body}
                </Link>
              ) : (
                <span className={SUGGESTION_ROW_CLASS}>{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function SiteHeader() {
  const { t } = useLang();
  const navigate = useNavigate();

  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  /**
   * Katalog, yalnızca GERÇEKTEN gerekince istenir (arama açıldı ya da menü
   * açıldı). Böylece yalnızca sayfa gezen ziyaretçide ek okuma doğmaz.
   */
  const [catalogWanted, setCatalogWanted] = useState(false);

  const catalogQuery = useQuery({
    queryKey: CATALOG_QUERY_KEY,
    queryFn: () => fetchShows(),
    enabled: catalogWanted,
    // Katalog seyrek değişir: oturum boyunca tekrar istenmesin (egress).
    staleTime: 5 * 60 * 1000,
  });

  const catalog = useMemo<HeaderShow[]>(
    () => (catalogQuery.data as HeaderShow[] | undefined) ?? [],
    [catalogQuery.data],
  );

  const searchRef = useRef<HTMLInputElement>(null);
  const desktopSearchRef = useRef<HTMLDivElement>(null);
  const mobileSearchRef = useRef<HTMLDivElement>(null);
  /**
   * Panel/menü AÇAN düğmeler. Aşağıdaki "dışarı tıklama" denetiminden MUAF
   * tutulurlar — gerekçesi `onPointerDown` içindeki nota bakın.
   */
  const togglerRef = useRef<HTMLButtonElement>(null);
  const searchTogglerRef = useRef<HTMLButtonElement>(null);

  /** Katalogdan eşleşen ilk birkaç seri (başlık ve slug üzerinden). */
  const searchSuggestions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("tr");
    if (!needle) return [];
    return catalog
      .filter((show) => {
        const haystack = `${show.title} ${show.slug ?? ""}`.toLocaleLowerCase("tr");
        return haystack.includes(needle);
      })
      .slice(0, SEARCH_SUGGESTION_LIMIT);
  }, [catalog, query]);

  const openSearch = () => {
    setCatalogWanted(true);
    setSearchOpen(true);
    setMenuOpen(false);
    // Panel açılırken odak kutuya gitsin (referans davranışı).
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  const toggleMenu = () => {
    setCatalogWanted(true);
    setSearchOpen(false);
    setMenuOpen((open) => !open);
  };

  /**
   * RASTGELE SERİ — ana sayfadaki davranışın aynısı.
   * Yalnızca adresi olan (slug) kayıtlar havuza girer; ölü adrese düşülmez.
   */
  const goRandom = () => {
    const pool = catalog.filter((show) => Boolean(show.slug && show.slug.trim()));
    if (pool.length === 0) return;
    const slug = pool[Math.floor(Math.random() * pool.length)]?.slug;
    if (!slug) return;
    setMenuOpen(false);
    void navigate({ to: "/anime/$slug", params: { slug } });
  };

  // ESC ve dışarı tıklama: açık panel/menü ekranda asılı kalmasın.
  useEffect(() => {
    if (!searchOpen && !menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSearchOpen(false);
        setMenuOpen(false);
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      /**
       * DÜZELTİLEN HATA (kullanıcı bildirimi, 01.10.2026):
       * "3 çizgiye basıyorum, tekrar üstüne basınca ... kapanıp açılıyor;
       *  x'e basınca kapanması lazım".
       *
       * SEBEP: hamburger düğmesi ne `.sh-search` kabının ne de menü panelinin
       * İÇİNDEDİR. Sıra şöyleydi —
       *   1) `mousedown` → düğme "dışarıda" sayılıp `menuOpen = false` yapılıyordu,
       *   2) hemen ardından düğmenin `onClick`i durumu TERSİNE çeviriyordu
       *      (`(open) => !open`) → menü yeniden AÇILIYORDU.
       * Yani menü düğmeyle hiç kapanamıyordu. Aynı çakışma mobil arama
       * düğmesinde de vardı.
       *
       * ÇÖZÜM: panel/menü açan iki düğme dışarı-tıklama denetiminden MUAF.
       * Kapanma artık yalnızca onların kendi `onClick`inden yönetilir.
       */
      const inControls =
        (togglerRef.current?.contains(target) ?? false) ||
        (searchTogglerRef.current?.contains(target) ?? false);
      if (inControls) return;
      const inDesktop = desktopSearchRef.current?.contains(target) ?? false;
      const inMobile = mobileSearchRef.current?.contains(target) ?? false;
      if (!inDesktop && !inMobile) {
        setSearchOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [searchOpen, menuOpen]);

  /**
   * Şerit KÖK düzeyde durduğu için sayfa değişince unmount OLMAZ; açık kalan
   * menü/panel yeni sayfaya taşınırdı. Gezinmede ikisi de kapanır.
   * (Bağımlılık yok: yalnızca bir kez bağlanır, kapanış `popstate`te de çalışır.)
   */
  useEffect(() => {
    const close = () => {
      setMenuOpen(false);
      setSearchOpen(false);
      setQuery("");
    };
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, []);

  /** Logoya/menüye basınca yukarı kaydır — `preventDefault` YOK (gezinme bozulmasın). */
  const scrollTop = () => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <header id="sh-header">
      {/* Şerit, sayfanın geri kalanıyla AYNI kabı kullanır; `relative` ŞART:
          hamburger menü paneli bu kabın sol kenarına hizalanır. */}
      <div className={`${PAGE_CONTAINER} relative`}>
        <div className="sh-wrapper">
          <div className="sh-start">
            {/* Hamburger her boyutta görünür: bağlantılar açılır paneldedir. */}
            <button
              ref={togglerRef}
              type="button"
              className="sh-toggler"
              aria-expanded={menuOpen}
              aria-controls="sh-menu"
              aria-label={menuOpen ? t("common.closeMenu") : t("common.openMenu")}
              onClick={toggleMenu}
            >
              {/* Üç çubuk bir KAP içinde: referans (reanime) da `gap: 4px` için
                  sütun flex bir kap kullanır; düğme grid + ortalama yapar. */}
              <span className="sh-glyph" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </button>

            {/* Logo → ana sayfa (ve yukarı kaydır). `Link`: sayfa YENİLENMEZ. */}
            <Link to="/" onClick={scrollTop} aria-label={t("common.homeAria")} className="sh-logo">
              <img
                src={BRAND_LOGO_SRC}
                alt={t("common.logoAlt")}
                width={BRAND_LOGO_WIDTH}
                height={BRAND_LOGO_HEIGHT}
                loading="eager"
                decoding="async"
              />
              <span className="sr-only">shanime</span>
            </Link>

            {/* ARAMA — kutunun içinde gerçek bir `<input>` vardır. */}
            <div
              ref={desktopSearchRef}
              /* `has-panel` YALNIZCA gerçekten öneri listelenecekken eklenir:
                 kutu ile panelin tek kart gibi birleşmesi buna bağlıdır. */
              className={`sh-search ${searchOpen ? "is-open" : ""} ${
                searchOpen && searchSuggestions.length > 0 ? "has-panel" : ""
              }`}
            >
              {/* `onSubmit` kesilir: süzme İSTEMCİDE yapılır, sayfa yenilenmemeli. */}
              <form role="search" onSubmit={(event) => event.preventDefault()}>
                <button
                  type="button"
                  aria-label={t("common.search")}
                  onClick={() => searchRef.current?.focus()}
                >
                  <FaSolid name="magnifyingGlass" />
                </button>
                <input
                  ref={searchRef}
                  id="search"
                  type="text"
                  autoComplete="off"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onFocus={() => {
                    setCatalogWanted(true);
                    setSearchOpen(true);
                  }}
                  placeholder={t("common.searchPlaceholder")}
                  aria-label={t("common.search")}
                />
                <div className="sh-tip">
                  <QuickAccessGlyph />
                  <span>{t("common.quickAccess")}</span>
                </div>
              </form>
              {searchOpen && (
                <SearchSuggestionPanel
                  query={query}
                  items={searchSuggestions}
                  className="absolute inset-x-0 top-full z-40 motion-safe:animate-pop-in motion-reduce:animate-none"
                  // Sonuca tıklanınca panel kapanır ve yazı temizlenir; yoksa
                  // panel yeni sayfada açık kalırdı (şerit unmount olmuyor).
                  onNavigate={() => {
                    setSearchOpen(false);
                    setQuery("");
                  }}
                />
              )}
            </div>
          </div>

          <div className="sh-end">
            <div className="sh-quick">
              <button
                type="button"
                className="sh-main-menu"
                aria-label={t("common.random")}
                // `title` BİLEREK YOK: etiket zaten görünür, tarayıcı balonu şeridi kirletiyordu.
                onClick={goRandom}
              >
                <RandomGlyph />
                <span>{t("common.random")}</span>
              </button>
              {/* Dil değiştirici SAĞ UÇTA kalır; "Rastgele" ise arama kutusunun
                  yanına yaslanır (kullanıcı isteği 01.10.2026). */}
              <LanguageToggle className="ml-auto" />
            </div>

            {/* Mobil arama açıcı (≥1200 px'te gizli). */}
            <button
              ref={searchTogglerRef}
              type="button"
              className="sh-search-toggler"
              aria-label={t("common.search")}
              aria-expanded={searchOpen}
              onClick={() => (searchOpen ? setSearchOpen(false) : openSearch())}
            >
              <FaSolid name="magnifyingGlass" />
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav
            ref={mobileSearchRef}
            id="sh-menu"
            aria-label={t("common.mainNav")}
            className="sh-menu"
          >
            {/* Hepsi `Link`: sayfa YENİLENMEDEN gider. Çapalar (`hash`) ana
                sayfadaki bölümlere kaydırır; başka sayfadan basılırsa önce ana
                sayfaya döner, sonra ilgili bölüme iner. */}
            {/* Menü öğeleri gezinmeden sonra KAPANIR: şerit unmount olmadığı
                için kendiliğinden kapanmaz. */}
            <Link
              to="/"
              onClick={() => {
                scrollTop();
                setMenuOpen(false);
              }}
            >
              {t("common.home")}
            </Link>
            <Link to="/" hash="series" onClick={() => setMenuOpen(false)}>
              {t("common.series")}
            </Link>
            <Link to="/" hash="season" onClick={() => setMenuOpen(false)}>
              {t("common.thisSeason")}
            </Link>
            {/* Rastgele menüde de durur: metin tabanlı bir yol kalsın. */}
            <button type="button" onClick={goRandom}>
              {t("common.random")}
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}

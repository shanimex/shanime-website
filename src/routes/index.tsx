// / — Ana sayfa: vitrin bandı, trend seriler ve tüm animelerin listelendiği ızgara.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  Menu,
  Play,
  Search,
  Tag,
  Tv,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import ANIME_LOGO_FILES from "@/data/anime-logo-files.json";
import { Button } from "@/components/ui/button";
import { AdSlot, useAdCode } from "@/components/site/AdSlot";
import { AdsterraLeaderboard } from "@/components/site/AdsterraUnit";
import { EpisodeCover } from "@/components/site/EpisodeCover";
import { LanguageToggle } from "@/components/site/LanguageToggle";
import { supabase } from "@/integrations/supabase/client";
import { fetchShows, showSlug, type ShowWithImage } from "@/lib/content";
import { cachedRead, TTL_CATALOG_SECONDS, TTL_LATEST_SECONDS } from "@/lib/server-cache";
import {
  plural,
  t as translate,
  useDocumentTitle,
  useLang,
  type I18nKey,
  type Translate,
} from "@/lib/i18n";
import { getLastEpisode, getProgress, getResumeFrame } from "@/lib/watch-progress";

/**
 * Statik dosya düzeni (public/static/anime-data/<slug>/):
 *   anime-cover.jpg   → grid kartı kapağı (veritabanındaki image_path ile aynı)
 *   anime-header.jpg  → vitrin arka planı (geniş, dikey kapak hero'da kırpılır)
 *   anime-header.mp4  → vitrin arka plan videosu (varsa)
 *   anime-logo.<ext>  → vitrin başlığı; yalnızca MANİFEST'te kayıtlı olan
 *                       uzantılar denenir (bkz. ANIME_LOGO_FILES). Hiçbiri
 *                       yoksa düz yazı başlık çizilir.
 * Klasör adı her zaman seri slug'ıdır; logo listesi `npm run logos:manifest`
 * ile üretilen `src/data/anime-logo-files.json` dosyasından gelir.
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
/* Logoya ya da menüdeki "Ana sayfa"ya basınca adres çubuğuna `#top` YAZILMAZ
   (kullanıcı geri bildirimi: "sekmede #top etiketi çıkıyor"). Hash'e hiç
   dokunulmadan yukarı kaydırılır; `href="#top"` yalnızca JS'siz durumda yedek
   olarak kalır. */
function scrollToTop(event?: { preventDefault: () => void }) {
  event?.preventDefault();
  if (typeof window === "undefined") return;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

const LOGO_RESOLVED = new Map<string, string>();

/**
 * Vitrinin koyu zemininde HARFLERİ KAYBOLAN logolar. Beyaz kontur yalnızca
 * bunlara uygulanır; renkli/aydınlık logolarda kontur görüntüyü bozuyordu.
 * Yeni bir koyu logo eklenirse slug'ını buraya yazmak yeterli.
 */
const LOGO_NEEDS_OUTLINE = new Set(["mushoku-tensei"]);

/**
 * GERÇEKTEN var olan vitrin logosu yolları.
 *
 * `scripts/generate-anime-logo-manifest.mjs` (`npm run logos:manifest`)
 * `public/static/anime-data/<slug>/` klasörlerini tarayıp
 * `src/data/anime-logo-files.json` dosyasını üretir; liste derleme zamanında
 * gömülür. Manifest, `episode-cover-files.json` deseninin aynısıdır.
 */
const LOGO_FILES = new Set<string>(ANIME_LOGO_FILES as string[]);

/**
 * Vitrin başlığı adayları — YALNIZCA manifest'te kayıtlı yollar.
 *
 * ── NEDEN MANİFEST (düzeltme, 29.09.2026) ────────────────────────────────────
 * Eskiden sıra KÖRLEMESİNE kuruluyordu (`anime-logo.png` sonra `.svg`). Bazı
 * serilerde yalnız `.svg` vardır (ör. `mushoku-tensei`); o seride tarayıcı önce
 * `anime-logo.png`e ister ve %100 **404** alırdı (ana sayfada görülen tek 404
 * isteğinin kaynağı buydu). Artık var olmayan uzantı hiç denenmez → 0 404, logo
 * yine görünür.
 *
 * Tercih sırası korunur: önce `.png`, sonra `.svg`.
 */
function logoCandidates(slug: string | null | undefined): string[] {
  if (!slug) return [];
  return [".png", ".svg"]
    .map((ext) => `${STATIC_DIR}/${slug}/anime-logo${ext}`)
    .filter((path) => LOGO_FILES.has(path));
}

/** Vitrin başlığı: manifest'teki ilk uygun logo → yoksa düz yazı. */
function ShowLogo({
  slug,
  title,
  className,
}: {
  slug?: string | null;
  title: string;
  className?: string;
}) {
  const { t } = useLang();
  // Sıra tek yerde tutulur, seri listesi tutulmaz. Yalnızca MANİFEST'teki yollar
  // döner; var olmayan bir uzantı hiç istenmez (bkz. logoCandidates).
  const sources = useMemo(() => logoCandidates(slug), [slug]);
  // Kaçıncı kaynakta olduğumuz: 0 = ilk mevcut logo, sonrası sıradaki; kaynak
  // kalmayınca düz yazı başlık çizilir.
  // Daha önce bulunmuşsa doğrudan oradan başlanır; boşa istek gitmez.
  const [step, setStep] = useState(() => {
    const known = slug ? LOGO_RESOLVED.get(slug) : undefined;
    const index = known ? sources.indexOf(known) : -1;
    return index > 0 ? index : 0;
  });

  const source = sources[step];
  const imgRef = useRef<HTMLImageElement>(null);
  // SSR'da sunucu HTML'e ilk kaynağı (manifest'teki ilk uzantı, ör. .png) koyar.
  // O dosya yoksa tarayıcı hatayı React hidrasyondan ÖNCE alır ve `onError` hiç
  // çalışmaz → ekranda kırık resim simgesi + alt metin kalır (nadiren, tamamen
  // yarışa bağlı). Bu yüzden kaynak her değiştiğinde durum elle de kontrol edilir.
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
      alt={t("home.logoAlt", { title })}
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
  // SUNUCU ÖNBELLEĞİ (kota/egress): vitrin listesi her istekte okunuyordu.
  // `fetchShows` panel (`/admin`) tarafından da kullanıldığı için önbellek KAYNAKTA
  // DEĞİL, yalnızca bu herkese açık çağrı yerinde uygulanır (bkz. lib/server-cache.ts).
  // En kötü gecikme: panelde yeni seri/bölüm eklendiğinde vitrin en fazla 120 sn
  // sonra güncellenir.
  loader: () => cachedRead("public:catalog:shows", TTL_CATALOG_SECONDS, fetchShows),
  staleTime: 5 * 60_000,
  // Başlık/künye SÖZLÜKTEN gelir: sunucuda `DEFAULT_LANG` yazılır (dil sunucuda yok), istemcide
  // ise sekme başlığı `useDocumentTitle` ile aktif dile bağlanır (bkz. Index()).
  head: () => ({
    meta: [
      { title: translate("meta.homeTitle") },
      {
        name: "description",
        content: translate("meta.siteDescription"),
      },
      { property: "og:title", content: translate("meta.homeTitle") },
      {
        property: "og:description",
        content: translate("meta.siteDescription"),
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

/**
 * Kart için adres kimliği. `showSlug` ile aynı kuralı uygular, fakat HeroCard
 * birleşiminde `id` tanımsız olabildiği için doğrudan `showSlug` çağrısı tip
 * hatası veriyordu; bu yardımcı o dar geçişi tolere eder.
 */
function cardSlug(show: HeroCard): string {
  const slug = show.slug;
  return slug && slug.trim() ? slug : (show.id ?? "");
}

/** Tür filtresinin "hepsi" etiketi. */
const ALL_GENRES = "Tümü";

/**
 * ARAMA ÖNERİ PANELİ — KAZA SONUCU SİLİNMİŞTİ, GERİ GETİRİLDİ.
 * ----------------------------------------------------------------------------
 * NEDEN BURADA: kesintiye uğrayan bir oturum, arama kutusunun altındaki uçan
 * öneri panelini (masaüstü VE mobil) ve onun satır bileşenini kazayla SİLDİ.
 * KULLANICI BUNU İSTEMEMİŞTİ: "arama kutusu ve altındaki liste çalışmaya devam
 * etsin" diyor. Bu yüzden panel (tek bileşen olarak, iki konuma da) geri kondu.
 *
 * PANEL NASIL BESLENİR (YENİ SORGU YOK): satırlar, sayfada ZATEN yüklü ve
 * süzülmüş olan listeden — ızgarayı çizen listenin TA KENDİSİNDEN (`filtered`)
 * — alınır ve yalnızca ilk birkaç eşleşme gösterilir (`SEARCH_SUGGESTION_LIMIT`).
 * Supabase'e EK BİR SORGU ATILMAZ.
 *
 * PANEL NE ZAMAN GÖRÜNÜR: yalnızca arama kutusu AÇIKKEN ve yazı BOŞ DEĞİLKEN;
 * eşleşme yoksa HİÇ çizilmez (boş kart kalmaz). Bu kapı bileşenin İÇİNDEDİR.
 *
 * ARAMA YİNE ESKİSİ GİBİ ÇALIŞIR: `query` durumu harf harf süzmeyi sürdürür
 * (`filtered` → `#series` ızgarası). Panel bu süzmenin ÜSTÜNE eklenir; kutunun
 * kendisi, `searchOpen`, `desktopSearchRef`/`mobileSearchRef` ile dışarı tıklama
 * ve Escape ile kapanma davranışı DEĞİŞMEDİ.
 */
/* ============================================================================
 * HERO ALTINDAKİ KEŞİF ALANI — referans yerleşimi (anikoto.cz/home, hero altı).
 *
 * NEDEN İKİ KOLON: referans, hero'nun altını GENİŞ ANA KOLON (solda ~2/3) +
 * DAR SABİT KENAR ÇUBUĞU (sağda ~1/3) diye böler. Kenar çubuğu tek bir sıralı
 * liste taşır ve masaüstünde `sticky`dir: ana kolon uzun olsa da ekranda kalır.
 * İçeriği kısa tutulur (yalnızca sıralı liste) ki ana kolonun yanında sayfanın
 * altına doğru kocaman bir ölü boşluk bırakmasın.
 *
 * NEDEN SATIR BAŞLIKLARI KÜÇÜK BÜYÜK-HARF + OK: referanstaki "Latest Episode" /
 * "New Release" başlık dili bu; ana sayfadaki tüm bölüm başlıkları TEK
 * bileşenden (DiscoveryRowHeader) geldiği için ızgaralar tek site gibi görünür.
 *
 * BÖLÜM SIRASI — `docs/anikoto-anasayfa-yapisi.md` (canlı DOM blueprint'i, §0/§2/§5)
 * SIRASIDIR. Sayfa bu sırayı izler:
 *   0) header (referansta `HEADER.fixed`; bizde `sticky top-0`) →
 *   1) hero (DOKUNULMADI) →
 *   2) ANA KOLON (`aside.main`), sırayla:
 *        2.1 duyuru şeridi (`#anikoto-bookmark-alert`)  → VERİ YOK, not bırakıldı
 *        2.2 sabitlenmiş duyuru şeridi (`#community-pinned.cpin`) → VERİ YOK, not
 *        2.3 paylaşım satırı (`DIV.bsharing.mb-4`)      → KALDIRILDI (kullanıcı isteği)
 *        2.4 "Kaldığın yerden devam et" (`#continue-watching`) → bizde cihazdaki
 *            izleme kaydından dolar (referansta giriş yapılmış kullanıcıda dolar)
 *        2.5 "Latest Episode" (`#recent-update`)        → "Son Bölümler" ızgarası
 *        2.6 "Upcoming Anime" (`#upcoming-anime`)       → `UpcomingSection` (AniList, /api/anilist)
 *        2.7 üç kolonlu bant (`DIV.top-tables.mb-3`)    → `HomeCompactBand` (footer'ın hemen üstünde)
 *        2.8 "Estimated Schedule" (`#schedule-block`)   → `ScheduleSection` (AniList, /api/anilist)
 *   3) KENAR ÇUBUĞU (`aside.sidebar`): TOP TRENDING (DOKUNULMADI) + "Discussion"
 *      (VERİ YOK → çizilmedi, not bırakıldı).
 *   4) FOOTER: ilk blok A-Z listesidir (`FOOTER > DIV.container > DIV.azlist`).
 * Ana kolondaki "Kaldığın yerden devam et" satırı referansta da bu sıradadır
 * (2.4); kullanıcı isteğiyle korunmuştur.
 *
 * KOMPAKT BANT NEREDE: blueprint §2.7 → bant `#upcoming-anime`DEN SONRA gelen
 * `DIV.top-tables` bloğudur. KULLANICI İSTEĞİYLE bant, ana içeriğin EN SONUNA —
 * footer'ın hemen üstüne ve "Bu sezon" bölümünün hemen altına — TAŞINDI (ana
 * kolonun içinde değil). ÜÇ kolon da (YENİ ÇIKANLAR / YENİ EKLENENLER /
 * TAMAMLANANLAR) çizilir ve ızgara referansın kendi üç kolonlu düzenidir (sütun
 * sayısı veriye göre DEĞİŞMEZ).
 *
 * REFERANSTA OLUP BİZDE OLMAYAN BÖLÜMLER (VERİ OLMADIĞI İÇİN ÇİZİLMEZ, her biri
 * ait olduğu konumda kısa bir Türkçe notla belgelenir — bkz. `HomeSections`):
 *   · duyuru şeritleri (2.1 / 2.2) → bizde duyuru/topluluk içeriği yok.
 *   · "Discussion"        → projede yorum/tartışma sistemi ve tablosu yok.
 * ARTIK ÇİZİLENLER (VERİ ANILIST'TEN GELİYOR — `shows` şemasında hâlâ yayın
 * durumu/tarihi YOK, `show_episodes` yalnızca `created_at` taşır):
 *   · "Upcoming Anime" (2.6)     → `/api/anilist?section=upcoming` + `UpcomingSection`.
 *   · "Estimated Schedule" (2.8) → `/api/anilist?section=schedule` + `ScheduleSection`.
 *
 * BİZDEN ÇIKAN, REFERANSTA KARŞILIĞI OLMAYAN BÖLÜMLER (ikisi de SİLİNDİ):
 * Önce aynı çipleri İKİNCİ kez çizen büyük "Türlere göre keşfet" paneli, ardından
 * KULLANICI İSTEĞİYLE onun son kalıntısı olan tek satırlık GENRES çip şeridi
 * (başlığı ve `id="genres"` kimliği dâhil) TÜMÜYLE silindi. Şeride giden
 * bağlantılar ölü kalmasın diye `#series` ızgarasına yönlendirildi (bkz.
 * `Index()` içindeki header "Keşfet" düğmesi ve footer bağlantısı). (Başlığı
 * yeniden adlandırılan) "Bu sezon" ızgarası ise ana içeriğin sonunda durur;
 * "Bu sezon" bölümü üç kolonlu bandın HEMEN ÜSTÜNE, bant ise footer'ın hemen
 * üstüne alındı (bkz. `Index()` yerleşimi).
 *
 * KENAR ÇUBUĞU BAŞLIĞI — ARTIK DİLE BAĞLI (düzeltildi): başlığın `tr` ve `en`
 * değerleri BİLEREK AYNI ("TOP TRENDING") yazılmıştı; panel bu yüzden dil
 * değişince başlığını değiştirmiyordu ("TR'ye geçince panel hâlâ değişmiyor").
 * Paneldeki diğer TÜM metinler zaten sözlükten geldiği için (sekmeler, ipuçları,
 * meta şeridi, `aria-label`) dil değişiminde güncelleniyordu — takılan tek metin
 * başlıktı. Artık `tr` → "TREND OLANLAR", `en` → "TOP TRENDING".
 * Dürüstlük kaygısı yine de geçerli: projede görüntülenme, puan ya da trend verisi
 * TUTULMUYOR ve panelin arkasındaki sıralama BÖLÜM SAYISINA göredir; ölçüt
 * sekmelerde (BÖL. / SEZON / YENİ) ve ipucu balonlarında açıkça söylenir,
 * uydurma sıralama/veri gösterilmez.
 *
 * Savunmacılık: bölüm sorgusu hata verirse YALNIZCA ona bağlı bölümler (Son
 * Bölümler ızgarası ve "Yeni Çıkanlar" kolonu) çizilmez; seri listesinden
 * beslenen kolonlar, kenar çubuğu ve sayfanın geri kalanı etkilenmez. Veri
 * yoksa başlık da boşluk da bırakılmaz.
 *
 * OMİT EDİLENLER (veri kaynağı YOK, uydurulmaz):
 *   · "TAMAMLANANLAR" kolonu artık ÇİZİLİR, fakat GERÇEK bir "tamamlandı"
 *     alanından DEĞİL: şemada tamamlanma/yayın durumu alanı hâlâ YOK. Kolon,
 *     `HomeCompactBand` üstünde belgelenmiş bir VEKİL (proxy) ölçütle beslenir
 *     (`COMPLETED_STALE_DAYS`) ve o notta gerçek bir alanın nasıl ekleneceği
 *     (küçük migrasyon) yazılıdır.
 *   · All/Sub/Dub/Trending filtre sekmeleri — `shows` üzerinde altyazı/dublaj
 *     işareti yok; `episode_sources.language` yalnızca BÖLÜM bazında 'tr'/'en'
 *     ayrımı taşır, seri bazlı bir "Sub/Dub" etiketi üretemez.
 *   · Puan/yıldız ve süre — `shows` şemasında rating ya da duration alanı yok.
 *     Bu yüzden kenar çubuğu meta şeridi referanstaki "★ puan · süre" yerine
 *     YALNIZCA gerçekten var olan alanları yazar: yıl · bölüm · sezon · ilk tür.
 * ============================================================================ */

/** Bölüm kaydı: bölüm bilgisi + ebeveyn seri + veritabanına eklenme zamanı. */
type LatestEpisode = {
  id: string;
  show: ShowWithImage;
  season: number;
  number: number;
  title: string;
  /** `show_episodes.created_at` (ISO). Kompakt bant satırındaki tarih buradan yazılır. */
  createdAt: string;
};

/**
 * Bölüm sorgusunda okunacak en fazla satır.
 *
 * NEDEN BOL SATIR: liste seri başına TEK (en yeni) bölüme indirilir. Bir serinin
 * yeni eklenmiş 30 bölümü listenin başını doldurursa küçük bir limitle 12 farklı
 * seriye hiç ulaşılamaz — bu yüzden bol satır okunur (satırlar çok küçük:
 * id, show_id, sezon, bölüm, başlık, tarih).
 */
const LATEST_QUERY_LIMIT = 300;

/** "Son Bölümler" ızgarasındaki kart sayısı (referans: yoğun 12'lik ızgara). */
const LATEST_GRID_LIMIT = 12;

/** Kompakt bant kolonlarındaki satır sayısı (referanstaki liste: ~5 satır). */
const COMPACT_ROW_LIMIT = 5;

/* ============================================================================
 * "SON BÖLÜMLER" SORUSU — IZGARA VE KOMPAKT BANT ORTAK KAYNAĞI
 *
 * NEDEN MODÜL DÜZEYİNDE TEK TANIM: bölüm listesini iki yer tüketiyor
 * ("Son Bölümler" poster ızgarası ve bandın "YENİ ÇIKANLAR" kolonu). Sorgu iki
 * bileşene kopyalansaydı biri güncellenmeden kalır ve iki liste zamanla
 * birbirinden sapardı.
 *
 * NEDEN İKİNCİ OKUMA DOĞMAZ (kota/egress): `queryKey` aynı olduğu için React
 * Query sonucu PAYLAŞIR — iki tüketici de bu kancayı çağırsa bile ağa TEK istek
 * gider (tazelik istemci varsayılanından: lib/query-client.ts → 5 dk). Yani bant
 * ekranda olsun ya da olmasın ana sayfanın okuma bütçesi değişmez.
 * ========================================================================== */
const LATEST_EPISODES_QUERY_KEY = ["home-latest-episodes"] as const;

/**
 * `show_episodes` (şema doğrulandı: show_id, season, number, title, created_at)
 * en yeniden eskiye okunur ve ebeveyn seriye bağlanır. Ebeveyni listede olmayan
 * bölüm ATLANIR (kırık bağlantı doğmaz).
 *
 * HATA YUTULUR (bilerek): sorgu patlarsa boş liste döner; yalnızca bölüm verisine
 * bağlı bölümler (ızgara + "YENİ ÇIKANLAR") çizilmez, sayfanın geri kalanı
 * etkilenmez. Hata önbelleğe YAZILMAZ, bir sonraki denemede sorgu yeniden çalışır.
 *
 * ÖNBELLEK (kota/egress): sonuç `TTL_LATEST_SECONDS` (120 sn) sunucu tarafında
 * hatırlanır (bkz. lib/server-cache.ts).
 */
async function readLatestEpisodes(shows: ShowWithImage[]): Promise<LatestEpisode[]> {
  try {
    return await cachedRead<LatestEpisode[]>(
      "public:home:latest-episodes",
      TTL_LATEST_SECONDS,
      async () => {
        const { data, error } = await supabase
          .from("show_episodes")
          .select("id, show_id, season, number, title, created_at")
          .order("created_at", { ascending: false })
          .limit(LATEST_QUERY_LIMIT);
        if (error) throw error;
        const byId = new Map(shows.map((show) => [show.id, show]));
        const items: LatestEpisode[] = [];
        for (const row of data ?? []) {
          const show = byId.get(row.show_id);
          // Ebeveyni listede olmayan bölüm gösterilmez (kırık bağlantı olmaz).
          if (!show) continue;
          items.push({
            id: row.id,
            show,
            season: typeof row.season === "number" && row.season > 0 ? row.season : 1,
            number: row.number,
            title: (row.title ?? "").trim(),
            createdAt: typeof row.created_at === "string" ? row.created_at : "",
          });
        }
        return items;
      },
    );
  } catch {
    // Sorgu patlarsa yalnızca bu bölümler çizilmez; ana sayfa bozulmaz.
    return [];
  }
}

/** "Son Bölümler" ızgarası ve "YENİ ÇIKANLAR" kolonu için ORTAK sorgu kancası. */
function useLatestEpisodes(shows: ShowWithImage[]) {
  return useQuery({
    queryKey: LATEST_EPISODES_QUERY_KEY,
    queryFn: () => readLatestEpisodes(shows),
  });
}

/**
 * En yeni bölüm listesini SERİ BAŞINA TEK (en yeni) bölüme indirir.
 *
 * NEDEN: yeni eklenmiş 30 bölümü olan bir seri tek başına listeyi doldurup keşif
 * değerini yok ederdi. Kural TEK yerde durur ki ızgara ile bant aynı satırları
 * göstersin (farkları yalnızca meta satırıdır).
 */
function latestPerShowItems(items: LatestEpisode[]): LatestEpisode[] {
  const seen = new Set<string>();
  const result: LatestEpisode[] = [];
  for (const item of items) {
    if (seen.has(item.show.id)) continue;
    seen.add(item.show.id);
    result.push(item);
  }
  return result;
}

/**
 * Kenar çubuğundaki sıralı liste uzunluğu (4–6 satır: referans panelin yoğunluğu).
 * Kısa tutulur ki ana kolonun yanında sayfanın altına doğru ölü boşluk kalmasın.
 */
const RANKED_LIMIT = 6;

/**
 * Kenar çubuğu sıralama sekmeleri. ÜÇÜ DE DÜRÜST: projede görüntülenme/puan/trend
 * verisi YOK, bu yüzden her sekme ELDEKİ bir alana göre yeniden sıralar. Sıralama
 * tamamen istemcide yapılır — yeni bir sorgu atılmaz (liste zaten `shows` içinde).
 */
type RankTab = "episode" | "season" | "new";

/**
 * Sekme tanımları: sekme etiketi + sekmeyi açıklayan tek satırlık ipucu.
 *
 * NEDEN İPUCU ARTIK GÖRÜNÜR SATIR DEĞİL: referans panelin başlık şeridi
 * yalnızca "başlık + sekmeler"den oluşur; altında açıklama satırı YOKTUR.
 * Şeridin yapısını birebir kopyalamak için ipucu görünür satırdan çıkarılıp
 * sekmenin `title` (ipucu balonu) metnine taşındı: dürüstlük korunur, fazladan
 * görsel öğe eklenmez.
 */
const RANK_TABS: { id: RankTab; labelKey: I18nKey; hintKey: I18nKey }[] = [
  { id: "episode", labelKey: "home.rankEpisode", hintKey: "home.rankEpisodeHint" },
  { id: "season", labelKey: "home.rankSeason", hintKey: "home.rankSeasonHint" },
  { id: "new", labelKey: "home.rankNew", hintKey: "home.rankNewHint" },
];

/**
 * REFERANSTAN ÖLÇÜLEN YERLEŞİM DEĞERLERİ — anikoto.cz/home, KULLANICININ GERÇEK
 * PENCERE GENİŞLİĞİNDE (1552×900) tarayıcıda ölçüldü; karşılaştırma için 1600×900
 * da ölçüldü. Ölçümler sitenin kendi kuralıyla birebir örtüşüyor
 * (`.container{max-width:1800px;padding:0 10px;margin:0 auto}`,
 *  `.ani.items .item{padding:0 10px;width:16.667%}`,
 *  `aside.main` %75 / `aside.sidebar` %25, `body.home #wrapper #body{padding-top:5rem}`).
 *
 * 1552×900 ÖLÇÜMÜ (HEDEF — kullanıcının penceresi ~1560 px):
 *   ilk posterin sol kenarı (içerik bloğunun etkin sol boşluğu) ..... 10 px
 *   içerik bloğu (ilk poster → "Top anime" sağ kenarı) .............. 1532 px (10 → 1542)
 *   poster kartı ................................................... 174 × 243.59 px (1:1.4)
 *   yatay kart boşluğu ............................................. 20 px (kart adımı 194 px)
 *   satır boşluğu .................................................. 20 px (satır adımı 326.36 px)
 *   satır başına kart .............................................. 6
 *   ana kolon : kenar çubuğu ....................................... 1144 : 368 px (%75 : %25)
 *   ana kolon ↔ kenar çubuğu boşluğu ............................... 20 px
 *   hero bandı → ilk içerik satırı ................................. 187.13 px
 *
 * 1600×900 ÖLÇÜMÜ (kartın pencereyle küçüldüğünün kanıtı):
 *   sol boşluk 10 px · içerik bloğu 1580 px · ana kolon 1180 px ·
 *   satır başına 6 kart · kart 180 × 252 px · boşluklar yine 20 / 20 px.
 *   Yani kart genişliği = pencerenin %12.5'i − 20 px (1552 → 174, 1600 → 180).
 *
 * YENİ REFERANS DOMAINİ — anikototv.to/home (aynı ürün, yeni adres), 1552×900'de
 * gerçek tarayıcıda yeniden ölçüldü. Kurallar anikoto.cz ile AYNI çıktı; yalnızca:
 *   · kart 172.13 × 240.97 px (bizde 174 × 243.6). Fark ~1.9 px ve kaynağı
 *     KAYDIRMA ÇUBUĞU: referans sayfasında dikey çubuk var, düzen genişliği
 *     1537 px (1552 değil). Kural aynı, ölçüm zemini 15 px dar → DEĞİŞİKLİK YOK.
 *   · ana kolon : kenar çubuğu = 1152.75 : 384.25 px (bizde 1144 : 368). Kenar
 *     çubuğu İÇERİĞİ referansta 364.25 px → aramızdaki fark ~3.75 px, 4 px
 *     eşiğinin ALTINDA; ana kolonun %75 ritmi korunur → DEĞİŞİKLİK YOK.
 *   · sol boşluk 10 px · kart boşluğu 20 px · satır boşluğu 20.27 px · satırda 6
 *     kart · kart ↔ kenar çubuğu görsel boşluğu 20 px → HEPSİ BİZDE AYNI.
 *   · HERO → İLK İÇERİK SATIRI: referansta başlık tepesi 257.13 px, ilk poster
 *     tepesi 312.63 px (bizde 187.5 px). Farkın TAMAMI, referansın hero'dan
 *     sonra koyduğu ve BİZDE BİLEREK OLMAYAN bloklardır (bookmark uyarısı 36 px +
 *     sabitlenmiş topluluk 50.75 px + paylaşım şeridi 89.38 px + aralarındaki
 *     boşluklar). Referansın KENDİ boşluk kuralı yine 40.5 px'tir
 *     (`#hotest{margin:2rem 0 3rem}`); bunu birebir uygulamak ~125 px ÖLÜ BOŞLUK
 *     demek olurdu. Veri uydurmadan boşluk eklenmez → 119 px KORUNDU.
 *   · KENAR ÇUBUĞU PANELİ KART DEĞİL: referansta `section#top-anime` için
 *     border-radius 0 / padding 0 / zemin şeffaf; görsel kart yalnızca her
 *     satırın `.inner` kabıdır. Eski dış HUD kabuğu (reanime.to ölçümü) bu yüzden
 *     KALDIRILDI. Panel başlığı 27 px / 600 / letter-spacing normal ve
 *     `padding-left: 5 px` (bizdeydi 20 px / 700 / tight) → DÜZELTİLDİ. Sekmeler
 *     artık "pill" grubu (kutu dolgusu 3 px, köşe 5 px; etiket 2×8 px dolgu,
 *     köşe 3 px, 13.5 px / 600, aktif DOLU) → DÜZELTİLDİ; RENKLER bizim
 *     temamızdan. Referansın 3 kolonlu bandı KOPYALANIR: YENİ ÇIKANLAR / YENİ
 *     EKLENENLER / TAMAMLANANLAR. Üçüncü kolon gerçek bir "tamamlandı" alanı
 *     bulunmadığı için belgelenmiş bir VEKİL ölçütle beslenir (bkz.
 *     `COMPLETED_STALE_DAYS`); program/reyting blokları da KOPYALANMAZ, çünkü
 *     şemada karşılıkları yok.
 *
 * NEDEN KAP 1800 px + 10 px: referansın kendi kabı bu. 1552 px'te kap 1800'e
 * henüz dayanmadığı için içerik 10 px yan boşlukla 1532 px kalır; pencere
 * ~1820 px'i geçince kap 1800'e oturur ve içerik ortalanır. Yan boşluğu 10 px'ten
 * büyütmek ölçülen referans değerlerinden uzaklaşır, bu yüzden 10 px korunur.
 *
 * NEDEN KART GENİŞLİĞİ SINIRLI (ızgara notu aşağıda): "posterler çok büyük ve sol
 * kenara yapışık" şikâyetinin sebebi, kabın TAM genişliğini kullanan ızgaralarda
 * kartın 1552 px'te 238.66 px'e çıkmasıydı; referansın kartı 174 px.
 *
 * Bölüm başlığı tipografisi (HEAD_ROW/HEAD_BAND) ve bölümler arası boşluk
 * (SECTION_GAP) da aynı ölçümden gelir:
 *   bölüm başlığı : 27 px / 600, başlık altı boşluk 15 px, bölümler arası 40 px
 *   bant başlığı  : 20.25 px, BÜYÜK HARF, soluk, başlık altı boşluk 10 px
 *
 * (Kenar çubuğu SATIR (RankedRow) ölçüleri reanime.to/home "Top Trending"
 *  panelinden; tam liste `RankedRow` üstündeki ölçüm notunda. Panelin DIŞ kart
 *  kabuğu ARTIK YOK: yeni referans anikototv.to panelde kart kabuğu kullanmaz.)
 *
 * NOT: buradaki değerler yalnızca ÖLÇÜDÜR. Referansın renkleri, markası, ikonları
 * KOPYALANMAZ; renkler bizim temamızdan (koyu yüzey + ana kırmızı) gelir.
 */
const PAGE_CONTAINER = "mx-auto w-full max-w-[1800px] px-2.5";

/**
 * Ana kolondaki poster ızgaralarının ortak düzeni (referansın kendi kuralı:
 * `.ani.items .item{width:16.667%}` → masaüstünde 6 sütun).
 *
 * NEDEN 6 SÜTUN: referansta HOME'daki TÜM poster ızgaraları iki kolonlu alanın
 * %75'lik ana kolonundadır ve 20 px boşlukla 6 sütun, ölçülen kart genişliğini
 * tam verir. Aritmetik (20 px boşluk = `gap-5`):
 *   1552 px pencere → ana kolon 1144 px → kart = (1144 − 5×20)/6 = 174 px ✓
 *   1600 px pencere → ana kolon 1180 px → kart = (1180 − 5×20)/6 = 180 px ✓
 * Referans aynı genişliklerde 174 ve 180 px ölçüldü; yani kart hem birebir aynı
 * hem de referanstaki gibi pencereyle birlikte büyüyüp küçülüyor.
 *
 * Bu düzen YALNIZCA kabı referansın ana kolonu kadar (içeriğin %75'i) olan
 * ızgaralarda doğrudur. Ana kolon tam genişliğe yayıldığında (kenar çubuğu
 * verisi yok) veya tam kap genişliğindeki bir bölümde ("Bu sezon") aynı 6 sütun
 * 1532 px'te 238.66 px kart üretir — referanstan ~%37 büyük. O durumlarda
 * `DISCOVERY_GRID_CAPPED` kullanılır. Telefonda 2 → 3 → 4 sütun (eski davranış).
 */
const DISCOVERY_GRID = "grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6";

/**
 * Kabı referansın ana kolonundan GENİŞ olan ızgaralar için düzen. Sabit sütun
 * sayısı burada ölçülen kart genişliğini tutturamadığı için kart genişliği
 * sınırlanır: `repeat(auto-fill, minmax(160px,1fr))` → kart asla referansın
 * kartından büyük olmaz, sütun sayısı sığdığı kadar artar.
 *
 * ARİTMETİK (20 px boşluk): sütun = (kap + 20) / (160 + 20), kalan boşluk eşit
 *   1552 px pencere, tam kap 1532 px → (1532+20)/180 = 8.62 → 8 sütun
 *      → kart = (1532 − 7×20)/8 = 1392/8 = 174 px  (referans 174 px ✓)
 *   1600 px pencere, tam kap 1580 px → (1580+20)/180 = 8.88 → 8 sütun
 *      → kart = (1580 − 7×20)/8 = 1440/8 = 180 px  (referans 180 px ✓)
 *   1552 px pencerede ana kolon tam genişliğe yayılırsa (kenar çubuğu yok)
 *      → (1532+20)/180 = 8.62 → 8 sütun → kart = 174 px (eskiden 238.66 px)
 */
const DISCOVERY_GRID_CAPPED =
  "grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-[repeat(auto-fill,minmax(160px,1fr))]";

/**
 * Bölüm başlıklarının tipografik ölçeği (referanstan ölçüldü):
 *   · ana kolon başlığı : 27 px (2rem), 600, letter-spacing normal
 *   · bant kolonu başlığı: 20.25 px (1.5rem), BÜYÜK HARF, soluk renk
 *   · başlık altı boşluk : 15 px (bantta 10 px)
 *   · bölümler arası      : 40 px
 * NEDEN SABİT: aynı ölçek üç ayrı yerde (satır başlığı, bant, kenar çubuğu)
 * kullanılıyor; tek yerde tutulmazsa başlıklar birbirinden sapar.
 */
const HEAD_ROW = "text-[27px] font-semibold tracking-normal text-foreground";
const HEAD_BAND = "text-[20px] font-semibold tracking-normal text-muted-foreground uppercase";
/** Başlığın altındaki boşluk: referans `section .head` margin-bottom 15 px. */
const HEAD_GAP_ROW = "mb-[15px]";
/** Bant başlığının altındaki boşluk: referans `section.top-table .head` 10 px. */
const HEAD_GAP_BAND = "mb-2.5";
/** Bölümler arası boşluk: referans `section { margin-bottom: 40px }`. */
const SECTION_GAP = "mb-10";

/**
 * BANT SATIRI ÖLÇÜLERİ — anikototv.to/home'un ALT BANDI, gerçek tarayıcıda
 * ~1552×900'de ölçüldü. Kaynak: `AnikotoTheme/assets/css/style.css?v=6.7`
 * (`.top-tables` ve `section.top-table … .item` kuralları) + sitenin kök yazı
 * ölçüsü `body,html{font-size:13.5px}` (bu yüzden aşağıdaki rem değerleri px'e
 * çevrildi). Kullanıcının penceresi ~1552 px olduğu için kırılım da bu ölçüde
 * doğrulandı.
 *
 * KAP VE KOLONLAR
 *   `.top-tables`              → `margin:0 -10px` (bant kabın dışına 10 px taşar)
 *   `section.top-table`        → ÜÇ kolon; her biri %33.33 + `padding:0 10px`
 *                                ⇒ kolonlar arası görsel boşluk 20 px (10+10)
 *   kırılım                    → 1199.98 px ALTI: kolonlar %100 (alt alta)
 *   `.head`                    → `margin-bottom:10px`; başlık 1.5rem = 20.25 px,
 *                                BÜYÜK HARF; ok `.text-gray2`
 *   (Bizim `grid gap-5 min-[1200px]:grid-cols-3` düzeni AYNI sonucu verir:
 *    referans kolonu = (W+20)/3 − 20 = (W−40)/3, bizimki = (W−40)/3.)
 *
 * SATIR (`.item`) — KUTU, ÇİZGİ DEĞİL
 *   `background:#142030; padding:10px; border-radius:5px; margin-bottom:15px;
 *    display:flex`
 *   UYARI: referansta satırlar arasında AYIRICI ÇİZGİ (divider) YOKTUR; ayrımı
 *   15 px boşluk ve satırın kendi kutusu yapar. Bu yüzden eski `divide-y`
 *   KALDIRILDI (kullanıcı "tıpatıp" istedi).
 *   satır yüksekliği           → 10 + 65 + 10 = 85 px (içerik 65 px: kapak)
 *   kapak (`.poster`)          → genişlik 50 px, oran `padding-bottom:130%`
 *                                ⇒ 50 × 65 px, `border-radius:3px`, taşma gizli
 *   bilgi (`.info`)            → `margin-left:10px` (bizde `gap-2.5`), dikey ortada
 *   başlık (`.info .name`)     → 1.2rem = 16.2 px / 500, `line-height:1.4rem` =
 *                                18.9 px, alt boşluk 6 px, 2 satıra kırpılır
 *   meta (`.info .meta`)       → 1rem = 13.5 px, `line-height:1.5rem` = 20.25 px,
 *                                tek satır (line-clamp 1)
 *   meta ayracı (`.dot+.dot`)  → içerik `/`, `margin-left:5px; margin-right:8px`,
 *                                `opacity:.1`
 *   rozet (`.ep-status`)       → `padding:0 3px` (ilk öğede soldan 4 px),
 *                                `height` ve `line-height` = 1.29rem = 17.415 px,
 *                                `border-radius:1.5px`, 0.9rem = 12.15 px / 600,
 *                                metin beyaz %80; arka planı EĞİK
 *                                (`skewX(345deg)` = −15°) ve renkli
 *                                (sub `#0084b9`, dub `#b1495c`)
 *   tarih                      → meta şeridinin SON öğesi (satır akışının sağ
 *                                ucunda; ayrı bir sütun/sağa yaslama YOK)
 *
 * RENK: referansın paleti (#142030 / #0084b9 / #b1495c / #a0b1c5 / #515f75)
 * KOPYALANMAZ; aynı ROLLER bizim tema belirteçlerine bağlanır (satır zemini
 * `bg-card`, hover `bg-secondary`, rozet `bg-primary` + `primary-foreground`,
 * soluk meta `muted-foreground`). Ölçüler birebir uygulanır.
 */
const BAND_ROW =
  "group flex items-center gap-2.5 rounded-[5px] bg-card p-2.5 transition-colors hover:bg-secondary";
const BAND_ROW_POSTER = "h-[65px] w-[50px] shrink-0 rounded-[3px] object-cover";
const BAND_ROW_TITLE =
  "mb-1.5 line-clamp-2 text-[16.2px] font-medium leading-[18.9px] text-foreground transition-colors group-hover:text-primary";
const BAND_ROW_META = "flex items-center text-[13.5px] leading-[20.25px] text-muted-foreground";
/** Meta öğeleri arasındaki referans ayracı: `/` , 5 px sol / 8 px sağ, %10 opak. */
const BAND_META_SEP = "ml-[5px] mr-2 select-none text-foreground/10";
const BAND_BADGE =
  "relative inline-flex h-[17.415px] items-center rounded-[1.5px] px-[3px] pl-1 text-[12.15px] font-semibold leading-[17.415px] text-primary-foreground/80";
/** Rozetin EĞİK zemini — referansta `skewX(345deg)`. */
const BAND_BADGE_BG = "absolute inset-0 [transform:skewX(-15deg)] rounded-[1.5px] bg-primary";
/** Satırlar arası boşluk: referans `.item { margin-bottom: 15px }` (çizgi yok). */
const BAND_ROWS_GAP = "space-y-[15px]";

/**
 * Bant kolonlarının ızgarası — referansın KENDİ düzeni: üç kolon YALNIZCA
 * 1200 px ve üzeri pencerelerde yan yana (`min-[1200px]` = referansın
 * `@media (max-width:1199.98px)` eşiği), altında alt alta yığılır.
 *
 * NEDEN SABİT ÜÇ SÜTUN: önceki sürüm ızgara sınıfını ÇİZİLEN kolon sayısından
 * hesaplıyordu (tek kolon veri geldiğinde sağda ölü alan kalmasın diye). Üçüncü
 * kolon artık her veri kümesinde doldurulduğu için o dengeye gerek kalmadı;
 * referansın kendi üç kolonlu düzeni kullanılır (kullanıcı isteği: "üçü ayrı
 * ayrı, tıpatıp").
 */
const BAND_GRID = "grid gap-5 min-[1200px]:grid-cols-3";

/**
 * Ana kolondaki TÜM poster ızgaralarının ("devam et" ve "Son Bölümler") ortak
 * kartı. Sınıflar ana sayfanın ana ızgarasındaki kartla birebir aynıdır:
 * `card-hover rounded-2xl bg-card shadow-2xl`, 2:3 poster, `group-hover:scale-105`,
 * altta kalın başlık + küçük meta satırı. Tek fark: alt satırın metni çağıran
 * tarafından verilir ("S1B5 · bölüm adı" ya da "S1B5'ten devam et").
 */
function PosterCard({
  slug,
  season,
  episode,
  title,
  image,
  meta,
  metaClassName,
  className,
}: {
  /**
   * Hedef serinin slug'ı. Boşsa kart BAĞLANTISIZ çizilir (veritabanı kaydı
   * olmayan yedek içerikte gidilecek bir sayfa yoktur).
   */
  slug?: string | undefined;
  /**
   * Kartın açacağı sezon. İzleme adresi artık YOL olarak kurulur
   * (`/anime/<slug>/season/<n>/episode/<n>`); değer verilmezse 1 yazılır ve izleme
   * sayfası kendi "ilk oynatılabilir sezon" mantığına düşer (eskiden parametresiz
   * izleme adresiyle açıldığında olan davranışın AYNISI).
   */
  season?: number | undefined;
  /** Kartın açacağı bölüm; yol adresi budur (bkz. `season` notu). */
  episode?: number | undefined;
  title: string;
  image: string;
  meta?: string | undefined;
  metaClassName?: string | undefined;
  className?: string | undefined;
}) {
  const { t } = useLang();
  // Kart sınıfı iki dalda da AYNI tutulur: değişen tek şey gezinme öğesidir.
  const cardClassName = `group card-hover relative block overflow-hidden rounded-2xl bg-card shadow-2xl ${
    className ?? ""
  }`;
  const body = (
    <>
      {/* Poster oranı referanstan ölçüldü: `.ani.poster>a { padding-bottom: 140% }`
          → 1:1.4 (masaüstünde 178×249 px). Eski 2:3 oranı kartı gereğinden uzun
          gösteriyordu. */}
      <div className="aspect-[5/7] overflow-hidden bg-muted">
        <img
          src={image}
          alt={t("home.coverAlt", { title })}
          width={768}
          height={1152}
          loading="lazy"
          className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
        />
      </div>
      {/* Yazı bloğu ölçüsü referanstan: kapağın altında 12 px boşluk, başlık
          16.2 px / 500, altında 10 px. Kart yükseklikleri böylece referanstaki
          gibi tek tip kalır. */}
      <div className="px-3 pt-3 pb-2.5">
        <h3 className="truncate text-[16px] font-medium leading-5 text-foreground">{title}</h3>
        {meta ? (
          <p
            className={
              metaClassName ??
              "mt-1 line-clamp-2 text-[13.5px] leading-[18px] text-muted-foreground"
            }
          >
            {meta}
          </p>
        ) : null}
      </div>
    </>
  );
  // Hedef yoksa (yedek içerik) bugünkü davranış birebir korunur: `href`siz `<a>`.
  if (!slug) {
    return <a className={cardClassName}>{body}</a>;
  }
  // İSTEMCİ İÇİ GEZİNME (`Link`) — ve ÖNDEN ÇEKME (preload) BİLEREK KAPALI.
  // NEDEN: bu kartlar yoğun raflarda/ızgarda yan yana durur ve fareyle üzerinden
  // geçmek tıklama anlamına GELMEZ. `Link`in önden çekmesi her hover'da hedef
  // rotanın yükleyicisini çalıştırır; izleme hedefinin bugün rota
  // yükleyicisi YOK (veri istemcide React Query ile gelir), yani bugün ölçülebilir
  // bir kazanç sağlamaz — ama yükleyici eklendiği gün hover başına boşa okuma
  // (kota/egress) doğar. Bu yüzden ana sayfadaki TÜM kartlarda önden çekme açıkça
  // kapatılır; gezinme yine istemci içi ve anındadır, yalnızca hover ön çekmesi
  // atlanır. (Tıklamada `/anime/$slug` hedefi verisini `showDetailQueryOptions`
  // önbelleğinden okur; ek okuma olmaz.)
  return (
    <Link
      to="/anime/$slug/season/$season/episode/$episode"
      params={{ slug, season: String(season ?? 1), episode: String(episode ?? 1) }}
      preload={false}
      className={cardClassName}
    >
      {body}
    </Link>
  );
}

/**
 * SERİ KARTI — ana ızgaraların ("Bu sezon" ve "A-Z Listesi") ORTAK kartı.
 *
 * NEDEN TEK BİLEŞEN: aynı kart eskiden "Bu sezon" ızgarasının İÇİNDE satır içi
 * yazılıydı. A-Z bölümü de seri listesini çizdiği için işaretleme kopyalanınca
 * iki ızgara zamanla birbirinden sapardı; tek bileşen bunu önler. İşaretleme ve
 * ölçüler ESKİ hâliyle birebir aynıdır (poster 1:1.4, başlık 16 px / 500,
 * alt başlık 13.5 px, "Yakında" rozeti, kart sınıfı).
 */
function SeriesCard({ show }: { show: HeroCard }) {
  const { t } = useLang();
  const cardClassName =
    "group card-hover relative block overflow-hidden rounded-2xl bg-card shadow-2xl";
  const body = (
    <>
      {/* Bölümü olmayan seriler ana sayfadan belli olsun. */}
      {show.id && show.episode_count === 0 && (
        <span className="absolute left-2 top-2 z-10 rounded-full bg-background/95 px-2.5 py-1 text-[11px] font-extrabold text-accent">
          {t("common.comingSoon")}
        </span>
      )}
      {/* Ölçüler keşif kartlarıyla aynı tutuldu (poster 1:1.4, yazı 16 px / 500,
          meta 13.5 px) ki sayfadaki tüm posterler tek boyutta görünsün. */}
      <div className="aspect-[5/7] overflow-hidden bg-muted">
        <img
          src={show.image}
          alt={t("home.coverAlt", { title: show.title })}
          width={768}
          height={1152}
          loading="lazy"
          className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
        />
      </div>
      <div className="px-3 pt-3 pb-2.5">
        <h3 className="truncate text-[16px] font-medium leading-5 text-foreground">{show.title}</h3>
        <p className="mt-1 line-clamp-2 text-[13.5px] leading-[18px] text-muted-foreground">
          {show.subtitle}
        </p>
      </div>
    </>
  );
  // Veritabanı kaydı yoksa (yedek içerik) gidilecek sayfa yoktur: `href`siz <a>.
  if (!show.id) {
    return <a className={cardClassName}>{body}</a>;
  }
  // İSTEMCİ İÇİ GEZİNME; ÖNDEN ÇEKME (preload) KAPALI — tam gerekçe PosterCard
  // üstündeki notta (hover başına boşa Supabase okuması olmasın).
  return (
    <Link
      to="/anime/$slug"
      params={{ slug: showSlug(show) }}
      preload={false}
      className={cardClassName}
    >
      {body}
    </Link>
  );
}

/**
 * Öneri panelinde gösterilen en fazla satır sayısı. YAKLAŞIK bir seçimdir
 * (ölçülmüş bir referans değeri DEĞİL): kutu genişliği ~320 px olduğu için
 * uzun liste kutuyu ekrandan taşırırdı; 5 satır kısa ve tıklanabilir kalır.
 */
const SEARCH_SUGGESTION_LIMIT = 5;

/**
 * ARAMA ÖNERİ PANELİ — arama kutusunun altında açılan küçük koyu kart
 * (masaüstü VE mobil AYNI bileşenden çizilir).
 *
 * ÜST SATIR: büyüteç ikonu + kullanıcının yazdığı metin (ör. `juju`).
 * ALTINDAKİ SATIRLAR: eşleşen her seri için POSTER görseli (küçük kare),
 * seri BAŞLIĞI ve soluk bir meta satırı (`home.resultKind` → "Anime · Seri").
 * Her satır `/anime/<slug>` adresine gider ve projedeki diğer kartların AYNI
 * `Link` kalıbı kullanılır (`preload={false}` — gerekçe: `PosterCard` notu:
 * yoğun listede hover ön çekmesi boşa Supabase okuması yakar).
 *
 * BOŞ KART ÇİZİLMEZ: yazı boşsa ya da eşleşme yoksa bileşen `null` döner.
 * Ölçüler YAKLAŞIKTIR (bu panel için referanstan ölçüm yapılmadı): köşe 16 px,
 * iç dolgu 6 px, satır dolgusu 8 px, poster 40×56 px, başlık 14 px, meta 11 px.
 */
function SearchSuggestionPanel({
  query,
  items,
  className,
}: {
  /** Kutudaki ham yazı — panelin üst satırında AYNEN gösterilir. */
  query: string;
  /** Eşleşen seriler (çağıran `filtered`ten yalnızca ilk birkaçını verir). */
  items: HeroCard[];
  /** Konumlandırma: masaüstünde uçan (absolute), mobilde akış içinde. */
  className?: string | undefined;
}) {
  const { t } = useLang();
  // Eşleşme yoksa ya da yazı boşsa panel HİÇ çizilmez: boş kart bırakılmaz.
  if (!query.trim() || items.length === 0) return null;
  // Satır sınıfı iki dalda da AYNI tutulur: değişen tek şey gezinme öğesidir.
  const rowClassName =
    "group flex items-center gap-2.5 rounded-xl p-2 transition-colors hover:bg-secondary";
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl ${
        className ?? ""
      }`}
    >
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
                  bugünkü kartlarla (bkz. `SeriesCard`) aynı davranış — bağlantısız. */}
              {show.id ? (
                <Link to="/anime/$slug" params={{ slug }} preload={false} className={rowClassName}>
                  {body}
                </Link>
              ) : (
                <span className={rowClassName}>{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * "KALDIĞIN YERDEN DEVAM ET" SATIRININ VERİSİ (cihazda tutulur).
 *
 * NEDEN `frame` VE `fraction` AYRI: ikisi farklı kaynaklardan gelir ve farklı
 * güvenilirliğe sahiptir.
 *   · `fraction` — oynatma konumunun süreye oranı. Konum, kendi oynatıcımızdan
 *     (`timeupdate`) YA DA gömülü oynatıcının `postMessage` bildiriminden
 *     (`event:"time"`) gelir; ikisi de GERÇEK ölçümdür, tahmin değildir.
 *   · `frame` — yalnızca kendi `<video>`muzdan yakalanabilen gerçek kare.
 *     Embed/iframe durumunda ÜRETİLEMEZ (cross-origin) ve boş kalır; o zaman
 *     satır seri posterine düşer. Uydurma kare üretilmez, kırık görsel gösterilmez.
 */
type ContinueItem = {
  show: HeroCard;
  season: number;
  episode: number;
  /** Yakalanmış gerçek kare (data URL); yoksa boş metin → poster gösterilir. */
  frame: string;
  /** 0..1 arası ilerleme; konum kaydı yoksa `null` (çubuk hiç çizilmez). */
  fraction: number | null;
};

/**
 * DEVAM SATIRI — GENİŞ YATAY SATIR (poster kartı DEĞİL).
 *
 * Kullanıcı geri bildirimi: eskiden bu bölüm poster kartlarıyla çiziliyordu ve
 * "kocaman, yer kaplıyor"du. Yeni düzen seri sayfasındaki bölüm satırıyla AYNI
 * mimaridir: solda yatay (ekran görüntüsü oranında) kapak, ortada başlık ve
 * bölüm etiketi, altında ince ilerleme çubuğu. Tek satır, kompakt.
 *
 * ÖLÇÜLER YAKLAŞIKTIR (bir referanstan ölçülmedi): kapak 16:9 kutu, 112 px
 * genişlik; satır dolgusu 10 px; köşe 12 px; çubuk yüksekliği 4 px. Amaç tek
 * satırda kalmak ve poster yüksekliğini ortadan kaldırmak.
 *
 * ÇUBUK HİÇ ÇİZİLMEZ EĞER gerçek konum kaydı yoksa: "%0" gibi uydurma bir
 * dolgu gösterilmez. Bağlantı yine durur, çünkü satırın varlık sebebi
 * "kalınan bölüme dönüş"tür ve o kayıt (izlenen bölüm) mevcuttur.
 */
function ContinueRow({
  slug,
  season,
  episode,
  title,
  image,
  frame,
  fraction,
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
}) {
  const { t } = useLang();
  // Satır sınıfı iki dalda da AYNI: değişen tek şey gezinme öğesidir.
  const rowClassName =
    "group flex items-center gap-3 rounded-xl bg-card p-2.5 transition-colors hover:bg-secondary";
  const percent = fraction === null ? 0 : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  const body = (
    <>
      {/* KAPAK: kare varsa GERÇEK kare, yoksa poster. `EpisodeCover` zinciri
          kırık görselde bir sonraki adaya, o da yoksa nötr numara kutusuna düşer
          — hiçbir durumda kırık görsel gösterilmez. */}
      <span className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-secondary">
        <EpisodeCover
          number={episode}
          numberClassName="font-display text-xl text-foreground/70"
          candidates={[frame, image]}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {/* show.title VERİTABANI içeriğidir → bilerek ÇEVRİLMEZ. */}
        <strong className="truncate text-sm font-bold text-foreground">{title}</strong>
        <span className="text-[11px] font-bold text-primary">
          {/* SEZON ARTIK HER ZAMAN YAZILIR. Kullanıcı isteği (28.09.2026):
              "her zaman sezon yazsın" — eskiden sezon yalnızca 1'den büyükken
              eklenirdi ("5. Bölüm · 2. Sezon"), tek sezonlu dizide hiç görünmezdi. */}
          {t("series.seasonEpisodeLabel", { season, number: episode })}
        </span>
        {/* İNCE İLERLEME ÇUBUĞU — yalnızca gerçek konum kaydı varsa. */}
        {fraction !== null && (
          <span
            role="progressbar"
            aria-label={t("home.continueHeading")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="mt-0.5 block h-1 w-full overflow-hidden rounded-full bg-foreground/10"
          >
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${percent}%` }}
            />
          </span>
        )}
      </span>
    </>
  );
  // Hedef yoksa (yedek içerik) bağlantı çizilmez: bugünkü davranış korunur.
  if (!slug) return <a className={rowClassName}>{body}</a>;
  // Yoğun satır listesi → `preload={false}` (gerekçe: PosterCard notu).
  return (
    <Link
      to="/anime/$slug/season/$season/episode/$episode"
      params={{ slug, season: String(season), episode: String(episode) }}
      preload={false}
      className={rowClassName}
    >
      {body}
    </Link>
  );
}

/**
 * Keşif satırı başlığı: solda büyük-harf başlık + ok, sağda isteğe bağlı
 * "Tümü" bağlantısı. Referanstaki satır başlığının tipografik ölçeğinin aynısı.
 *
 * NEDEN İKİ ÖLÇEK: referans ana kolon başlıklarını 27 px (600) ile, bant
 * kolonlarının başlıklarını ise 20.25 px BÜYÜK HARF ve soluk renkle çiziyor
 * (`section.top-table .head .title`). İki ölçek tek bileşende tutulur ki
 * başlıklar site içinde birbirinden sapmasın.
 */
function DiscoveryRowHeader({
  title,
  moreHref,
  variant = "row",
}: {
  title: string;
  // `| undefined`: `exactOptionalPropertyTypes` açık (bkz. PosterCard notu).
  moreHref?: string | undefined;
  /** "row" = ana kolon satırı, "band" = bant kolonu (küçük, büyük harf). */
  variant?: "row" | "band" | undefined;
}) {
  const { t } = useLang();
  const isBand = variant === "band";
  return (
    <div
      className={`flex items-center justify-between gap-3 border-b border-border pb-3 ${
        isBand ? HEAD_GAP_BAND : HEAD_GAP_ROW
      }`}
    >
      <h2 className={`flex items-center gap-2 ${isBand ? HEAD_BAND : HEAD_ROW}`}>
        {title}
        <ArrowRight size={isBand ? 16 : 20} aria-hidden="true" className="shrink-0 text-primary" />
      </h2>
      {moreHref ? (
        <a
          href={moreHref}
          className="group link-hover flex items-center gap-2 text-[15px] font-semibold text-muted-foreground transition-colors hover:text-accent"
        >
          {t("common.viewAll")}
          <ArrowRight
            size={15}
            aria-hidden="true"
            className="transition-transform group-hover:translate-x-1"
          />
        </a>
      ) : null}
    </div>
  );
}

/** Tek keşif satırı: başlık + poster kartı ızgarası. Boş satır çağıranda hiç çizilmez. */
function DiscoveryRow({
  title,
  moreHref,
  gridClassName,
  children,
}: {
  title: string;
  // `| undefined`: `exactOptionalPropertyTypes` açık (bkz. PosterCard notu).
  moreHref?: string | undefined;
  /**
   * Izgara düzeni. Varsayılan `DISCOVERY_GRID` (6 sütun) yalnızca ana kolon
   * referans genişliğindeyken doğrudur; kenar çubuğu verisi yoksa (ana kolon
   * tam genişliğe yayılır) çağıran `DISCOVERY_GRID_CAPPED` geçirir — yoksa
   * kartlar 174 px yerine 238.66 px'e çıkıyordu ("posterler çok büyük").
   */
  gridClassName?: string | undefined;
  children: ReactNode;
}) {
  return (
    // Bölüm arası boşluk referanstan: `section { margin-bottom: 40px }`.
    <section aria-label={title} className={`${SECTION_GAP} last:mb-0`}>
      <DiscoveryRowHeader title={title} moreHref={moreHref} />
      <div className={gridClassName ?? DISCOVERY_GRID}>{children}</div>
    </section>
  );
}

/* ============================================================================
 * ANILIST'TEN BESLENEN İKİ ANA KOLON BÖLÜMÜ — blueprint §2.6 ve §2.8
 * ----------------------------------------------------------------------------
 * NEDEN BURADA ÖNCEDEN HİÇBİR ŞEY ÇİZİLMİYORDU (ve neden artık çiziliyor): bu iki
 * bölüm sayfada "VERİ YOK" notuyla boş bırakılmıştı. Gerekçe gerçekti: `shows`
 * şemasında yayın durumu ya da ilk yayın tarihi tutan alan YOK (`status`,
 * `premiered`, `next_airing` bulunmuyor) ve `show_episodes` yalnızca `created_at`
 * (SİTEYE EKLENME zamanı) taşır, yayın saati taşımaz. Uydurma liste gösterilmedi.
 *
 * Artık İKİSİ DE GERÇEK VERİYLE dolar: AniList GraphQL API'si (anahtar GEREKMEZ,
 * giriş GEREKMEZ). Veri `/api/anilist` SUNUCU ROTASINDAN alınır.
 *
 * NEDEN SUNUCU ROTASI (tarayıcıdan doğrudan çağrı YOK) — İKİ SEBEP:
 *   1) ÖNBELLEK: AniList'in CORS'u açıktır ama yanıtlarında **CDN önbelleği
 *      YOKTUR** (`Cache-Control: no-cache, private` — ölçüldü). Tarayıcıdan
 *      çağrılsaydı her sayfa görüntülemesi AniList'e bir istek olurdu ve 30
 *      istek/dk sınırına çarpardık. Önbelleği BİZ kuruyoruz: rota sonucu
 *      `cachedRead` ile TTL boyunca hatırlanır (upcoming 6 saat, takvim 3 saat;
 *      gerekçeler lib/server-cache.ts içinde), yani upstream isteği "ziyaretçi
 *      başına" değil "önbellek dolumu başına" olur.
 *   2) SÖZLEŞME: rota yanıtı COMPACT'tır (yalnızca çizilen alanlar) ve saat/tarih
 *      metinleri sunucuda İstanbul saatine göre üretilir; istemci biçimlendirme
 *      yapmaz, tarayıcı saat dilimi sonucu değiştiremez.
 * Supabase'e bu bölümler için HİÇ yazılmaz, okuma da yapılmaz: aşağıdaki eşleştirme
 * sayfada ZATEN yüklü olan seri listesi üzerinden İSTEMCİDE yürür.
 *
 * KATALOĞA BAĞLAMA: AniList kayıtları `idMal` (MyAnimeList kimliği) taşır, bizim
 * `shows.mal_id` kolonu tam olarak onu tutar. Eşleşen kayıt `/anime/<slug>`
 * sayfamıza gider; eşleşmeyen kayıt HİÇBİR YERE gitmez (yerel sayfa UYDURULMAZ).
 * `idMal` `null` olabilir: o kayıtlar eşleştirmeye sokulmaz ve ASLA hata üretmez.
 *
 * SESSİZ BOZULMA: upstream ya da rota hata verirse ilgili bölüm HİÇ çizilmez
 * (boş başlık, hata kutusu, yükleme iskeleti yok) ve sayfanın geri kalanı
 * etkilenmez (bkz. `readAnilist`).
 * ========================================================================== */

/** "GELECEK ANİMELER" bölümünde gösterilen en fazla kart (2 satır × 6 sütun). */
const UPCOMING_CARD_LIMIT = 12;

/** React Query anahtarları: iki bölüm ayrı ayrı ve bağımsız bozulacak şekilde sorgular. */
const ANILIST_UPCOMING_QUERY_KEY = ["home-anilist-upcoming"] as const;
const ANILIST_SCHEDULE_QUERY_KEY = ["home-anilist-schedule"] as const;

/** `/api/anilist?section=upcoming` yanıtındaki kayıt. */
type UpcomingItem = {
  id: number;
  /** MyAnimeList kimliği; `null` ise eşleştirme yapılmaz (bkz. `useMalIndex`). */
  malId: number | null;
  title: string;
  english: string | null;
  cover: string;
  /** `YYYY-AA-GG` ya da gün bilinmiyorsa `YYYY-AA`. */
  date: string;
  format: string;
  episodes: number | null;
};

/** `/api/anilist?section=schedule` yanıtındaki tek yayın satırı. */
type ScheduleItem = {
  id: number;
  malId: number | null;
  title: string;
  episode: number | null;
  /** `HH:MM` — İstanbul saati, SUNUCUDA biçimlendirilmiş. */
  time: string;
};

/** Takvimin bir günü. */
type ScheduleDay = { date: string; items: ScheduleItem[] };

/**
 * Sunucu rotasından TEK bir bölümü okur.
 *
 * HATA YUTULUR (bilerek): ağ hatası, 5xx, `ok:false` ya da bozuk gövde → `null`.
 * Çağıran `null`/boş sonucu "bölümü hiç çizme" olarak yorumlar; sayfada hata
 * kutusu ya da boş başlık OLUŞMAZ ve sayfanın geri kalanı etkilenmez.
 */
async function readAnilist<T>(section: "upcoming" | "schedule"): Promise<T | null> {
  try {
    const response = await fetch(`/api/anilist?section=${section}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") return null;
    if ((body as { ok?: unknown }).ok !== true) return null;
    return body as T;
  } catch {
    return null;
  }
}

/** "GELECEK ANİMELER" sorgusu (sunucu önbellekli rota üzerinden). */
function useUpcomingAnime() {
  return useQuery({
    queryKey: ANILIST_UPCOMING_QUERY_KEY,
    queryFn: () => readAnilist<{ ok: true; items: UpcomingItem[] }>("upcoming"),
  });
}

/** Haftalık yayın takvimi sorgusu (sunucu önbellekli rota üzerinden). */
function useWeeklySchedule() {
  return useQuery({
    queryKey: ANILIST_SCHEDULE_QUERY_KEY,
    queryFn: () => readAnilist<{ ok: true; today: string; days: ScheduleDay[] }>("schedule"),
  });
}

/**
 * `idMal` → bizim seri slug'ı indeksi.
 *
 * KAYNAK: sayfada ZATEN yüklü olan seri listesi (`shows`) — EK SUPABASE OKUMASI
 * YOKTUR. `mal_id` tip tanımında `optional`/`nullable` olduğu için üç kapı vardır:
 * sayı değilse, 0/negatifse ya da serinin veritabanı kaydı yoksa (yedek içerik)
 * eşleştirmeye GİRMEZ — böylece kırık ya da uydurma bağlantı doğmaz.
 */
function useMalIndex(shows: ShowWithImage[]): Map<number, string> {
  return useMemo(() => {
    const index = new Map<number, string>();
    for (const show of shows) {
      const malId = show.mal_id;
      if (!show.id) continue;
      if (typeof malId !== "number" || !Number.isFinite(malId) || malId <= 0) continue;
      index.set(malId, showSlug(show));
    }
    return index;
  }, [shows]);
}

/**
 * `YYYY-AA-GG` / `YYYY-AA` metnini GÜN.AY.YIL biçimine çevirir.
 *
 * NEDEN İSTEMCİDE ÇEVİRİ YOK: sunucu tarihleri Türkçe kullanımına uygun biçimde
 * (gün önce) yazar; bu biçim hem `tr` hem `en` için site genelinde geçerlidir
 * (bkz. `isoDate` notu). Dil değişiminde metin değişmez çünkü bir TARİH biçimidir,
 * çeviri değildir; bozuk/eksik parça hiç yazılmaz.
 */
function startDateLabel(date: string): string {
  const [year, month, day] = date.split("-");
  return [day, month, year].filter(Boolean).join(".");
}

/**
 * "GELECEK ANİMELER" kartı: poster + başlık + tarih/biçim/bölüm meta satırı.
 *
 * ÖLÇÜLER sayfadaki diğer poster kartlarıyla (bkz. `PosterCard`/`SeriesCard`)
 * birebir aynıdır ki bu ızgara da tek site gibi görünsün: 5:7 poster, 16 px
 * başlık, 13.5 px meta. Başlık AniList İÇERİĞİDİR (veritabanı metni gibi):
 * romaji her zaman yazılır, arayüz İngilizceyken varsa İngilizce başlık tercih
 * edilir. Eşleşme yoksa kart bağlantısız çizilir (sayfadaki yedek içerik
 * kartlarıyla AYNI davranış: `href`siz `<a>`).
 */
function UpcomingCard({ item, slug }: { item: UpcomingItem; slug?: string | undefined }) {
  const { lang, t } = useLang();
  const cardClassName =
    "group card-hover relative block overflow-hidden rounded-2xl bg-card shadow-2xl";
  // Başlık: içerik metni (çevrilmez), yalnızca dil tercihiyle romaji/İngilizce seçilir.
  const title = lang === "en" && item.english ? item.english : item.title;
  // Meta: başlangıç tarihi · biçim · bölüm sayısı. Bölüm sayısı DİLE BAĞLI olduğu
  // için sözlükten gelir (`plural`: İngilizcede "1 episode"/"12 episodes").
  const meta = [
    startDateLabel(item.date),
    item.format,
    item.episodes ? plural(t, item.episodes, "home.episodeCountOne", "home.episodeCount") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const body = (
    <>
      <div className="aspect-[5/7] overflow-hidden bg-muted">
        <img
          src={item.cover}
          alt={t("home.coverAlt", { title })}
          width={768}
          height={1152}
          loading="lazy"
          className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
        />
      </div>
      <div className="px-3 pt-3 pb-2.5">
        <h3 className="truncate text-[16px] font-medium leading-5 text-foreground">{title}</h3>
        <p className="mt-1 line-clamp-2 text-[13.5px] leading-[18px] text-muted-foreground">
          {meta}
        </p>
      </div>
    </>
  );
  // Kataloğumuzda karşılığı yoksa (ya da `idMal` boşsa) gidilecek YEREL sayfa
  // yoktur: kart bağlantısız çizilir, uydurma adres üretilmez.
  if (!slug) return <a className={cardClassName}>{body}</a>;
  // Yoğun ızgara → önden çekme KAPALI (gerekçe: `PosterCard` notu).
  return (
    <Link to="/anime/$slug" params={{ slug }} preload={false} className={cardClassName}>
      {body}
    </Link>
  );
}

/**
 * Ana kolondaki "GELECEK ANİMELER" bölümü (blueprint §2.6 — referansta
 * `SECTION#upcoming-anime`). Veri gelmezse bölüm BAŞLIĞIYLA birlikte hiç çizilmez.
 */
function UpcomingSection({
  shows,
  gridClassName,
}: {
  shows: ShowWithImage[];
  /** Ana kolon genişliğine göre ızgara sınıfı (bkz. `mainGridClass`). */
  gridClassName: string;
}) {
  const { t } = useLang();
  const query = useUpcomingAnime();
  const malIndex = useMalIndex(shows);
  const items = (query.data?.items ?? []).slice(0, UPCOMING_CARD_LIMIT);
  // BOŞ BAŞLIK YOK: veri yoksa/hata varsa hiçbir şey çizilmez.
  if (items.length === 0) return null;
  return (
    <DiscoveryRow title={t("home.upcomingHeading")} gridClassName={gridClassName}>
      {items.map((item) => (
        <UpcomingCard
          key={item.id}
          item={item}
          slug={item.malId === null ? undefined : malIndex.get(item.malId)}
        />
      ))}
    </DiscoveryRow>
  );
}

/**
 * Ana kolondaki "Estimated Schedule" bölümü (blueprint §2.8 — referansta
 * `#schedule-block > #schedule`): 7 günlük yayın takvimi, GÜNE GÖRE GRUPLU.
 *
 * GÜN SEKMELERİ: referansın gün şeridinin karşılığıdır. Sekmeler SUNUCUDAN gelen
 * gün listesidir (uydurma sabit 7 gün değil, gerçekten yayını olan günler); varsayılan
 * gün sunucunun İstanbul saatine göre işaretlediği `today`dir, listede yoksa ilk gün.
 *
 * SAAT DİLİMİ: satır saatleri (`HH:MM`) ve gün sınırları SUNUCUDA Europe/Istanbul
 * ile üretilir (bkz. api.anilist.ts). İstemci `Intl` ile yalnızca HAFTA GÜNÜ adını
 * yazar; tarayıcının saat dilimi listeyi kaydıramaz.
 *
 * "Now: <tarih saat>" satırı BİLEREK ÇİZİLMEZ: sunucudan gelen önbellekli veriyle
 * canlı bir saat göstermek yanıltıcı olurdu (TTL 3 saat). Uydurma zaman yazılmaz.
 */
function ScheduleSection({ shows }: { shows: ShowWithImage[] }) {
  const { lang, t } = useLang();
  const query = useWeeklySchedule();
  const malIndex = useMalIndex(shows);
  // Kullanıcının seçtiği gün. `null` = seçim yok → sunucunun `today`si açılır.
  // NEDEN `useState` + türetme (effect DEĞİL): veri asenkron geldiği için effect ile
  // senkronlamak fazladan render demekti; değer render sırasında türetilir.
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const days = query.data?.days ?? [];
  const today = query.data?.today ?? "";

  /**
   * CANLI SAAT — panelin alt şeridinde `YYYY/MM/DD HH:mm:ss`.
   *
   * ── ÖNCEKİ KARAR DEĞİŞTİ (kullanıcı isteği, 27.09.2026) ──────────────────────
   * Bu dosyada daha önce "Now: <tarih saat>" satırı BİLEREK çizilmiyordu; gerekçe
   * şuydu: sunucudan gelen önbellekli takvim verisiyle (TTL 3 saat) canlı bir saat
   * yan yana konunca "veri de canlı" izlenimi doğuyordu.
   *
   * Kullanıcı referansı (reanime.to/home) birebir istedi ve ölçümde o panelin alt
   * şeridindeki saat GERÇEKTEN canlı akıyor (`2026/09/27 23:36:22` → `23:36:26`).
   * Bu yüzden saat eklendi — ama YALNIZCA tarayıcının kendi saati yazılır; takvim
   * verisinin tazeliği hakkında hiçbir iddia taşımaz (yanıltıcı etiket yok).
   */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  /**
   * GÜN PENCERESİ — referansta şerit 3 gün gösterir ve yanlarında ‹ › okları var.
   * `null` = kullanıcı ok kullanmadı; pencere AKTİF GÜNÜ SONA alacak şekilde
   * kurulur (referans ölçümü: aktif gün SUN 27, pencerenin son kutusu).
   */
  const [dayWindow, setDayWindow] = useState<number | null>(null);

  /**
   * LİSTE AÇ / KAPA — referansın alt şeridindeki `More ▾` düğmesinin karşılığı.
   *
   * Referans ölçümü: panelde 9 satır vardır (panel 583 px) ve alt şeritteki düğme
   * `<button>`dur — `href` YOK, yanında 14 px chevron-DOWN ikonu vardır; yani
   * "listeyi genişlet" demektir. Bizim günümüzde 20 yayın olabildiği için panel
   * gereksiz uzuyordu; bu yüzden ilk 9 satır gösterilip `More` kalanı açar. Böylece
   * panel referansın yüksekliğine oturur ve düğme GERÇEKTEN bir iş yapar (ölü
   * düğme konmaz — daha önce bu yüzden hiç koymamıştım).
   */
  const [expanded, setExpanded] = useState(false);
  const ROW_LIMIT = 9;
  const activeDate =
    pickedDay ?? (days.some((day) => day.date === today) ? today : (days[0]?.date ?? ""));
  const activeDay = days.find((day) => day.date === activeDate);

  /**
   * NOT: eski `dayLabel` ("Pzt 25" / "Bugün") KALDIRILDI. Referans panelinde gün
   * kutusu iki satırdır (üstte hafta günü, altta gün numarası) ve numara kendi
   * kutusunda gösterilir; tek satırlık etiket kullanılmıyor → yerini yukarıdaki
   * `dayWeekday` + `day.date.slice(8, 10)` aldı. Kullanılmayan fonksiyon
   * bırakmamak için silindi.
   */

  // VERİ YOKSA PANEL YOK: başlık, boşluk ve hata kutusu bırakılmaz.
  if (days.length === 0 || !activeDay || activeDay.items.length === 0) return null;

  /**
   * GÜN PENCERESİ (3 kutu) + ok durumları.
   * Referans ölçümü: şeritte 3 gün kutusu var, yanlarında 36×36 ‹ › düğmeleri
   * durur; pencere dışında gün kaldığında ilgili ok pasif olur (ölçümde `Next day`
   * `disabled` idi çünkü aktif gün pencerenin sonundaydı).
   */
  const activeIndex = Math.max(
    0,
    days.findIndex((day) => day.date === activeDate),
  );
  const maxStart = Math.max(0, days.length - 3);
  const startIndex = Math.min(dayWindow ?? Math.max(0, activeIndex - 2), maxStart);
  const windowDays = days.slice(startIndex, startIndex + 3);

  /** Gün kutusunun üst satırı: hafta günü kısaltması (bugünse "Bugün"/"Today"). */
  const dayWeekday = (date: string): string => {
    if (date === today) return t("home.scheduleToday");
    const parsed = new Date(`${date}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed
      .toLocaleDateString(lang === "en" ? "en-US" : "tr-TR", { weekday: "short" })
      .toUpperCase();
  };

  const pad2 = (value: number): string => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}/${pad2(now.getMonth() + 1)}/${pad2(now.getDate())} ${pad2(
    now.getHours(),
  )}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;

  /**
   * PANEL — reanime.to/home "Estimated Schedule" panelinin karşılığı.
   * Ölçüler gerçek tarayıcıda computed style ile alındı (1912×863, 27.09.2026):
   * · kutu 446×583, padding 16, radius 12, 1 px kenarlık rgba(255,255,255,.055),
   *   160° gradyan zemin, `0 16px 40px -18px` siyah gölge, `overflow: hidden`;
   * · BAŞLIK METNİ YOK — referansta da yok, panel doğrudan gün sekmeleriyle başlar;
   * · üst şerit: 36×36 ‹ › düğmeleri + 3 gün kutusu (üstte 10 px büyük harf gün adı,
   *   altta 64×30 gün numarası; aktif gün ana renk + 1.05 ölçek);
   * · satırlar 40 px yüksek, 8 px aralık, saat sütunu 48 px mono 12.5 px, başlık
   *   13.5 px, bölüm rozeti 11 px mono (arka plansız);
   * · alt şerit: canlı `YYYY/MM/DD HH:mm:ss` (12 px mono).
   *
   * `More` düğmesi ÇİZİLMEDİ: referansta tam takvim sayfasını açar, bizde o rota
   * yok; çalışmayan ölü düğme koymak yerine hiç konmadı (istenirse rota açılıp
   * bağlanır). Kutu köşeleri referansta 0 px'tir (gün kutuları/satırlar/oklar) —
   * yalnızca panelin kendisi 12 px yuvarlaktır; ölçüye sadık kalındı.
   */
  return (
    <div className="relative overflow-hidden rounded-[12px] border border-white/[0.055] bg-[repeating-linear-gradient(-82deg,rgba(255,255,255,0.008)_0px,rgba(255,255,255,0.008)_1px,transparent_1px,transparent_26px),linear-gradient(160deg,#101118,#0b0c11)] p-4 shadow-[0_16px_40px_-18px_rgba(0,0,0,0.9)]">
      {/* KÖŞE SÜSLERİ — referansın `.hud-corner-tl` / `.hud-corner-br` /
          `.hud-vents` elemanları (ölçüm: 14×14 px köşe çizgileri,
          rgba(255,255,255,0.14); 52×12 px çapraz tırnak şeridi).
          Süs oldukları için `aria-hidden`; tıklamayı engellemesinler diye
          `pointer-events-none`. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-2 top-2 z-[2] size-3.5 border-l border-t border-white/[0.14]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-2 right-2 size-3.5 border-b border-r border-white/[0.14]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[7px] right-[30px] h-3 w-[52px] bg-[repeating-linear-gradient(-82deg,rgba(255,255,255,0.13)_0px,rgba(255,255,255,0.13)_2px,transparent_2px,transparent_9px)]"
      />
      <div className="mb-4 flex items-center justify-between border-b border-white/[0.07] pb-4">
        <button
          type="button"
          onClick={() => setDayWindow(Math.max(0, startIndex - 1))}
          disabled={startIndex === 0}
          aria-label={t("home.schedulePrevDay")}
          className="grid size-9 shrink-0 place-items-center bg-secondary text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={16} />
        </button>
        <div
          role="tablist"
          aria-label={t("home.scheduleDayAria")}
          className="flex items-center gap-4"
        >
          {windowDays.map((day) => {
            const active = day.date === activeDate;
            return (
              <button
                key={day.date}
                type="button"
                role="tab"
                aria-selected={active}
                title={startDateLabel(day.date)}
                onClick={() => setPickedDay(day.date)}
                className="flex flex-col items-center gap-1.5"
              >
                <span
                  className={`text-[10px] font-bold uppercase tracking-[0.5px] ${
                    active ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {dayWeekday(day.date)}
                </span>
                <span
                  className={`grid h-[30px] w-16 place-items-center text-sm font-black transition-transform ${
                    active
                      ? "scale-105 bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground/85"
                  }`}
                >
                  {day.date.slice(8, 10)}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setDayWindow(Math.min(maxStart, startIndex + 1))}
          disabled={startIndex + 3 >= days.length}
          aria-label={t("home.scheduleNextDay")}
          className="grid size-9 shrink-0 place-items-center bg-secondary text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/*
        SATIRLAR — referansın `a.sched-row` yapısı (ölçüm, panel içi koordinatlar):
        · satır 40 px, `margin: 0 8px 8px`, `padding: 0 8px`, arka plan ŞEFFAF;
        · saat sütunu 48 px (`w-12`), SAĞA DAYALI, mono 12.5 px, en soluk ton;
        · arada 32 px'lik AYIRICI HÜCRE: 1 px dikey çizgi (ana renk %40) ve
          ortasında 5×1 px çentik (ana renk %60). Hover'da çentik büyür ve tam
          ana renge döner (referans: `-ml-6px`, `w-12px`, `bg-primary`);
        · başlık 13.5 px / 500, soluk; hover'da aydınlanır;
        · sağda `EP n` (mono 11 px) + 12 px play ikonu — ikon YALNIZ hover'da
          görünür (referans: `opacity: 0`).
        · TÜR ETİKETİ (TV / TV_SHORT / ONA) ÇİZİLMEDİ: referans bunu AniList'in
          `format` alanından basıyor, bizim takvim yanıtımızda böyle bir alan YOK;
          uydurma etiket yazılmaz (veri katmanına eklenirse buraya konur).
      */}
      <div>
        {(expanded ? activeDay.items : activeDay.items.slice(0, ROW_LIMIT)).map((item) => {
          const slug = item.malId === null ? undefined : malIndex.get(item.malId);
          const rowClassName =
            "group mx-2 mb-2 flex h-10 items-center px-2 transition-colors hover:bg-white/[0.04]";
          const row = (
            <>
              <span className="w-12 shrink-0 text-right font-mono text-[12.5px] font-medium tabular-nums text-foreground/35">
                {item.time}
              </span>
              <span className="relative h-10 w-8 shrink-0">
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-1/2 -ml-px w-px bg-primary/40"
                />
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 top-1/2 z-10 -ml-[2.5px] -mt-px h-px w-[5px] bg-primary/60 transition-all group-hover:-ml-1.5 group-hover:w-3 group-hover:bg-primary"
                />
              </span>
              {/* Başlık AniList İÇERİĞİDİR → bilerek ÇEVRİLMEZ. */}
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                {item.title}
              </span>
              {item.episode ? (
                <span className="ml-4 flex shrink-0 items-center gap-1.5 text-muted-foreground">
                  <span className="font-mono text-[11px] font-medium">EP {item.episode}</span>
                  <Play
                    aria-hidden="true"
                    className="size-3 opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </span>
              ) : null}
            </>
          );
          // Karşılığı olmayan kayıt bağlantısız çizilir (yerel sayfa uydurulmaz).
          return slug ? (
            <Link
              key={`${item.id}-${item.time}`}
              to="/anime/$slug"
              params={{ slug }}
              preload={false}
              className={rowClassName}
            >
              {row}
            </Link>
          ) : (
            <a key={`${item.id}-${item.time}`} className={rowClassName}>
              {row}
            </a>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
        <span className="font-mono text-xs text-muted-foreground">{stamp}</span>
        {/* `More ▾` — referansta `<button>`, href YOK, yanında chevron-DOWN. */}
        {activeDay.items.length > ROW_LIMIT ? (
          <button
            type="button"
            onClick={() => setExpanded((state) => !state)}
            className="flex items-center gap-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            {expanded ? t("home.scheduleLess") : t("home.scheduleMore")}
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={expanded ? "rotate-180 transition-transform" : "transition-transform"}
            />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * KOMPAKT BANTTAKİ SERİ satırının meta öğeleri: `yıl` ve `tür`.
 *
 * NEDEN TAM OLARAK BU İKİ ALAN: referansın bant satırı "format · tarih"
 * ritmini taşır ve bu iki alan şemada GERÇEKTEN var (`shows.year`,
 * `shows.genre`). Referanstaki puan/süre/trend alanlarının bizde karşılığı YOK;
 * uydurma değer yazmak yerine yalnızca var olan alanlar yazılır.
 *
 * NEDEN DİZİ DÖNER: şerit artık referansın ölçüsüne göre çizilir; öğeler
 * arasına referansın `/` ayracı (5 px sol / 8 px sağ, %10 opak) girer. Boş alan
 * hiç yazılmaz (satırda başıboş ayraç kalmaz). Yalnızca İLK tür yazılır çünkü
 * şerit tek satıra kırpılır (truncate) ve uzun tür listesi taşardı. Tür adı
 * veritabanı içeriğidir → bilerek ÇEVRİLMEZ.
 */
function seriesMetaParts(show: ShowWithImage): string[] {
  const year = (show.year ?? "").trim();
  const genre = (show.genre ?? "").split(",")[0]?.trim() ?? "";
  return [year, genre].filter(Boolean);
}

/**
 * Kompakt bant satırı — referansın `section.top-table … .item` satırının
 * BİREBİR kopyası; ölçüler yukarıdaki "BANT SATIRI ÖLÇÜLERİ" notundadır.
 *
 * SATIR: `display:flex`, 10 px dolgu, 5 px köşe, 10 px kapak ↔ metin boşluğu;
 * satırlar arasında 15 px boşluk (kolon `space-y-[15px]`). Referansta AYIRICI
 * ÇİZGİ YOKTUR — satırın kendi kutusu ve 15 px boşluk ayırır.
 *
 * METİN ŞERİDİ: en solda ROZET (referans `.ep-status`: eğik zemin, 17.415 px
 * yükseklik, 1.5 px köşe, 12.15 px / 600, beyaz %80 metin), sonra meta öğeleri
 * ve aralarında referansın `/` ayracı. TARİH, referansta olduğu gibi şeridin
 * SON öğesidir (sağ uçta; ayrı bir sütun ya da sağa yaslama yoktur).
 *
 * NEDEN AYRI BİLEŞEN: üç bant kolonu aynı satırı kullanıyor; ayrı ayrı
 * yazılsaydı biri güncellenmeden kalırdı.
 */
function CompactRow({
  slug,
  watch,
  image,
  title,
  badge,
  badgeTitle,
  meta,
}: {
  // `| undefined` bilerek: projede `exactOptionalPropertyTypes` açık (bkz. PosterCard notu).
  /** Hedef serinin slug'ı; boşsa satır bağlantısız çizilir. */
  slug?: string | undefined;
  /**
   * Verilirse satır İZLEME sayfasına (`/anime/<slug>/season/<n>/episode/<n>`),
   * verilmezse ANİME detayına (`/anime/<slug>`) gider.
   */
  watch?: { season: number; episode: number } | undefined;
  image: string;
  title: string;
  /** Sol baştaki rozet metni (ör. referanstaki bölüm numarası). Boşsa çizilmez. */
  badge?: string | undefined;
  /** Rozetin ipucu balonu (ör. "Bölüm sayısı"). */
  badgeTitle?: string | undefined;
  /** Rozetten SONRAKİ meta öğeleri; aralarına referansın `/` ayracı girer. */
  meta?: string[] | undefined;
}) {
  // Boş öğeler hiç çizilmez: şeritte başıboş ayraç kalmaz.
  const metaItems = (meta ?? []).filter(Boolean);
  // Satır sınıfı iki dalda da AYNI: yalnızca gezinme öğesi değişir.
  const rowClassName = BAND_ROW;
  const body = (
    <>
      {/* Kapak: 50 × 65 px (referans oranı %130), 3 px köşe. */}
      <img src={image} alt="" width={50} height={65} loading="lazy" className={BAND_ROW_POSTER} />
      <span className="min-w-0">
        <strong className={BAND_ROW_TITLE}>{title}</strong>
        {badge || metaItems.length > 0 ? (
          <span className={BAND_ROW_META}>
            {badge ? (
              <span className={BAND_BADGE} title={badgeTitle}>
                {/* Eğik renkli zemin: referans `skewX(345deg)`, renk bizim temadan. */}
                <span aria-hidden="true" className={BAND_BADGE_BG} />
                <span className="relative truncate">{badge}</span>
              </span>
            ) : null}
            {metaItems.map((part, index) => (
              // Anahtar konumla birlikte verilir: iki öğe aynı metni taşısa
              // (ör. yıl ile tarih) React çakışan anahtar uyarısı vermez.
              <span key={`${part}-${index}`} className="flex min-w-0 items-center">
                <span aria-hidden="true" className={BAND_META_SEP}>
                  /
                </span>
                <span className="truncate">{part}</span>
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </>
  );
  // Hedef yoksa (yedek içerik) bugünkü davranış korunur: `href`siz `<a>`.
  if (!slug) {
    return <a className={rowClassName}>{body}</a>;
  }
  // Yoğun bir listedir → `preload={false}` (gerekçe: PosterCard notu).
  return watch ? (
    <Link
      to="/anime/$slug/season/$season/episode/$episode"
      params={{ slug, season: String(watch.season), episode: String(watch.episode) }}
      preload={false}
      className={rowClassName}
    >
      {body}
    </Link>
  ) : (
    <Link to="/anime/$slug" params={{ slug }} preload={false} className={rowClassName}>
      {body}
    </Link>
  );
}

/**
 * Serinin veritabanına eklenme zamanı (`shows.created_at`).
 *
 * Şema doğrulandı: kolon VAR, fakat tip tanımında (content.ts `Show`) yer
 * almıyor; `fetchShows` `select("*, …")` kullandığı için değer çalışma anında
 * gelir. Bu yüzden dar (tek alanlık) bir okuma yapılır. Değer yoksa boş metin
 * döner ve "en yeni" sıralamasında o seriler listenin SONUNA düşer.
 */
function seriesCreatedAt(show: ShowWithImage): string {
  return (show as { created_at?: string }).created_at ?? "";
}

/**
 * Kenar çubuğu satırının meta şeridi: YIL · BÖLÜM · SEZON · İLK TÜR.
 *
 * NEDEN BU SIRALAMA VE NEDEN PUAN YOK: referans satırın meta şeridi
 * "★ puan · biçim · bölümler" ritmini taşır. Bizde puan, süre ve trend verisi
 * BULUNMUYOR; uydurmak yerine elimizde olan DÖRT alan aynı ritimde ve aynı
 * sırayla (yıl → bölüm → sezon → ilk tür) yazılır. Boş olan alan hiç çizilmez,
 * böylece şeritte başıboş ayraç kalmaz.
 */
type RankMeta = { year: string; episode: string; season: string; genre: string };

function rankMeta(show: ShowWithImage, t: Translate): RankMeta {
  // Tür alanı "Aksiyon, Dram, Fantastik" biçiminde; şeritte yalnızca İLK tür
  // gösterilir (şerit tek satır kalmalı ve uzun tür listesi taşırıyordu).
  // NOT: tür adı veritabanı içeriğidir, bilerek ÇEVRİLMEZ.
  const firstGenre = (show.genre ?? "").split(",")[0]?.trim() ?? "";
  return {
    year: show.year ?? "",
    // `plural`: İngilizcede "1 episode"/"1 season" tekil yazılır; Türkçede ek almaz.
    episode:
      show.episode_count > 0
        ? plural(t, show.episode_count, "home.episodeCountOne", "home.episodeCount")
        : "",
    season:
      show.season_count > 0
        ? plural(t, show.season_count, "home.seasonCountOne", "home.seasonCount")
        : "",
    genre: firstGenre,
  };
}

/**
 * Kenar çubuğu satırının ARKA PLAN görseli.
 *
 * KULLANICI GERİ BİLDİRİMİ: "trending'deki kapaklar kötü görünüyor — banner
 * fotoğraflarını kullan, neden onlara başka fotoğraf koydun?"
 *
 * KURAL: ÖNCE serinin BANNER'ı (`shows.banner_image_path` → `fetchShows`
 * içinde imzalanıp `ShowWithImage.banner_image` olarak gelir), banner
 * yoksa/boşsa ESKİ davranış olan POSTER (`image`). Poster yalnızca banner
 * gerçekten yokken çizilir; böylece hiçbir satır görselsiz kalmaz.
 *
 * SORGU: ek bir kolon eklemek GEREKMEDİ — `fetchShows()` zaten
 * `select("*, show_episodes(count), show_seasons(count)")` kullanıyor, yani
 * `banner_image_path` `*` ile geliyor; `src/lib/content.ts` de bu yolu Storage
 * imzalı adrese çevirip `banner_image` alanına yazıyor (bkz. `fetchShows`
 * içindeki `signImagePaths` çağrısı). Kolonun varlığı `types.ts` ve
 * `supabase/migrations/20260923_seasons_banner_content.sql` ile doğrulandı.
 */
function rankArtwork(show: ShowWithImage): string {
  const banner = (show.banner_image ?? "").trim();
  return banner || show.image;
}

/**
 * Kenar çubuğu satırı — referans "Top Trending" satırının BİREBİR kopyası
 * (reanime.to/home, tarayıcıda ölçüldü).
 *
 * REFERANSTA ÖLÇÜLEN SATIR YAPISI (yukarıdan aşağıya değil, soldan sağa):
 *   satır    : 100 px yükseklik, 12 px köşe, 1 px kenarlık, px-4 (16 px) dolgu
 *   kapak    : satırın ARKASINA gömülü TAM KAPLAMA <img> — absolute inset-0,
 *              object-cover, %20 opaklık, mix-blend-screen, %80 gri; üstünde iki
 *              gradyan perde (soldan sağa + alttan yukarı) ve hover'da parıltı
 *   sıra no. : SOLDAKİ 48 px kutuda İKİ KATMAN: arkada 80 px KONTUR rakam
 *              (text-stroke 2 px, %10 opaklık), önde 30 px DOLU rakam; ikisi de
 *              italik ve en kalın (font-black)
 *   metin    : ml-5 (20 px), başlık ile meta arası 6 px
 *   başlık   : 15 px / 700, tek satıra kırpılır (line-clamp-1)
 *   meta     : 12 px / 600 şerit; ikonlar 12 px ve SOLUK, sayılar daha PARLAK
 *   sağda    : 40×40 px yuvarlak düğme — normalde GİZLİ, hover'da kayarak gelir
 *   hover    : satır 8 px sağa + 2 px yukarı kayar, kenarlık parlar, kapak
 *              görünür olur, soldan 6 px'lik vurgu çubuğu çıkar (800 ms, ease-out)
 *
 * NEDEN TAM KAPLAMA ARKA PLAN KOPYALANDI: referansın satırı kapağı okunaklılığı
 * bozmayacak şekilde arka plana gömer; aynı teknik birebir uygulanır. Görsel
 * yüklenmezse geriye yalnızca satır zemini kalır, metin yine okunur.
 *
 * RENK: referans kapağın kendi vurgu rengini (`--hover-color`) kullanır; bizde
 * böyle bir veri YOK, bu yüzden vurgu doğrudan site ana rengine bağlanır
 * (`var(--primary)`). Referansın altın puan rengi de ana renge eşlenir.
 */
function RankedRow({ show, rank }: { show: ShowWithImage; rank: number }) {
  const { t } = useLang();
  const meta = rankMeta(show, t);
  return (
    // KENAR ÇUBUĞU SATIRI — artık İSTEMCİ İÇİ gezinme (`Link`). Temsili yer:
    // aşağıdaki gerekçe sayfadaki TÜM kart/raf/kenar çubuğu bağlantıları için geçerli.
    //
    // ÖNDEN ÇEKME (preload) NEDEN KAPALI (KOTA/EGRESS): satırlar 6'lı bir listede
    // alt alta durur; fareyle ÜZERİNDEN GEÇMEK tıklama değildir. `Link`in
    // varsayılan önden çekmesi her hover'da hedef rotanın yükleyicisini çalıştırır;
    // `/anime/$slug` yükleyicisi `showDetailQueryOptions` ile Supabase'te 4 tablo
    // okuması (`shows` + `show_episodes` + `show_seasons` + `site_settings`) ve
    // Storage imzalaması yapar. Yani listenin üzerinden fareyle geçmek, hiç
    // tıklanmasa bile hover başına BİR okuma yakar. `preload={false}` bu boşa
    // okumayı tamamen kaldırır: gezinme yine istemci içi/anında kalır, sayfa
    // yeniden yüklenmez, reklam ve sorgu önbelleği korunur.
    <Link
      to="/anime/$slug"
      params={{ slug: showSlug(show) }}
      preload={false}
      className="group relative block h-[100px] w-full overflow-hidden rounded-[12px] border border-foreground/5 bg-background text-left transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:translate-x-2 hover:border-foreground/20"
    >
      {/* Hover parıltısı: referans `inset 40px 0 80px -40px var(--hover-color)`. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 opacity-0 transition-opacity duration-[800ms] group-hover:opacity-100"
        style={{ boxShadow: "inset 40px 0 80px -40px var(--primary)" }}
      />
      {/* GÖRSEL: satırın arkasına gömülü tam kaplama — referansın tekniği AYNI
          (absolute inset-0 + object-cover + yıkama + iki gradyan perde), fakat
          kaynak artık BANNER (kullanıcı geri bildirimi: "trending'deki kapaklar
          kötü görünüyor — banner fotoğraflarını kullan"). Banner yoksa poster
          kullanılır; bkz. `rankArtwork`.

          NEDEN KIRPMA VE OPAKLIK DEĞİŞTİ: banner 16:9 (geniş), satır ise
          ~364×100 px (≈3.6:1). `object-cover` + varsayılan konum görüntünün
          ortadaki ~%49'luk dikey bandını alır → esneme/uzama olmaz, kadraj
          bozulmaz. Eski ayar (opacity %20 + grayscale 0.8 + mix-blend-screen)
          dikey posterde çalışıyordu ama geniş banner'ı siyah zeminde "çamur"
          gibi yutuyordu; bu yüzden opaklık %35'e, grileşme 0.35'e çekildi
          (hover'da %80 / gri 0). Yıkama ve gradyanlar AYNEN korundu: metin
          okunurluğu ilk sırada kalır. */}
      <img
        src={rankArtwork(show)}
        alt=""
        width={1280}
        height={720}
        loading="lazy"
        className="absolute inset-0 z-0 size-full object-cover object-center opacity-[0.35] mix-blend-screen grayscale-[0.35] transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-110 group-hover:opacity-80 group-hover:grayscale-0"
      />
      {/* İki perde: soldan sağa (yazı tarafı koyu kalır) + alttan yukarı. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-r from-background via-background/90 to-transparent"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-t from-background via-transparent to-transparent"
      />
      {/* Hover'da soldan çıkan vurgu çubuğu (6 px, ana renk + parıltı). */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-0 bottom-0 left-0 z-10 w-1.5 bg-primary opacity-0 transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:opacity-100"
        style={{ boxShadow: "0 0 20px var(--primary)" }}
      />
      <div className="relative z-10 flex h-full items-center px-4">
        {/* SIRA NUMARASI: solda 48 px kutu; arkada 80 px kontur, önde 30 px dolu.

            NEDEN KONTUR KATMANINDA ARTIK `{rank}` METNİ YOK (çift rakam hatası):
            burada İKİ katman var ve ikisi de AYNI rakamı taşıyordu; arka (kontur)
            katman `aria-hidden="true"` olsa bile rakam DOM'da İKİNCİ bir GERÇEK
            METİN DÜĞÜMÜ olarak duruyordu. Bu yüzden satırın erişilebilirlik/DOM
            metni "11Jujutsu Kaisen", "22Re:Zero" … biçiminde rakamı ÇİFT okuyordu.
            ÇÖZÜM: rakam TEK gerçek metin olarak öndeki 30 px katmanda kalır; arka
            80 px kontur katmanı rakamı `data-rank` özniteliğinden CSS ile
            (`::before` + `attr()`) çizer — DOM'da metin düğümü OLUŞMAZ, ekran
            okuyucu rakamı BİR KEZ okur. Pseudo-öğe ana öğenin tipografisini
            (80 px / font-black / italic / -webkit-text-stroke / opacity) miras
            aldığı ve konumu birebir aynı olduğu için GÖRSEL ÇIKTI DEĞİŞMEZ
            (kontur + dolu rakam görünümü korunur). */}
        <span className="relative flex w-12 shrink-0 items-center justify-center">
          <span
            aria-hidden="true"
            data-rank={rank}
            className="absolute top-1/2 -left-3 -translate-y-1/2 text-[80px] leading-none font-black text-transparent italic opacity-10 transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] before:content-[attr(data-rank)] group-hover:translate-x-1 group-hover:-translate-y-1/2 group-hover:scale-[1.15] group-hover:opacity-30"
            style={{ WebkitTextStroke: "2px var(--primary)" }}
          />
          <span className="relative z-10 text-3xl font-black text-foreground italic drop-shadow-md transition-all duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1 group-hover:scale-[1.15] group-hover:text-primary">
            {rank}
          </span>
        </span>
        {/* METİN: başlık + meta şeridi (araları 6 px). */}
        <div className="ml-5 flex min-w-0 flex-1 flex-col justify-center gap-1.5">
          <h3 className="line-clamp-1 text-[15px] font-bold text-foreground/90 drop-shadow-sm transition-colors duration-300 group-hover:text-foreground">
            {show.title}
          </h3>
          {/* Meta şeridi: referans `flex flex-wrap items-center gap-2.5 text-xs
              font-semibold` — öğe arası 10 px, yazı 12 px / 600. */}
          <span className="flex flex-wrap items-center gap-2.5 text-xs font-semibold">
            {/* 1) YIL — referansın "★ puan" öğesinin slotu: ikon + değer aynı
                renkte (referansta altın, bizde ana renk). İkon 12 px. */}
            {meta.year ? (
              <span
                className="flex items-center gap-1 text-primary"
                style={{
                  filter:
                    "drop-shadow(0 0 8px color-mix(in oklab, var(--primary) 30%, transparent))",
                }}
              >
                <Calendar size={12} aria-hidden="true" className="shrink-0" />
                <span>{meta.year}</span>
              </span>
            ) : null}
            {/* 2) BÖLÜM / SEZON — referansın bölüm çipinin BİREBİR geometrisi:
                4 px köşe, bg-white/5, px-1.5 py-0.5, 10 px / 500 metin; her
                değer ikonlu ve "/" ile ayrılmış. İkonlar soluk (zinc-400 →
                muted-foreground), sayılar daha parlak (white/70 → foreground/70). */}
            {meta.episode || meta.season ? (
              <span className="flex items-center gap-1.5 rounded-[4px] bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-foreground/70 transition-colors group-hover:bg-foreground/10 group-hover:text-foreground">
                {meta.episode ? (
                  <span className="flex items-center gap-1" title={t("home.episodeCountTitle")}>
                    <Tv
                      size={12}
                      aria-hidden="true"
                      className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground/70"
                    />
                    <span>{meta.episode}</span>
                  </span>
                ) : null}
                {meta.episode && meta.season ? (
                  <span className="text-foreground/20 transition-colors group-hover:text-foreground/40">
                    /
                  </span>
                ) : null}
                {meta.season ? (
                  <span className="flex items-center gap-1" title={t("home.seasonCountTitle")}>
                    <Layers
                      size={12}
                      aria-hidden="true"
                      className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground/70"
                    />
                    <span>{meta.season}</span>
                  </span>
                ) : null}
              </span>
            ) : null}
            {/* 3) İLK TÜR — referansın biçim ("TV") öğesinin slotu: soluk metin.
                İkon da metinle aynı ölçüde (12 px) tutulur ki şerit ritmi bozulmasın. */}
            {meta.genre ? (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Tag size={12} aria-hidden="true" className="shrink-0" />
                <span className="line-clamp-1">{meta.genre}</span>
              </span>
            ) : null}
          </span>
        </div>
        {/* Sağdaki 40×40 daire referansta oynatma düğmesidir; bizim satırımız
            seri sayfasına gittiği için aynı ölçüde "seriye git" okunu taşır. */}
        <span className="flex size-10 shrink-0 translate-x-4 items-center justify-center rounded-full bg-foreground/20 text-foreground opacity-0 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:translate-x-0 group-hover:bg-foreground/20 group-hover:opacity-100">
          <ChevronRight size={20} aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}

/** Bant kolonu: küçük büyük-harf başlık + ok ve altında dikey kompakt satırlar. */
function CompactColumn({
  title,
  moreHref,
  children,
}: {
  title: string;
  // `| undefined`: `exactOptionalPropertyTypes` açık (bkz. PosterCard notu).
  moreHref?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      {/* Bant kolonu başlığı referansta daha küçük ve BÜYÜK HARF çizilir. */}
      <DiscoveryRowHeader title={title} moreHref={moreHref} variant="band" />
      {/* Satır arası boşluk referanstan: `section.top-table … .item` 15 px.
          AYIRICI ÇİZGİ YOK: referansta satırlar arasında çizgi bulunmaz,
          ayrımı 15 px boşluk ve satırın kendi kutusu (`bg-card`) yapar. Eski
          `divide-y divide-border` bu yüzden KALDIRILDI. */}
      <div className={BAND_ROWS_GAP}>{children}</div>
    </div>
  );
}

/**
 * ISO tarihi GÜN.AY.YIL biçimine çevirir.
 *
 * NEDEN METİRDEN DİLİMLENİR (`Intl`/`toLocaleDateString` YERİNE): sayfa sunucuda
 * da render edilir. `Intl` ile biçimlendirme sunucu (UTC) ile tarayıcı (yerel
 * saat) arasında bir gün kayabiliyor ve hidrasyon uyuşmazlığı doğuruyordu;
 * tarihi damganın ilk 10 karakterinden (YYYY-AA-GG) okuyunca iki taraf da aynı
 * metni yazar. Damga bozuksa boş metin döner ve meta satırı sade kalır.
 */
function isoDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  return year && month && day ? `${day}.${month}.${year}` : "";
}

/**
 * "TAMAMLANANLAR" İÇİN VEKİL (PROXY) ÖLÇÜT — GERÇEK ALAN DEĞİL, KÜÇÜK BİR
 * MİGRASYONLA DEĞİŞTİRİLMELİDİR
 * ----------------------------------------------------------------------------
 * ŞEMADA TAMAMLANMA YOK: `shows` tablosunda yayın durumu (`status`, `airing`,
 * `completed` vb.) ya da yayının bittiği tarihi tutan bir kolon BULUNMUYOR
 * (bkz. src/integrations/supabase/types.ts). Referansın "Just Completed" kolonu
 * bu yüzden bugüne kadar hiç çizilmiyordu. Uydurma bir "tamamlandı" işareti
 * yazmak yerine, ELDEKİ VERİDEN hesaplanabilen EN YAKIN gerçek sinyal kullanılır:
 *
 *   VEKİL KURAL: serinin EN SON bölümü, eldeki en yeni bölüm tarihinden
 *   `COMPLETED_STALE_DAYS` (30) günden DAHA ESKİ eklenmişse (yani seriye uzun
 *   süredir yeni bir şey gelmiyorsa) ve seri bölüm sayısı bakımından listenin
 *   başında duruyorsa → "bitmiş görünüyor" kabul edilir.
 *
 *   · "ŞİMDİ" REFERANSI VERİDEN ALINIR (eldeki en yeni bölümün damgası),
 *     `Date.now()` DEĞİL: sayfa sunucuda da render edilir; `Date.now()` sunucu
 *     ile istemcide farklı bir kesim noktası üretip hidrasyon uyuşmazlığı
 *     doğurabilirdi. Veriden türeyen eşik iki tarafta AYNI sonucu verir.
 *   · Son bölümü/tarihi bilinmeyen serinin "bittiği" İDDİA EDİLMEZ → listeye
 *     girmez ("kanıt yok" = "tamamlanmadı").
 *   · Vekil hiç sonuç vermezse (ör. bütün bölümler tazeyse) kolon boş kalmasın
 *     diye EN ÇOK BÖLÜMLÜ serilere düşülür.
 *
 * KALICI ÇÖZÜM (bu vekilin yerini almalı): `shows` tablosuna gerçek bir alan
 * eklemek, ör.
 *     ALTER TABLE shows ADD COLUMN airing_status text;   -- ongoing|finished|upcoming
 *     -- veya yayın bitiş tarihi: ALTER TABLE shows ADD COLUMN finished_at date;
 * ve `fetchShows` içinde bu alanı seçip `ShowWithImage`e taşımak. Alan geldiği
 * gün bu blok ve `HomeCompactBand` içindeki vekil hesap SİLİNİR; kolon doğrudan
 * gerçek alandan beslenir.
 * ----------------------------------------------------------------------------
 */
const COMPLETED_STALE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO damgasının GÜN kısmını UTC gece yarısına çevirir; geçersizse `0` döner. */
function isoDayMs(iso: string): number {
  const day = iso.slice(0, 10);
  if (day.length !== 10) return 0;
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * ============================================================================
 * KOMPAKT BANT — "YENİ ÇIKANLAR | YENİ EKLENENLER | TAMAMLANANLAR"
 * ============================================================================
 * Referans (blueprint §2.7: `DIV.top-tables.mb-3`): poster satırlarının altında,
 * her biri "BAŞLIK + ok" olan ÜÇ AYRI kompakt kolon yan yana ve her kolonda
 * ~5 satırlık dikey liste. KULLANICI İSTEĞİYLE bant, ana içeriğin EN SONUNA —
 * footer'ın hemen üstüne ve "Bu sezon" bölümünün hemen altına — alındı (çağrı
 * yeri: `Index()`; ana kolonun içinde değil, tam kap genişliğinde).
 *
 * ÜÇ KOLONUN KAYNAĞI:
 *   1) YENİ ÇIKANLAR   → en yeni BÖLÜMLER (en yeni önce).
 *   2) YENİ EKLENENLER → `shows.created_at`e göre en yeni SERİLER.
 *   3) TAMAMLANANLAR   → VEKİL ölçüt (bkz. `COMPLETED_STALE_DAYS` notu).
 *
 * IZGARA ARTIK SABİT (referansın kendi düzeni): üç kolon 1200 px ve üzerinde
 * yan yana, altında alt alta (`BAND_GRID`). Önceki sürüm sütun sayısını ÇİZİLEN
 * kolon sayısından hesaplıyordu (tek kolon veri geldiğinde sağda ölü alan
 * kalmasın diye); üçüncü kolon artık doldurulduğu için o dengeye gerek yok ve
 * kolon DÜŞÜRÜLMEZ. Hiçbir kolonda veri yoksa bant, başlıkları ve boşluklarıyla
 * BİRLİKTE hiç çizilmez (`return null`) — boş başlık ya da boş ızgara kalmaz.
 */
function HomeCompactBand({ shows }: { shows: ShowWithImage[] }) {
  const { t } = useLang();
  // "Son Bölümler" ızgarasıyla AYNI sorgu anahtarı: sonuç paylaşılır, ikinci bir
  // ağ okuması doğmaz (bkz. `useLatestEpisodes`).
  const latestQuery = useLatestEpisodes(shows);
  const latestPerShow = useMemo(
    () => latestPerShowItems(latestQuery.data ?? []),
    [latestQuery.data],
  );
  // Bant kolonlarındaki satır sayısı referanstan: ~5 satır.
  const newReleases = latestPerShow.slice(0, COMPACT_ROW_LIMIT);

  // Seri başına EN SON bölüm: TAMAMLANANLAR vekilinin tarih kaynağı. Liste zaten
  // seri başına tek bölüme indirilmiştir (bkz. `latestPerShowItems`).
  const lastEpisodeByShow = useMemo(
    () => new Map(latestPerShow.map((item) => [item.show.id, item])),
    [latestPerShow],
  );

  // YENİ EKLENENLER: `shows.created_at` (şema doğrulandı) yeni → eski. Değer tip
  // tanımında (`content.ts` `Show`) olmadığı için `seriesCreatedAt` ile dar bir
  // alan okuması yapılır. Tarihi olmayan (boş metin) seriler listenin SONUNA
  // düşer; tarihler eşitse özgün sıra korunur (kararlı, zıplamayan liste).
  // EK SORGU YOK: liste zaten `shows` içinde yüklüdür.
  const newestSeries = useMemo(
    () =>
      shows
        .filter((show) => Boolean(show.id))
        .map((show, index) => ({ show, at: seriesCreatedAt(show), index }))
        .sort((a, b) => (a.at === b.at ? a.index - b.index : a.at < b.at ? 1 : -1))
        .slice(0, COMPACT_ROW_LIMIT),
    [shows],
  );

  /**
   * TAMAMLANANLAR — VEKİL (bkz. `COMPLETED_STALE_DAYS` notu; gerçek alan DEĞİL).
   * Sıra: önce "uzun süredir yeni bölüm gelmeyen" seriler, bölüm sayısı çok → az.
   * Vekil boş kalırsa en çok bölümlü serilere düşülür.
   */
  const completedSeries = useMemo(() => {
    const withEpisodes = shows.filter((show) => Boolean(show.id) && show.episode_count > 0);
    const byEpisodeCount = (a: ShowWithImage, b: ShowWithImage) =>
      b.episode_count - a.episode_count;
    // "Şimdi" = eldeki en yeni bölüm (sunucu/istemci aynı sonucu versin diye).
    const newestStamp = latestPerShow.reduce(
      (max, item) => Math.max(max, isoDayMs(item.createdAt)),
      0,
    );
    const cutoff = newestStamp - COMPLETED_STALE_DAYS * DAY_MS;
    const stale = withEpisodes.filter((show) => {
      const last = lastEpisodeByShow.get(show.id);
      // Son bölümü bilinmeyen seri "bitmiş" sayılmaz: kanıt yok.
      if (!last) return false;
      const at = isoDayMs(last.createdAt);
      return at > 0 && at < cutoff;
    });
    const source = stale.length > 0 ? stale : withEpisodes;
    return source.sort(byEpisodeCount).slice(0, COMPACT_ROW_LIMIT);
  }, [shows, latestPerShow, lastEpisodeByShow]);

  if (newReleases.length === 0 && newestSeries.length === 0 && completedSeries.length === 0) {
    return null;
  }

  return (
    // Bant kullanıcı isteğiyle ana içeriğin SONUNDA çizilir; kap genişliğini
    // çağıran taraf verir (`Index()` → `PAGE_CONTAINER`). Burada yalnızca bölümler
    // arası boşluk (`SECTION_GAP`, referans: 40 px) uygulanır. Kolonlar 1200 px ve
    // üzerinde 3'e bölünür (bkz. `BAND_GRID`).
    <section aria-label={t("home.bandAria")} className={SECTION_GAP}>
      {/* Üç kolon, referansın kendi düzeninde (bkz. `BAND_GRID`): kolon arası
          20 px = referansın 10 px + 10 px kolon dolgusu. */}
      <div className={BAND_GRID}>
        {newReleases.length > 0 && (
          <CompactColumn title={t("home.newReleases")}>
            {newReleases.map((item) => (
              <CompactRow
                key={item.id}
                // Bölüme doğrudan gider: /anime/<slug>/season/<s>/episode/<n>
                slug={showSlug(item.show)}
                watch={{ season: item.season, episode: item.number }}
                image={item.show.image}
                title={item.show.title}
                // Referansın rozeti bölüm numarasıdır; bizde sezon+bölüm kodu
                // ("S1B5", İngilizcede "S1E5") aynı yuvada durur — harf dile
                // bağlı olduğu için sözlükten gelir.
                badge={t("series.seasonEpisodeCode", {
                  season: item.season,
                  number: item.number,
                })}
                // Tarih, referansta olduğu gibi şeridin SON öğesidir.
                meta={[isoDate(item.createdAt)]}
              />
            ))}
          </CompactColumn>
        )}
        {newestSeries.length > 0 && (
          <CompactColumn title={t("home.newlyAdded")} moreHref="#series">
            {newestSeries.map(({ show }) => (
              <CompactRow
                key={show.slug ?? show.title}
                // Seri detayına gider; veritabanı kaydı olmayan seride bağlantı çizilmez.
                slug={show.id ? showSlug(show) : ""}
                image={show.image}
                title={show.title}
                // Rozet: bölüm SAYISI (şemadaki tek sayısal alan). Referansın
                // "total" rozetiyle aynı yuvadır; ipucu balonu anlamı söyler.
                badge={show.episode_count > 0 ? String(show.episode_count) : undefined}
                badgeTitle={show.episode_count > 0 ? t("home.episodeCountTitle") : undefined}
                // Meta: yıl, ilk tür ve serinin `shows.created_at` tarihi
                // (sıralamanın dayandığı gerçek alan).
                meta={[...seriesMetaParts(show), isoDate(seriesCreatedAt(show))]}
              />
            ))}
          </CompactColumn>
        )}
        {completedSeries.length > 0 && (
          <CompactColumn title={t("home.justCompleted")}>
            {completedSeries.map((show) => {
              const last = lastEpisodeByShow.get(show.id);
              return (
                <CompactRow
                  key={show.slug ?? show.title}
                  slug={showSlug(show)}
                  image={show.image}
                  title={show.title}
                  // Rozet: bölüm sayısı (vekile göre "bitmiş" serinin büyüklüğü).
                  badge={String(show.episode_count)}
                  badgeTitle={t("home.episodeCountTitle")}
                  // Meta: sezon sayısı ve EN SON bölümün eklenme tarihi — vekilin
                  // dayandığı gerçek sinyal ("şu tarihten beri yeni bölüm yok").
                  meta={[
                    show.season_count > 0
                      ? plural(t, show.season_count, "home.seasonCountOne", "home.seasonCount")
                      : "",
                    last ? isoDate(last.createdAt) : "",
                  ]}
                />
              );
            })}
          </CompactColumn>
        )}
      </div>
    </section>
  );
}

/**
 * Hero ALTINDAKİ tüm keşif alanı: iki kolonlu sayfa düzeni (solda geniş ana
 * kolon, sağda dar kenar çubuğu). Her bölüm kendi verisine bakar; veri
 * getirmeyen bölüm BAŞLIĞIYLA birlikte hiç çizilmez (boş başlık/boşluk kalmaz).
 *
 * NOT (kenar çubuğu artık STICKY DEĞİL): blueprint §6'ya göre referansta
 * `fixed`/`sticky` olan TEK eleman site header'ıdır; `aside.sidebar`ın
 * `position` değeri `static`'tir. Bu yüzden eski `lg:sticky lg:top-24`
 * kaldırıldı (bkz. aşağıdaki `aside` notu).
 */
function HomeSections({
  shows,
  continueItems,
}: {
  shows: ShowWithImage[];
  /** Cihazdaki izleme ilerlemesi (localStorage). Boşsa "devam et" satırı yoktur. */
  continueItems: ContinueItem[];
}) {
  const { t } = useLang();
  // NOT: "Yeni eklenenler" (`shows.created_at`) listesi BURADA DEĞİL, kompakt
  // banttadır (`HomeCompactBand`) — bant kullanıcı isteğiyle ana içeriğin SONUNA
  // taşındı. Liste tek yerde (bantta) hesaplanır ki iki yerde tutulup zamanla
  // birbirinden sapmasın.
  // NOT: tür çip şeridi KULLANICI İSTEĞİYLE TÜMÜYLE SİLİNDİ (bkz. `Index`
  // içindeki (a) notu): bu bileşende tür filtresiyle ilgili hiçbir şey çizilmez.

  // Kenar çubuğu sıralama sekmeleri. Sekmeler yalnızca SIRAYI değiştirir; yeni
  // sorgu atılmaz, liste zaten `shows` içinde geliyor.
  const [rankTab, setRankTab] = useState<RankTab>("episode");

  // Kenar çubuğunun ANA KÜMESİ: bölümü olan seriler.
  //
  // NEDEN "En Çok Bölüm" DEĞİL DE "SIRALAMA": projede görüntülenme ya da puan
  // verisi YOK; "en popüler/trend" demek uydurma olurdu. Sıralama, var olan
  // alanlarla (bölüm / sezon / eklenme tarihi) yapılır ve ölçütü sekme etiketi
  // yazar. Bölümü olmayan seriler listeye girmez (hiçbiri bölümlü değilse panel
  // hiç çizilmez). KÜME TÜM SEKMELERDE AYNIDIR: sekme yalnızca sırayı değiştirir,
  // böylece liste sekme değişiminde bir seriyi kaybedip kazanmaz.
  const rankable = useMemo(
    () =>
      shows
        .filter((show) => Boolean(show.id) && show.episode_count > 0)
        .map((show, index) => ({ show, index })),
    [shows],
  );

  // Sekmeye göre yeniden sıralama (istemcide, ek istek yok):
  //   BÖLÜM  → bölüm sayısı (çok → az)
  //   SEZON  → sezon sayısı (çok → az), eşitlikte bölüm sayısı
  //   YENİ   → `shows.created_at` (yeni → eski)
  // Eşitlikte listenin özgün sırası korunur (kararlı, zıplamayan liste).
  const ranked = useMemo(() => {
    const rows = [...rankable];
    if (rankTab === "season") {
      rows.sort(
        (a, b) =>
          b.show.season_count - a.show.season_count ||
          b.show.episode_count - a.show.episode_count ||
          a.index - b.index,
      );
    } else if (rankTab === "new") {
      rows.sort((a, b) => {
        const aAt = seriesCreatedAt(a.show);
        const bAt = seriesCreatedAt(b.show);
        if (aAt === bAt) return a.index - b.index;
        // Tarihi olmayan (boş metin) seriler listenin sonuna düşer.
        return aAt < bAt ? 1 : -1;
      });
    } else {
      rows.sort((a, b) => b.show.episode_count - a.show.episode_count || a.index - b.index);
    }
    return rows.slice(0, RANKED_LIMIT);
  }, [rankable, rankTab]);

  // "Son Bölümler" ızgarası ile bandın "YENİ ÇIKANLAR" kolonu AYNI sorguya bakar
  // (bkz. `useLatestEpisodes` / `readLatestEpisodes`): `queryKey` aynı olduğu için
  // React Query sonucu PAYLAŞIR — ikinci bir ağ okuması doğmaz.
  const latestQuery = useLatestEpisodes(shows);
  // Liste SERİ BAŞINA TEK (en yeni) bölüme indirilir; indirgeme kuralı ortaktır
  // (`latestPerShowItems`) ki ızgara ile bant aynı satırları göstersin. NEDEN: yeni
  // eklenmiş 30 bölümü olan bir seri tek başına 12 kartı doldurup keşif değerini
  // yok ederdi. `latestQuery.data` doğrudan burada okunur: araya bir `?? []` dizisi
  // koymak useMemo bağımlılığını her render'da değiştiriyordu (lint uyarısı).
  const latestPerShow = useMemo(
    () => latestPerShowItems(latestQuery.data ?? []),
    [latestQuery.data],
  );

  const latestCards = latestPerShow.slice(0, LATEST_GRID_LIMIT);
  // NOT: kompakt bant (YENİ ÇIKANLAR | YENİ EKLENENLER | TAMAMLANLAR) KULLANICI
  // İSTEĞİYLE ana içeriğin EN SONUNA taşındı (`Index()` sonundaki yerleşim).
  // Bu bölümün kendi satırları ve kenar çubuğu DEĞİŞMEDİ.
  // Panel ancak sıralanacak seri (bölümü olan) varsa çizilir; yoksa başlık ve
  // boşluk da bırakılmaz. Sekme ne olursa olsun aynı kümeye bakıldığı için
  // "panel var/yok" kararı sekmeye göre değişmez.
  const hasSidebar = rankable.length > 0;
  /**
   * Ana kolondaki ızgaraların sınıfı. Kenar çubuğu çizilirken ana kolon
   * içeriğin %75'i (1552 px'te 1144 px) olur ve 6 sütun tam referans kartını
   * (174 px) verir. Kenar çubuğu verisi yoksa ana kolon TAM genişliğe yayılır;
   * o durumda 6 sütun kartı 238.66 px'e çıkarırdı, bu yüzden kart genişliği
   * sınırlı düzen kullanılır (kart yine 174 px).
   */
  const mainGridClass = hasSidebar ? DISCOVERY_GRID : DISCOVERY_GRID_CAPPED;
  // ERKEN ÇIKIŞ KALDIRILDI: eskiden hiç keşif verisi yoksa bileşen `null` dönüyordu.
  // Erken çıkış yine de geri KONMADI (kapsam dışı bir davranış değişikliği
  // olurdu). Kenar çubuğu kendi verisine bakar; veri yoksa hiç çizilmez.
  // Bölümler yine kendi verisine bakar: veri yoksa yalnızca o bölüm (başlığıyla
  // birlikte) çizilmez, boş başlık/boşluk kalmaz.

  return (
    // İKİ KOLONLU SAYFA ALANI: solda GENİŞ ana kolon (masaüstünde 3 birimin
    // 2'si), sağda DAR kenar çubuğu. `items-start` kritik: kenar çubuğu ana
    // kolonun boyuna UZAMAZ (referansta olduğu gibi kendi içeriği kadar kalır).
    // Kenar çubuğu çizilmiyorsa (bölüm sayısı verisi yok) ana kolon FULL genişliğe
    // yayılır:
    // sağda boş bir üçte bir bırakmak ölü boşluk olurdu.
    // KAP + KOLON RİTMİ (referanstan; 1552 px pencerede ölçüldü): kap max-width
    // 1800 px + 10 px yan boşluk → içerik bloğu 1532 px, ilk kartın sol kenarı
    // 10 px. Masaüstünde 4 birimlik ızgara → ana kolon 3/4 (%75, 1144 px) +
    // 20 px boşluk + kenar çubuğu 1/4 (%25, 368 px): referansla birebir.
    // HERO → İLK İÇERİK SATIRI: eski referansta (anikoto.cz) 187.13 px'ti ve üst
    // boşluk 119 px buna göre seçilmişti (119 + 68.5 = 187.5, hedefe ~0.4 px).
    // Yeni referans (anikototv.to) aynı noktada 257.13 px ölçtü; farkın TAMAMI
    // onun hero'dan sonra koyduğu ve bizde OLMAYAN bloklardır (bookmark uyarısı,
    // sabitlenmiş topluluk, paylaşım şeridi ≈ 176 px + aralarındaki boşluklar).
    // Referansın kendi boşluk kuralı yine 40.5 px; birebir uygulamak ~125 px ÖLÜ
    // BOŞLUK eklerdi ve bu, veri uydurmadan boşluk yazmak olurdu → 119 px KORUNDU.
    <div className={`${PAGE_CONTAINER} grid items-start gap-10 pt-[119px] lg:grid-cols-4 lg:gap-5`}>
      <div className={hasSidebar ? "min-w-0 lg:col-span-3" : "min-w-0 lg:col-span-4"}>
        {/* ── REFERANS 2.1: `#anikoto-bookmark-alert` — DUYURU ŞERİDİ (ÇİZİLMEDİ) ──
            Blueprint §2.1: referans, ANA KOLONUN EN BAŞINDA (hero'nun hemen
            altında, "Latest Episode"dan önce) kapatılabilir bir duyuru şeridi
            çizer: `I.fas.fa-bookmark` ikonu + `P.anikoto-bookmark-alert__text`
            cümlesi + sağda kapatma düğmesi (`BUTTON.anikoto-bookmark-alert__close`);
            sayfa açılışında `is-visible` durumundadır ve ana kolonun tam
            genişliğindedir.
            NEDEN BURADA HİÇBİR ŞEY ÇİZİLMİYOR: bu şerit TAMAMEN İÇERİĞE bağlıdır
            (sitenin kendi duyuru cümlesini taşır). Bizde duyuru metni/alanı
            BULUNMUYOR; cümle uydurmak yasak olduğu için şerit çizilmez. Panelden
            yönetilen gerçek bir duyuru alanı eklendiğinde bu konumda çizilir. */}

        {/* ── REFERANS 2.2: `#community-pinned.cpin` — SABİTLENMİŞ DUYURU (ÇİZİLMEDİ) ─
            Blueprint §2.2: referans burada `Pinned` rozetli bir şerit
            (`DIV.cpin-bar` + `SPAN.cpin-badge` + `DIV.cpin-items` + `BUTTON.cpin-hide`)
            ve altında `DIV.cpin-spot` taşır. `cpin-items` içeriği üç topluluk
            başlığıdır (ör. `#Updates` / `#General` etiketleriyle, her öğe
            `/community/post/...` adresine gider ve yorum sayısı gösterir).
            NEDEN ÇİZİLMİYOR: projede topluluk gönderisi, yorum tablosu ve yorum
            sayısı YOK; blueprint'in verdiği başlıkları/metinleri kopyalamak ya da
            yorum sayısı uydurmak yasak. Şerit bu yüzden hiç çizilmez. */}

        {/* PAYLAŞIM SATIRI KALDIRILDI (kullanıcı isteği): önceki oturumda
            hero altına eklenen davet cümlesi ve düğme sırası (Paylaş / X /
            WhatsApp / Facebook / Reddit / Telegram) gereksiz bulundu ve tümüyle
            silindi. Bu konumda başka bir blok çizilmez. */}

        {/* REFERANS 2.4: "Kaldığın yerden devam et" → bizde cihazdaki izleme
            kaydından dolar (referansta `#continue-watching`, giriş yapılmış
            kullanıcıda dolar; anonim gözlemde boştu — blueprint §2.4 / §7).
            Cihazda ilerlemesi olan seri yoksa blok tamamen yok olur. */}
        {continueItems.length > 0 && (
          <section aria-label={t("home.continueAria")} className={SECTION_GAP}>
            <div
              className={`flex items-end justify-between gap-3 border-b border-border pb-3 ${HEAD_GAP_ROW}`}
            >
              <div>
                <p className="text-[15px] font-semibold text-primary">{t("home.continueTag")}</p>
                <h2 className={`mt-1 ${HEAD_ROW}`}>{t("home.continueHeading")}</h2>
              </div>
              <ArrowRight size={20} aria-hidden="true" className="shrink-0 text-primary" />
            </div>
            {/* GENİŞ SATIRLAR (poster ızgarası DEĞİL): her satır tek bir bölümü
                temsil eder ve doğrudan o bölümün izleme adresine gider. Alan
                kompakt kalsın diye sütun düzeni yerine dikey liste kullanılır;
                satırlar arası boşluk 12 px (YAKLAŞIK). */}
            <div className="flex flex-col gap-3">
              {continueItems.map(({ show, season, episode, frame, fraction }) => (
                <ContinueRow
                  key={show.slug ?? show.title}
                  // Doğrudan kaldığı bölümün izleme sayfasına gider
                  // (`/anime/<slug>/season/<n>/episode/<n>`); satır bunu `Link` ile kurar.
                  slug={cardSlug(show)}
                  season={season}
                  episode={episode}
                  title={show.title}
                  image={show.image}
                  // Cihazda yakalanmış gerçek kare (varsa) — yoksa poster.
                  frame={frame}
                  fraction={fraction}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── REFERANS 2.5: `SECTION#recent-update` — "Latest Episode" ───────────
            (sözlükte TR "Son Bölümler"): referansın bu
            başlıktaki kendi kelimesi/başlık-cümlesi kullanılır. Yoğun büyük
            poster ızgarası (en fazla 12 kart, masaüstünde 6'lı satır). Kart, o
            bölümün izleme adresine gider.

            BAŞLIĞIN SAĞINDAKİ FİLTRE ŞERİDİ VE ←/→ OKLARI — BİLEREK YOK.
            Referans bu satırın sağına küçük bir filtre (All/Sub/Dub) ve ok
            düğmeleri koyar. Bu sekmeleri GERÇEKTEN besleyecek veri elimizde YOK:
            `shows` tablosunda seri bazlı altyazı/dublaj/trend işareti bulunmuyor;
            `episode_sources.language` (`tr`/`en`) YALNIZCA BÖLÜM KAYNAĞI
            bazındadır ve seri bazlı bir "Sub/Dub" etiketi üretmez — üstelik bu
            ızgara `show_episodes` okur, `episode_sources` okumaz. Veri uydurmamak
            için HİÇBİR sekme çizilmez. Oklar da çizilmez: ızgara sabit en fazla
            12 kartlık bir listedir; sayfalayıcı ya da kaydırıcı (slider) DEĞİLDİR.
            Bkz. yukarıdaki "OMİT EDİLENLER" notu. */}
        {latestCards.length > 0 && (
          <DiscoveryRow title={t("home.latestEpisodes")} gridClassName={mainGridClass}>
            {latestCards.map((item) => (
              <PosterCard
                key={item.id}
                // Bölüme doğrudan gider: /anime/<slug>/season/<s>/episode/<n>
                slug={showSlug(item.show)}
                season={item.season}
                episode={item.number}
                title={item.show.title}
                image={item.show.image}
                // Meta: "S1B5" (İngilizcede "S1E5") + varsa bölüm adı. Kısaltma
                // dile bağlı olduğu için harf burada birleştirilmez, sözlükten gelir.
                meta={`${t("series.seasonEpisodeCode", {
                  season: item.season,
                  number: item.number,
                })}${item.title ? ` · ${item.title}` : ""}`}
              />
            ))}
          </DiscoveryRow>
        )}

        {/* ── REFERANS 2.6: `SECTION#upcoming-anime` — "GELECEK ANİMELER" ──────
            KONUM DEĞİŞMEDİ: referansta bu bölüm hero'nun altındaki ana kolonda,
            "Latest Episode"dan SONRA ve üç kolonlu banttan ÖNCE durur; bizde de
            tam burada. ÖNCE ÇİZİLMİYORDU çünkü `shows` şemasında yayın durumu ya
            da ilk yayın tarihi tutan alan yoktu (`status`, `airing`, `premiered`,
            `next_airing` — hiçbiri yok; bkz. src/integrations/supabase/types.ts →
            shows) ve uydurma bir "yaklaşan anime" listesi gösterilmezdi. Artık
            GERÇEK veriyle dolar: AniList'in yayınlanmamış animeler sorgusu
            (`status: NOT_YET_RELEASED` + `startDate_greater`) `/api/anilist`
            sunucu rotası + uzun ömürlü `cachedRead` önbelleği üzerinden okunur
            (gerekçe: `UpcomingSection` üstündeki not). Veri gelmezse bölüm
            başlığıyla birlikte hiç çizilmez.

            Referansın sağ üstteki "View more →" bağlantısı ÇİZİLMEZ: gideceği
            ayrı bir "yaklaşan animeler" listesi sayfası projede yok, ölü bağlantı
            üretilmez. */}
        <UpcomingSection shows={shows} gridClassName={mainGridClass} />

        {/* ── REFERANS 2.7: `DIV.top-tables.mb-3` — ÜÇ KOLONLU KOMPAKT BANT ─────
            KULLANICI İSTEĞİ: bant BURADAN kaldırıldı; artık ana içeriğin EN
            SONUNDA, footer'ın hemen üstünde ve "Bu sezon" bölümünün hemen
            altında durur (bkz. `Index()` sonundaki yerleşim). Bantın üç
            kolonu, başlıkları ve veri kaynağı DEĞİŞMEDİ. */}

        {/* ── "Estimated Schedule" ARTIK ANA KOLONDA DEĞİL ─────────────────────
            KULLANICI İSTEĞİ (27.09.2026): "estimated schedule şeyini bu sitedeki
            gibi yap … şu an durduğu yer kötü … top trending'in tam altına."
            Referansta (reanime.to/home) bu panel ANA KOLONDA DEĞİL, SAĞ KENAR
            ÇUBUĞUNDA ve "Top Trending" panelinin HEMEN ALTINDA durur (ölçüm:
            kenar çubuğu 446 px; Top Trending y=636 h=1201 → Estimated Schedule
            y=1861 h=583, aralarında 24 px). Bu yüzden bölüm buradan kaldırıldı ve
            `aside` içinde Top Trending'in altına taşındı; panelin kendisi de
            referansın ölçüleriyle yeniden çizildi (`ScheduleSection` üstündeki not).

            Veri kaynağı DEĞİŞMEDİ: AniList `airingSchedules` → `/api/anilist` +
            `cachedRead` önbelleği, 7 günlük pencere, GÜNLERE bölünmüş. Veri
            gelmezse panel hiç çizilmez. */}

        {/* ── REFERANSTA KARŞILIĞI OLMAYAN BÖLÜMLER ───────────────────────────
            "Bu sezon" ızgarası ve tür çipleri referansta YOKTUR; kullanıcı
            isteğiyle SİLİNMEDİ, ana kolonun DIŞINA çıkarılıp A-Z bölümünden SONRA
            (footer'ın hemen üstüne) taşındı. Yerleşim için `Index()` gövdesine
            bakın. */}
      </div>

      {/* SAĞ: DAR KENAR ÇUBUĞU — YENİ referansın (anikototv.to/home) kenar
          çubuğunun DÜRÜST karşılığı. Ölçüler yeni referanstan alınır: başlık
          27 px / 600, sekmeler "pill" grubu; panel DIŞ kart kabuğu YOKTUR
          (referansta da yok — kart yalnızca satırların kendisidir). İçerik yine
          bizim dürüst verimizdir. Alan yalnızca içeriği kadar yüksektir;
          `self-start` sayesinde ana kolonun boyuna UZAMAZ (ölü boşluk olmaz).

          KENAR ÇUBUĞU ARTIK STICKY DEĞİL: blueprint §6, referansta `fixed`/`sticky`
          olan TEK elemanın site header'ı (`HEADER.fixed`) olduğunu ve
          `aside.sidebar`ın `position: static` kaldığını söyler. Bu yüzden eski
          `lg:sticky lg:top-24` KALDIRILDI; kenar çubuğu artık ana kolonla birlikte
          normal akışta kayar (yalnızca `self-start` kalır ki ızgara satırına
          gereksiz yere uzamasın). Ölçüler ve panel işaretlemesi DEĞİŞMEDİ.
          Masaüstü öncesi tek kolon akışında görünür. */}
      {hasSidebar && (
        <aside aria-label={t("home.rankingAria")} className="min-w-0 lg:col-span-1 lg:self-start">
          {/* PANEL DIŞ KABUĞU YOK — YENİ referans (anikototv.to/home, 1552×900'de
              gerçek tarayıcıda ölçüldü): `section#top-anime` KART DEĞİLDİR;
              border-radius 0 px, padding 0 px, zemin şeffaf. Görsel kart yalnızca
              her SATIRIN kendi kabıdır (bizde karşılığı `RankedRow`). Eski dış HUD
              kabuğu (12 px köşe + 16 px dolgu + kenarlık + 160° gradyan + HUD
              köşe/havalandırma süsleri) reanime.to ölçümünden geliyordu ve yeni
              referansla uyuşmuyordu → KALDIRILDI. Satırların kendi kart görünümü
              korunur (satır işaretlemesi / ölçüsü / hover davranışı dokunulmaz).
              Renkler yine bizim temamızdan gelir. */}
          <div>
            <div>
              {/* BAŞLIK ŞERİDİ — YENİ referans `section#top-anime .head`
                  (anikototv.to/home): flex + space-between + align-center, alt
                  çizgi YOK (referansta `border-bottom: 0`), başlık 27 px / 600 /
                  letter-spacing normal ve `padding-left: 5 px`. Eski 1 px çizgi
                  ile ona binen 72×2 px KIRIK (skew -8°) vurgu şeridi KALDIRILDI:
                  ikisi de artık kaldırılan HUD kart kabuğunun parçasıydı ve yeni
                  referansta YOK. `flex-wrap` yalnızca güvenlik ağıdır: dar sütunda
                  başlık ile sekmeler alt alta iner, taşma olmaz.

                  NEDEN BAŞLIK ŞERİDİ SIKIŞTIRILDI (ÖLÇÜM, 1552×900): kenar
                  çubuğunun İÇ genişliği 364 px. Başlık "TOP TRENDING" 27 px/600
                  iken 183 px, sol dolgu 5 px ile 188 px; ESKİ sekme grubu
                  ~203 px (kutu dolgusu 2×3 px + etiket araları 2×2 px + üç
                  etiketin kendi dolgusu 3×16 px + etiket metinleri ~145 px).
                  Üst şeritteki `gap-x-3` (12 px) ile gereken en az genişlik
                  188 + 203 + 12 = 403 px > 364 px olduğu için `flex-wrap`
                  şeridi İKİNCİ SATIRA kırıyordu (sekmeler başlığın ~41 px
                  altına düşüyordu); referansta ise tek satırdır.
                  DÜZELTME (başlık 27 px'te ve üç sekme yerinde KALARAK, taşma
                  olmadan tek satır): etiket dolgusu 8→6 px (`px-1.5`), etiket
                  arası 2→1 px (`gap-px`), kutu dolgusu 3→2 px (`p-[2px]`), hafif
                  sıkı harf aralığı `tracking-[-0.02em]` ve etiketler kısaltıldı
                  (BÖLÜM→BÖL., İngilizcede EPISODES→EPS. / SEASON→SEAS.; her iki
                  dil sözlükte güncellendi). Üst şerit aralığı da 12→8 px
                  (`gap-x-2`) ki kırılma eşiği daha geniş bir hataya payı bıraksın.
                  YENİ ARİTMETİK: grup = 203 − 4 (kutu dolgusu) − 12 (etiket
                  dolgusu) − 21 (BÖLÜM→BÖL.) − ~3.5 (harf aralığı) ≈ 162 px;
                  toplam 188 + 162 + 8 = 358 px ≤ 364 px → TEK SATIR (~6 px pay).
                   İngilizcede 188 + ~155 + 8 = 351 px → ~13 px pay. Not: `justify-between`
                   sayesinde artan boşluk zaten araya dağılır, yani sekme grubu
                   sağa yaslı kalır ve görsel aralık değişmez.

                   DİKKAT (dil): ölçüm "TOP TRENDING" (12 karakter) içindir. Türkçe
                   başlık "TREND OLANLAR" (13 karakter) birkaç px daha geniştir; 364 px
                   iç genişlikte TR'de satır İKİ SATIRA kırılabilir. Bu bilerek göze
                   alındı: `flex-wrap` tam olarak bunun için duruyor (taşma olmaz) ve
                   kullanıcı başlığın TÜRKÇE olmasını istedi. HİÇBİR ölçü (başlık 27 px,
                   etiket dolgusu, grup dolgusu, aralıklar) DEĞİŞTİRİLMEDİ. */}
              <div className="mb-[15px] flex flex-wrap items-center justify-between gap-x-2">
                {/* Başlık DİLE BAĞLI: `tr` → "TREND OLANLAR", `en` → "TOP TRENDING"
                    (bkz. i18n'deki `home.ranking` notu ve sayfa başındaki panel
                    açıklaması). Tipografi YENİ referanstan (27 px / 600 / harf
                    aralığı normal); renk bizim temamızdan (foreground %90). */}
                <h2 className="pl-[5px] text-[27px] font-semibold tracking-normal text-foreground/90">
                  {t("home.ranking")}
                </h2>
                {/* SEKMELER — YENİ referans `.tabs`: bir "pill" GRUBU (kutu dolgusu
                    3 px, köşe 5 px; her etiket 2×8 px dolgu, köşe 3 px,
                    13.5 px / 600; etiketler arası 2 px) ve aktif etiket DOLU.
                    RENKLER bizim temamızdan: kutu `bg-foreground/5`, aktif
                    `bg-primary`, pasif soluk. Etiket metinleri bizim DÜRÜST ölçüt
                    adlarımızdır; referansın kısa etiketleri
                    (Day/Week/Month) KOPYALANMAZ çünkü arkasında öyle bir veri yok.
                    Ölçüt açıklaması yine ipucu (title) balonundadır.

                    SIKIŞTIRMA (bkz. başlık şeridindeki ölçüm notu): 364 px'te tek
                    satıra sığmak için grup dolgusu 3→2 px, etiket dolgusu 8→6 px
                    (`px-1.5`), etiket arası 2→1 px (`gap-px`) ve harf aralığı
                    -0.02em yapıldı; görünüm (yuvarlak grup + soluk zemin + aktif
                    primary) AYNI kalır. */}
                <div
                  role="tablist"
                  aria-label={t("home.rankTabAria")}
                  className="flex items-center gap-px rounded-[5px] bg-foreground/5 p-[2px]"
                >
                  {RANK_TABS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={rankTab === item.id}
                      title={t(item.hintKey)}
                      onClick={() => setRankTab(item.id)}
                      className={`rounded-[3px] px-1.5 py-0.5 text-[13.5px] font-semibold tracking-[-0.02em] transition-colors ${
                        rankTab === item.id
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t(item.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
              {/* Satır listesi: referans `space-y-3` → satırlar arası 12 px.
                  Satırlar ayrı kartlardır; aralarında çizgi YOKTUR. */}
              <div className="space-y-3">
                {ranked.map(({ show }, index) => (
                  <RankedRow key={show.slug ?? show.title} show={show} rank={index + 1} />
                ))}
              </div>
            </div>
          </div>

          {/* ── "Estimated Schedule" — TOP TRENDING'İN HEMEN ALTINDA ──────────
              KULLANICI İSTEĞİ (27.09.2026): referansın (reanime.to/home) kenar
              çubuğu sırası birebir alındı: Top Trending → Estimated Schedule →
              (Top Posts). Ölçüm: panel 446×583, arada 24 px; bizde kenar çubuğu
              `space-y-6` (24 px) kullandığı için aralık zaten referansla aynı.
              Panel artık ana kolonda ÇİZİLMİYOR (bkz. ana kolondaki kaldırma notu).
              Dar ekranlarda ızgara tek kolona indiği için panel, kenar çubuğunun
              doğal akışında Top Trending'in altında görünür. */}
          <div className="mt-6">
            <ScheduleSection shows={shows} />
          </div>
          {/* ── REFERANS 5: kenar çubuğunda "Discussion" paneli — ÇİZİLMEDİ ───
               Referans, TOP TRENDING'in ALTINDA sağ kenar çubuğuna bir
               "Discussion" (son yorumlar / tartışma başlıkları) paneli koyar.
               NEDEN YOK: projede yorum/tartışma SİSTEMİ ve yorum TABLOSU
               bulunmuyor (`shows`, `show_episodes`, `show_seasons`,
               `show_images`, `show_characters` dışında bir yorum tablosu yok;
               bkz. src/integrations/supabase/types.ts). Uydurma tartışma
               başlıkları ya da yorum sayıları gösterilmez. Bu yüzden panel
               burada hiç çizilmez; TOP TRENDING paneli ise DOKUNULMADI.
               ─────────────────────────────────────────────────────────────── */}
        </aside>
      )}
    </div>
  );
}

/**
 * ============================================================================
 * A-Z LİSTESİ — referansın `DIV.azlist` bloğu (blueprint §4).
 * ============================================================================
 * NEREDE DURUR: referansta A-Z listesi ANA KOLONUN içinde DEĞİL, FOOTER'ın
 * içindedir (`FOOTER > DIV.container > DIV.azlist`). Bu yüzden bölüm main'den
 * çıkarılıp footer'ın İLK bloğu olarak çizilir (bkz. `Index()`).
 *
 * Referans burada bir BAŞLIK ("A-Z List"), bir ALT BAŞLIK ("Searching anime order
 * by alphabet name A to Z.") ve `All # 0-9 A B C … Z` biçiminde (toplam 29 çip)
 * bir HARF ÇİPİ SATIRI taşır. Bizde bu bölüm YENİ VERİ İSTEMEZ: çipler,
 * hâlihazırda yüklü olan seri listesini (`shows`) başlığın İLK HARFİNE göre
 * İSTEMCİDE süzer — ağa/Supabase'e yeni bir sorgu ÇIKMAZ (kota/egress sabit).
 * (Referans çipe basınca `/az-list/<harf>` sayfasına GİDER; bizde ayrı liste
 * sayfası olmadığı için aynı süzme sayfa içinde, istemcide yapılır.)
 *
 * ÇİP DAVRANIŞI (referansın `ALL # 0-9 A…Z` sırası korunur):
 *   · ALL → tüm seriler.
 *   · 0-9 → başlığı RAKAMLA başlayanlar.
 *   · #   → başlığı HARF OLMAYAN karakterle başlayanlar (rakam ya da simge).
 *           `0-9` bunun yalnızca RAKAMA daraltılmış hâlidir; ikisi bilerek
 *           örtüşür, çünkü referansta "#" tam olarak "harf olmayan" kovasıdır.
 *   · A…Z → o harfle başlayanlar.
 *
 * TÜRKÇE HARFLER: başlığın ilk harfi önce Türkçe büyütülür, sonra ASCII tabanına
 * indirgenir (Ç→C, Ğ→G, İ→I, Ö→O, Ş→S, Ü→U). Böylece "İ" ile başlayan seriler de
 * `I` çipinde, "Ç" ile başlayanlar `C` çipinde görünür; ayrı Türkçe çipler
 * eklemeye gerek kalmaz (referans da yalnızca A-Z çizer).
 * ============================================================================
 */
/** Çip kimlikleri: sabitler + tek harfler (A…Z). Tek harf değerleri sabitlerle çakışmaz. */
const AZ_ALL = "all";
const AZ_HASH = "hash";
const AZ_DIGITS = "digits";

/** A-Z çip satırındaki 26 harf (referans sırası: A…Z). */
const AZ_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/** Başlığın İLK harfini Türkçe büyütüp ASCII tabanına indirger (yukarıdaki nota bkz.). */
function azFirstLetter(title: string): string {
  const first = (title ?? "").trim().charAt(0);
  if (!first) return "";
  const upper = first.toLocaleUpperCase("tr");
  const folded: Record<string, string> = { Ç: "C", Ğ: "G", İ: "I", Ö: "O", Ş: "S", Ü: "U" };
  return folded[upper] ?? upper;
}

/** Seçili çipin bir seriyi gösterip göstermediği (yukarıdaki çip davranışı). */
function azMatches(title: string, filter: string): boolean {
  if (filter === AZ_ALL) return true;
  const base = azFirstLetter(title);
  if (filter === AZ_DIGITS) return /^[0-9]$/.test(base);
  // "#" = harf olmayan (rakam ya da simge). Boş başlık da bu kovaya düşer.
  if (filter === AZ_HASH) return !/^[A-Z]$/.test(base);
  return base === filter;
}

/**
 * A-Z bölümü: başlık + alt başlık + harf çipleri + süzülmüş seri ızgarası.
 * `shows` çağırandan gelir (ana sayfada zaten yüklü liste); ek okuma yoktur.
 */
function AzList({ shows }: { shows: HeroCard[] }) {
  const { t } = useLang();
  // Seçili çip; varsayılan ALL (bölüm açıldığında tüm seriler görünür).
  const [filter, setFilter] = useState<string>(AZ_ALL);
  // Çip listesi SABİTTİR (ALL, #, 0-9, A…Z) — veriden türetilmez; referansın
  // kendi çip satırı budur ve sırası da referanstaki sıradır.
  const chips = useMemo(
    () => [
      { id: AZ_ALL, label: t("home.azAll") },
      { id: AZ_HASH, label: "#" },
      { id: AZ_DIGITS, label: "0-9" },
      ...AZ_LETTERS.map((letter) => ({ id: letter, label: letter })),
    ],
    [t],
  );
  // Süzme İSTEMCİDE: liste `shows` ile zaten elde, ek sorgu YOK.
  const filteredShows = useMemo(
    () => shows.filter((show) => azMatches(show.title, filter)),
    [shows, filter],
  );
  return (
    // Kap footer'ın içindedir; bu yüzden sayfa ritmi korunur (kap + 10 px yan
    // boşluk) ve dikey boşluk `pt-12`/`pb-10` ile footer'ın kendi `py-12` bloğuna
    // uydurulur. YAKLAŞIK: bu iki dikey boşluk bizim seçimimizdir (blueprint A-Z
    // bloğu için yalnızca `.azlist { margin-bottom: 40px }` verir; 40 px alt boşluk
    // korunur, üst boşluk footer ritmine uydurulmuştur). `id="az"` korunur.
    <section id="az" aria-label={t("home.azAria")} className={`${PAGE_CONTAINER} pt-12 pb-10`}>
      {/* Başlık + alt başlık (referansın bu bölümdeki kendi düzeni). */}
      <div className={HEAD_GAP_ROW}>
        <h2 className={HEAD_ROW}>{t("home.azHeading")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("home.azSubtitle")}</p>
      </div>
      {/* ÇİP SATIRI — referans: `ALL # 0-9 A B C … Z`; dar ekranda sarar. */}
      <div aria-label={t("home.azFilterAria")} className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            aria-pressed={filter === chip.id}
            onClick={() => setFilter(chip.id)}
            className={`ui-hover min-w-[36px] rounded-md border px-3 py-1.5 text-sm font-bold ${
              filter === chip.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:border-accent hover:text-accent"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>
      {/* SONUÇ IZGARASI: süzülen seriler. Hiç sonuç yoksa uydurma kart yerine
          kısa bir bilgi satırı gösterilir. */}
      {filteredShows.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">{t("home.azEmpty")}</p>
      ) : (
        <div className={`mt-6 ${DISCOVERY_GRID_CAPPED}`}>
          {filteredShows.map((show) => (
            <SeriesCard key={show.slug ?? show.title} show={show} />
          ))}
        </div>
      )}
    </section>
  );
}

function Index() {
  const { t } = useLang();
  // Sekme başlığı aktif dili izler (rota `head()`i sunucuda bir kez üretilir).
  useDocumentTitle(t("meta.homeTitle"));
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Anasayfa reklamı: panelde `ad_home` kodu varsa PANEL kazanır, boşsa
  // koddaki Adsterra birimi çalışır (slot vardı ama içi boştu → reklam yoktu).
  const adHome = useAdCode("ad_home");
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState(ALL_GENRES);
  const searchRef = useRef<HTMLInputElement>(null);
  const desktopSearchRef = useRef<HTMLDivElement>(null);
  const mobileSearchRef = useRef<HTMLDivElement>(null);
  // Veri loader'dan gelir (sunucuda çekilmiş) — "yükleniyor" ara durumu yok.
  const dbShows = Route.useLoaderData();
  const shows: HeroCard[] = dbShows && dbShows.length > 0 ? dbShows : fallbackShows;

  // Vitrin slider'ı: YALNIZCA panelde "Vitrin'e ekle" ile işaretlenmiş seriler döner.
  //
  // ⚠️ DÜZELTİLEN HATA (kullanıcı bildirimi, 29.09.2026):
  //   "Panelden anime ekleyip 'Vitrin'e ekle' yapmadığım sürece ana sayfa
  //    vitrininde görünmemesi gerekiyordu — neden görünüyor?"
  //
  // Eski satır `featuredShows.length > 0 ? featuredShows : shows` idi: HİÇBİR seri
  // işaretli değilken vitrin TÜM serilere düşüyordu. Panelden eklenen her yeni
  // kayıt kendiliğinden vitrinde dönmeye başlıyordu — kullanıcının gördüğü buydu.
  //
  // Artık düşme (fallback) VERİTABANINA değil, sitenin koddaki statik vitrinine
  // (`fallbackShows`) yapılır: işaretsiz bir kayıt asla vitrine sızmaz, slayt da
  // boş kalmaz.
  const featuredShows = shows.filter((show) => show.is_featured);
  const heroShows: HeroCard[] = featuredShows.length > 0 ? featuredShows : fallbackShows;

  /**
   * "Kaldığın yerden devam et" satırının verisi.
   *
   * İzleme ilerlemesi cihazda (localStorage) tutulur; sunucuda `window` yoktur.
   * Bu yüzden liste ilk render'da BİLEREK boştur ve yalnızca mount sonrası
   * doldurulur — SSR ile istemci HTML'i uyuşmazlığı (hydration mismatch) olmaz.
   * Okuma asla hata fırlatmaz: bozuk/eksik depo "ilerleme yok" demektir ve
   * satır hiç çizilmez.
   *
   * KAYIT YOKSA SATIR DA YOK: liste yalnızca cihazda izlenmiş bölümü olan
   * serilerden kurulur (aşağıdaki `if (last)` kapısı). Yani "ilerleme yoksa
   * hiçbir şey çizilmez" kuralı bu kapıdır; kart/postercanlı boş bir satır
   * üretilmez.
   *
   * EK OKUMA YOK: kare ve konum aynı cihaz deposundan gelir (localStorage);
   * ne Supabase'e ne de ağa çıkılır.
   */
  const [continueItems, setContinueItems] = useState<ContinueItem[]>([]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const next: ContinueItem[] = [];
      for (const show of shows) {
        const showKey = cardSlug(show);
        const last = getLastEpisode(showKey);
        if (!last) continue;
        // Konum kaydı: oran yalnızca süre de biliniyorsa hesaplanır. Konum
        // kaydı yoksa `null` kalır ve çubuk çizilmez (uydurma %0 yok).
        const progress = getProgress(showKey, last.season, last.episode);
        const fraction =
          progress && progress.duration > 0
            ? Math.min(1, Math.max(0, progress.position / progress.duration))
            : null;
        // Kare YALNIZCA kendi oynatıcımızda yakalanmışsa vardır; embed/iframe
        // durumunda boş gelir ve satır postere düşer (bkz. lib/watch-progress.ts).
        const frame = getResumeFrame(showKey, last.season, last.episode);
        next.push({ show, season: last.season, episode: last.episode, frame, fraction });
      }
      setContinueItems(next);
    } catch {
      // Depo okunamadıysa satır gösterilmez; sayfanın geri kalanı etkilenmez.
      setContinueItems([]);
    }
  }, [shows]);

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

  /**
   * Bırakma sonrası "oturma" süresi (ms). anikoto.cz'deki akıcı his için:
   * parmak/fare bırakılınca slayt ANİDEN zıplamaz, kısa bir yavaşlamayla
   * hedefine kayar. (Animasyon kare kare rAF ile yürütülür; CSS geçişiyle
   * değil, çünkü sürükleme sırasında geçişler bilerek kapatılıyor.)
   */
  const SETTLE_MS = 280;

  /** Fırlatma eşiği: bırakma anındaki hız (yüzde/ms). Hızlı bir savurma, kayma
   *  eşiği geçilmemiş olsa bile slaytı ilerletir. */
  const FLING_VELOCITY = 0.25;

  /** Sürükleme ile tıklamayı ayıran küçük kayma toleransı (px). */
  const CLICK_SLOP = 4;

  /** Bırakma hızını hesaplamak için tutulan son fare örnekleri. */
  const dragSamples = useRef<{ x: number; t: number }[]>([]);
  /** Pointer gerçekten kaydı mı: kaydırma sonrası tıklamayı bastırmak için. */
  const dragMoved = useRef(false);
  /** Oturma animasyonunun rAF tanıtıcısı (yeni sürüklemede iptal edilir). */
  const settleRaf = useRef<number | null>(null);

  /** Fare/parmağın hero genişliğine göre yatay kayması (yüzde). */
  function dragPercent(clientX: number) {
    const width = heroRef.current?.getBoundingClientRect().width ?? 1;
    return ((clientX - (dragStart.current?.x ?? clientX)) / width) * 100;
  }

  /** Bekleyen oturma animasyonunu durdurur (yeni sürükleme onu geçersiz kılar). */
  function stopSettle() {
    if (settleRaf.current !== null) {
      window.cancelAnimationFrame(settleRaf.current);
      settleRaf.current = null;
    }
  }

  /**
   * Yumuşak oturma: dragX'i `from`dan `to`ya ease-out ile taşır, bitince `done`.
   * Yalnızca "hareket azaltma" İSTENMEDİĞİNDE çağrılır (bkz. onHeroPointerUp).
   */
  function runSettle(from: number, to: number, done: () => void) {
    stopSettle();
    const startedAt = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / SETTLE_MS);
      // ease-out cubic: hızlı başlar, sona doğru süzülür (momentum hissi).
      const eased = 1 - Math.pow(1 - t, 3);
      setDragX(from + (to - from) * eased);
      if (t < 1) {
        settleRaf.current = window.requestAnimationFrame(step);
      } else {
        settleRaf.current = null;
        done();
      }
    };
    settleRaf.current = window.requestAnimationFrame(step);
  }

  /** Bırakma anındaki hız: son ~80 ms'lik örneklerden yüzde/ms cinsinden. */
  function dragVelocity() {
    const samples = dragSamples.current;
    const last = samples[samples.length - 1];
    const initial = samples[0];
    if (samples.length < 2 || !last || !initial) return 0;
    let first = initial;
    for (let i = samples.length - 2; i >= 0; i -= 1) {
      const sample = samples[i];
      if (!sample) continue;
      if (last.t - sample.t <= 80) first = sample;
      else break;
    }
    const dt = last.t - first.t;
    if (dt <= 0) return 0;
    const width = heroRef.current?.getBoundingClientRect().width ?? 1;
    return (((last.x - first.x) / width) * 100) / dt;
  }

  function onHeroPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (heroShows.length < 2) return;
    // Bağlantı ve butonlar kendi tıklamasını alsın: sürükleme görselin üstünde başlar.
    const target = event.target as HTMLElement | null;
    if (target?.closest("a, button")) return;
    // Sürerken yeni bir tutuş: bekleyen oturma animasyonu iptal edilir ki
    // eski animasyon yeni sürüklemeyle çakışıp slaytı titretmesin.
    stopSettle();
    dragStart.current = { x: event.clientX, y: event.clientY };
    dragSamples.current = [{ x: event.clientX, t: event.timeStamp }];
    dragMoved.current = false;
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
      dragMoved.current = false;
      setHeroDragging(false);
      setDragX(null);
      return;
    }
    // Tolerans aşıldıysa bu artık tıklama değil sürüklemedir (tıklama bastırılır).
    if (!dragMoved.current && Math.hypot(dx, dy) > CLICK_SLOP) dragMoved.current = true;
    const samples = dragSamples.current;
    samples.push({ x: event.clientX, t: event.timeStamp });
    if (samples.length > 8) samples.shift();
    // 1:1 takip: içerik imlecin tam altında kalır (yüzde = hero genişliğine göre).
    setDragX(Math.max(-100, Math.min(100, dragPercent(event.clientX))));
  }

  function onHeroPointerUp() {
    const start = dragStart.current;
    dragStart.current = null;
    const shift = dragX ?? 0;
    const velocity = dragVelocity();
    const moved = dragMoved.current;
    // Hareket azaltma istenmişse ya da gerçek bir kayma olmadıysa momentum
    // ATLANIR ve eski davranış aynen korunur: anında otur, eşik geçildiyse
    // slayt değişir. (Azaltılmış hareket tercihi burada da gözetilir.)
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!moved || reduceMotion) {
      setHeroDragging(false);
      setDragX(null);
      if (!start || Math.abs(shift) < DRAG_THRESHOLD) return;
      if (shift < 0) goNext();
      else goPrev();
      return;
    }
    const direction =
      Math.abs(shift) >= DRAG_THRESHOLD ? (shift < 0 ? -1 : 1) : velocity < 0 ? -1 : 1;
    const advance = Math.abs(shift) >= DRAG_THRESHOLD || Math.abs(velocity) >= FLING_VELOCITY;
    if (advance) {
      // Eşik ya da fırlatma hızı aşıldı: komşu slayt yumuşakça tam ekrana
      // oturur, bitince slayt değişir (goTo kapısı; nokta/ok/klavye ile aynı).
      runSettle(shift, direction * 100, () => {
        setDragX(null);
        setHeroDragging(false);
        if (direction < 0) goNext();
        else goPrev();
      });
      return;
    }
    // Eşik altı: slayt bulunduğu yere süzülerek geri döner.
    runSettle(shift, 0, () => {
      setDragX(null);
      setHeroDragging(false);
    });
  }

  function onHeroPointerCancel() {
    stopSettle();
    dragStart.current = null;
    dragMoved.current = false;
    setHeroDragging(false);
    setDragX(null);
  }

  /**
   * Kaydırmadan sonra gelen tıklamayı bastırır: fareyle hero'yu sürüklerken
   * altındaki bağlantının yanlışlıkla açılmasını engeller. Yalnızca gerçek
   * kaymada (dragMoved) devreye girer; sade tıklama etkilenmez.
   */
  function onHeroClickCapture(event: ReactMouseEvent<HTMLElement>) {
    if (!dragMoved.current) return;
    dragMoved.current = false;
    event.preventDefault();
    event.stopPropagation();
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

  // NOT: `genreOptions` (serilerin kendi `genre` alanından türetilen çip listesi)
  // KULLANICI İSTEĞİYLE SİLİNEN GENRES çip şeridiyle birlikte KALDIRILDI: çipleri
  // tek tüketen yer o şeritti. Tür süzme zinciri (`genre` → `filtered`) korunur;
  // sıralama/büyük-küçük harf yardımcılarına (`localeCompare`) bu yüzden gerek yok.

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

  /**
   * ARAMA ÖNERİ PANELİNİN SATIRLARI (bkz. `SearchSuggestionPanel`).
   *
   * KAYNAK: sayfada ZATEN yüklü ve süzülmüş liste `filtered` — ızgarayı çizen
   * listenin TA KENDİSİ (`(isFiltering ? filtered : shows)`). Yalnızca ilk
   * `SEARCH_SUGGESTION_LIMIT` eşleşme alınır ve `filtered` her render'da zaten
   * hesaplandığı için burada `useMemo` AÇILMAZ (gereksiz önbellek olurdu).
   * EK SORGU YOK: Supabase'e hiçbir yeni istek gitmez.
   * Yazı boşken liste boştur; panel o durumda hiç çizilmez.
   */
  const searchSuggestions = query.trim() ? filtered.slice(0, SEARCH_SUGGESTION_LIMIT) : [];

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
      <header className="sticky top-0 z-50 border-b border-border bg-background">
        {/* Başlık şeridi de sayfanın geri kalanıyla AYNI kabı kullanır (referansta
            header, içerik ve footer tek `.container` içindedir); yoksa içerik
            genişlerken header dar kalıp sayfa kopuk görünürdü. */}
        <div className={`${PAGE_CONTAINER} flex h-[72px] items-center justify-between gap-5`}>
          <a
            href="#top"
            onClick={scrollToTop}
            aria-label={t("common.homeAria")}
            className="ui-hover flex items-center gap-2 rounded-full px-1 py-1"
          >
            <img
              src="/shanime-logo.png?v=6"
              alt={t("common.logoAlt")}
              width={1060}
              height={856}
              loading="eager"
              decoding="async"
              className="h-11 w-auto object-contain sm:h-12"
            />
            <span className="sr-only">shanime</span>
          </a>
          {/* ── DİL DEĞİŞİMİNDE SIFIR KAYMA ──────────────────────────────────
              KULLANICI GERİ BİLDİRİMİ: "TR|EN düğmesi neden kayıyor? Basınca kutu
              kayıyor, sanki sayfa yeniden çizilmiş gibi."
              ÖLÇÜM (viewport 1552×900): dil değişince YALNIZCA düğme değil, yanındaki
              çevrilen etiketler de genişlik değiştiriyordu — nav bağlantı grubu
              240,5 px → 226,9 px, "Keşfet" düğmesi 130,7 px → 138 px. Üst şerit
              `justify-between` bir flex olduğu için bu toplam fark düğmeyi x 1032,1 →
              1022,8 (9,3 px) kaydırıyordu.
              ÇÖZÜM: her çevrilen etiketin kutusunu dile bağlı olmaktan çıkarıyoruz.
              Her bağlantıya İKİ dilden GENİŞ olanına göre `min-w` rezerve edilir ve
              etiket `text-center` ile kutunun ortasına oturur; böylece kutu genişliği
              `tr` ve `en` için birebir aynı kalır ve 9,3 px'lik kayma tamamen biter.
              (Ölçüler: "Ana sayfa" ≈ 66,7 px / "Home" ≈ 39,1 px → 70; "Seriler" ≈
              48,9 px / "Series" ≈ 44,6 px → 51; "Bu sezon" ≈ 60,5 px / "This season"
              ≈ 81,8 px → 84.) */}
          <nav aria-label={t("common.mainNav")} className="hidden items-center gap-8 md:flex">
            <a
              href="#top"
              onClick={scrollToTop}
              className="link-hover min-w-[70px] text-center text-base font-extrabold text-accent"
            >
              {t("common.home")}
            </a>
            <a
              href="#series"
              className="link-hover min-w-[51px] text-center text-base font-bold text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("common.series")}
            </a>
            <a
              href="#season"
              className="link-hover min-w-[84px] text-center text-base font-bold text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("common.thisSeason")}
            </a>
          </nav>
          {/* Dil değiştirici: nav ile arama arasında; mobilde de görünür. */}
          <LanguageToggle />
          {/* Dışarı tıklamayı denetleyen effect, tıklamanın panelin İÇİNDE olup
              olmadığını bu kapsayıcının ref'i üzerinden anlıyor. Ref buraya
              bağlanmazsa `desktopSearchRef.current` her zaman null kalır, açılır
              panelin ve kutunun içine yapılan tıklama da "dışarı" sayılır; panel
              bağlantının tıklaması işlenmeden kapanır ve seri sayfasına hiç
              gidilmez. */}
          <div ref={desktopSearchRef} className="relative hidden items-center gap-3 md:flex">
            <Button
              variant="ghost"
              size="icon"
              className={`search-button rounded-full bg-secondary ${searchOpen ? "is-open" : ""}`}
              aria-label={searchOpen ? t("common.closeSearch") : t("common.search")}
              aria-expanded={searchOpen}
              onClick={() => setSearchOpen((open) => !open)}
            >
              <Search className="search-button-icon" size={18} />
            </Button>
            {/*
              "Keşfet / Explore" DÜĞMESİ KALDIRILDI (kullanıcı, 28.09.2026:
              "explore keşfet butonunu gereksiz, kaldırsana onu sil").

              NEDEN GEREKSİZDİ: düğme yalnızca sayfayı AŞAĞI KAYDIRIYORDU
              (`#series` bölümüne). Yani kullanıcıya yeni bir şey açmıyordu —
              aynı sayfada zaten görünen içeriğe atlıyordu.

              YAN FAYDA: bu düğme, dil düğmesinin yanındaki en büyük metin
              genişliği kaynağıydı ("Keşfet" ≈ 39 px ↔ "Explore" ≈ 47 px). Düğme
              gidince dil değiştiricinin etrafındaki yerleşim bir olasılığı daha
              kayboldu; çip genişlikleri zaten sabit (`w-8`) olduğu için kayma yok.
            */}
            {searchOpen && (
              <div className="absolute right-16 top-14 z-50 w-80 rounded-3xl border border-border bg-popover p-4 shadow-2xl motion-safe:animate-pop-in motion-reduce:animate-none">
                <div className="flex items-center gap-2 rounded-full border-2 border-primary px-4">
                  <Search size={17} className="text-muted-foreground" />
                  <label className="sr-only" htmlFor="search">
                    {t("common.search")}
                  </label>
                  <input
                    id="search"
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("common.searchPlaceholder")}
                    className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />
                </div>
                {/* ÖNERİ PANELİ — kutunun ALTINDA uçan kart olarak geri getirildi
                    (bkz. `SearchSuggestionPanel` ve üstündeki geri getirme notu).
                    Panel, kutuyu taşıyan kartın İÇİNDE durur ama `inset-x-0
                    top-full mt-2` ile kartın DIŞINA, hemen altına yerleşir: kart
                    `absolute` olduğu için panelin konumlanma kutusu karttır, bu
                    yüzden genişlik kutununkiyle birebir aynı olur. Konum ve
                    ölçüler YAKLAŞIKTIR — bu panel için referanstan ölçüm
                    yapılmadı. Yalnızca arama AÇIKKEN ve yazı doluyken çizilir;
                    eşleşme yoksa bileşen kendini çizmez (boş kart kalmaz). */}
                <SearchSuggestionPanel
                  query={query}
                  items={searchSuggestions}
                  className="absolute inset-x-0 top-full z-40 mt-2 motion-safe:animate-pop-in motion-reduce:animate-none"
                />
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden icon-btn"
            aria-label={menuOpen ? t("common.closeMenu") : t("common.openMenu")}
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
            <a
              className="py-3 font-bold text-primary"
              href="#top"
              onClick={(event) => {
                scrollToTop(event);
                setMenuOpen(false);
              }}
            >
              {t("common.home")}
            </a>
            <a className="py-3 font-bold" href="#series" onClick={() => setMenuOpen(false)}>
              {t("common.series")}
            </a>
            <a className="py-3 font-bold" href="#season" onClick={() => setMenuOpen(false)}>
              {t("common.thisSeason")}
            </a>

            {/* Masaüstündeki arama kutusu `md` altında gizli olduğu için
                telefonda arama yapılamıyordu; aynı `query` durumunu kullanan
                alan menüye eklendi. Kutu, yazdıkça ana sayfadaki seri
                ızgarasını süzer (`filtered` → `#series`). */}
            <div className="mt-2 flex items-center gap-2 rounded-full border-2 border-primary px-4">
              <Search size={17} className="text-muted-foreground" />
              <label className="sr-only" htmlFor="search-mobile">
                {t("common.search")}
              </label>
              <input
                id="search-mobile"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("common.searchPlaceholder")}
                className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
              {query ? (
                <button
                  type="button"
                  aria-label={t("common.clearSearch")}
                  onClick={() => setQuery("")}
                  className="icon-btn shrink-0 text-muted-foreground"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {/* ÖNERİ PANELİ (MOBİL) — masaüstüyle AYNI bileşen, kutunun hemen
                altında ve AKIŞ İÇİNDE durur (menü zaten açılır bir panel; burada
                absolute konum dar ekranda sayfa içeriğinin üstüne binerdi).
                Menü açık olduğu için görünürlük kapısı yalnızca yazıdır;
                eşleşme yoksa bileşen kendini çizmez (`SearchSuggestionPanel`). */}
            <SearchSuggestionPanel query={query} items={searchSuggestions} className="mt-2" />
          </nav>
        )}
      </header>

      <main id="top">
        <section
          ref={heroRef}
          aria-label={t("home.heroAria")}
          className={`hero-section ${heroDragging ? "hero-dragging is-dragging" : ""}`}
          onPointerDown={onHeroPointerDown}
          onPointerMove={onHeroPointerMove}
          onPointerUp={onHeroPointerUp}
          onPointerCancel={onHeroPointerCancel}
          // Kaydırma sonrası tıklamayı bastır (yakalama aşamasında).
          onClickCapture={onHeroClickCapture}
        >
          {/* Sayfanın tek h1'i: vitrindeki seri başlıkları h1 değil, vitrin
              içeriği olduğu için h1 kirliliği yapmaz. */}
          <h1 className="sr-only">{t("home.heroSrTitle")}</h1>
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
                {/* Telefonda DİKEY kapak, masaüstünde geniş banner kullanılır.
                    16:9 banner portre kutuya sığdırılınca görüntünün yalnızca
                    ~%39'u görünüyor ve karakter kadrajın dışında kalıyordu
                    (kullanıcı geri bildirimi: "vitrindeki resmin sadece yarısı
                    görünüyor"). 2:3 dikey kapağın neredeyse tamamı görünür.
                    <picture> sayesinde tarayıcı yalnızca eşleşen kaynağı indirir. */}
                <picture className="hero-picture">
                  <source media="(max-width: 767px)" srcSet={show.image} />
                  <img
                    src={backdrop}
                    alt={active ? t("home.slideScene", { title: show.title }) : ""}
                    width={1536}
                    height={864}
                    loading={index === 0 ? "eager" : "lazy"}
                    fetchPriority={index === 0 ? "high" : "low"}
                    decoding="async"
                    draggable={false}
                    onError={() => setBrokenBackdrops((map) => ({ ...map, [key]: true }))}
                    className="hero-image"
                  />
                </picture>
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
                  <span className="hero-featured-badge">{t("home.heroBadge")}</span>
                  <ShowLogo slug={show.slug} title={show.title} className="hero-logo" />
                  <div className="hero-details">
                    <div className="hero-details-inner">
                      {/* sonanime'deki "yıl · bölüm sayısı" satırının karşılığı. */}
                      <div className="hero-meta">
                        {show.year && <span>{show.year}</span>}
                        {show.id && show.episode_count > 0 && (
                          <span>
                            {plural(
                              t,
                              show.episode_count,
                              "home.episodeCountOne",
                              "home.episodeCount",
                            )}
                          </span>
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
                      {/* show.genre ve show.description veritabanı içeriğidir
                          (tür adları, açıklama) — bilerek ÇEVRİLMEZ; içerik
                          çevirisi ayrı bir iş. */}
                      <p className="hero-description">{show.description}</p>
                    </div>
                  </div>
                  {/* VİTRİN ÇAĞRILARI — istemci içi gezinme (`Link`). ÖNDEN ÇEKME
                      (preload) BURADA DA KAPALI: vitrinde her slaytın düğmeleri
                      DOM'da durur (gizli slaytlarınki `visibility: hidden`),
                      dolayısıyla hover'ı tıklama tahmini saymak güvenilir değil.
                      `/anime/$slug` hedefi hover başına 4 tablo okuması yapar
                      (bkz. RankedRow notu), izleme hedefinde ise rota
                      yükleyicisi YOK — yani önden çekmenin kazancı ölçülemez,
                      riski ise gerçek. Tek satır gezinme yine anındadır. */}
                  <div className="flex flex-wrap items-center gap-4">
                    {show.id ? (
                      /* Vitrin kartında sezon/bölüm bilgisi YOK; izleme yolu
                          parametresiz olamadığı için 1/1 verilir. İzleme sayfası bu
                          değerleri bulamazsa KENDİ "ilk oynatılabilir sezon/bölüm"
                          mantığına düşer — yani eskiden parametresiz izleme adresiyle
                          açılan bölümün AYNISI oynar. */
                      <Link
                        to="/anime/$slug/season/$season/episode/$episode"
                        params={{ slug: showSlug(show), season: "1", episode: "1" }}
                        preload={false}
                        className="home-cta-pill"
                      >
                        <Play size={17} fill="currentColor" /> {t("common.watchNow")}
                      </Link>
                    ) : (
                      <a href="#series" className="home-cta-pill">
                        <Play size={17} fill="currentColor" /> {t("common.watchNow")}
                      </a>
                    )}
                    {show.id ? (
                      <Link
                        to="/anime/$slug"
                        params={{ slug: showSlug(show) }}
                        preload={false}
                        className="ui-hover rounded-full border border-border bg-secondary px-5 py-3 text-sm font-bold text-foreground hover:border-accent hover:text-accent"
                      >
                        {t("common.seriesDetails")}
                      </Link>
                    ) : (
                      <a
                        href="#series"
                        className="ui-hover rounded-full border border-border bg-secondary px-5 py-3 text-sm font-bold text-foreground hover:border-accent hover:text-accent"
                      >
                        {t("common.seriesDetails")}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {heroShows.length > 1 && (
            <>
              <button
                type="button"
                aria-label={t("home.prevSeries")}
                onClick={goPrev}
                className="hero-nav hero-nav-prev"
              >
                <ChevronLeft size={24} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={t("home.nextSeries")}
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
              // Mobilde aralik genis: noktalarin dokunma alanlari (padding ile
              // buyutulmus) 8px aralikta ust uste biniyordu ve yanlis slayta
              // gidiliyordu. Masaustunde aralik eskisi gibi 8px kaliyor.
              className="absolute bottom-[30px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-7 md:gap-2"
              role="tablist"
              aria-label={t("home.slideSelect")}
            >
              {heroShows.map((s, i) => (
                <button
                  key={s.slug}
                  type="button"
                  role="tab"
                  aria-selected={i === safeIndex}
                  aria-label={t("home.goToSlide", { title: s.title })}
                  onClick={() => goTo(i)}
                  className={`hero-dot ${i === safeIndex ? "active" : ""}`}
                />
              ))}
            </div>
          )}
        </section>

        {/* REFERANS 2 (hero altı, blueprint §0/§2): iki kolonlu alan — solda geniş
            ANA KOLON, sağda DAR KENAR ÇUBUĞU. Ana kolonun sırası blueprint'in
            `aside.main` çocuk sırasıdır:
              2.1 duyuru şeridi (VERİ YOK → not), 2.2 sabitlenmiş duyuru (not),
              2.3 PAYLAŞIM SATIRI (KALDIRILDI — kullanıcı isteği),
              2.4 "Kaldığın yerden devam et", 2.5 "Latest Episode",
              2.6 "Upcoming Anime" (AniList verisi), 2.8 "Estimated Schedule"
              (AniList verisi).
            Sağ kenar çubuğu: TOP TRENDING (DOKUNULMADI) + "Discussion" (VERİ YOK
            → not). Bölümler kendi verisine bakar; veri yoksa başlığıyla birlikte
            hiç çizilmez.
            NOT: 2.7 üç kolonlu kompakt bant (`HomeCompactBand`) KULLANICI
            İSTEĞİYLE bu alanın DIŞINA çıkarıldı: ana içeriğin EN SONUNDA,
            footer'ın hemen üstünde ve "Bu sezon" bölümünün hemen altında çizilir
            (bkz. `Index()` sonundaki yerleşim). */}
        <HomeSections shows={dbShows ?? []} continueItems={continueItems} />

        {/* ══ REFERANSTA KARŞILIĞI OLMAYAN BÖLÜMLER (biri silindi, biri TAŞINDI) ══
            Aşağıdaki bölümler referansta YOKTUR. Tür çip şeridi KULLANICI
            İSTEĞİYLE SİLİNDİ (bkz. (a) notu); (başlığı yeniden adlandırılan)
            "Bu sezon" ızgarası ise kullanıcı isteğiyle silinmedi, A-Z footer'a
            taşındıktan sonra ana içeriğin sonuna alındı. (Blueprint §4'te A-Z
            `FOOTER > DIV.container > DIV.azlist` olduğu için A-Z artık footer'ın
            içindedir.) KULLANICI İSTEĞİYLE "Bu sezon" bölümü artık en altta, üç
            kolonlu bandın hemen üstünde durur; bant ise footer'ın hemen
            öncesindedir. */}

        {/* (a) GENRES ÇİP ŞERİDİ — KULLANICI İSTEĞİYLE TÜMÜYLE SİLİNDİ.
            Silinen blok: `id="genres"` taşıyan tek satırlık şerit — "TÜRLER"
            etiketi + All/Aksiyon/Başka Dünya/…/Shounen çipleri ve `pickGenre`
            işleyicisi. Şerit, referansta karşılığı olmayan bir bölümdü; ondan
            önce de çipleri İKİNCİ kez çizen büyük "Türlere göre keşfet" paneli
            silinmişti. Onunla birlikte artık hiçbir yerde kullanılmayan
            `genreOptions` listesi, `hasGenreStrip` kapısı ve `pickGenre` de
            kaldırıldı; yalnızca şeride ait `home.genresTag` / `home.genresAria`
            / `common.all` sözlük anahtarları düşürüldü.
            `id="genres"` ARTIK YOK: ona giden üç bağlantı ölü kalmasın diye
            `#series` (seri ızgarası) hedefine yönlendirildi — header'daki
            "Keşfet" düğmesi, footer'daki "Türler" bağlantısı ve
            `src/routes/__root.tsx` içindeki `/#genres` bağlantısı.
            Buraya başka bir blok KONMADI; altında reklam alanı eskisi gibi
            durur. */}

        {adHome.isFetched && adHome.code ? (
          <AdSlot slot="ad_home" className="flex justify-center" />
        ) : (
          <AdsterraLeaderboard />
        )}

        {/* SİLİNEN BLOK: büyük "Türlere göre keşfet" paneli (eyebrow `home.genreTag`,
             başlık `home.genreHeading`, açıklama `home.genreIntro` ve İKİNCİ tür çip
             satırı). KULLANICI GERİ BİLDİRİMİ: aynı çipler sayfada iki kez çiziliyordu
             (yukarıdaki tek satırlık şerit + bu panel) ve bu tekrar gereksizdi; panel
             bu yüzden tümüyle kaldırıldı, ardından KULLANICI İSTEĞİYLE kalan tek
             satırlık GENRES çip şeridi de silindi (bkz. yukarıdaki (a) notu). Buraya
             başka bir blok KONMADI. Panelle birlikte yalnızca ONA ÖZEL üç sözlük
             anahtarı da sözlükten düşürülmüştü. */}

        {/* "Bu sezon" bölümü + #series ızgarası. KULLANICI İSTEĞİ: bölüm, üç
             kolonlu bandın HEMEN ÜSTÜNE taşındı. Başlık DÜZELTİLDİ: bir önceki
             oturumda başlık referansın "Upcoming Anime" ifadesine çevrilmişti,
             fakat o ad artık ANA KOLONDAKİ GERÇEK upcoming bölümüne ait
             (bkz. `UpcomingSection`, blueprint §2.6, AniList verisiyle dolduruldu).
             Sayfada iki aynı başlık kalmasın ve header/footer'daki "Bu sezon"
             bağlantıları (`#season`) hedefledikleri bölümle uyuşsun diye başlık
             kendi adına döndü: `common.thisSeason` → TR "Bu sezon" / EN
             "This season". Başlık, eyebrow ("Yeni seçkiler"), kartlar, `#series`
             ızgarası ve "Tümünü gör" bağlantısı DIŞINDA hiçbir şey DEĞİŞMEDİ;
             veri kaynağı da aynıdır. Kap, başlık ölçeği ve bölüm boşlukları hero
             altındaki bölümlerle AYNI (kap 1800 px / 10 px, başlık 27 px / 600,
             bölümler arası 40 px). */}
        <section id="season" className={`${PAGE_CONTAINER} py-10`}>
          <div className={`flex items-end justify-between ${HEAD_GAP_ROW}`}>
            <div>
              <p className="text-[15px] font-semibold text-primary">{t("home.seasonTag")}</p>
              <h2 className={`mt-1 ${HEAD_ROW}`}>{t("common.thisSeason")}</h2>
            </div>
            <a
              href="#series"
              className="group link-hover ui-hover flex items-center gap-2 text-[15px] font-semibold"
            >
              {t("common.seeAll")}{" "}
              <ArrowRight size={17} className="transition-transform group-hover:translate-x-1" />
            </a>
          </div>
          {/* Kartlar ana keşif ızgarasıyla AYNI KART ÖLÇÜSÜNÜ kullanır (20 px
              boşluk, referans kartı: 1552 px'te 174 px). Bu bölüm kabın TAM
              genişliğinde (1552'de 1532 px) durduğu için sabit 6 sütun kartı
              238.66 px'e çıkarıyordu — referanstan ~%37 büyük poster. Bu yüzden
              burada kart genişliği sınırlı düzen kullanılır; sütun sayısı
              sığdığı kadar artar (1552'de 8 sütun × 174 px). */}
          <div id="series" className={DISCOVERY_GRID_CAPPED}>
            {/* Kart artık ORTAK bileşen (`SeriesCard`): A-Z bölümü de aynı kartı
                çizdiği için işaretlemeyi burada satır içi tutmak zamanla sapmaya
                yol açardı. Süzme davranışı (arama/tür) ve `#series` kimliği
                DEĞİŞMEDİ; önden çekme kapalı (kota/egress gerekçesi: SeriesCard
                notu). */}
            {(isFiltering ? filtered : shows).map((show) => (
              <SeriesCard key={show.slug ?? show.title} show={show} />
            ))}
          </div>
          {isFiltering && filtered.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-muted-foreground">{t("home.noFilterMatch")}</p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setGenre(ALL_GENRES);
                }}
                className="ui-hover mt-4 rounded-full border border-border px-5 py-2 text-sm font-bold text-foreground hover:border-accent hover:text-accent"
              >
                {t("home.clearFilter")}
              </button>
            </div>
          )}
        </section>

        {/* ── ÜÇ KOLONLU KOMPAKT BANT — ANA İÇERİĞİN EN SONUNDA ────────────────
            KULLANICI İSTEĞİ: bant "en altta" durmalı; bu yüzden ana kolonun
            içinden çıkarılıp ana içeriğin SONUNA, footer'ın hemen üstüne ve
            "Bu sezon" bölümünün hemen altına alındı. Burada tam kap genişliğinde
            (`PAGE_CONTAINER`) durur; içeriği, üç kolonu, veri kaynağı ve
            başlıkları DEĞİŞMEDİ. */}
        <div className={`${PAGE_CONTAINER} py-10`}>
          <HomeCompactBand shows={dbShows ?? []} />
        </div>
      </main>

      <footer className="border-t border-border bg-secondary text-foreground">
        {/* ── REFERANS 4: A-Z LİSTESİ — FOOTER'IN İLK BLOĞU ────────────────────
            Blueprint §4: referansta A-Z listesi ANA KOLONDA DEĞİL, footer'ın
            içindedir (`FOOTER > DIV.container > DIV.azlist`); başlığı
            "A-Z List", alt açıklaması "Searching anime order by alphabet name A
            to Z." ve altında `All # 0-9 A B C … Z` (toplam 29 çip) harf çip
            satırı bulunur. Bu yüzden bölüm main'in içinden ÇIKARILIP footer'ın
            başına taşındı. Çipler ve istemci içi süzme DAVRANIŞI DEĞİŞMEDİ;
            yeni sorgu yok (liste zaten yüklü `shows`). */}

        <AzList shows={shows} />

        {/* Footer de aynı kabı kullanır: içerikle aynı hizada başlar. */}
        <div className={`${PAGE_CONTAINER} grid gap-10 py-12 md:grid-cols-2`}>
          <div>
            <p className="font-display text-2xl">
              <img
                src="/shanime-logo.png?v=6"
                alt={t("common.logoAlt")}
                width={1060}
                height={856}
                loading="lazy"
                decoding="async"
                className="h-12 w-auto object-contain"
              />
              <span className="sr-only">shanime</span>
            </p>
            <p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">
              {t("footer.tagline")}
            </p>
          </div>
          <div>
            <p className="text-sm font-extrabold">{t("footer.explore")}</p>
            <div className="mt-4 flex flex-col gap-1 text-sm text-muted-foreground">
              {/* py-2: dokunmatikte en az ~36 px yükseklik (eskiden 20 px idi). */}
              <a href="#season" className="link-hover w-fit py-2">
                {t("common.thisSeason")}
              </a>
              <a href="#series" className="link-hover w-fit py-2">
                {t("footer.allSeries")}
              </a>
              {/* HEDEF YENİDEN YÖNLENDİRİLDİ: GENRES çip şeridi (ve onunla gelen
                  `id="genres"`) KULLANICI İSTEĞİYLE SİLİNDİĞİ için bu bağlantı
                  ölü kalmasın diye `#genres` yerine `#series` (seri ızgarası)
                  hedefine bağlandı. Etiket ("Türler"/"Genres") DEĞİŞMEDİ. */}
              <a href="#series" className="link-hover w-fit py-2">
                {t("footer.genres")}
              </a>
            </div>
          </div>
        </div>
        <div className="border-t border-border px-5 py-5 text-center text-xs text-muted-foreground">
          {t("footer.copyright")}
        </div>
      </footer>
    </div>
  );
}

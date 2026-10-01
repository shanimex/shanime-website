/**
 * Ana sayfa vitrinin STATİK yedek katmanı — saf yardımcılar (bileşen yok).
 *
 * `src/components/home/heroStatic.tsx` içindeki `ShowLogo` burayı kullanır.
 * Bileşenle sabitler AYRI dosyalarda tutulur (react-refresh kuralı).
 */
import ANIME_LOGO_FILES from "@/data/anime-logo-files.json";
import type { ShowWithImage } from "@/lib/content";

/**
 * Statik dosya düzeni (public/static/anime-data/<slug>/):
 *   anime-cover.jpg   → grid kartı kapağı (veritabanındaki image_path ile aynı)
 *   anime-header.jpg  → vitrin arka planı (geniş, dikey kapak hero'da kırpılır)
 *   anime-header.mp4  → vitrin arka plan videosu (varsa)
 *   anime-logo.<ext>  → vitrin başlığı; yalnızca MANİFEST'te kayıtlı olan
 *                       uzantılar denenir. Hiçbiri yoksa düz yazı çizilir.
 * Klasör adı her zaman seri slug'ıdır; logo listesi `npm run logos:manifest`
 * ile üretilir.
 */
const STATIC_DIR = "/static/anime-data";

/**
 * GERÇEKTEN var olan vitrin logosu yolları (derleme zamanında gömülü liste).
 * Var olmayan uzantı hiç denenmez → 0 404 (düzeltme, 29.09.2026).
 */
const LOGO_FILES = new Set<string>(ANIME_LOGO_FILES as string[]);

/**
 * Bulunmuş logo adresleri (oturum içi hatırlama) + koyu zeminde kaybolan
 * logoların listesi. `ShowLogo` bileşenine aittir, burada tutulur.
 */
export const LOGO_RESOLVED = new Map<string, string>();
export const LOGO_NEEDS_OUTLINE = new Set(["mushoku-tensei"]);

/**
 * Vitrin başlığı adayları — YALNIZCA manifest'te kayıtlı yollar.
 * Tercih sırası: önce `.png`, sonra `.svg`.
 */
export function logoCandidates(slug: string | null | undefined): string[] {
  if (!slug) return [];
  return [".png", ".svg"]
    .map((ext) => `${STATIC_DIR}/${slug}/anime-logo${ext}`)
    .filter((path) => LOGO_FILES.has(path));
}

/** Vitrin arka planı: dikey kapaklar hero'da kötü kırpılıyor, geniş header'lar kullanılır. */
export function heroBackdrop(slug: string | null | undefined, fallback: string): string {
  return slug ? `${STATIC_DIR}/${slug}/anime-header.jpg` : fallback;
}

/** Vitrin arka plan videoları: eski sitede hero'da video oynatıyordu.
 *  Sadece aktif slaytın videosu indirilir/oynatılır; dosya yoksa jpg kalır. */
export function heroVideo(slug: string | null | undefined): string | undefined {
  return slug ? `${STATIC_DIR}/${slug}/anime-header.mp4` : undefined;
}

// Veritabanı boşsa veya yüklenemediyse gösterilen yedek içerik.
// slug'lar gerçek seri slug'larıyla aynı tutulur ki hero logosu ve
// seri bağlantıları yedek modda da çalışsın.
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

export const fallbackShows = [
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
export type HeroCard = ShowWithImage | typeof fallbackHero;

/** Kart için adres kimliği (`showSlug` ile aynı kural, `id` tanımsızlığını tolere eder). */
export function cardSlug(show: HeroCard): string {
  const slug = show.slug;
  return slug && slug.trim() ? slug : (show.id ?? "");
}

/**
 * "KALDIĞIN YERDEN DEVAM ET" SATIRININ VERİSİ (cihazda tutulur).
 *
 * NEDEN `frame` VE `fraction` AYRI: ikisi farklı kaynaklardan gelir ve farklı
 * güvenilirliğe sahiptir (kare: kendi videomuzdan; oran: gerçek konum ölçümü).
 * Uydurma kare üretilmez, kırık görsel gösterilmez.
 */
export type ContinueItem = {
  show: HeroCard;
  season: number;
  episode: number;
  /** Yakalanmış gerçek kare (data URL); yoksa boş metin → poster gösterilir. */
  frame: string;
  /** 0..1 arası ilerleme; konum kaydı yoksa `null` (çubuk hiç çizilmez). */
  fraction: number | null;
  /** Kayıtlı son saniye (0 = kayıt yok) → zaman damgası "0:55 / 23:40". */
  position: number;
  /** Toplam süre saniye (0 = bilinmiyor) → "23 dk kaldı". */
  duration: number;
  /** Serinin toplam bölüm sayısı (0 = bilinmiyor). */
  total: number;
  /** Serinin MAL kimliği; bölüm kapağını çözmek için (yoksa zincir boş döner). */
  malId: number | null;
};

/** Saat biçimi: 143 → "2:23", 1423 → "23:43", 3700 → "1:01:40". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

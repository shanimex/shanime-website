/**
 * MARKA SABİTLERİ — logolar tek yerden yönetilir.
 *
 * KULLANICI İSTEĞİ (01.10.2026): "admin paneldeki değişmesin ... onu geri ekle
 * o admin'de kalsın ama diğer her yerde bunu kullan".
 *
 * İKİ LOGO VARDIR ve bilerek AYRIDIR:
 *   · SİTE LOGOSU (`BRAND_LOGO_SRC`)  → ana sayfa, seri detayı, oynatıcı, giriş
 *                                       ekranı, 404 ve alt bilgi. Kırmızı
 *                                       aksanlı yeni kelime markası.
 *   · PANEL LOGOSU (`ADMIN_LOGO_SRC`) → yalnızca `/admin`. Yönetim paneli bir iç
 *                                       araçtır; kullanıcı isteğiyle ESKİ amblem
 *                                       logosu orada kaldı.
 *
 * LOGOYU DEĞİŞTİRMEK İÇİN:
 *   1) Kendi görselini ilgili dosyanın ÜZERİNE yaz
 *      (`public/shanime-logo.png` ya da `public/shanime-logo-admin.png`).
 *   2) Aşağıdaki `LOGO_VERSION` değerini BİR ARTIR (`"8"` → `"9"`).
 *
 * NEDEN 2. ADIM ŞART: tarayıcılar `?v=8` adresini önbelleğe alır. Dosya değişse
 * bile adres aynı kalırsa ziyaretçi ESKİ logoyu görmeye devam eder. Sürümü
 * artırmak adresi değiştirir ve önbelleği geçersiz kılar.
 *
 * NEDEN ORTAK SABİT: aynı dosya adı `__root.tsx` (404), `auth.tsx`, `admin.tsx`,
 * `index.tsx` (alt bilgi) ve `SiteHeader.tsx` içinde elle yazılıydı; tek yerini
 * atlamak mümkündü. Sürüm artık buradan yönetilir.
 */

/**
 * Önbellek kırıcı sürüm (iki logo için ORTAK).
 *
 * SÜRÜM GEÇMİŞİ:
 *   6 → 7 : kullanıcı yeni logoyu koydu (kendi değiştirdi).
 *   7 → 8 : dosya adı AYNI kaldı ama İÇERİĞİ değişti — kaynak görselin şeffaf
 *           kenar boşlukları kırpıldı ve 800 px'e küçültüldü.
 *   8 → 9 : yeni site logosu (beyaz "Sha" + kırmızı "nime", 2170×725).
 *   9 → 10: aynı dosyanın boş siyah kenarları kırpıldı (1290×373) — içerik
 *           tuvalin yarısından azdı, şeritte minik görünüyordu.
 */
const LOGO_VERSION = "10";

/** Dosya adları — `public/` altındaki gerçek dosyalar. */
const SITE_LOGO_FILE = "/shanime-logo.png";
const ADMIN_LOGO_FILE = "/shanime-logo-admin.png";

/**
 * SEKME İKONLARININ önbellek sürümü (logo ile aynı sayacı paylaşır).
 *
 * `__root.tsx` içindeki dört `<link rel="icon">` etiketi bunu kullanır.
 * İkonlar (`favicon.ico`, `icon-192/512`, `apple-touch-icon`) yeniden
 * üretildiğinde bu sayacı artırmak yeterlidir; tarayıcı sekmelerdeki eski
 * ikonu önbellekten göstermeye devam etmesin.
 */
export const BRAND_ICON_VERSION = LOGO_VERSION;

/**
 * SİTE logosu — `/admin` DIŞINDA her yerde.
 *
 * Dosya 1290×373 px'dir (boş kenarları kırpılmış yeni marka).
 */
export const BRAND_LOGO_SRC = `${SITE_LOGO_FILE}?v=${LOGO_VERSION}`;

/** SİTE logosunun gerçek piksel ölçüsü — `width`/`height` ile verilir (yerleşim kaymasın). */
export const BRAND_LOGO_WIDTH = 1290;
export const BRAND_LOGO_HEIGHT = 373;

/**
 * PANEL logosu — YALNIZCA `/admin`.
 *
 * Kullanıcı eski dosyayı `shanime-logoCOPY.png` adıyla bırakmıştı; burada
 * anlamlı bir ada (`shanime-logo-admin.png`) taşındı. Ölçüsü kareye yakındır.
 */
export const ADMIN_LOGO_SRC = `${ADMIN_LOGO_FILE}?v=${LOGO_VERSION}`;

/** PANEL logosunun gerçek piksel ölçüsü. */
export const ADMIN_LOGO_WIDTH = 1060;
export const ADMIN_LOGO_HEIGHT = 856;

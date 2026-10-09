/**
 * ÖN REKLAM KAPISI — OTURUM KAYDI.
 *
 * NEDEN VAR: kapının "geçildi" bilgisi eskiden YALNIZCA React durumundaydı
 * (`useState`). Telefonda tarayıcı sayfayı arka plana atınca (ya da geri/ileri
 * gezinmesinde) BELLEKTEN düşürüp yeniden yüklediği için her dönüşte reklam
 * BAŞTAN oynuyordu. Kullanıcı geri bildirimi (09.10.2026): "en ufak sayfa
 * değişiminde video sıfırlanıyor, bazen baştan başlıyor, reklam bile geliyor."
 *
 * KURAL: bir bölümün kapısı bu OTURUMDA bir kez geçildiyse bir daha oynatılmaz.
 * Kayıt `sessionStorage`'dadır — sekme kapanınca silinir; yani YENİ ziyaret,
 * yeni sekme ve farklı bölüm reklamsız kalmaz (gösterim/para kaybı yoktur).
 * Aynı sekmede aynı bölüme geri dönmek ise reklamı TEKRAR oynatmaz.
 *
 * NEDEN AYRI DOSYA: bu bilgiyi okuyan/yazan tek yer olsun; anahtar iki dosyada
 * yazılsaydı biri değişip öteki unutulurdu (projedeki `watch-progress.ts` ile
 * aynı desen: tek anahtar + sürüm + her şey try/catch içinde).
 */

/** Depo anahtarının TEK kaynağı. Biçim değişirse sürüm artırılır (`:v1` → `:v2`). */
const STORAGE_KEY = "shanime:reklam-kapisi:v1";

/** Tutulacak en fazla bölüm kaydı — oturum uzasa da kayıt sınırsız büyümesin. */
const MAX_ENTRIES = 200;

/**
 * Kapı kaydını okur; bozuk/dolu/erişilemez depo "hiç geçilmemiş" sayılır
 * (reklam bir kez fazladan oynar, akış bozulmaz — güvenli taraf).
 */
function readAll(): string[] {
  // Sunucuda `window` yoktur (SSR): burada durmak sunucu render'ını korur.
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

/** Yazamazsa (gizli mod / kota) sessizce geçer: kapı kaydı yardımcı bir özelliktir. */
function writeAll(keys: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(keys.slice(-MAX_ENTRIES)));
  } catch {
    /* Depo yazılamadı: reklam bu oturumda tekrar oynayabilir, sayfa çalışır. */
  }
}

/** Bu bölümün kapısı bu oturumda geçildi mi? */
export function hasPassedPreroll(episodeKey: string): boolean {
  if (!episodeKey) return false;
  return readAll().includes(episodeKey);
}

/** Bu bölümün kapısı geçildi olarak işaretlenir (aynı anahtar tekrar eklenmez). */
export function markPrerollPassed(episodeKey: string): void {
  if (!episodeKey) return;
  const keys = readAll();
  if (keys.includes(episodeKey)) return;
  writeAll([...keys, episodeKey]);
}

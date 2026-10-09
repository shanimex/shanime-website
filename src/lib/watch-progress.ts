/**
 * Bölüm izleme ilerlemesi — CİHAZA ÖZEL (kullanıcı tercihi).
 *
 * NEDEN CİHAZDA: kullanıcı ilerlemenin cihazda kalmasını seçti; hesap
 * eşitlemesi (Supabase tablosu) istenmedi. Böylece giriş yapmayan ziyaretçide de
 * ilerleme çalışır ve sunucuya hiçbir kişisel veri gitmez.
 *
 * NEDEN TEK ANAHTAR + SÜRÜM: tüm seriler tek bir JSON nesnesinde tutulur
 * (`{ "<seri>": ["s1b5", "s1b6"] }`). Biçim değişirse anahtarın sürümü artırılır;
 * eski kayıt okunmaz ve sessizce yok sayılır, yani güncelleme kimseyi kırmaz.
 *
 * NEDEN HER ŞEY try/catch İÇİNDE: depo bozuk (elle düzenlenmiş / yarım yazılmış),
 * dolu ya da gizli modda (Safari private) olabilir. İlerleme kaydı YARDIMCI bir
 * özelliktir; hiçbir durumda sayfayı çökertmemeli, hata fırlatmamalıdır.
 */

/**
 * Depo anahtarının TEK kaynağı burasıdır. Başka hiçbir dosya localStorage'dan
 * ilerleme okumaz/yazmaz — anahtar iki yerde yazılsaydı biri değişip öteki
 * unutulur, ilerleme "kaybolmuş" gibi görünürdü.
 */
const STORAGE_KEY = "shanime:izlenen-bolumler:v1";

/** Depodaki biçim: seri anahtarı → izlenen bölüm anahtarları (EN SON izlenen en sonda). */
type ProgressMap = Record<string, string[]>;

/**
 * Bir seride tutulacak en fazla bölüm anahtarı. 1000+ bölümlü seride de kayıt
 * sınırsız büyümesin; en eski girdiler düşer, "son izlenen" her zaman korunur.
 */
const MAX_ENTRIES_PER_SHOW = 500;

/** Bölüm anahtarı: sezon 1 / bölüm 5 → `"s1b5"`. Okunması kolay, ayrıştırması ucuz. */
export function episodeKey(season: number, episode: number): string {
  return `s${season}b${episode}`;
}

/** `"s1b5"` → `{ season: 1, episode: 5 }`; biçim tutmuyorsa null. */
function parseEpisodeKey(key: string): { season: number; episode: number } | null {
  const match = /^s(\d+)b(\d+)$/.exec(key);
  if (!match) return null;
  const season = Number(match[1]);
  const episode = Number(match[2]);
  if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
  return { season, episode };
}

/**
 * Okunan değerin beklenen biçimde olup olmadığını denetler.
 *
 * NEDEN: `JSON.parse` bozuk kayıtta fırlatır, ama biçimi bozuk (ör. dizi ya da
 * sayı listesi) kayıtta fırlatmaz — o durumda `getWatched` çökmesin diye
 * içerik de doğrulanır.
 */
function isProgressMap(value: unknown): value is ProgressMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((list) =>
    Array.isArray(list) ? list.every((item) => typeof item === "string") : false,
  );
}

/** Depoyu okur. Kayıt yok, bozuk ya da tarayıcı dışı ortam (SSR) → boş nesne. */
function readAll(): ProgressMap {
  // Sunucuda `window` yoktur (SSR). Burada durmak, sunucu render'ının
  // localStorage'a dokunmaya çalışıp çökmesini yapısal olarak engeller.
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return isProgressMap(parsed) ? parsed : {};
  } catch {
    // Bozuk JSON: ilerleme yokmuş gibi davran (veri kaybı değil, sessiz düşüş).
    return {};
  }
}

/** Depoya yazar. Yazamazsa (dolu/gizli mod) sessizce geçer. */
function writeAll(map: ProgressMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Depo yazılamadı: ilerleme bu oturumda tutulmaz, sayfa normal çalışır.
  }
}

/**
 * Bir bölümü izlendi olarak işaretler.
 *
 * Kayıt SIRASI korunur ve aynı bölüm tekrar izlenirse listenin SONUNA taşınır:
 * `getLastEpisode` "en son izlenen"i listenin sonundan okuduğu için, izleyici
 * eski bir bölüme dönse bile "kaldığın yerden devam et" DOĞRU bölümü gösterir.
 */
export function markWatched(showSlug: string, season: number, episode: number): void {
  if (!showSlug || !Number.isFinite(season) || !Number.isFinite(episode)) return;
  const key = episodeKey(season, episode);
  const map = readAll();
  const list = map[showSlug] ?? [];
  map[showSlug] = [...list.filter((item) => item !== key), key].slice(-MAX_ENTRIES_PER_SHOW);
  writeAll(map);
}

/**
 * Bir seride izlenen bölümlerin anahtar kümesi (`"s1b5"` gibi).
 * Küme döner çünkü çağıran taraf çoğunlukla "bu bölüm izlendi mi?" diye bakar.
 */
export function getWatched(showSlug: string): Set<string> {
  if (!showSlug) return new Set();
  return new Set(
    (readAll()[showSlug] ?? []).filter((key) => {
      const parsed = parseEpisodeKey(key);
      return parsed ? hasStarted(showSlug, parsed.season, parsed.episode) : false;
    }),
  );
}

/** En son izlenen bölüm; hiç kayıt yoksa `null` (arayüz bu durumda hiçbir şey çizmez). */
export function getLastEpisode(showSlug: string): { season: number; episode: number } | null {
  if (!showSlug) return null;
  const list = readAll()[showSlug] ?? [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const parsed = parseEpisodeKey(list[index]!);
    if (parsed && hasStarted(showSlug, parsed.season, parsed.episode)) return parsed;
  }
  return null;
}

/** Eski tıklama kayıtlarını ayıklamak için gerçek oynatma pozisyonu kontrolü. */
function hasStarted(showSlug: string, season: number, episode: number): boolean {
  const entry = readPositions()[progressKey(showSlug, season, episode)];
  return Boolean(entry && Number.isFinite(entry.p) && entry.p > 0);
}

/* ============================================================================
 * OYNATMA KONUMU VE "KALDIĞIN YER" KARESİ — DÜRÜST KAPSAM
 * ============================================================================
 * Buradaki iki ek kayıt, ilerlemenin SAYISAL konumunu ve (mümkünse) videodan
 * yakalanmış GERÇEK bir kareyi tutar. İkisi de cihazda kalır; sunucuya hiçbir
 * şey gönderilmez (üstteki nota bakın).
 *
 * ⚠️ KARE YALNIZCA BİZİM <video>'MUZDAN YAKALANABİLİR. Bölüm bir iframe/embed
 * (Anizm, TauVideo, Megaplay, VidMoly …) içinde oynuyorsa tarayıcı o kareyi
 * OKUYAMAZ: iframe'in belgesi BAŞKA bir kaynak (cross-origin) olduğu için
 * canvas'a çizim `SecurityError` ile reddedilir ve tarayıcıda "iframe içindeki
 * videodan kare al" diye bir API YOKTUR. Bu yüzden kare yakalama iframe
 * durumunda hiç DENENMEZ; arayüz sessizce yedek görsele (seri posteri) düşer.
 * Uydurma bir kare/poster üretilmez.
 *
 * KONUM (sayı) ise iframe'de de gerçektir: sağlayıcı kendi oynatıcısından
 * `postMessage` ile `{"event":"time","time":…,"duration":…}` yollar (izleme
 * sayfası bunu zaten dinliyor). Konum ORADAN gelir, tahmin edilmez.
 *
 * NEDEN AYRI DEPO ANAHTARI (v1 kaydının içine gömülmedi): `STORAGE_KEY` altındaki
 * kayıt `ProgressMap` biçimindedir ve doğrulayıcı (`isProgressMap`) YALNIZCA
 * `string[]` değerleri kabul eder. İçine kare/konum nesnesi konsaydı doğrulama
 * başarısız olur, TÜM kayıt "bozuk" sayılır ve izlenen bölüm listesi silinirdi.
 * Bu yüzden aynı modülde, aynı sürümleme kuralıyla (`:v1`) İKİNCİ bir anahtar
 * kullanılır; mevcut kayıt biçimi bilerek DEĞİŞTİRİLMEDİ.
 * ========================================================================== */

/** Yakalanan karelerin deposu (bölüm başına tek data URL). */
const FRAME_KEY = "shanime:devam-kareleri:v1";

/** Oynatma konumlarının deposu (bölüm başına son saniye + toplam süre). */
const POSITION_KEY = "shanime:izleme-konumu:v1";

/**
 * Kare yakalanırken kullanılan genişlik (px) — YAKLAŞIK bir değerdir, bir
 * referanstan ölçülmedi: yakalanan tek kareyi yalnızca SATIRIN KÜÇÜK KAPAĞINDA
 * göstereceğiz, bu yüzden 160 px fazlasıyla yeterlidir ve kayıt küçük kalır
 * (yerel depo dolmasın).
 */
const RESUME_FRAME_WIDTH = 160;

/** JPEG sıkıştırma oranı — küçük tutulur (kayıt boyutu öncelikli). */
const RESUME_FRAME_QUALITY = 0.45;

/** Saklanacak en fazla kare sayısı (en eski kayıtlar düşer). */
const MAX_FRAMES = 30;

/** Tek karenin kabul edilen en uzun data URL'i (bozuk/şişmiş kayda karşı). */
const MAX_FRAME_LENGTH = 60_000;

/** Saklanacak en fazla konum kaydı (en eski kayıtlar düşer). */
const MAX_POSITIONS = 200;

/** Konum kaydı: `"<seri>:s1b5"` → son saniye (`p`) ve toplam süre (`d`). */
type PositionMap = Record<string, { p: number; d: number }>;

/** Bölüm başına anahtar: seri anahtarı + bölüm anahtarı. */
function progressKey(showSlug: string, season: number, episode: number): string {
  return `${showSlug}:${episodeKey(season, episode)}`;
}

/** Konum deposunu okur; bozuk kayıt "konum yok" sayılır (asla fırlatmaz). */
function readPositions(): PositionMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(POSITION_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: PositionMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as { p?: unknown; d?: unknown };
      const position = Number(entry.p);
      const duration = Number(entry.d);
      if (Number.isFinite(position) && position > 0) {
        result[key] = { p: position, d: Number.isFinite(duration) && duration > 0 ? duration : 0 };
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** Konum deposunu yazar; yazamazsa sessizce geçer. */
function writePositions(map: PositionMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(POSITION_KEY, JSON.stringify(map));
  } catch {
    /* Depo dolu/gizli mod: konum tutulmaz, oynatma etkilenmez. */
  }
}

/**
 * Bölümdeki SON oynatma konumunu kaydeder (saniye).
 *
 * Çağıran taraf: (a) kendi `<video>`muzdaki `timeupdate`/`pause`/`seeked`,
 * (b) sağlayıcının `postMessage` ile bildirdiği `event:"time"` mesajları.
 * Geçersiz/0 değer yazılmaz — "başlamadı" kaydı ilerleme sayılmaz.
 */
export function savePosition(
  showSlug: string,
  season: number,
  episode: number,
  position: number,
  duration: number,
): void {
  if (!showSlug || !Number.isFinite(season) || !Number.isFinite(episode)) return;
  if (!Number.isFinite(position) || position <= 0) return;
  const map = readPositions();
  const key = progressKey(showSlug, season, episode);
  // Var olan anahtar yeniden yazılır: kayıt SIRASI "en son izlenen en sonda"
  // anlamını taşır ve budama ilk (en eski) anahtarlardan başlar. Aynı bölüm
  // farklı sağlayıcılarda farklı süre bildirebilir; kartta kısa olanın üzerine
  // yazmamak için görülen en uzun gerçek süre korunur.
  const previousDuration = Number(map[key]?.d) > 0 ? Number(map[key]?.d) : 0;
  delete map[key];
  const incomingDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  map[key] = { p: position, d: Math.max(previousDuration, incomingDuration) };
  const keys = Object.keys(map);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_POSITIONS))) delete map[stale];
  writePositions(map);
}

/**
 * Bölümün kayıtlı oynatma konumu; kayıt yoksa `null`.
 * `duration` bilinmiyorsa 0 döner (yüzde hesabı çağıranda yapılır).
 */
export function getProgress(
  showSlug: string,
  season: number,
  episode: number,
): { position: number; duration: number } | null {
  if (!showSlug) return null;
  const entry = readPositions()[progressKey(showSlug, season, episode)];
  return entry ? { position: entry.p, duration: entry.d } : null;
}

/**
 * BİR SERİNİN TÜM BÖLÜM KONUMLARI — TEK OKUMA (`"s1b5"` → `{ position, duration }`).
 *
 * NEDEN AYRI FONKSİYON (05.10.2026): bölüm listeleri (detay sayfası + oynatıcı
 * yan paneli) her satır için `getProgress` çağırsaydı HER ÇAĞRI tüm depoyu
 * yeniden okurdu (`getItem` + tam `JSON.parse`). 1000 bölümlük bir seride bu,
 * satır başına bir JSON çözümlemesi demektir. Burada depo BİR kez okunur ve
 * yalnızca istenen serinin kayıtları süzülür.
 *
 * `duration` 0 olabilir: sağlayıcı süreyi bildirmemişse yüzde hesaplanamaz;
 * yalnızca süre okunur; gösterilip gösterilmeyeceğine ÇAĞIRAN karar verir
 * (ör. "kalan süre" etiketi yalnızca süre biliniyorsa gösterilir).
 */
export function getShowProgress(
  showSlug: string,
): Record<string, { position: number; duration: number }> {
  if (!showSlug) return {};
  const prefix = `${showSlug}:`;
  const result: Record<string, { position: number; duration: number }> = {};
  for (const [key, value] of Object.entries(readPositions())) {
    if (!key.startsWith(prefix)) continue;
    result[key.slice(prefix.length)] = { position: value.p, duration: value.d };
  }
  return result;
}

/** Kare deposunu okur; yalnızca `data:image/…` ile başlayan kayıtlar geçerlidir. */
function readFrames(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(FRAME_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.startsWith("data:image/")) result[key] = value;
    }
    return result;
  } catch {
    // Bozuk kayıt: kare yokmuş gibi davran (oynatma etkilenmez).
    return {};
  }
}

/** Kare deposunu yazar; depo dolarsa sessizce geçer (kare yardımcı özelliktir). */
function writeFrames(map: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FRAME_KEY, JSON.stringify(map));
  } catch {
    /* Kota dolu: kare tutulmaz; izleme ve ilerleme normal çalışır. */
  }
}

/**
 * Bölüm için yakalanmış kareyi kaydeder. Yalnızca geçerli bir data URL kabul
 * edilir; boş/geçersiz değer kaydı DEĞİŞTİRMEZ (var olan kare korunur).
 */
function saveResumeFrame(showSlug: string, season: number, episode: number, dataUrl: string): void {
  if (!showSlug || !Number.isFinite(season) || !Number.isFinite(episode)) return;
  if (!dataUrl.startsWith("data:image/") || dataUrl.length > MAX_FRAME_LENGTH) return;
  const map = readFrames();
  const key = progressKey(showSlug, season, episode);
  delete map[key];
  map[key] = dataUrl;
  const keys = Object.keys(map);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_FRAMES))) delete map[stale];
  writeFrames(map);
}

/** Bölüm için kayıtlı kare; yoksa boş metin (arayüz bu durumda postere düşer). */
export function getResumeFrame(showSlug: string, season: number, episode: number): string {
  if (!showSlug) return "";
  return readFrames()[progressKey(showSlug, season, episode)] ?? "";
}

/**
 * O AN oynayan `<video>`dan TEK kare yakalar ve küçük bir JPEG data URL'i döner.
 *
 * ⚠️ YALNIZCA KENDİ <video>'MUZ İÇİN: iframe/embed (Anizm, TauVideo, Megaplay …)
 * cross-origin olduğu için `drawImage`/`toDataURL` `SecurityError` fırlatır ve
 * tarayıcıda iframe içini okuyacak bir API yoktur. Bu fonksiyon bu yüzden iframe
 * için ÇAĞRILMAZ (çağrılsa da aşağıdaki try/catch boş metin döndürür).
 *
 * HİÇBİR DURUMDA FIRLATMAZ ve oynatmayı BLOKLAMAZ: hata/boş kare → boş metin.
 */
export function captureResumeFrame(
  video: HTMLVideoElement,
  showSlug: string,
  season: number,
  episode: number,
  maxWidth: number = RESUME_FRAME_WIDTH,
): string {
  if (typeof document === "undefined") return "";
  try {
    const width = video.videoWidth;
    const height = video.videoHeight;
    // Meta veri henüz yoksa (henüz kare çözülmediyse) yakalama atlanır.
    if (!width || !height) return "";
    const scale = Math.min(1, maxWidth / width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return "";
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    // Kirli (cross-origin) tuval burada `SecurityError` fırlatır → aşağıda yutulur.
    const dataUrl = canvas.toDataURL("image/jpeg", RESUME_FRAME_QUALITY);
    if (!dataUrl.startsWith("data:image/")) return "";
    saveResumeFrame(showSlug, season, episode, dataUrl);
    return dataUrl;
  } catch {
    // Cross-origin (`SecurityError`), çözülmüş tuval ya da bozuk video verisi:
    // KARE YOK sayılır. Arayüz postere düşer; oynatma hiç etkilenmez.
    return "";
  }
}

/**
 * Bir serinin TÜM ilerleme kaydını siler — "İzlemeye devam et" listesinden
 * çıkarma (referans animex.one'daki "Edit" davranışı).
 *
 * NEDEN İKİ DEPO DA TEMİZLENİR: izlenen bölüm listesi silinse bile konum
 * kayıtları (`<seri>:s1b5` → saniye) depoda kalırdı; seri sonradan yeniden
 * izlendiğinde eski "kaldığın yer" geri gelirdi. İkisi birlikte silinir.
 *
 * Hata yutulur (depo bozuk/dolu olabilir): silme yardımcı bir işlemdir,
 * sayfayı çökertmemelidir.
 */
export function forgetShow(showSlug: string): void {
  if (!showSlug) return;
  try {
    const watched = readAll();
    if (watched[showSlug]) {
      delete watched[showSlug];
      writeAll(watched);
    }
    const positions = readPositions();
    const prefix = `${showSlug}:`;
    let touched = false;
    for (const key of Object.keys(positions)) {
      if (key.startsWith(prefix)) {
        delete positions[key];
        touched = true;
      }
    }
    if (touched) writePositions(positions);
  } catch {
    // Sessiz düşüş.
  }
}

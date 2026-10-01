/**
 * İÇERİK ÇEVİRİSİ (istemci tarafı) — bölüm adları, özetler, dizi açıklamaları
 * ve türler için TR karşılıklarını getirir.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NEDEN İSTEMCİDE TUTULUR (arayüz sözlüğünden FARKI)
 *
 * `lib/i18n.ts` ARAYÜZ metinlerini çevirir: sabit, kısa, geliştirici tarafından
 * yazılmış cümleler. Orada çeviri elle yazılır, doğruluğu garantidir.
 *
 * Buradaysa VERİTABANI içeriği var: dizi adları, bölüm adları, özetler, türler.
 * Bunlar kullanıcı/admin tarafından değiştirilebilir ve binlerce satır olabilir —
 * elle çevrilemeyeceği için makineye çevirtilir (sunucu rotası `/api/translate`,
 * motor DeepL).
 *
 * ── ÜÇ KATMANLI ÖNBELLEK ───────────────────────────────────────────────────
 *  1. `localStorage` — tarayıcıda kalıcı. Aynı ziyaretçi bir metni BİR KEZ
 *     ister; sonraki ziyaretlerde ağa hiç çıkılmaz.
 *  2. Sunucu belleği (L1) — aynı sunucu örneğindeki tüm ziyaretçiler paylaşır.
 *  3. Sunucu Cache API (L2) — üretimde kalıcı (bkz. `routes/api.translate.ts`).
 *
 * Bu yüzden DeepL'in ücretsiz kotası (1.000.000 karakter) rahat yeter.
 *
 * ── ASLA BLOKLAMAZ ────────────────────────────────────────────────────────
 * Çeviri gelene kadar ORİJİNAL metin gösterilir; hata olursa da öyle kalır.
 * Yani çeviri katmanı bozulsa bile site eksiksiz çalışır.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { useEffect, useMemo, useState } from "react";
import { useLang } from "@/lib/i18n";

const STORAGE_KEY = "shanime:tr-cache:v1";
/** Tarayıcı deposunda tutulacak en fazla kayıt (sınırsız büyümesin). */
const MAX_ENTRIES = 4000;
/** Tek istekte gönderilecek en fazla metin (sunucu sınırı 60). */
const BATCH = 50;

type Cache = Record<string, string>;

let memoryCache: Cache | null = null;

/** Kalıcı istemci önbelleğini okur (ilk çağrıda diskten, sonra bellekten). */
function readCache(): Cache {
  if (memoryCache) return memoryCache;
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Cache) : {};
    memoryCache = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    memoryCache = {};
  }
  return memoryCache;
}

/** Önbelleği diske yazar; kota dolarsa SESSİZCE vazgeçer (site çalışmaya devam eder). */
function writeCache(cache: Cache): void {
  memoryCache = cache;
  if (typeof window === "undefined") return;
  try {
    const keys = Object.keys(cache);
    if (keys.length > MAX_ENTRIES) {
      // En eski kayıtlar baştan atılır (nesne sırası ekleme sırasıdır).
      const trimmed: Cache = {};
      for (const key of keys.slice(keys.length - MAX_ENTRIES)) trimmed[key] = cache[key] as string;
      cache = trimmed;
      memoryCache = trimmed;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Kota/özel mod: kalıcı yazma yapılamaz, bellekteki kopya yeterli.
  }
}

/** Önbellek anahtarı — hedef dil + metnin kendisi. */
const cacheKey = (target: string, text: string) => `${target}\u0000${text}`;

/* ═══════════════════════════════════════════════════════════════════════════
   İSTEK BİRLEŞTİRME — ÖLÇÜLMÜŞ SORUNUN DÜZELTMESİ

   İlk sürümde her `useTranslatedTexts` çağrısı KENDİ isteğini atıyordu. Dizi
   detay sayfasında her bölüm satırı bir kanca çalıştırdığı için ölçüm şuydu:
   **18 ayrı `/api/translate` isteği** (hepsi 200 ve doğru, ama gereksiz).

   ÇÖZÜM: aynı çizim turunda gelen istekler TEK çağrıda toplanır (hedef dil
   başına bir istek). Satırlar zaten birlikte çizildiği için 18 istek 1-2'ye
   iner ve sunucu önbelleği tek seferde ısınır.
   ═══════════════════════════════════════════════════════════════════════════ */

type Waiter = (value: string) => void;

/** Hedef dil → { metin → o metni bekleyen çözücüler }. */
const pending = new Map<string, Map<string, Waiter[]>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Bir metnin çevirisini kuyruğa ekler; sonucu veren bir söz döndürür. */
function enqueue(target: "tr" | "en", text: string): Promise<string> {
  let bucket = pending.get(target);
  if (!bucket) {
    bucket = new Map();
    pending.set(target, bucket);
  }
  const bucketRef = bucket;
  const promise = new Promise<string>((resolve) => {
    const waiters = bucketRef.get(text) ?? [];
    waiters.push(resolve);
    bucketRef.set(text, waiters);
  });
  // Aynı turdaki tüm çağrılar biriksin diye gönderim bir sonraki göreve bırakılır.
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushQueue();
    }, 0);
  }
  return promise;
}

/** Kuyruğu boşaltır: hedef dil başına TEK istek (gerekirse parçalara bölünür). */
async function flushQueue(): Promise<void> {
  const batches = [...pending.entries()];
  pending.clear();

  for (const [target, bucket] of batches) {
    const texts = [...bucket.keys()];
    for (let i = 0; i < texts.length; i += BATCH) {
      const chunk = texts.slice(i, i + BATCH);
      let results: string[] = [];
      let ok = false;
      try {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts: chunk, target }),
        });
        const json = (await res.json()) as { ok?: boolean; translations?: string[] };
        if (json.ok && Array.isArray(json.translations)) {
          results = json.translations;
          ok = true;
        }
      } catch {
        // Ağ hatası: bekleyenler ORİJİNAL metinle çözülür (aşağıda).
      }

      const next = { ...readCache() };
      chunk.forEach((source, index) => {
        const translated = ok ? (results[index] ?? "") : "";
        /**
         * ⚠️ Çeviri KAYNAKLA AYNI olsa da ÖNBELLEĞE YAZILIR.
         *
         * NEDEN (ölçülmüş hata): ilk sürüm "aynıysa yazma" diyordu. İçerik zaten
         * Türkçe olduğu için DeepL çoğu metni DEĞİŞTİRMEDEN döndürüyor; bu yüzden
         * hiçbir şey önbelleğe girmiyor ve HER dil değişiminde aynı istekler
         * yeniden atılıyordu (ölçüm: 18 istek → yine 18 istek; önbellek istek
         * sayısını hiç azaltmıyor, yalnızca gecikmeyi düşürüyordu).
         * "Değişmedi" de geçerli bir CEVAPTIR ve önbellekte durmalıdır.
         */
        if (translated) next[cacheKey(target, source)] = translated;
        // Yanıt gelse de gelmese de bekleyenler ÇÖZÜLÜR: aksi hâlde bileşen
        // sonsuza kadar orijinal metinde kalırdı.
        for (const resolve of bucket.get(source) ?? []) resolve(translated || source);
      });
      writeCache(next);
    }
  }
}

/**
 * Verilen metinlerin çevirilerini döndürür: önce önbellek, eksikler tek istekte.
 * Çevrilemeyen metin için ORİJİNAL metin döner.
 */
async function translateTexts(texts: string[], target: "tr" | "en"): Promise<string[]> {
  const wanted = texts.map((text) => text.trim());
  const cache = readCache();
  const result = [...texts];
  const missing = new Set<string>();

  wanted.forEach((text, index) => {
    if (!text) return;
    const hit = cache[cacheKey(target, text)];
    if (typeof hit === "string" && hit) result[index] = hit;
    else missing.add(text);
  });

  const list = [...missing];
  if (list.length === 0) return result;

  // Eksikler KUYRUĞA verilir; aynı turdaki tüm satırların istekleri tek çağrıda
  // birleşir (bkz. `enqueue` notu). Söz her durumda çözülür — istek patlasa bile
  // bileşen sonsuza kadar beklemez.
  await Promise.all(list.map((text) => enqueue(target, text)));

  const fresh = readCache();
  wanted.forEach((text, index) => {
    if (!text) return;
    const hit = fresh[cacheKey(target, text)];
    if (typeof hit === "string" && hit) result[index] = hit;
  });
  return result;
}

/**
 * Bileşenler için hook: verilen metinlerin, SEÇİLİ DİLE göre görüntülenecek
 * hâlini döndürür.
 *
 * DAVRANIŞ: dil zaten İngilizce ise (içerik dili) hiçbir şey yapılmaz ve
 * metinler AYNEN döner — yani varsayılan dilde ek istek/gecikme YOKTUR.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ DÖNÜŞ BİR DİZİDİR, TUPLE DEĞİL — DESTRUCTURING'E DİKKAT
 *
 * Bu kanca GİRDİYLE AYNI UZUNLUKTA bir dizi döndürür: her girdi metni için bir
 * çeviri. Yani `n` metin verirsen `n` uzunlukta dizi alırsın.
 *
 * YAYGIN HATA: `const [ceviri] = useTranslatedTexts(liste)` yazmak. Bu, listenin
 * TAMAMINI değil YALNIZCA İLK çevirisini alır. Sonra `ceviri[i]` ile indekslenirse
 * **tek tek harfler** döner — canlıda tam olarak bu yaşandı: 24 bölümün adları
 * `[translatedSidebarTitles]` diye alınmıştı, dizi yerine tek metin ("Ryomen
 * Sukuna") elde kaldı ve bölümlere harfler dağıldı (1. bölüm "R", 2. "y", 3. "o").
 *
 * DOĞRU KULLANIM:
 *   · Tam liste gerekiyorsa → `const ceviriler = useTranslatedTexts(liste)`
 *   · Tek metin → `useTranslatedText([metin])` kullan (ayrı kısa yol).
 *   · Yalnızca sabit sayıda metin (ör. 2) çeviriyorsan destructuring GÜVENLİDİR,
 *     çünkü o zaman dizinin uzunluğu da 2'dir:
 *     `const [aciklama, tur] = useTranslatedTexts([aciklama, tur])`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * @param texts Sırası korunacak metin listesi.
 */
export function useTranslatedTexts(texts: string[]): string[] {
  const { lang } = useLang();
  /**
   * Bağımlılık anahtarı: `texts` her çizimde yeni dizi kimliği alır, o yüzden
   * diziye doğrudan bağlanmak sonsuz döngü yaratır. İçerik değişmediği sürece
   * anahtar aynı kalır.
   */
  const signature = useMemo(() => texts.join("\u0001"), [texts]);

  const [resolved, setResolved] = useState<string[]>(texts);

  useEffect(() => {
    const list = signature ? signature.split("\u0001") : [];
    if (lang !== "tr" || list.length === 0) {
      setResolved(list);
      return;
    }
    let alive = true;
    void translateTexts(list, "tr").then((translated) => {
      if (alive) setResolved(translated);
    });
    return () => {
      alive = false;
    };
  }, [signature, lang]);

  return resolved;
}

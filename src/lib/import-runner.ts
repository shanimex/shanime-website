/**
 * ── SIRALI, ÇÖKMEYEN YÜKLEME MOTORU ───────────────────────────────────────────
 *
 * NEDEN VAR (kullanıcı kararı, 27.09.2026): "her yeni sezon/anime eklediğimde
 * farklı bir hata alıyorum, sen her seferinde yama yapıyorsun; mimari kırılgan,
 * kökten esnek ve hata geçirmez hâle getir." Bu dosya, panelin kaynak yükleme
 * akışının ÇEKİRDEĞİDİR: bölüm/kaynak başına tek tek ilerleyen, tek bir kalemin
 * patlamasıyla TÜM işi düşürmeyen, her kalemi kayda geçen tek bir yol.
 *
 * ── KABUL EDİLEN KURALLAR (hepsi burada uygulanır) ────────────────────────────
 *   1) SIRALI ÇALIŞMA: `Promise.all` YOK. Kalemler `for` ile tek tek işlenir;
 *      istekler arasına `delayMs` (varsayılan 300 ms) konur. Böylece hem bizim
 *      Supabase/Cloudflare tarafımız hem karşı kaynak kilitlenmez.
 *   2) İZOLE HATA: `process` fırlatırsa yalnızca O KALEM "failed" olur; döngü
 *      DURMAZ, sonraki kaleme geçilir. Hata metni kayda yazılır — yutulmaz.
 *   3) "YOK" İLE "HATA" AYRI: kaynakta bulunmama (`ImportSkip`) başarısızlık
 *      DEĞİLDİR; ayrı sayaçta ve ayrı renkte gösterilir. Yoksa "kaynakta yok"
 *      bilgisi "sistem bozuk" gibi okunuyordu.
 *   4) GEÇİCİ HATA TEKRARI: ağ/429/5xx gibi GEÇİCİ hatalarda kısa artan beklemeyle
 *      `retries` kez yeniden denenir; kalıcı hatada (ör. şema yok) boşuna denenmez.
 *   5) GÜVENLİ OKUMA: kaynaktan gelen her şey `unknown` kabul edilir; `asArray`,
 *      `asString`, `asNumber`, `asRecord` ile okunur. Çağıran `data.property`
 *      yazmak zorunda kalmaz, `undefined` yüzünden çökme olmaz.
 *   6) ASLA ÇÖKMEZ: `labelOf`/`onProgress`/`sleepFn` gibi İSTEĞE BAĞLI geri
 *      çağrılar bir hata fırlatsa bile akış bozulmaz (hepsi korumalı). Fonksiyon
 *      kendisi de hata fırlatmaz; her koşulda ÖZET döner.
 *
 * BAĞIMSIZLIK: bu dosya HİÇBİR ŞEY İTHAL ETMEZ (React, Supabase, tarayıcı API'si
 * yok). Bu bilinçli: motor saf tutulduğu için Node'da doğrudan test edilebilir
 * (`tsc` ile derleyip çalıştırmak yeterli) ve panel dışında da kullanılabilir.
 */

/** Kalem durumu. `skipped` = kaynakta yok (HATA DEĞİL), `failed` = gerçek hata. */
export type ImportStatus = "ok" | "skipped" | "failed" | "stopped";

/** Tek bir kalemin (bölüm ya da bölüm×kaynak) kaydı — panelde satır olarak çizilir. */
export type ImportLogEntry = {
  /** 1'den başlayan sıra (aynı koşudaki benzersiz kimlik). */
  seq: number;
  /** İnsan okur etiket (ör. "12. Bölüm"). */
  label: string;
  /** Sağlayıcı adı (ör. "Anizm") — kalem düzeyinde boş olabilir. */
  provider: string;
  status: ImportStatus;
  /** Sonuç/sebep metni (boş bırakılmaz; en azından "tamam"). */
  detail: string;
  /** Kaç deneme yapıldı (ilk deneme dâhil). */
  attempts: number;
  /** Bu kalemin süresi (ms). */
  ms: number;
  /** Alt kayıtlar: bölüm → o bölümün kaynakları (panel iki düzeyli liste çizer). */
  children?: ImportLogChild[];
};

/** Kalemin altındaki kaynak kaydı (bölüm satırının içinde gösterilir). */
export type ImportLogChild = {
  label: string;
  provider: string;
  status: ImportStatus;
  detail: string;
  ms: number;
  /**
   * Bu kaynak için kaç istek denendi (geçici hatada artar).
   * Panelde "2 deneme" olarak görünür: dalgalı hata yaşandığı ama kurtarıldığı
   * kullanıcı tarafından ayırt edilebilsin.
   */
  attempts?: number;
};

/** İlerleme özeti (düğme/çubuk bunu okur). */
export type ImportProgress = {
  done: number;
  total: number;
  ok: number;
  skipped: number;
  failed: number;
  /** İşlenmekte olan kalemin etiketi (boş olabilir). */
  current: string;
};

/**
 * "Kaynakta yok" işareti.
 *
 * NEDEN AYRI SINIF: `process` içinden düz `throw new Error(...)` atmak, "bu bölüm
 * kaynakta yok" ile "şema hatası/ağ hatası"nı aynı sepete koyuyordu; kullanıcı
 * hangisinin gerçek sorun olduğunu ayırt edemiyordu. Bu sınıfı fırlatmak kalemi
 * "skipped" yapar.
 */
export class ImportSkip extends Error {
  constructor(detail: string) {
    super(detail || "kaynakta yok");
    this.name = "ImportSkip";
  }
}

/**
 * İstekler arası varsayılan bekleme (ms).
 *
 * ── TARİHÇE ─────────────────────────────────────────────────────────────────
 * 27.09.2026: **300 ms** — kaynaklar dalgalı hata veriyordu, kullanıcı istedi.
 * 29.09.2026: **80 ms** — kullanıcı: "yükleme çubuğunu yavaşlatma; en yüksek
 *   hızda yüklesin, sadece CANLI ve GERÇEK şekilde göstersin." Bekleme hem
 *   BÖLÜMLER arasında (`runSequentialImport`) hem de bir bölümün KAYNAKLARI
 *   arasında uygulanır; 25 bölüm × 3 kaynak için toplam bekleme ~30 sn → ~8 sn.
 *
 * ⚠️ NEDEN SIFIR DEĞİL: sağlayıcılar (animecix / tauvideo / puffytr) kısa sürede
 * çok istek atılınca **429/502** döndürebiliyor; o durumda `DEFAULT_RETRIES`
 * devreye girer ve iş DAHA YAVAŞ biter (her deneme ayrıca bekler). 80 ms bu
 * dengeyi korur. Daha hızlısı istenirse ayar TEK YERDEDİR (burası) — ama önce
 * canlı günlükten "başarısız" sayısına bakılmalı.
 */
export const RATE_LIMIT_DELAY_MS = 80;

/**
 * Varsayılan DENEME sayısı (ilk deneme dâhil) — geçici hatalarda.
 *
 * NEDEN 3 (ÖLÇÜM 27.09.2026): kaynaklar DALGALI hata veriyor. animecix
 * (`/secure/episode-videos`) aynı bölüm için bazen Cloudflare **502** döndürüp hemen
 * ardından tam veriyi veriyor (ölçüm: Erased S1B2 ve S1B4 ilk denemede 502, ikinci
 * denemede 200 + 6/4 kayıt). Tek denemeyle kalınınca kullanıcı "TauVideo bu bölümde
 * yok" sanıyordu. Hata YOKSA bu sayının maliyeti SIFIRDIR (istek yine tek atılır).
 */
export const DEFAULT_RETRIES = 3;

/**
 * Geçici hata sonrası bekleme tabanı (ms); deneme başına artar (taban × deneme).
 * Ölçüm: 502'ler ~0,5 sn içinde düzeliyor — 800 ms taban bunu güvenle kapsar.
 */
export const RETRY_BASE_DELAY_MS = 800;

// ── Güvenli okuma yardımcıları ────────────────────────────────────────────────
// Kaynaktan gelen her şey `unknown`: `data.property` yazmak yerine bunlar kullanılır.

/** Her değeri diziye çevirir (`null`/`undefined`/obje → `[]`). */
export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Metne çevirir; metin değilse `fallback` (varsayılan `""`). */
function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

/** Sayıya çevirir; geçersizse `fallback` (varsayılan `0`). */
export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** Düz nesneye çevirir; değilse boş nesne (iç içe okumalarda çökme olmasın). */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** İlk BOŞ OLMAYAN metni verir (`data?.title ?? data?.name ?? …` deseninin kısası). */
function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = asString(value, "").trim();
    if (text) return text;
  }
  return "";
}

/**
 * Hata GEÇİCİ mi (yeniden denemeye değer mi)?
 *
 * GEÇİCİ: ağ/timeout, 408, 429, 5xx. KALICI: şema/izin hatası (42501, 42P01),
 * bozuk veri, doğrulama hatası — bunları tekrar denemek boşuna istek ve süre kaybı.
 */
export function isTransient(error: unknown): boolean {
  const text = firstText(
    asRecord(error)["message"],
    asRecord(error)["error_description"],
    error instanceof Error ? error.message : "",
    error,
  ).toLowerCase();
  const status = asNumber(asRecord(error)["status"] ?? asRecord(error)["statusCode"], 0);
  if (status === 408 || status === 429 || (status >= 500 && status < 600)) return true;
  if (!text) return false;
  // Şema/izin gibi KALICI hatalar önce elenir (metinde geçiyorsa geçici sayılmaz).
  if (
    /column .* does not exist|relation .* does not exist|permission denied|invalid api key|schema cache/i.test(
      text,
    )
  )
    return false;
  return (
    /\b(429|408|50[0-9])\b/.test(text) ||
    /timeout|timed out|network|failed to fetch|fetch failed|socket|econnreset|etimedout|temporarily|temporar|rate limit|too many requests|overloaded|unavailable/i.test(
      text,
    )
  );
}

/** Bekleme — saf yardımcı (testte değiştirilebilir). */
export function sleep(ms: number): Promise<void> {
  const wait = Number.isFinite(ms) && ms > 0 ? Math.min(ms, 60_000) : 0;
  return new Promise((resolve) => setTimeout(resolve, wait));
}

/** `retryTransient` sonucu: değer + kaç denemede alındığı. */
export type RetryOutcome<T> = { value: T; attempts: number };

/** Yeniden deneme seçenekleri. */
export type RetryOptions = {
  /** En fazla kaç DENEME (ilk deneme dâhil). Varsayılan `DEFAULT_RETRIES`. */
  attempts?: number;
  /** Bekleme tabanı (ms). Deneme başına artar. Varsayılan `RETRY_BASE_DELAY_MS`. */
  baseDelayMs?: number;
  /** Test edilebilirlik: beklemeyi değiştirir. */
  sleepFn?: (ms: number) => Promise<void>;
  /**
   * Her denemeden ÖNCE çağrılır (1 tabanlı sıra). NEDEN: başarısız bir işte kaç
   * deneme yapıldığı hata nesnesinden okunamıyor; kayda ("3 deneme") yazabilmek
   * için sayı buradan toplanır.
   */
  onAttempt?: (attempt: number) => void;
};

/**
 * GEÇİCİ hatada yeniden dener, KALICI hatada hemen bırakır.
 *
 * KURALLAR:
 *   · `ImportSkip` (kaynakta yok) ASLA yeniden denenmez — yeniden denemek anlamsız
 *     istek ve süre kaybıdır; ayrıca kullanıcıya yanlış "sorun var" izlenimi verir.
 *   · Geçici hata (`isTransient`: ağ/timeout/429/5xx) `attempts` kadar denenir,
 *     aralarda `baseDelayMs × deneme` beklenir.
 *   · Hepsi başarısız olursa SON hata fırlatılır (**yutulmaz**): kayıt listesinde
 *     sebebi görünsün diye.
 *
 * NEDEN AYRI YARDIMCI: bu mantık hem kalem düzeyinde (`runSequentialImport`) hem
 * KAYNAK düzeyinde (panel: bölüm × kaynak isteği) gerekiyor. İki kopya tutulunca
 * biri düzeltilip öteki unutuluyordu — bu satır, kullanıcının "her seferinde yama"
 * şikâyetinin önüne geçmek için bilinçli olarak tek yerde tutuldu.
 */
export async function retryTransient<T>(
  task: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryOutcome<T>> {
  const maxAttempts =
    Number.isFinite(options.attempts) && Number(options.attempts) > 0
      ? Math.floor(Number(options.attempts))
      : DEFAULT_RETRIES;
  const base =
    Number.isFinite(options.baseDelayMs) && Number(options.baseDelayMs) >= 0
      ? Number(options.baseDelayMs)
      : RETRY_BASE_DELAY_MS;
  const wait = typeof options.sleepFn === "function" ? options.sleepFn : sleep;

  const safeWait = async (ms: number) => {
    try {
      await wait(ms);
    } catch {
      // Bekleme başarısızsa beklemeden devam (akış bozulmaz).
    }
  };

  let lastError: unknown = new Error("bilinmeyen hata");
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      options.onAttempt?.(attempt);
    } catch {
      // Geri çağrı patlarsa deneme yine yapılır (kayıt tutmak işi engellemez).
    }
    try {
      const value = await task(attempt);
      return { value, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (error instanceof ImportSkip) throw error; // "yok" → tekrar denenmez
      if (attempt < maxAttempts && isTransient(error)) {
        await safeWait(base * attempt);
        continue;
      }
      break;
    }
  }
  throw lastError;
}

/** `process` dönüşü: kayda yazılacak metin + toplanacak değer + alt kayıtlar. */
export type ProcessOutcome<TValue> = {
  detail?: string;
  value?: TValue;
  children?: ImportLogChild[];
};

export type RunOptions<TItem, TValue> = {
  /** İşlenecek kalemler. Dizi değilse koşu boş döner (çökmez). */
  items: readonly TItem[];
  /** Kalem etiketi (panel/log). Fırlatırsa "#3" gibi güvenli bir etikete düşülür. */
  labelOf?: (item: TItem, index: number) => string;
  /**
   * Tek kalemi işler. FIRLATABİLİR:
   *   · `ImportSkip` → kalem "skipped" (kaynakta yok),
   *   · başka hata → "failed" (geçici ise `retries` kadar denenir).
   * Döndürdüğü `detail` kayda yazılır; `value` sonuç listesine eklenir.
   */
  process: (item: TItem, index: number) => Promise<ProcessOutcome<TValue> | TValue | void>;
  /** Kalemler arası bekleme (ms). Varsayılan `RATE_LIMIT_DELAY_MS` (300). */
  delayMs?: number;
  /** Geçici hatada en fazla kaç DENEME (ilk deneme dâhil). Varsayılan `DEFAULT_RETRIES`. */
  retries?: number;
  /** Kullanıcı iptali: `true` dönerse koşu temiz şekilde biter. */
  shouldStop?: () => boolean;
  /** İlerleme geri çağrısı (fırlatsa bile koşu bozulmaz). */
  onProgress?: (progress: ImportProgress) => void;
  /** Test edilebilirlik: beklemeyi değiştirir. */
  sleepFn?: (ms: number) => Promise<void>;
};

export type ImportRunResult<TValue> = {
  entries: ImportLogEntry[];
  values: TValue[];
  ok: number;
  skipped: number;
  failed: number;
  /** Toplam istek denemesi (yeniden denemeler dâhil). */
  attempts: number;
  /** Koşu süresi (ms). */
  ms: number;
  /** `shouldStop` ile mi bitirildi. */
  stopped: boolean;
};

/** `process` dönüşünü tek biçime indirger (değer mi, kayıt mı belirsiz olabiliyor). */
function outcomeOf<TValue>(raw: unknown): ProcessOutcome<TValue> {
  const record = asRecord(raw);
  // Nesne ama `detail`/`value`/`children` alanlarından hiçbiri yoksa: bu bizim
  // değerimizdir (ör. yazılan satır), kayıt değil.
  const looksLikeOutcome = "detail" in record || "value" in record || "children" in record;
  if (looksLikeOutcome) {
    return {
      detail: asString(record["detail"], ""),
      value: record["value"] as TValue,
      children: asArray<ImportLogChild>(record["children"]),
    };
  }
  if (raw === undefined || raw === null) return {};
  return { value: raw as TValue };
}

/**
 * Kalemleri SIRAYLA işler; her kalemi ayrı ayrı kayda geçer; asla çökmez.
 *
 * Kullanım (panel):
 *   const run = await runSequentialImport({
 *     items: episodes,
 *     labelOf: (ep) => `${ep.number}. Bölüm`,
 *     process: async (ep) => { ... },
 *     onProgress: setProgress,
 *   });
 */
export async function runSequentialImport<TItem, TValue = unknown>(
  options: RunOptions<TItem, TValue>,
): Promise<ImportRunResult<TValue>> {
  const startedAt = Date.now();
  const entries: ImportLogEntry[] = [];
  const values: TValue[] = [];
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let attempts = 0;
  let stopped = false;

  const items = asArray<TItem>(options?.items);
  const wait = typeof options?.sleepFn === "function" ? options.sleepFn : sleep;
  const delayMs = Number.isFinite(options?.delayMs) ? Number(options.delayMs) : RATE_LIMIT_DELAY_MS;
  const maxAttempts =
    Number.isFinite(options?.retries) && Number(options.retries) > 0
      ? Math.floor(Number(options.retries))
      : 1;

  /** Güvenli bekleme: `sleepFn` patlarsa koşu durmasın. */
  const safeWait = async (ms: number) => {
    try {
      await wait(ms);
    } catch {
      // Bekleme başarısızsa beklemeden devam edilir (akış bozulmaz).
    }
  };

  /** Güvenli etiket: `labelOf` patlarsa güvenli bir numaraya düşülür. */
  const labelFor = (item: TItem, index: number): string => {
    try {
      const label = asString(options?.labelOf?.(item, index), "").trim();
      return label || `#${index + 1}`;
    } catch {
      return `#${index + 1}`;
    }
  };

  const emitProgress = (current: string, done: number) => {
    if (typeof options?.onProgress !== "function") return;
    try {
      options.onProgress({ done, total: items.length, ok, skipped, failed, current });
    } catch {
      // Arayüz geri çağrısı patlarsa koşu devam eder (kayıt zaten tutuluyor).
    }
  };

  for (let index = 0; index < items.length; index += 1) {
    // 1) İptal: kalemlere başlamadan önce bakılır (ortada kesmeyiz, iş yarım kalmaz).
    let stopNow = false;
    try {
      stopNow = options?.shouldStop?.() === true;
    } catch {
      stopNow = false;
    }
    if (stopNow) {
      stopped = true;
      break;
    }

    const item = items[index] as TItem;
    const label = labelFor(item, index);
    const itemStartedAt = Date.now();
    emitProgress(label, index);

    let status: ImportStatus = "failed";
    let detail = "";
    let itemAttempts = 0;
    let children: ImportLogChild[] = [];

    /**
     * Deneme döngüsü ORTAK yardımcıdan gelir (`retryTransient`): "geçici hatada
     * yeniden dene, `ImportSkip`ta ASLA denemeden vazgeç" kuralı tek yerde yaşasın.
     */
    try {
      const outcome = await retryTransient(
        async () => outcomeOf<TValue>(await options.process(item, index)),
        {
          attempts: maxAttempts,
          baseDelayMs: RETRY_BASE_DELAY_MS,
          sleepFn: wait,
          onAttempt: (attempt) => {
            itemAttempts = attempt;
            attempts += 1;
          },
        },
      );
      const parsed = outcome.value;
      status = "ok";
      detail = firstText(parsed.detail, "tamam");
      children = parsed.children ?? [];
      if (parsed.value !== undefined) values.push(parsed.value);
    } catch (error) {
      if (error instanceof ImportSkip) {
        status = "skipped";
        detail = firstText(error.message, "kaynakta yok");
      } else {
        status = "failed";
        detail = firstText(
          asRecord(error)["message"],
          error instanceof Error ? error.message : "",
          error,
          "bilinmeyen hata",
        );
      }
    }

    if (status === "ok") ok += 1;
    else if (status === "skipped") skipped += 1;
    else failed += 1;

    entries.push({
      seq: index + 1,
      label,
      provider: "",
      status,
      detail,
      attempts: itemAttempts,
      ms: Date.now() - itemStartedAt,
      ...(children.length > 0 ? { children } : {}),
    });

    emitProgress(label, index + 1);

    // 2) SIRA ARASI BEKLEME: son kalemden sonra beklemeye gerek yok.
    if (index < items.length - 1 && delayMs > 0) await safeWait(delayMs);
  }

  emitProgress("", items.length);

  return {
    entries,
    values,
    ok,
    skipped,
    failed,
    attempts,
    ms: Date.now() - startedAt,
    stopped,
  };
}

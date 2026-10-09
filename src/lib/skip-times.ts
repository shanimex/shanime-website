/**
 * Açılış/kapanış (OP/ED) zamanları — AniSkip.
 *
 * NEDEN GEREKLİ: oynatıcıdan gelen tek "bitti" sinyali `complete` ve o da dosyanın
 * EN SONUNDA (bitiş jeneriği dahil) geliyor. Ölçüm (26.09.2026, megaplay/JW):
 *   · saniyede ~4 kez `{"event":"time","time":X,"duration":Y,"percent":Z}`
 *   · bölüm sonunda bir kez `{"event":"complete","percent":100}`
 * Jenerik 90 saniye sürdüğü için izleyici, bölüm bitmiş olmasına rağmen ~1,5 dakika
 * bekliyordu ("süreyi geçti hâlâ ilerliyor, geçmedi"). AniSkip her bölüm için
 * jeneriğin BAŞLANGIÇ saniyesini veriyor → jenerik başladığı anda sonraki bölüme
 * geçilebiliyor.
 *
 * KAYNAK: `https://api.aniskip.com/v2/skip-times/{malId}/{episode}` — herkese açık,
 * `Access-Control-Allow-Origin: *` (tarayıcıdan doğrudan çağrılabilir; ölçüldü).
 * Veri yoksa `null` döner ve otomatik atlama sessizce devre dışı kalır — hata
 * fırlatmaz, çünkü bu bir KOLAYLIK'tır, oynatmayı engellememelidir.
 */
export type SkipInterval = { start: number; end: number };

export type SkipTimes = {
  /** Açılış jeneriği (şu an kullanılmıyor: iframe içinde ileri sarma yetkimiz yok). */
  op: SkipInterval | null;
  /** Kapanış jeneriği — başlangıcı, sonraki bölüme geçiş anıdır. */
  ed: SkipInterval | null;
};

/** Aynı bölüm için tekrar tekrar istek atmayalım (bölüm/sayfa ömrü boyunca). */
const cache = new Map<string, SkipTimes | null>();

type RawSkip = {
  interval?: { startTime?: number; endTime?: number };
  skipType?: string;
};

function pick(results: RawSkip[], type: "op" | "ed"): SkipInterval | null {
  const hit = results.find((item) => item.skipType === type);
  const start = Number(hit?.interval?.startTime ?? NaN);
  const end = Number(hit?.interval?.endTime ?? NaN);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

/**
 * Bir bölümün jenerik zamanlarını getirir.
 *
 * @param malId MAL kimliği (yoksa `null` döner — sorgu yapılmaz)
 * @param episode Bölüm numarası
 * @param duration Dosya süresi (saniye). AniSkip bu değerle doğrulama yapıyor;
 *   yanlış süre verilirse kayıt bulunamıyor. Oynatıcının `time` mesajından gelir.
 */
export async function fetchSkipTimes(
  malId: number | null | undefined,
  episode: number,
  duration: number,
): Promise<SkipTimes | null> {
  if (!malId || malId <= 0 || !Number.isFinite(duration) || duration <= 0) return null;
  const length = Math.round(duration);
  const key = `${malId}-${episode}-${length}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  try {
    const url =
      `https://api.aniskip.com/v2/skip-times/${malId}/${episode}` +
      `?types[]=ed&types[]=op&episodeLength=${length}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      // 404 = bu bölüm için kayıt yok (normal durum, hata değil).
      cache.set(key, null);
      return null;
    }
    const json = (await res.json()) as { found?: boolean; results?: RawSkip[] };
    if (!json.found) {
      cache.set(key, null);
      return null;
    }
    const results = json.results ?? [];
    const value: SkipTimes = { op: pick(results, "op"), ed: pick(results, "ed") };
    cache.set(key, value);
    return value;
  } catch {
    // Ağ/servis hatası: özellik sessizce kapalı kalır, oynatma etkilenmez.
    cache.set(key, null);
    return null;
  }
}

/** `1338.25` → `"22:18"` (şeritte bilgi amaçlı gösterilir). */
export function formatSkipTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

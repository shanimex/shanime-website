/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KATALOG PANELİ — PANELDEN BAĞIMSIZ KALICI DURUM (modül düzeyinde store)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ── NEDEN VAR (kullanıcı şikâyeti, 30.09.2026) ────────────────────────────────
 * "Panelde yükleme yaparken başka yere dokunursam minimize etsin. Başka yere
 *  dokundum, indirdiğim bazı şeyler sıfırlandı. … Ekranı kapatsam bile yüklediğim
 *  kısma kadar kalsın. Her panel açtığımda tek tek yüklemeyim, nerede kaldıysam
 *  oradan devam etmeli."
 *
 * ÖLÇÜLEN KÖK SEBEP: yazma/çekme durumu `AnizipSyncPanel` bileşeninin KENDİ
 * `useState`'lerinde tutuluyordu. Panel kapanınca (X'e basınca, minimizasyon
 * kaldırılıp unmount edilince ya da dışına tıklayınca) bileşen DOM'dan kalkıyor ve
 * BÜTÜN durum — çekilen katalog listesi, seçili bölümler, ilerleme, yüklenenler —
 * yok oluyordu. Aynı şey sayfa yenilenince (F5) de oluyordu: her açılış SIFIRDAN.
 *
 * ── ÇÖZÜM ─────────────────────────────────────────────────────────────────────
 * Bu dosya, panel durumunu bileşenin DIŞINDA, `show + sezon` anahtarıyla
 * (`<showId>:<seasonNumber>`) tutan bir MODÜL DÜZEYİ store sağlar:
 *   · Bileşen unmount olsa bile store yaşamaya devam eder → süren yazma koşusu
 *     (JS async döngüsü) store'u güncellemeyi sürdürür; panel geri açıldığında
 *     AYNI durumu (aynı liste, aynı seçim, aynı ilerleme) okur.
 *   · Seçili alanlar `localStorage`'a yazılır → sayfa yenilense (F5) bile liste,
 *     seçim ve ilerleme geri gelir; "kaldığı yerden devam" sunulabilir.
 *
 * KALICILIK ANAHTARI: `anizip-sync:v1:<showId>:<seasonNumber>`
 *
 * ── VERİ GÜVENLİĞİ ────────────────────────────────────────────────────────────
 * Store YALNIZCA arayüz durumunu tutar (liste/seçim/ilerleme/özet). Veritabanına
 * yazan/silen tek yer panelin kendi mevcut akışıdır; bu dosya veritabanına
 * DOKUNMAZ, şema/migration değişikliği yapmaz, yazılmış satırları silmez.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { CatalogEpisode } from "@/lib/admin-anizip";
import type { ImportLogEntry } from "@/lib/import-runner";

/** Bölüm satırının yazma durumu (paneldeki çubuk bunu çizer). */
export type RowStatus = "writing" | "done" | "error";
export type RowState = {
  pct: number;
  cap: number;
  at: number;
  status: RowStatus;
  step?: string | undefined;
};

/** Koşu ilerlemesi (bölüm bölüm). */
export type SyncProgress = { done: number; total: number; fail: string[] };

/**
 * PANELİN KALICI DURUMU — bileşen dışında yaşayan tek doğruluk kaynağı.
 * Panel kapanınca yok olmayan alanlar burada; panel bunları OKUR ve YAZAR.
 */
export type AnizipSyncState = {
  status: "loading" | "ready" | "error";
  problem: string | null;
  list: CatalogEpisode[];
  showMalId: number | null;
  seasonMalId: number | null;
  showSlug: string;
  picked: Record<string, boolean>;
  progress: SyncProgress | null;
  runStartedAt: number;
  rowProgress: Record<string, RowState>;
  rangeFrom: string;
  rangeTo: string;
  selected: number[];
  busy: boolean;
  runLog: ImportLogEntry[];
  unresolved: string[];
  notes: string[];
  advanced: boolean;
  /**
   * İŞ YARIDA KALDI BAYRAĞI.
   *
   * Sekme kapanınca/JS durunca yazma döngüsü fiziksel olarak sonlanır; `busy`
   * kalıcılıkta `true` kalır ama çalışan bir koşu YOKTUR. Panel yeniden
   * açıldığında bu tespit edilir: `busy=false` yapılır ve kullanıcıya "kaldığı
   * yerden devam et" sunulur (bkz. `isRunActive`). Kalıcılığa YAZILMAZ.
   */
  interrupted: boolean;
};

/** `localStorage` anahtar öneki + sürüm. Şekil değişirse sürüm artırılır. */
const STORAGE_PREFIX = "anizip-sync:v1:";

/** Kalıcılığa yazılan alanlar (`interrupted` hariç — hesaplanır). */
const PERSIST_FIELDS: (keyof AnizipSyncState)[] = [
  "status",
  "problem",
  "list",
  "showMalId",
  "seasonMalId",
  "showSlug",
  "picked",
  "progress",
  "runStartedAt",
  "rowProgress",
  "rangeFrom",
  "rangeTo",
  "selected",
  "busy",
  "runLog",
  "unresolved",
  "notes",
  "advanced",
];

/** Store anahtarı: "show + sezon". */
export function anizipStoreKey(showId: string, season: number): string {
  return `${showId}:${season}`;
}

function storageKeyFor(storeKey: string): string {
  return STORAGE_PREFIX + storeKey;
}

/**
 * ÇALIŞAN KOŞU KAYDI (yalnızca bellekte, kalıcı DEĞİL).
 *
 * `busy` kalıcılıkta `true` kalabilir ama sayfa yenilenince döngü ölür; bu küme
 * "şu an gerçekten koşan bir yazma var mı" sorusunu cevaplar.
 */
const activeRuns = new Set<string>();
export function markRunActive(storeKey: string): void {
  activeRuns.add(storeKey);
}
export function markRunInactive(storeKey: string): void {
  activeRuns.delete(storeKey);
}
export function isRunActive(storeKey: string): boolean {
  return activeRuns.has(storeKey);
}

/** Kalıcılıktan okur; bozuk/erişilemezse `null` (panel yine çalışır). */
function readPersisted(storeKey: string): Partial<AnizipSyncState> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKeyFor(storeKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const out: Record<string, unknown> = {};
    for (const field of PERSIST_FIELDS) {
      if (field in parsed) out[field] = parsed[field];
    }
    return out as Partial<AnizipSyncState>;
  } catch {
    return null;
  }
}

/**
 * Store — abonelik + kalıcılık. Bileşenden BAĞIMSIZ yaşar.
 *
 * React dışından da (süren yazma döngüsü) güvenle güncellenebilir: her `setField`
 * abonelere haber verir, panel açıksa yeniden çizer, kapalıysa sessizce saklar.
 */
export class AnizipSyncStore {
  readonly key: string;
  private state: AnizipSyncState;
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(key: string, defaults: AnizipSyncState) {
    this.key = key;
    const saved = readPersisted(key);
    // Kalıcı alanlar varsayılanı EZER; `interrupted` her zaman taze hesaplanır.
    this.state = saved ? { ...defaults, ...saved, interrupted: false } : defaults;
  }

  getState = (): AnizipSyncState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // Bir abone patlarsa ötekiler ve akış bozulmaz.
      }
    }
  }

  /** Yazmayı geciktirir (hızlı ardışık güncellemelerde tek yazma). */
  private scheduleSave(): void {
    if (typeof window === "undefined") return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 250);
  }

  /** Hemen `localStorage`'a yazar (kota/erişim hatası yutulur). */
  saveNow(): void {
    if (typeof window === "undefined") return;
    try {
      const slice: Record<string, unknown> = {};
      for (const field of PERSIST_FIELDS) slice[field] = this.state[field];
      window.localStorage.setItem(storageKeyFor(this.key), JSON.stringify(slice));
    } catch {
      // Kota dolu ya da `localStorage` kapalı: panel bellekte çalışmaya devam eder.
    }
  }

  /** Birden fazla alanı tek seferde yazar (değişmeyenler atlanır). */
  patch(partial: Partial<AnizipSyncState>): void {
    let changed = false;
    for (const key of Object.keys(partial) as (keyof AnizipSyncState)[]) {
      if (!Object.is(this.state[key], partial[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...partial };
    this.scheduleSave();
    this.emit();
  }

  /** Tek alanı yazar; `useState` gibi değer VEYA güncelleyici fonksiyon alır. */
  setField<K extends keyof AnizipSyncState>(
    field: K,
    value: SetStateAction<AnizipSyncState[K]>,
  ): void {
    const prev = this.state[field];
    const next =
      typeof value === "function"
        ? (value as (current: AnizipSyncState[K]) => AnizipSyncState[K])(prev)
        : value;
    if (Object.is(next, prev)) return;
    this.state = { ...this.state, [field]: next };
    this.scheduleSave();
    this.emit();
  }
}

/**
 * "KALDIĞI YERDEN DEVAM" ADAYLARI — bu seride yarıda kalmış sezonlar.
 *
 * `localStorage` taranır: `busy` ya da tamamlanmamış `progress` taşıyan anahtarlar
 * döner. Böylece panel kapalıyken (hatta sayfa yenilendikten sonra) üst panel
 * kalıcı bir "devam et" rozeti gösterebilir.
 */
export function findResumableKeys(showId: string): string[] {
  const out: string[] = [];
  if (typeof window === "undefined") return out;
  const prefix = `${showId}:`;
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const full = window.localStorage.key(index);
      if (!full || !full.startsWith(STORAGE_PREFIX)) continue;
      const key = full.slice(STORAGE_PREFIX.length);
      if (!key.startsWith(prefix)) continue;
      try {
        const parsed = JSON.parse(window.localStorage.getItem(full) ?? "{}") as {
          busy?: boolean;
          progress?: { done?: number; total?: number } | null;
        };
        const total = parsed?.progress?.total ?? 0;
        const done = parsed?.progress?.done ?? 0;
        if (parsed?.busy === true || (total > 0 && done < total)) out.push(key);
      } catch {
        // Bozuk kayıt atlanır.
      }
    }
  } catch {
    return out;
  }
  return out;
}

/** Canlı store kayıt defteri (anahtar başına tek örnek). */
const stores = new Map<string, AnizipSyncStore>();

/**
 * ── BEKLEYEN YAZMALARI HEMEN İNDİR (açık kalan tek delik, 30.09.2026) ─────────
 *
 * NEDEN GEREKLİ: yazma 250 ms GECİKTİRİLİR (hızlı ardışık güncellemeler tek yazmaya
 * insin diye). Ama sekme tam bu pencerede kapanırsa SON güncellemeler diske hiç
 * inmez — kullanıcının "ekranı kapatsam bile yüklediğim kısma kadar kalsın"
 * isteğinin delik kaldığı tek yer burasıydı. `saveNow()` yazılmıştı ama HİÇ
 * ÇAĞRILMIYORDU (ölü kod); artık sekme gizlenirken/kapanırken zorlanıyor.
 */
function flushAllStores(): void {
  for (const store of stores.values()) {
    try {
      store.saveNow();
    } catch {
      // Bir store'un hatası ötekileri ve akışı engellemez.
    }
  }
}

/** Dinleyiciler BİR KEZ bağlanır. */
let flushBound = false;

/**
 * Sekme gizlenince/kapanınca bekleyen yazmayı indirir. `visibilitychange` mobilde
 * sekme değiştirmeyi de kapsar (mobilde `pagehide` her zaman gelmez).
 */
function bindFlushListeners(): void {
  if (flushBound) return;
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  flushBound = true;
  try {
    window.addEventListener("pagehide", flushAllStores);
    window.addEventListener("beforeunload", flushAllStores);
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushAllStores();
      });
    }
  } catch {
    // Dinleyici bağlanamazsa geciktirilmiş yazma yine çalışır (davranış bozulmaz).
  }
}

/** Store'u döndürür; yoksa `factory()` varsayılanlarıyla (kalıcı veriyle) kurar. */
export function getOrCreateStore(
  storeKey: string,
  factory: () => AnizipSyncState,
): AnizipSyncStore {
  const existing = stores.get(storeKey);
  if (existing) return existing;
  const store = new AnizipSyncStore(storeKey, factory());
  stores.set(storeKey, store);
  // İlk store kurulurken sekme kapanış dinleyicileri bağlanır (tembel bağlama:
  // sunucuda `window` yoktur, bu yüzden modül yüklenirken değil, ilk kullanımda).
  bindFlushListeners();
  return store;
}

/**
 * React kancası: anahtara bağlı store (bileşen yeniden kurulsa da AYNI örnek).
 *
 * `factory` yalnızca store İLK kez oluşturulurken çağrılır; sonraki mount'lar
 * mevcut store'u (dolayısıyla kalıcı durumu) kullanır.
 */
function useAnizipStore(storeKey: string, factory: () => AnizipSyncState): AnizipSyncStore {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- kasıtlı: kimlik anahtara bağlı.
  return useMemo(() => getOrCreateStore(storeKey, factory), [storeKey]);
}

/**
 * Store alanını `useState` gibi okur/yazar.
 * Referans kararlılığı: alan değişmedikçe aynı değer döner (sonsuz çizim yok).
 */
export function useAnizipField<T>(
  store: AnizipSyncStore,
  field: keyof AnizipSyncState,
): [T, Dispatch<SetStateAction<T>>] {
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const getSnapshot = useCallback(() => store.getState()[field] as T, [store, field]);
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const set = useCallback(
    (next: SetStateAction<T>) => {
      store.setField(field, next as never);
    },
    [store, field],
  );
  return [value, set];
}

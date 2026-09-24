/**
 * Voe API istemcisi (v1) + dosya adı çözümleyici.
 *
 * NE İÇİN: Bölümleri tek tek elle girmek yerine Voe'ya yüklenen videoları dosya
 * adından çözüp panele otomatik eklemek için (`Jujutsu Kaisen S01E05 - Ad.mp4`).
 *
 * ÖNEMLİ — CORS: Voe API'si tarayıcıdan çağrılabilir (ölçüldü: OPTIONS preflight
 * `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET`). Bu yüzden
 * sunucu/proxy yok. API anahtarı YALNIZCA paneli kullanan tarayıcıda (`localStorage`)
 * tutulur; `site_settings` anon anahtarla okunabildiği için anahtarı oraya koymak onu
 * herkese açık ederdi.
 *
 * API dokümanı: https://voe.sx/api-1-reference-index · Limit: 3-4 istek/sn.
 * Anahtar: Voe → Ayarlar → Hesap → "API Ayrıntıları" → "Geliştirici API anahtarı".
 */

const VOE_API = "https://voe.sx/api";
const KEY_STORAGE = "shanime:voe-key";
const FILTER_STORAGE = "shanime:voe-filter";

/* ---------------------------------------------------------------- anahtar */

export function loadVoeKey(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(KEY_STORAGE) ?? "";
}

export function saveVoeKey(key: string): void {
  if (typeof window === "undefined") return;
  const value = key.trim();
  if (value) window.localStorage.setItem(KEY_STORAGE, value);
  else window.localStorage.removeItem(KEY_STORAGE);
}

/** Son kullanılan dosya adı filtresi (seri başına) — her seferinde yazmak zorunda kalmayasın. */
export function loadVoeFilter(showId: string): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(`${FILTER_STORAGE}:${showId}`) ?? "";
}

export function saveVoeFilter(showId: string, filter: string): void {
  if (typeof window === "undefined") return;
  if (filter.trim()) window.localStorage.setItem(`${FILTER_STORAGE}:${showId}`, filter.trim());
  else window.localStorage.removeItem(`${FILTER_STORAGE}:${showId}`);
}

/* ------------------------------------------------------------------ linkler */

export function voeEmbedUrl(code: string): string {
  return `https://voe.sx/e/${code}`;
}

/** Voe video kodunu linkten çıkarır (`.../e/<kod>` ya da düz `<kod>`). */
export function voeCodeFromUrl(url: string): string {
  const clean = (url ?? "").split(/[?#]/)[0] ?? "";
  return (
    clean.match(/\/(?:e|embed)\/([A-Za-z0-9]{6,})/)?.[1] ??
    clean.match(/\/([A-Za-z0-9]{8,})$/)?.[1] ??
    ""
  );
}

/* ------------------------------------------------------------ dosya listesi */

export type VoeFile = {
  /** Voe video kodu (`/e/<kod>`). */
  code: string;
  /** Yüklenen dosyanın adı — sezon/bölüm buradan çözülür. */
  name: string;
  /** Voe'daki başlık alanı (dosya adından farklı olabilir). */
  title: string;
  uploaded: string;
};

/** API'nin döndürdüğü ham satır (alan adları sürüme göre değişebiliyor). */
type VoeRawRow = {
  filecode?: string;
  file_code?: string;
  name?: string;
  title?: string;
  uploaded?: string;
};

/** API cevabı: hata gövdesi `msg`/`message`, liste `result.data` altında. */
type VoeRawPayload = {
  result?: { data?: unknown[]; files?: unknown[]; last_page?: number | string };
  data?: unknown[];
  files?: unknown[];
  last_page?: number | string;
  msg?: string;
  message?: string;
};

function rowToFile(row: VoeRawRow): VoeFile | null {
  const code = typeof row.filecode === "string" ? row.filecode : (row.file_code ?? "");
  if (!code) return null;
  return {
    code,
    name: row.name ?? "",
    title: row.title ?? "",
    uploaded: row.uploaded ?? "",
  };
}

function errorMessage(payload: VoeRawPayload | null, status: number): string {
  if (payload?.message) return payload.message;
  if (payload?.msg) return payload.msg;
  return `HTTP ${status}`;
}

/**
 * Hesaptaki videoları sayfa sayfa çeker.
 *
 * Cevap biçimi dokümandan: `{ result: { data: [...], last_page } }` — farklı
 * sürümlerde alanlar `data`/`files` altında da gelebildiği için okuma esnektir.
 */
export async function listVoeFiles(
  key: string,
  options: {
    perPage?: number;
    maxPages?: number;
    onProgress?: (page: number, lastPage: number) => void;
  } = {},
): Promise<VoeFile[]> {
  const perPage = options.perPage ?? 100;
  const maxPages = options.maxPages ?? 40;
  const files: VoeFile[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const url = `${VOE_API}/file/list?key=${encodeURIComponent(key)}&page=${page}&per_page=${perPage}&fld_id=0`;
    const response = await fetch(url);
    const payload = (await response.json().catch(() => null)) as VoeRawPayload | null;
    if (!response.ok) throw new Error(errorMessage(payload, response.status));

    const result = payload?.result ?? payload ?? {};
    const rows = result.data ?? result.files ?? [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const file = rowToFile(row as VoeRawRow);
      if (file) files.push(file);
    }

    const lastPage = Number(result.last_page ?? page) || page;
    options.onProgress?.(page, lastPage);
    if (!rows.length || page >= lastPage) break;
    // API limiti 3-4 istek/sn — sayfalar arasında kısa bekleme.
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  return files;
}

/* --------------------------------------------------------- dosya adı çözümü */

export type ParsedEpisodeName = {
  /** Dosya adının sezon/bölümden ÖNCEKİ kısmı (seri eşleştirmesi için). */
  series: string;
  season: number;
  number: number;
  title: string;
};

/** Uzantı ve teknik etiketleri temizler: `[1080p]`, `(SubsPlease)`, `_`, `.` … */
function cleanFileName(raw: string): string {
  return raw
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[[(][^\])]{1,60}[\])]/g, " ")
    .replace(/[_.]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Desteklenen ad biçimleri (sırayla denenir). */
const NAME_PATTERNS: RegExp[] = [
  // Jujutsu Kaisen S01E05 - Ad
  /^(?<series>.+?)[\s-]*s(?:eason)?[\s-]*(?<s>\d{1,2})[\s-]*e(?:p|pisode)?[\s-]*(?<e>\d{1,3})(?:[\s-]+(?<title>.+))?$/i,
  // Jujutsu Kaisen 1x05 Ad
  /^(?<series>.+?)[\s-]*(?<s>\d{1,2})x(?<e>\d{1,3})(?:[\s-]+(?<title>.+))?$/i,
  // Jujutsu Kaisen 1. Sezon 5. Bölüm Ad
  /^(?<series>.+?)[\s-]*(?<s>\d{1,2})[\s-]*(?:sezon|season)[\s-]*(?<e>\d{1,3})[\s-]*b[oö]l[uü]m(?:[\s-]+(?<title>.+))?$/i,
  // Jujutsu Kaisen 05 - Ad   (sezon yazılmamışsa 1. sezon sayılır)
  /^(?<series>.+?)[\s-]+(?:b[oö]l[uü]m|e|ep|episode|part)?[\s-]*(?<e>\d{1,3})(?:[\s-]+(?<title>.+))?$/i,
];

/**
 * Dosya adından sezon/bölüm/başlık çıkarır; çözemezse `null`.
 *
 * Kural: sezon numarası bulunamazsa **1** kabul edilir; başlık bulunamazsa
 * "<n>. Bölüm" yazılır. Çözüm yalnızca öneridir — panelde önizleme gösterilir,
 * kullanıcı onaylamadan hiçbir şey eklenmez.
 */
export function parseEpisodeName(rawName: string): ParsedEpisodeName | null {
  const name = cleanFileName(rawName).replace(/^[\s-]+/, "");
  if (!name) return null;

  for (const pattern of NAME_PATTERNS) {
    const groups = (pattern.exec(name)?.groups ?? null) as {
      s?: string;
      e?: string;
      series?: string;
      title?: string;
    } | null;
    if (!groups) continue;
    const number = Number(groups.e);
    if (!Number.isFinite(number) || number <= 0 || number > 999) continue;
    const seasonRaw = Number(groups.s ?? 1);
    const series = (groups.series ?? "").replace(/[\s-]+$/, "").trim();
    const title = (groups.title ?? "").replace(/^[\s-]+/, "").trim();
    return {
      series,
      season: Number.isFinite(seasonRaw) && seasonRaw > 0 ? seasonRaw : 1,
      number,
      title: title || `${number}. Bölüm`,
    };
  }
  return null;
}

/** Türkçe karakter/ayraç farkını yok sayarak metni karşılaştırmaya hazırlar. */
function normalizeText(value: string): string {
  return value
    .toLocaleLowerCase("tr")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Dosya adı verilen seri adıyla eşleşiyor mu? (boş arama → hepsi) */
export function fileMatchesSeries(file: VoeFile, series: string): boolean {
  const needle = normalizeText(series);
  if (!needle) return true;
  return normalizeText(`${file.name} ${file.title}`).includes(needle);
}

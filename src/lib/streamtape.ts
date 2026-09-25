import { parseEpisodeName, type ParsedEpisodeName } from "./voe";

/**
 * Streamtape resmî API istemcisi — YALNIZ SUNUCU TARAFI.
 *
 * Neden sadece embed linki üretiyor:
 * Streamtape API'si bir "download ticket" akışıyla ham dosya adresi de verir
 * (`/file/dlticket` → `/file/dl` → `tapecontent.net/...mp4`). Ancak o ham
 * adresi kendi oynatıcımızda göstermek Streamtape Şartlar ve Koşulları'nın
 * "Prohibited Activities" bölümüne açıkça aykırıdır:
 *
 *   - "use content obtained from Streamtape or via the Services for
 *      commercial purposes"
 *   - "modify, copy, distribute, transmit, display, perform, reproduce,
 *      publish ... the Services except by using functionality provided by
 *      Streamtape"
 *
 * Sonuçları: hesabın önceden haber verilmeden kapatılması ("We may also
 * terminate your account without prior notice ... if you violate these Terms")
 * ve kazançların kesilmesi ("Company may withhold some or all payment to you
 * for any reason it deems reasonable"). Bu yüzden bu istemci YALNIZCA resmî
 * embed adresini üretir: sitede Streamtape'in kendi oynatıcısı çalışır,
 * reklamlar görünür ve izlenmeler "Publisher Program" kapsamında yazılır —
 * yani tam olarak ücret almanın meşru yolu.
 *
 * Kaynaklar: streamtape.com/api · streamtape.com/terms-and-conditions
 *
 * Kimlik bilgileri: API, panelin "Account Settings" sekmesindeki **API Login**
 * ve **API Key** çiftini ister (tek başına key yetmez). Anahtarlar istemci
 * paketine girmemesi için ortam değişkeninden okunur:
 *   STREAMTAPE_LOGIN, STREAMTAPE_KEY
 */

const API_BASE = "https://api.streamtape.com";

export type StreamtapeFile = {
  /** Streamtape dosya kimliği, ör. "rbAarvRPXdYbaxY". */
  id: string;
  name: string;
  size: number;
  /** İndirme sayısı. */
  downloads: number;
  /** Dönüştürme tamamlandı mı? ("converted") */
  converted: boolean;
  /** Oynatıcı sayfası adresi — API'nin döndürdüğü `link` alanı. */
  pageUrl: string;
  /** Sitede kullanılacak resmî embed adresi: https://streamtape.com/e/<id> */
  embedUrl: string;
  /** Dosya adından çözülen sezon/bölüm (çözülemezse null). */
  parsed: ParsedEpisodeName | null;
};

/** Ortam değişkenini hem sunucu (process.env) hem Vite (import.meta.env) tarafından okur. */
function envValue(name: string): string {
  const fromProcess = typeof process !== "undefined" && process.env ? process.env[name] : undefined;
  if (fromProcess) return fromProcess.trim();
  const meta = import.meta.env as unknown as Record<string, string | undefined>;
  return (meta[name] ?? "").trim();
}

/** Kimlik bilgileri tanımlı mı? (Panelde/ortamda eksikse çağrı yapılmaz.) */
export function streamtapeConfigured(): boolean {
  return Boolean(envValue("STREAMTAPE_LOGIN") && envValue("STREAMTAPE_KEY"));
}

type ApiEnvelope<T> = { status: number; msg: string; result: T };

async function callApi<T>(path: string, params: Record<string, string>): Promise<T> {
  const login = envValue("STREAMTAPE_LOGIN");
  const key = envValue("STREAMTAPE_KEY");
  if (!login || !key) {
    throw new Error(
      "Streamtape API yapılandırılmadı: STREAMTAPE_LOGIN ve STREAMTAPE_KEY ortam değişkenlerini ekleyin.",
    );
  }
  const query = new URLSearchParams({ ...params, login, key });
  const response = await fetch(`${API_BASE}${path}?${query.toString()}`);
  const payload = (await response.json()) as ApiEnvelope<T>;
  if (payload.status !== 200) {
    throw new Error(`Streamtape API hatası (${payload.status}): ${payload.msg}`);
  }
  return payload.result;
}

/** Hesap bilgisi: kullanılan depolama, kazanç vb. */
export async function streamtapeAccountInfo(): Promise<Record<string, unknown>> {
  return callApi<Record<string, unknown>>("/account/info", {});
}

/**
 * Bir klasördeki dosyaları listeler (varsayılan: kök klasör).
 *
 * Sitedeki otomatik bölüm ekleme akışı bunu kullanır: dosya adı
 * "JujutsuKaisen-S1B1-..." biçimindeyse sezon/bölüm `parseEpisodeName` ile
 * çözülür (aynı çözümleyici Voe akışında da kullanılıyor).
 */
export async function listStreamtapeFiles(folder?: string): Promise<StreamtapeFile[]> {
  const result = await callApi<{
    files?: Array<{
      linkid?: string;
      name?: string;
      size?: number;
      downloads?: number;
      convert?: string;
      link?: string;
    }>;
  }>("/file/listfolder", folder ? { folder } : {});

  return (result.files ?? []).flatMap((file) => {
    const id = (file.linkid ?? "").trim();
    if (!id) return [];
    const name = file.name ?? "";
    return [
      {
        id,
        name,
        size: file.size ?? 0,
        downloads: file.downloads ?? 0,
        converted: (file.convert ?? "") === "converted",
        pageUrl: file.link ?? `https://streamtape.com/v/${id}/`,
        embedUrl: streamtapeEmbedUrl(id),
        parsed: parseEpisodeName(name),
      },
    ];
  });
}

/**
 * Resmî oynatıcı (embed) adresi.
 * API dokümanındaki örnek biçim: https://streamtape.com/e/<dosya-id>
 */
export function streamtapeEmbedUrl(id: string): string {
  return `https://streamtape.com/e/${id}`;
}

/**
 * Embed adresine sorgu parametreleri ekler.
 *
 * Dokümandaki desteklenen parametreler:
 *  - `cN_label` / `cN_file`: dinamik altyazı. **Hem .srt hem .vtt desteklenir**
 *    ve 1'den başlayarak birden fazla altyazı eklenebilir. Bizim için önemli:
 *    Streamtape oynatıcısında altyazı, harici oynatıcıya geçmeden çalışıyor.
 *  - `thumb`: dinamik kapak görseli.
 *  - `color`: oynatıcı rengi (ör. "230,29,72").
 */
export function streamtapeEmbedUrlWithOptions(
  id: string,
  options: {
    subtitles?: Array<{ label: string; file: string }>;
    thumb?: string;
    color?: string;
  } = {},
): string {
  const url = new URL(streamtapeEmbedUrl(id));
  options.subtitles?.forEach((subtitle, index) => {
    const counter = index + 1;
    url.searchParams.set(`c${counter}_label`, subtitle.label);
    url.searchParams.set(`c${counter}_file`, subtitle.file);
  });
  if (options.thumb) url.searchParams.set("thumb", options.thumb);
  if (options.color) url.searchParams.set("color", options.color);
  return url.toString();
}

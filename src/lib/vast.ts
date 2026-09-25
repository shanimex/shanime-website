/**
 * Minimal VAST istemcisi — yalnızca "video öncesi reklam" için gerekli kadarı.
 *
 * Neden kendi istemcimiz: sitede bölümler SAĞLAYICI EMBED'i (VidMoly/Streamtape
 * iframe) olarak duruyor; Fluid Player bir iframe oynatamaz, dolayısıyla VAST
 * ad-pod'unu sağlayıcı oynatıcısının ÖNÜNE koymak için reklamı kendimiz
 * oynatmak zorundayız. Fluid Player'ın kendi VAST motoru, doğrudan video
 * dosyası olan (kendi barındırdığın) bölümlerde kullanılıyor — bkz. FluidPlayer.tsx.
 *
 * Desteklenen: InLine + Wrapper zinciri (VASTAdTagURI), Linear süre/skipoffset,
 * progressive mp4 MediaFile seçimi, Impression ve ClickTracking sayaçları.
 */

export type VastAd = {
  /** Oynatılacak mp4 adresi (en yüksek çözünürlüklü progressive dosya). */
  mediaFile: string;
  /** Reklamın süresi (saniye). VAST vermediyse undefined. */
  durationSeconds?: number;
  /** Atlama düğmesinin görüneceği saniye (VAST skipoffset). Yoksa undefined. */
  skipOffsetSeconds?: number;
  /** Gösterim sayaçları — reklam başlarken tetiklenir. */
  impressions: string[];
  /** Tıklama sayaçları (şu an tıklanabilirlik kapalı, ileride kullanılabilir). */
  clickTrackings: string[];
  /** Tıklanınca açılacak adres. */
  clickThrough?: string;
};

const DEFAULT_MAX_REDIRECTS = 3;

/** Alan adı önekini yok sayarak (vast:Ad gibi) etiket arar. */
function childrenByLocalName(root: Document | Element, name: string): Element[] {
  const wanted = name.toLowerCase();
  return Array.from(root.getElementsByTagName("*")).filter(
    (element) => element.localName?.toLowerCase() === wanted,
  );
}

function firstText(root: Document | Element, name: string): string {
  const found = childrenByLocalName(root, name)[0];
  return found?.textContent?.trim() ?? "";
}

function firstAttr(root: Document | Element, name: string, attribute: string): string {
  return childrenByLocalName(root, name)[0]?.getAttribute(attribute)?.trim() ?? "";
}

/** "00:00:15", "00:00:15.000" veya "15" biçimlerini saniyeye çevirir. Yüzde (%) desteklenmez. */
function parseTimeToSeconds(value: string): number | undefined {
  const text = value.trim();
  if (!text || text.includes("%")) return undefined;
  const parts = text.split(":").map((part) => Number.parseFloat(part));
  if (parts.some((part) => Number.isNaN(part))) return undefined;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  return undefined;
}

function absoluteUrl(raw: string): string | undefined {
  const text = raw.trim();
  return /^https?:\/\//i.test(text) ? text : undefined;
}

/** MediaFile'lar arasından en yüksek çözünürlüklü progressive mp4'ü seçer. */
function pickMediaFile(inLine: Element): string | undefined {
  const files = childrenByLocalName(inLine, "MediaFile");
  const scored = files
    .map((file) => {
      const url = absoluteUrl(file.textContent ?? "");
      if (!url) return null;
      const type = (file.getAttribute("type") ?? "").toLowerCase();
      const delivery = (file.getAttribute("delivery") ?? "").toLowerCase();
      const height = Number.parseFloat(file.getAttribute("height") ?? "0");
      // mp4 + progressive tercih edilir; puan yükseklikle artar.
      let score = Number.isNaN(height) ? 0 : height;
      if (type.includes("mp4")) score += 1000;
      if (delivery === "progressive") score += 500;
      return { url, score };
    })
    .filter((entry): entry is { url: string; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.url;
}

function parseAd(inLine: Element, inheritedImpressions: string[]): VastAd | null {
  const mediaFile = pickMediaFile(inLine);
  if (!mediaFile) return null;

  const linear = childrenByLocalName(inLine, "Linear")[0];
  const skipOffset = linear
    ? parseTimeToSeconds(linear.getAttribute("skipoffset") ?? "")
    : undefined;
  const duration = parseTimeToSeconds(firstText(inLine, "Duration"));

  const impressions = [...inheritedImpressions];
  for (const node of childrenByLocalName(inLine, "Impression")) {
    const url = absoluteUrl(node.textContent ?? "");
    if (url) impressions.push(url);
  }

  const clickTrackings: string[] = [];
  for (const node of childrenByLocalName(inLine, "ClickTracking")) {
    const url = absoluteUrl(node.textContent ?? "");
    if (url) clickTrackings.push(url);
  }

  const clickThrough = absoluteUrl(firstText(inLine, "ClickThrough"));

  return {
    mediaFile,
    ...(duration !== undefined ? { durationSeconds: duration } : {}),
    ...(skipOffset !== undefined ? { skipOffsetSeconds: skipOffset } : {}),
    impressions,
    clickTrackings,
    ...(clickThrough ? { clickThrough } : {}),
  };
}

/**
 * VAST etiketini çeker ve oynatılabilir reklamları döndürür.
 *
 * Hata/boş dolgu durumunda BOŞ DİZİ döner — çağıran taraf her durumda içeriği
 * göstermeye devam etmelidir (reklam yüzünden video asla bloke edilmez).
 */
export async function fetchVastAds(
  tagUrl: string,
  options: { maxRedirects?: number; timeoutMs?: number } = {},
): Promise<VastAd[]> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? 3500;
  const ads: VastAd[] = [];
  const inheritedImpressions: string[] = [];

  let currentUrl = tagUrl;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    let xml: string;
    try {
      const response = await fetch(currentUrl, {
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
      });
      if (!response.ok) return ads;
      xml = await response.text();
    } catch {
      return ads;
    } finally {
      window.clearTimeout(timer);
    }

    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) return ads;

    // Aynı yanıtta birden fazla <Ad> olabilir: MyBid'in "Number of video(s)"
    // ayarı bu şekilde tek yanıtta birden fazla reklam döndürür (ad-pod).
    for (const inLine of childrenByLocalName(doc, "InLine")) {
      const parent = inLine.parentElement;
      const ad = parseAd(inLine, inheritedImpressions);
      if (ad) ads.push({ ...ad, ...(parent ? {} : {}) });
    }

    const wrapper = childrenByLocalName(doc, "Wrapper")[0];
    if (!wrapper) break;

    // Wrapper seviyesindeki Impression'lar alt reklamla birlikte tetiklenir.
    for (const node of childrenByLocalName(wrapper, "Impression")) {
      const url = absoluteUrl(node.textContent ?? "");
      if (url) inheritedImpressions.push(url);
    }

    const next = absoluteUrl(firstText(wrapper, "VASTAdTagURI"));
    if (!next) break;
    currentUrl = next;
  }

  return ads;
}

/**
 * Gösterim sayaçlarını tetikler.
 *
 * `no-cors` + `keepalive`: sayaç sunucuları CORS başlığı göndermez; yanıtı
 * okumamıza gerek yok, yalnızca isteğin gitmesi yeterli.
 */
export function fireBeacons(urls: string[]): void {
  for (const url of urls) {
    try {
      void fetch(url, { mode: "no-cors", keepalive: true, credentials: "omit" });
    } catch {
      /* sayaç gönderilemezse oynatma etkilenmez */
    }
  }
}

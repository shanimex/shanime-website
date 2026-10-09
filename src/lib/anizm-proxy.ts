/**
 * ANİZM OYNATICI TERS PROXY'Sİ (08.10.2026) — "doğru embed, oynatıcının içinde".
 *
 * ── NEDEN VAR ────────────────────────────────────────────────────────────────
 * Anizm (puffytr/anizm.net ağı) Türkçe altyazıyı videoya GÖMÜLÜ veren temiz
 * oynatıcıyı `https://anizmplayer.com/video/<hash>` altında sunar. Ölçüm
 * (`docs/arastirma/anizm-puffy-embed-findings.md`): reklamsız, pop-up yok, 1080p.
 *
 * AMA sağlayıcı bu adresi **yalnızca `Referer: https://anizm.net/` ya da
 * `https://puffytr.com/`** ise servis ediyor. Bizim origin'imizden (localhost ya
 * da shanime.xyz) gelen istek **403** döner — hem oynatıcı belgesi hem de medya
 * (`/cdn/hls/...`) için. Tarayıcı bir iframe'de `Referer`'ı seçemez, bu yüzden
 * doğrudan gömme İMKÂNSIZ.
 *
 * ÇÖZÜM: oynatıcıyı SUNUCUMUZ çeker (Referer'ı biz ayarlarız), gövdesini
 * origin'imize göre yeniden yazar ve bizden servis eder. İzleyicinin iframe'i
 * artık bizim origin'imizde çalışır → temiz oynatıcı oynatıcının İÇİNDE gömülür
 * (sağlayıcının reklamlı "bölüm sayfası" değil).
 *
 * ── AKIŞ (ölçülerek doğrulandı) ──────────────────────────────────────────────
 *   1) iframe src = `/api/anizm-player?hash=<hash>` → oynatıcı belgesi.
 *   2) Belgedeki MUTLAK `anizmplayer.com` adresleri origin-göreli yapılır →
 *      `/player/…` (JW Player paketi, `index.php?do=getVideo`), `/cdn/…` (HLS
 *      master + m3u8), `/m3/…` (kalite varyantları) bizim origin'imize gelir.
 *   3) `server.ts` (üretim) ve Vite dev yaması bu yolları aynı Referer'la proxy'ler.
 *   4) `do=getVideo` JSON'undaki `videoSource`/`securedLink` de origin'imize yazılır.
 *   5) Varyant playlist'teki segmentler AYRI host'tadır (`anz-gth-N.com.tr`) ve
 *      CORS'u yalnızca `anizmplayer.com`'a açıktır → onlar da
 *      `/api/anizm-asset?u=<adres>` üzerinden proksilenir.
 *
 * ── İKİ UÇ NOKTA ─────────────────────────────────────────────────────────────
 *   · `/api/anizm-player?hash=…` + `/player/` `/cdn/` `/m3/`  → anizmplayer.com
 *   · `/api/anizm-asset?u=…`                                  → allowlist host'lar
 *     (anizmplayer.com ve `anz-gth-N.com.tr` segment sunucuları) — SSRF'e kapalı.
 */

/** Sağlayıcının oynatıcı host'u. */
export const ANIZM_PLAYER_ORIGIN = "https://anizmplayer.com";

/** Sağlayıcının aradığı referer (ölçüm: yalnızca anizm.net/puffytr.com kabul). */
const ANIZM_REFERER = "https://anizm.net/";

/** İstemcinin iframe'e yazdığı bizim oynatıcı proxy yolumuz. */
export const ANIZM_PLAYER_PATH = "/api/anizm-player";

/** Farklı host'lardaki (segmentler/dış görseller) içeriği proksileyen genel uç. */
export const ANIZM_ASSET_PATH = "/api/anizm-asset";

/** `anizmplayer.com/video/<hash>` biçimi (16+ onaltılık karakter). */
const ANIZM_PLAYER_URL_RE = /^https:\/\/anizmplayer\.com\/video\/([0-9a-f]{16,})/i;

/** Yalnızca hash biçimi (sorgu parametresinden gelir). */
const HASH_RE = /^[0-9a-f]{16,}$/i;

/** Segment sunucusu host'ları: `anz-gth-3-01.com.tr` vb. */
const SEGMENT_HOST_RE = /^anz-gth-[a-z0-9-]+\.com\.tr$/i;

/** `/api/anizm-asset?u=…` için izinli host mu? (SSRF koruması) */
function isAllowedAssetHost(hostname: string): boolean {
  return hostname === "anizmplayer.com" || SEGMENT_HOST_RE.test(hostname);
}

/**
 * Sağlayıcının SAYFA adresi mi? (`anizm.net/...`, `puffytr.com/...`)
 *
 * ⚠️ BU ADRESLER IFRAME'E GÖMÜLEMEZ. Gömüldüğünde sayfanın kendi katmanları
 * oynatıcının içinde açılıyor: "PuffyTR Google ile giriş" penceresi ve reklam
 * şeritleri (kullanıcı bildirimi, 08.10.2026: "anizm kaynağı seçiliyken video
 * yerine tarayıcı sayfası açılıyor"). İzleyicinin görmesi gereken tek belge
 * doğrudan oynatıcıdır: `anizmplayer.com/video/<hash>` → bizim proxy.
 *
 * NEDEN AYRI BİR DENETİM: sağlayıcı "bölüm sayfası" adresini her yerde
 * kullanıyor (panel kayıtları, `watch_url`, eski çözümleme çıktıları). Hepsi tek
 * kapıdan geçtiği için süzgeç burada durur — sayfa adresi oynatıcıya ULAŞAMAZ.
 */
export function isAnizmPageUrl(url: string | null | undefined): boolean {
  return /^https?:\/\/(?:[a-z0-9-]+\.)*(?:anizm\.net|puffytr\.com)\//i.test((url ?? "").trim());
}

/**
 * Sağlayıcının doğrudan oynatıcı adresini bizim proxy adresimize çevirir.
 *
 * Dönüş:
 *   · `anizmplayer.com/video/<hash>` → `/api/anizm-player?hash=<hash>`
 *   · sağlayıcı SAYFA adresi        → `null` (gömülemez — bkz. `isAnizmPageUrl`)
 *   · diğer sağlayıcılar (megaplay/tauvideo) → OLDUĞU GİBİ
 */
export function anizmProxyEmbed(url: string | null | undefined): string | null {
  if (!url) return url ?? null;
  if (isAnizmPageUrl(url)) return null;
  const match = ANIZM_PLAYER_URL_RE.exec(url.trim());
  return match ? `${ANIZM_PLAYER_PATH}?hash=${match[1]}` : url;
}

/**
 * Oynatıcının KÖK-GÖRELİ alt kaynak yolları. Bunlar bizim origin'imize gelir ve
 * sağlayıcıya iletilmeleri gerekir (ölçüldü 08.10.2026):
 *   /player/… → JW Player paketi, remodal, görseller, `index.php?do=getVideo`
 *   /cdn/…    → HLS master.txt / m3u8, kapak
 *   /m3/…     → HLS varyant (kalite) playlist'leri
 */
const ANIZM_PROXY_PREFIXES = ["/player/", "/cdn/", "/m3/"];

/**
 * Bu istek proksilenmeli mi? (server entry kancası ve Vite dev yaması bunu çağırır.)
 */
export function isAnizmProxyRequest(request: Request): boolean {
  const path = new URL(request.url).pathname;
  return (
    path === ANIZM_PLAYER_PATH ||
    path === ANIZM_ASSET_PATH ||
    ANIZM_PROXY_PREFIXES.some((p) => path.startsWith(p))
  );
}

/** Gövdesi metin olarak yeniden yazılacak içerik tipleri/yolları. */
function isRewritable(url: string, contentType: string): boolean {
  if (
    /^(text\/|application\/(?:javascript|json|xml|x-javascript)|application\/vnd\.apple\.mpegurl)/i.test(
      contentType,
    )
  )
    return true;
  return /\.(?:php|js|css|txt|m3u8|json)(?:$|\?)/i.test(url);
}

/** Sağlayıcıya giden hedef adresi bu istekten üretir. */
function targetFor(requestUrl: URL): string | null {
  if (requestUrl.pathname === ANIZM_PLAYER_PATH) {
    const hash = (requestUrl.searchParams.get("hash") ?? "").trim();
    return HASH_RE.test(hash) ? `${ANIZM_PLAYER_ORIGIN}/video/${hash}` : null;
  }
  if (requestUrl.pathname === ANIZM_ASSET_PATH) {
    const raw = requestUrl.searchParams.get("u") ?? "";
    try {
      const target = new URL(raw);
      if (target.protocol !== "https:" || !isAllowedAssetHost(target.hostname)) return null;
      return target.href;
    } catch {
      return null;
    }
  }
  return `${ANIZM_PLAYER_ORIGIN}${requestUrl.pathname}${requestUrl.search}`;
}

/** Segment/asset adresini bizim asset uç noktasına çevirir. */
function assetUrl(absUrl: string): string {
  return `${ANIZM_ASSET_PATH}?u=${encodeURIComponent(absUrl)}`;
}

/** Metindeki sağlayıcı host'larını bizim origin'imize / asset uç noktasına çevirir. */
function rewriteBody(text: string, origin: string): string {
  return (
    text
      // 1) anizmplayer.com → bizim origin (yol-tabanlı proxy: /player /cdn /m3)
      .replaceAll("https://anizmplayer.com", origin)
      .replaceAll("http://anizmplayer.com", origin)
      .replaceAll("//anizmplayer.com", origin)
      // JSON yanıtlarında `/` KAÇIŞLI gelir (`https:\/\/anizmplayer.com`).
      .replaceAll("https:\\/\\/anizmplayer.com", origin)
      .replaceAll("http:\\/\\/anizmplayer.com", origin)
      .replaceAll("\\/\\/anizmplayer.com", origin)
      // 2) Segment sunucuları (farklı host, CORS'u bize kapalı) → asset uç noktası.
      .replace(
        /https:\/\/(anz-gth-[a-z0-9-]+\.com\.tr)(\/[^\s"']*)?/gi,
        (_m, host: string, path = "") => assetUrl(`https://${host}${path}`),
      )
      // 2b) JSON'daki kaçışlı biçim (`https:\/\/anz-gth-3-01.com.tr\/…`).
      .replace(
        /https:\\\/\\\/(anz-gth-[a-z0-9-]+\.com\.tr)((?:\\\/[^\s"']*)?)/gi,
        (_m, host: string, path = "") => assetUrl(`https://${host}${path.replace(/\\\//g, "/")}`),
      )
  );
}

/**
 * Proxilenmiş yanıtı üretir. Başarısızlıkta hata yanıtı döner.
 */
export async function handleAnizmProxy(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const target = targetFor(requestUrl);
  if (!target) return new Response("Geçersiz anizm oynatıcı isteği", { status: 400 });

  /**
   * ⚠️ METHOD VE GÖVDE AYNEN İLETİLİR. Oynatıcı medyayı
   * `POST /player/index.php?data=<hash>&do=getVideo` + gövde `hash=…&r=…` ile
   * ister ve JSON bekler (bkz. `scripts.php` → `FirePlayer`). GET'e çevrilirse
   * sunucu HTML döner, oynatıcı süresiz "yükleniyor"da kalır (ölçüldü).
   */
  const isPost = request.method === "POST";
  const body = isPost ? await request.arrayBuffer() : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: isPost ? "POST" : "GET",
      redirect: "follow",
      ...(body ? { body } : {}),
      headers: {
        Referer: ANIZM_REFERER,
        // ⚠️ Origin `anizmplayer.com` OLMALI (anizm.net DEĞİL): segment sunucuları
        // (`anz-gth-N.com.tr`) Origin'i allowlist'e göre denetliyor ve
        // `anizm.net`/bizim origin 403 alıyor — ölçüldü 08.10.2026.
        Origin: "https://anizmplayer.com",
        "User-Agent":
          request.headers.get("user-agent") ??
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        Accept: request.headers.get("accept") ?? "*/*",
        "Accept-Language": request.headers.get("accept-language") ?? "tr,en;q=0.9",
        // ⚠️ KRİTİK: oynatıcı medyayı jQuery `$.ajax` ile ister ve jQuery
        // `X-Requested-With: XMLHttpRequest` başlığını gönderir. Bu başlık
        // olmadan `do=getVideo` HTML sayfası döndürür (JSON değil) ve oynatıcı
        // süresiz "yükleniyor"da kalır — ölçüldü 08.10.2026.
        ...(request.headers.get("x-requested-with")
          ? { "X-Requested-With": request.headers.get("x-requested-with")! }
          : {}),
        ...(isPost
          ? {
              "Content-Type":
                request.headers.get("content-type") ?? "application/x-www-form-urlencoded",
            }
          : {}),
      },
    });
  } catch {
    return new Response("anizm oynatıcıya ulaşılamadı", { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(`anizm oynatıcı yanıtı: ${upstream.status}`, {
      status: upstream.status || 502,
    });
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const headers = new Headers();
  headers.set("content-type", contentType);
  // Oynatıcı durumu kişiye özel değil; yine de araya önbellek girmesin.
  headers.set("cache-control", "no-store");
  headers.set("access-control-allow-origin", "*");
  // X-Frame-Options / CSP KOPYALANMAZ: iframe'de gömülmeyi engellemesinler.

  // Asset uç noktası (segmentler/görseller) ASLA metin olarak yeniden yazılmaz:
  // segmentler `text/html` gibi görünse de İKİLİdir; text() ile bozulur.
  if (requestUrl.pathname === ANIZM_ASSET_PATH || !isRewritable(target, contentType)) {
    return new Response(upstream.body, { status: 200, headers });
  }

  const text = rewriteBody(await upstream.text(), requestUrl.origin);
  return new Response(text, { status: 200, headers });
}

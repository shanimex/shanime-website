/**
 * Bölüm kapaklarını sağlayıcıdan çekip veritabanına yazar.
 *
 * NEDEN GEREKLİ: Panelde bölüme yalnızca embed adresi girilir; kapak adresini
 * sağlayıcı üretir ama adres KODDAN TÜRETİLEMEZ:
 *
 *   vidmoly.org/embed-<kod>.html  →  https://<cdn>.vmwesa.online/i/01/02950/<kod>.jpg
 *
 * CDN alan adı (`transit-up-1170-i`, `1171-e`, `1164-r`…) ve `01/02950` yolu
 * sağlayıcıya özel; embed sayfasının içinden okunması gerekir.
 *
 * NEDEN TARAYICIDA: VidMoly embed sayfası CORS başlığı gönderiyor
 * (`Access-Control-Allow-Origin`), yani tarayıcıdan doğrudan okunabiliyor. Bu
 * sayede ayrı bir sunucu/servis katmanı gerekmiyor.
 *
 * NEDEN VERİTABANI: Sonuç `site_settings` tablosuna yazılır. Böylece yeni bölüm
 * eklendiğinde kapak, yeniden yayına almaya (deploy) gerek kalmadan sitede
 * görünür — site bölüm verisini zaten çalışma anında Supabase'den okuyor.
 *
 * AKIŞ: Bölüm eklenip kaydedildiğinde `syncAllEpisodePosters()` çağrılır; yalnızca
 * kapağı EKSİK olan bölümler için istek yapılır (yeni 1 bölüm = 1 istek).
 */
import { supabase } from "@/integrations/supabase/client";
import BAKED_POSTERS from "@/data/episode-posters.json";
import { puffySlugCandidates, puffySlugFor } from "@/lib/puffy";
import { cachedRead } from "@/lib/server-cache";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** `site_settings` içindeki anahtar. */
export const POSTER_SETTINGS_KEY = "episode_posters";

const baked = BAKED_POSTERS as Record<string, string>;

/** Embed adresinden video kodunu çıkarır. */
export function videoCodeFromUrl(url?: string | null): string {
  if (!url) return "";
  const clean = (url.split(/[?#]/)[0] ?? "").replace(/\/+$/, "");
  const last = clean.split("/").filter(Boolean).pop() ?? "";
  const dashed = /^embed-([a-z0-9]{6,})\.html$/i.exec(last);
  if (dashed) return dashed[1] ?? "";
  const plain = /^([a-z0-9]{6,})\.html$/i.exec(last);
  if (plain) return plain[1] ?? "";
  return /^[a-z0-9]{6,}$/i.test(last) ? last : "";
}

/**
 * VidMoly embed sayfasından kapak adresini okur.
 * Player yapılandırmasındaki `image:` en güvenilir kaynak; `og:image` bazı
 * sayfalarda site logosuna işaret ediyor.
 */
export async function fetchVidmolyPoster(code: string): Promise<string> {
  const res = await fetch(`https://vidmoly.org/embed-${code}.html`, { credentials: "omit" });
  if (!res.ok) return "";
  const html = await res.text();
  const direct = /image\s*:\s*["']([^"']+_?\.(?:jpg|jpeg|png|webp))["']/i.exec(html);
  if (direct) return direct[1] ?? "";
  const decoded = decodeURIComponent(html);
  return /https:\/\/[^\s"'<>\\]+_p\.jpg/.exec(decoded)?.[0] ?? "";
}

/**
 * Voe alan adları. Voe linkleri bir mirror alan adına JS ile yönlendiriyor
 * (jamesbornmain.com, chuckle-tube.com, goofy-banana.com…) ve bunlar dönüyor;
 * ek olarak `/e/<kod>` biçimi de Voe sayılır (bkz. isVoeUrl).
 */
const VOE_HOSTS = /(^|\.)(voe\.sx|chuckle-tube\.com|goofy-banana\.com|jamesbornmain\.com)$/i;

/**
 * Link Voe'ya mı ait? Yalnızca **alan adı** listesine bakılır.
 *
 * Eskiden `/e/<kod>` biçimi de yeterli sayılıyordu; Filemoon gibi sağlayıcılar da
 * aynı biçimi kullandığı için Filemoon linkli bölüm Voe sanılıyor ve var olmayan
 * bir kapak adresi (`i.voe.sx/cache/<kod>_storyboard_L5.jpg`) üretiliyordu
 * (kullanıcı bildirimi: Filemoon'a geçince 1. bölümün kapağı kırıldı).
 * Yeni bir Voe mirror'ı çıkarsa `VOE_HOSTS` listesine eklenmeli.
 */
export function isVoeUrl(url: string): boolean {
  try {
    return VOE_HOSTS.test(new URL(url.split(/[?#]/)[0] ?? "").hostname);
  } catch {
    return false;
  }
}

/**
 * Bir video linkinin kapak adresi.
 *
 * - **Voe:** adres DETERMİNİSTİK ve API'nin verdiğiyle aynı:
 *   `https://i.voe.sx/cache/<kod>_storyboard_L5.jpg`. Kademe önemli:
 *   **L5 = 1x1 → tek kare**; L2 (4x4), L1 (5x5) gibi kademeler 16-25 kareli
 *   mozaik görsellerdir ve kapak olarak ızgara gibi görünür. Voe sayfası CORS
 *   başlığı göndermediği için tarayıcıdan okunamıyor — adres koddan türetiliyor.
 * - **VidMoly:** adres CDN'e özel ve koddan türetilemez, embed sayfasından
 *   okunur (`fetchVidmolyPoster`).
 * - **Morencius:** `https://pixibay.cc/<kod>.jpg`
 */
export async function posterForWatchUrl(url: string, code?: string): Promise<string> {
  const videoCode = code ?? videoCodeFromUrl(url);
  if (!videoCode || !url) return "";
  if (isVoeUrl(url)) return `https://i.voe.sx/cache/${videoCode}_storyboard_L5.jpg`;
  if (/vidmoly/i.test(url)) return fetchVidmolyPoster(videoCode);
  if (/morencius/i.test(url)) return `https://pixibay.cc/${videoCode}.jpg`;
  return "";
}

/**
 * ── KAYNAKTAN KAPAK (TÜRKÇE KAYNAK İÇİN YEDEK ZİNCİR, 27.09.2026) ──────────────
 *
 * NEDEN GEREKLİ: `videoCodeFromUrl` yalnızca VidMoly/Voe/Morencius gibi
 * sağlayıcıların embed adresinden kod çıkarabiliyor. Türkçe kaynak (Anizm) bölümün
 * `watch_url`i `anizmplayer.com/video/<hash>` biçimindedir; bu hash'ten kapak
 * adresi TÜRETİLEMEZ ve oynatıcı sayfasında görsel de yoktur (ölçüm 27.09.2026:
 * sayfa 200, 17 KB HTML, içinde hiç `img`/`m3u8` yok). Yani Türkçe kaynağı birincil
 * yaptığımız bölümler kapaksız kalıyordu. Kullanıcının kuralı: "illa olmazsa alınan
 * kaynaktaki kapağı koysun" — bu yüzden kapak, dizinin Türkçe kaynaktaki KENDİ
 * sayfasından okunur.
 *
 * ÖLÇÜM (27.09.2026, canlı HTTP):
 *   puffytr.com/jujutsu-kaisen-1-bolum-izle → 200, `og:image` =
 *     https://puffytr.com/storage/pcovers/17242.webp ✔ (kapak var)
 *   puffytr.com/rezero-kara-hajimeru-isekai-seikatsu-1-bolum-izle → 200 ama sayfada
 *     HİÇ görsel yok (bu adres dizinin kendisi değil) ✘ → boş döner, aday elenir
 *   `access-control-allow-origin: *` → tarayıcıdan doğrudan okunabilir (CORS engeli yok)
 *   `cache-control: no-cache, private` → CDN önbelleği yok; bu yüzden sonuç sezon
 *     başına BİR kez çözülür ve bellekte tutulur (aşağıdaki `puffyCoverMemo`).
 */

/** `og:image` (iki yazım sırası da denenir: property→content ve content→property). */
function ogImageFromHtml(html: string): string {
  const direct = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (direct?.[1]) return direct[1].trim();
  const reverse = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html);
  return reverse?.[1]?.trim() ?? "";
}

/**
 * Türkçe kaynaktaki bir SEZONUN kapağını okur (sezonun 1. bölümünün sayfasından).
 *
 * NEDEN 1. BÖLÜM: kapak dizi düzeyindedir (ölçüm: her bölüm sayfası aynı
 * `pcovers` görselini veriyor); 1. bölüm ise bir sezonda her zaman var olan tek
 * sayıdır. Böylece bölüm başına değil SEZON başına tek istek yapılır.
 *
 * @param seasonSlug kaynaktaki sezon slug'ı (`rezero-…-2-sezon` gibi; aday sırası
 *                   `lib/puffy.ts` → `puffySlugCandidates`).
 */
export async function fetchPuffyCover(seasonSlug: string): Promise<string> {
  const slug = seasonSlug.trim();
  if (!slug) return "";
  const res = await fetch(`https://puffytr.com/${slug}-1-bolum-izle`, { credentials: "omit" });
  if (!res.ok) return "";
  return ogImageFromHtml(await res.text());
}

/** (Dizi + sezon) → çözülen kapak sözü. Aynı sezon tekrar sorulmaz. */
const puffyCoverMemo = new Map<string, Promise<string>>();

/**
 * Dizinin/sezonun Türkçe kaynaktaki kapağı — aday adresler sırayla denenir.
 *
 * Aday sırası `puffySlugCandidates`tır (ölçülmüş yazımlar: `-2nd-season`, `-2-sezon`…)
 * ve İLK kapak veren adres kullanılır. Hiçbiri kapak vermezse `""` döner ve kapak
 * yazılmaz — uydurma yok, o bölüm kapaksız kalır.
 */
export function puffyCoverForSeason(showSlug: string, season: number): Promise<string> {
  const key = `${showSlug}:s${season}`;
  const cached = puffyCoverMemo.get(key);
  if (cached) return cached;
  const task = (async () => {
    for (const candidate of puffySlugCandidates(puffySlugFor(showSlug), season)) {
      try {
        const cover = await fetchPuffyCover(candidate);
        if (cover) return cover;
      } catch {
        // Aday okunamadı (ağ/CORS); sıradaki denenir.
      }
    }
    return "";
  })();
  puffyCoverMemo.set(key, task);
  return task;
}

/**
 * ── ANIMECIX BÖLÜM KAPAĞI (29.09.2026) ────────────────────────────────────────
 *
 * NEDEN GEREKLİ: Türkçe (hardsub) kaynağı birincil yaptığımız bölümlerde
 * `watch_url` `anizmplayer.com/video/<hash>` biçimindedir; bu hash'ten ne video
 * kodu ne de kapak türetilebilir ve puffytr bazı ağlarda 403 döner. Sonuç: bölüm
 * kartı BOŞ kalıyor, yalnızca seri posteri gösteriliyordu. Oysa animecix API'si
 * HER BÖLÜM için gerçek bir `thumbnail` döndürüyor (bölüme özel).
 *
 * ÖLÇÜM (29.09.2026, canlı HTTP):
 *   /secure/episode-videos?titleId=10535&season=1&episode=1
 *     → cdn.mangacix.net/file/tau-video/thb/64c714d7d7eea72649594c49-32.jpg  (200, image/jpeg)
 *   aynı dizi episode=2 → FARKLI hash (yani bölüme özel)
 *   titleId=7350 (Mushoku) → image.tmdb.org/... (dizi görseli)
 *   `cdn.mangacix.net` referer'sız HTTP 200 + `image/jpeg` → hotlink engeli YOK,
 *   `<img src>` ile doğrudan gösterilebilir (vekil rota GEREKMEZ).
 *
 * GÜVENLİK/MALİYET: yalnızca `https:` adresler kabul edilir; istekte KISA timeout
 * vardır ve sonuç `cachedRead` ile (üretimde) önbelleğe alınır; ek olarak modül
 * düzeyinde bir söz önbelleği (`animecixCoverMemo`) vardır — dev'de server-cache
 * kapalı olduğu için aynı bölüm TEKRAR sorulmaz.
 */
const ANIMECIX_BASE = "https://animecix.tv";
const ANIMECIX_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
/** Tek kaynak yanıtı için üst sınır — sayfa açılışını bloklamasın. */
const ANIMECIX_COVER_TIMEOUT_MS = 4000;
/** Üretimde önbellek süresi (saniye). Kapaklar bölüm başına stabildir. */
const ANIMECIX_COVER_TTL_SECONDS = 900;

/** Yalnızca https kapak adresleri geçerli; bozuksa boş döner (uydurma yok). */
function safeCoverUrl(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  return /^https:\/\//i.test(value) ? value : "";
}

/**
 * animecix bölüm kayıt listesinden kapak adresini seçer.
 * Sıralama `pickBest` ile aynı mantık: onaylı + "full" + Türkçe önce.
 */
function thumbnailFromAnimecixList(list: unknown): string {
  if (!Array.isArray(list)) return "";
  const items = list.filter(
    (row): row is Record<string, unknown> => !!row && typeof row === "object",
  );
  const usable = items.filter((row) => safeCoverUrl(row["thumbnail"]));
  if (usable.length === 0) return "";
  const score = (row: Record<string, unknown>) =>
    (row["approved"] === true ? 0 : 4) +
    (row["category"] === "full" ? 0 : 2) +
    (typeof row["language"] === "string" && row["language"] !== "tr" ? 1 : 0);
  usable.sort(
    (a, b) =>
      score(a) - score(b) ||
      Number(a["order"] ?? 99) - Number(b["order"] ?? 99) ||
      Number(a["id"] ?? 0) - Number(b["id"] ?? 0),
  );
  return safeCoverUrl(usable[0]?.["thumbnail"]);
}

/**
 * animecix bölüm kaydını okur ve kapak adresini çıkarır (kısa timeout).
 *
 * ── NEDEN İKİ YOL (ölçüldü, 29.09.2026) ──────────────────────────────────────
 * İzleme sayfası seri detayını TARAYICIDA okur (`useQuery` → `fetchShowDetail`).
 * animecix.tv CORS başlığı GÖNDERMİYOR; tarayıcıdan doğrudan çağrı
 * `net::ERR_FAILED` ile düşer (ölçüldü: 10 bölüm için 10 başarısız istek,
 * kapaklar seri posterine düşüyordu). Bu yüzden:
 *   · SUNUCU  → animecix upstream'i doğrudan çağrılır (CORS yok, hızlı).
 *   · TARAYICI → aynı kaynaklı `/api/animecix` rotası çağrılır; rotanın kendisi
 *     kapak alanını (`poster`) döndürür ve sunucuda 15 dk önbelleklenir.
 */
async function fetchAnimecixThumbnail(
  animecixId: number,
  season: number,
  episode: number,
): Promise<string> {
  const inBrowser = typeof window !== "undefined";
  const url = inBrowser
    ? `/api/animecix?titleId=${animecixId}&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`
    : `${ANIMECIX_BASE}/secure/episode-videos?titleId=${animecixId}` +
      `&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`;
  const init: RequestInit = { signal: AbortSignal.timeout(ANIMECIX_COVER_TIMEOUT_MS) };
  // Tarayıcıda özel başlık EKLENMEZ (CORS preflight'ı tetikler ve gereksizdir).
  if (!inBrowser) {
    init.headers = {
      "User-Agent": ANIMECIX_UA,
      Accept: "application/json, text/plain, */*",
      Referer: `${ANIMECIX_BASE}/`,
    };
  }
  try {
    const res = await fetch(url, init);
    if (!res.ok) return "";
    const body = (await res.json()) as unknown;
    if (inBrowser) return safeCoverUrl((body as { poster?: unknown } | null)?.poster);
    const list = Array.isArray(body)
      ? body
      : ((body as { videos?: unknown[]; data?: unknown[] } | null)?.videos ??
        (body as { data?: unknown[] } | null)?.data ??
        []);
    return thumbnailFromAnimecixList(list);
  } catch {
    // Ağ/timeout: kapak yok sayılır, zincir bir sonraki adaya geçer.
    return "";
  }
}

/** (animecixId, sezon, bölüm) → çözülen kapak sözü. Aynı bölüm tekrar sorulmaz. */
const animecixCoverMemo = new Map<string, Promise<string>>();

/**
 * Bir bölümün animecix kapağı. Id yoksa/geçersizse boş döner (istek atılmaz).
 * `cachedRead` üretimde paylaşımlı (isolate'ler arası) önbellek sağlar; dev'de
 * server-cache kapalı olduğu için modül söz önbelleği devreye girer.
 */
export function animecixCoverForEpisode(
  animecixId: number | null | undefined,
  season: number,
  episode: number,
): Promise<string> {
  const id = Number(animecixId ?? 0);
  if (!Number.isFinite(id) || id <= 0) return Promise.resolve("");
  const key = `animecix-cover:${id}:s${season}e${episode}`;
  const existing = animecixCoverMemo.get(key);
  if (existing) return existing;
  const task = cachedRead(key, ANIMECIX_COVER_TTL_SECONDS, () =>
    fetchAnimecixThumbnail(id, season, episode),
  ).catch(() => "");
  animecixCoverMemo.set(key, task);
  return task;
}

/**
 * Birden çok bölümün animecix kapağını SINIRLI eşzamanlılıkla çözer.
 * Amaç: uzun bir sezonu açarken animecix'e aynı anda onlarca istek atıp
 * 429/502 almamak.
 *
 * @returns anahtar `"<sezon>:<bölüm>"`, değer kapak adresi ("" = bulunamadı).
 */
export async function animecixCoversForEpisodes(
  animecixId: number | null | undefined,
  items: { season: number; number: number }[],
  limit = 6,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const queue = [...items];
  if (queue.length === 0) return out;
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), queue.length) }, async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      const cover = await animecixCoverForEpisode(animecixId, item.season, item.number);
      out.set(`${item.season}:${item.number}`, cover);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Kapak haritasındaki kayıt: kapak adresi + çözüldüğü video kodu. */
export type PosterEntry = { p: string; c: string };

/**
 * Kaydı okur. Eski kayıtlar düz metindi (`"<kapak>"`), yenileri nesne
 * (`{p, c}`). İkisi de desteklenir; düz metinlerin kaynak kodu bilinmez.
 */
export function posterEntryOf(raw: unknown): PosterEntry {
  if (typeof raw === "string") return { p: raw, c: "" };
  if (raw && typeof raw === "object") {
    const value = raw as { p?: unknown; c?: unknown };
    return {
      p: typeof value.p === "string" ? value.p : "",
      c: typeof value.c === "string" ? value.c : "",
    };
  }
  return { p: "", c: "" };
}

/**
 * Haritadaki kapağı döndürür — ama yalnızca kayıt GÜNCEL video için çözülmüşse.
 *
 * Neden: kayıt eskiden yalnızca bölüm anahtarına (`slug-s1e1`) bağlıydı; bölümün
 * video linki değiştirilince eski kapağın kalmasına yol açıyordu ("hep eski
 * kapaklar"). Artık kayıt, çözüldüğü video kodunu da taşıyor; kod uyuşmuyorsa
 * boş dönülür ve kapak zinciri yeni videonun kapağını çözer.
 */
export function posterFromMap(raw: unknown, watchUrl?: string | null): string {
  const entry = posterEntryOf(raw);
  if (!entry.p) return "";
  const code = videoCodeFromUrl(watchUrl);
  // Kaynak kodu bilinmeyen (eski) kayıtlar kullanılır; kod biliyorsak eşleşmeli.
  if (entry.c && code && entry.c !== code) return "";
  return entry.p;
}

/**
 * Kapak adresini ÇALIŞMA ANINDA yeniden çözer.
 *
 * Neden gerekli: sağlayıcının CDN alan adı ve yol öneki dönüyor
 * (`transit-up-1170-i.vmwesa.online/i/01/…` → `box-1659-u.vmbox.space/i/03/…`).
 * Bu yüzden bir gün önce doğru olan adres bugün 404 dönebiliyor. Görsel
 * yüklenemezse bu fonksiyon güncel adresi üretir/okur ve sonucu oturum boyunca
 * `sessionStorage`'da tutar — aynı bölüm için tekrar sorulmaz.
 *
 * Voe ve morencius adresleri koddan türetilir (istek gerekmez); VidMoly adresi
 * embed sayfasından okunur — o sayfa CORS başlığı gönderdiği için tarayıcıdan
 * doğrudan okunabiliyor (bkz. DURUM-RAPORU §26).
 */
export async function resolvePosterForEpisode(watchUrl?: string | null): Promise<string> {
  if (!watchUrl || typeof window === "undefined") return "";
  const code = videoCodeFromUrl(watchUrl);
  if (!code) return "";
  const cacheKey = `shanime:poster:${code}`;
  try {
    const cached = window.sessionStorage.getItem(cacheKey);
    if (cached) return cached;
    const fresh = await posterForWatchUrl(watchUrl, code);
    if (fresh) window.sessionStorage.setItem(cacheKey, fresh);
    return fresh;
  } catch {
    return "";
  }
}

/**
 * Geçerli kapak haritası: dosyadaki tohum + veritabanındaki güncel kayıtlar.
 * Veritabanı kazanır (yeni çözülen kapaklar orada).
 */
export async function loadPosterMap(): Promise<Record<string, unknown>> {
  try {
    const { data } = await db
      .from("site_settings")
      .select("value")
      .eq("key", POSTER_SETTINGS_KEY)
      .maybeSingle();
    const raw = (data?.value as string) ?? "";
    if (!raw) return { ...baked };
    const parsed = JSON.parse(raw) as Record<string, string>;
    return { ...baked, ...parsed };
  } catch {
    return { ...baked };
  }
}

/**
 * KATALOG KAPAĞI — MAL kimliğinden AniList kapak görseli.
 *
 * Anahtar gerektirmez, tarayıcıdan doğrudan çağrılabilir (panel katalog
 * zincirinde bu uç noktayı zaten kullanıyor). `extraLarge` tercih edilir
 * (1400×2000'e kadar); yoksa `large`.
 *
 * Ne zaman işe yarar: serinin/bölümün kapağı sağlayıcıdan ve Türkçe kaynaktan
 * çıkarılamadığında. Özellikle FİLMLERDE — filmin kayıtlı video adresi yoktur,
 * oynatma MAL kimliğiyle varsayılan oynatıcıdan yapılır; dolayısıyla kapağın
 * türetilebileceği başka hiçbir kaynak kalmaz.
 *
 * Tek istek `idMal` iledir: kimliğimiz zaten elimizde olduğu için arama
 * yapılmaz (daha hızlı ve yanlış eşleşme riski yok).
 */
async function catalogCoverForMal(malId: number): Promise<string> {
  if (!Number.isFinite(malId) || malId <= 0) return "";
  try {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "query($id:Int){Media(idMal:$id,type:ANIME){coverImage{extraLarge large color}}}",
        variables: { id: malId },
      }),
    });
    if (!res.ok) return "";
    const json = (await res.json()) as {
      data?: { Media?: { coverImage?: { extraLarge?: string; large?: string } } };
    };
    const image = json.data?.Media?.coverImage;
    return image?.extraLarge || image?.large || "";
  } catch {
    // Ağ hatası: kapak bulunamadı sayılır, zincir biter (uydurma yok).
    return "";
  }
}

/**
 * Kapakları çözer ve sonucu `site_settings`'e yazar.
 *
 * @param force `false` (varsayılan): yalnızca kapağı EKSİK bölümler için istek
 *   atılır — bölüm eklenince otomatik çalışan yol budur, 1 yeni bölüm = 1 istek.
 *   `true`: TÜM bölümler yeniden çözülür. Sağlayıcı CDN adresini değiştirdiğinde
 *   (ör. `transit-up-1170-i` → `1171-e`) eski kayıtlar geçersiz kalır; kapağı
 *   eksik olmayan bölümleri de tazelemek için bu mod gerekir.
 */
export async function syncAllEpisodePosters(force = false): Promise<{
  resolved: number;
  failed: number;
  total: number;
}> {
  const map = await loadPosterMap();
  const next: Record<string, unknown> = force ? {} : { ...map };
  let resolved = 0;
  let failed = 0;
  let total = 0;

  const { data: shows } = await db.from("shows").select("id,slug,mal_id");
  for (const show of (shows ?? []) as {
    id: string;
    slug: string | null;
    mal_id: number | null;
  }[]) {
    if (!show.slug) continue;
    /**
     * Seri başına katalog kapağı önbelleği. `null` = HENÜZ SORULMADI,
     * `""` = soruldu ve bulunamadı. Bu ayrım şart: aksi hâlde kapak
     * bulunamayan seride her bölüm için yeniden istek atılırdı.
     */
    let catalogCover: string | null = null;
    const { data: episodes } = await db
      .from("show_episodes")
      .select("season,number,watch_url")
      .eq("show_id", show.id);

    for (const ep of (episodes ?? []) as {
      season: number;
      number: number;
      watch_url: string | null;
    }[]) {
      total += 1;
      const key = `${show.slug}-s${ep.season}e${ep.number}`;
      const url = ep.watch_url ?? "";
      const code = videoCodeFromUrl(url);
      const entry = posterEntryOf(next[key]);
      // Kayıt bu videonun koduyla çözülmüşse dokunma. Link DEĞİŞTİYSE (kod
      // uyuşmuyorsa) kapak yeniden çözülür — "hep eski kapak kalıyor"
      // sorununun sebebi buydu.
      if (!force && entry.p && (!code || entry.c === code)) continue;

      /**
       * ZİNCİR: (1) sağlayıcının kendi kapağı (VidMoly CDN / Voe karesi / morencius),
       * (2) olmazsa TÜRKÇE KAYNAĞIN kapağı. Kod çıkarılamayan adreslerde (Anizm
       * oynatıcısı) eskiden bölüm doğrudan "başarısız" sayılıyordu; artık kaynaktan
       * kapak denenir. Kaynak kapak da vermezse bölüm kapaksız kalır (uydurulmaz).
       */
      let poster = "";
      if (code) {
        try {
          poster = await posterForWatchUrl(url, code);
        } catch {
          poster = "";
        }
      }
      if (!poster) {
        try {
          poster = await puffyCoverForSeason(show.slug, ep.season);
        } catch {
          poster = "";
        }
      }
      /**
       * (3) KATALOG KAPAĞI — AniList, MAL kimliğiyle. ZİNCİRİN SON HALKASI.
       *
       * ── NEDEN EKLENDİ (kullanıcı, 28.09.2026) ───────────────────────────────
       * "Film kaynağında 'Kapakları güncelle' var … doğru çalışsın."
       *
       * SORUN: zincirin ilk iki halkası da bir VİDEO ADRESİ gerektiriyor.
       *   1) sağlayıcı CDN kapağı → `watch_url`'deki video kodundan türetilir,
       *   2) Türkçe kaynak kapağı → kaynağın kendi dizininden (ör. puffytr).
       * FİLMDE ikisi de boş: film varsayılan oynatıcıyla (MegaPlay) MAL kimliği
       * üzerinden oynuyor, kayıtlı bir `watch_url` YOK. Bu yüzden "Kapakları
       * güncelle" filmi her zaman "başarısız" sayıyor ve kapağı hiç yazamıyordu
       * (ölçüm: `/static/episode-covers/jujutsu-kaisen-0-s1e1.jpg` → 404).
       *
       * ÇÖZÜM: film/dizi ayrımı yapmadan, MAL kimliği olan her seri için AniList
       * kapak görseli kullanılır. MALİYET SINIRLI: istek SERİ BAŞINA BİR KEZ
       * yapılır (`catalogCover` bellekte tutulur), bölüm sayısıyla artmaz.
       */
      if (!poster && show.mal_id) {
        if (catalogCover === null) catalogCover = await catalogCoverForMal(show.mal_id);
        poster = catalogCover;
      }

      if (poster) {
        // `c: code` — kod çıkarılamadıysa BOŞ yazılır: eski kayıtlar gibi "kodu
        // bilinmiyor" sayılır ve geçerli olur; kod varsa tazelik denetimi çalışır.
        next[key] = { p: poster, c: code };
        resolved += 1;
      } else {
        failed += 1;
      }
    }
  }

  // Kayıt her zaman yazılır (yalnızca değişiklik olduğunda değil): böylece ilk
  // çalıştırmada veritabanı satırı oluşur ve site kapakları dosyadan değil
  // veritabanından okumaya başlar. Yazılacak veri küçük (birkaç KB).
  const { error } = await db
    .from("site_settings")
    .upsert({ key: POSTER_SETTINGS_KEY, value: JSON.stringify(next) });
  if (error) throw error;

  return { resolved, failed, total };
}

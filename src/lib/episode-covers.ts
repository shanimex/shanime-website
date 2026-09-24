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

/** Link Voe'ya mı ait? (mirror alan adları döndüğü için `/e/<kod>` biçimi de sayılır.) */
export function isVoeUrl(url: string): boolean {
  try {
    const parsed = new URL(url.split(/[?#]/)[0] ?? "");
    if (VOE_HOSTS.test(parsed.hostname)) return true;
    return /\/e\/[a-z0-9]{6,}$/i.test(parsed.pathname);
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

/** Kapak haritasındaki kayıt: kapak adresi + çözüldüğü video kodu. */
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

  const { data: shows } = await db.from("shows").select("id,slug");
  for (const show of (shows ?? []) as { id: string; slug: string | null }[]) {
    if (!show.slug) continue;
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
      if (!code) {
        failed += 1;
        continue;
      }
      try {
        const poster = await posterForWatchUrl(url, code);
        if (poster) {
          next[key] = { p: poster, c: code };
          resolved += 1;
        } else {
          failed += 1;
        }
      } catch {
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

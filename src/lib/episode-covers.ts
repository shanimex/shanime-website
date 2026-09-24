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
 * Geçerli kapak haritası: dosyadaki tohum + veritabanındaki güncel kayıtlar.
 * Veritabanı kazanır (yeni çözülen kapaklar orada).
 */
export async function loadPosterMap(): Promise<Record<string, string>> {
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
  const next = force ? {} : { ...map };
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
      if (!force && next[key]) continue; // kapak zaten var

      const url = ep.watch_url ?? "";
      const code = videoCodeFromUrl(url);
      if (!code) {
        failed += 1;
        continue;
      }
      try {
        // VidMoly dışındaki sağlayıcılar (eski morencius kayıtları) türetilebilir.
        const poster = /vidmoly/i.test(url)
          ? await fetchVidmolyPoster(code)
          : /morencius/i.test(url)
            ? `https://pixibay.cc/${code}.jpg`
            : "";
        if (poster) {
          next[key] = poster;
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

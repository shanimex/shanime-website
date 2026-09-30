import BAKED_THUMBS from "@/data/episode-thumbs.json";
import BAKED_TMDB from "@/data/mal-tmdb.json";
import { cachedRead } from "@/lib/server-cache";

/**
 * Yayın tarihi önbellek ömrü: 7 gün.
 *
 * NEDEN UZUN: yayın tarihi DEĞİŞMEZ bir veridir (bölüm bir kez yayınlanır).
 * Katalog okumaları (120 sn) gibi taze tutmaya gerek yok; uzun TTL hem
 * upstream'i hem kotayı korur.
 */
export const TTL_AIRDATE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Bölüm kapakları — GERÇEK bölüm görselleri (ani.zip / TVDB).
 *
 * NEDEN AYRI BİR KAYNAK: embed sağlayıcıları (megaplay, vidlink, videasy) bölüm
 * kapağı yayınlamıyor. `episode-posters.json` zinciri de yalnızca VidMoly
 * adreslerinden türetme yapabildiği için sağlayıcı embed'li bölümlerde kart
 * boş kalıyordu ve tek çare seri posteriydi (her bölüm aynı görsel).
 *
 * ÇÖZÜM: `scripts/sync-anizip-covers.mjs` MAL kimliğiyle `api.ani.zip`'ten bölüm
 * bölüm gerçek görseli çekip `src/data/episode-thumbs.json` dosyasına yazar.
 * Görseller `artworks.thetvdb.com` üzerinden geliyor; referer'sız HTTP 200 +
 * `image/jpeg` (hotlink serbest). Veri DERLEME ZAMANINDA dosyaya gömüldüğü için
 * çalışma anında dış istek yapılmaz, sayfa yavaşlamaz.
 *
 * SINIR (dürüstçe): bu, videodan alınmış bir KARE DEĞİLDİR. Cross-origin
 * iframe'in içindeki videodan kare çıkarılamaz; gerçek kare ancak videoyu
 * kendimiz barındırırsak (R2 + kendi oynatıcı) üretilebilir. Amaç, boş/kırık
 * kapak yerine bölüme ait gerçek bir görsel göstermek.
 *
 * Yeni seri ekledikten sonra: `node scripts/sync-anizip-covers.mjs`
 */
const thumbs = BAKED_THUMBS as Record<string, Record<string, string>>;

/**
 * Verilen seri/bölüm için gerçek bölüm kapağı; yoksa boş dizge.
 *
 * Arama sırası:
 *   1. `s<sezon>e<bölüm>` — sezon + bölüm birebir eşleşmesi.
 *   2. `abs<bölüm>`       — mutlak bölüm numarası (sezon bilgisi tutmayan
 *                            serilerde MAL bölüm numarası sezonu yok sayar).
 */
export function anizipCover(
  malId: number | null | undefined,
  season: number,
  episode: number,
): string {
  if (!malId) return "";
  const table = thumbs[String(malId)];
  if (!table) return "";
  return table[`s${season}e${episode}`] ?? table[`abs${episode}`] ?? "";
}

/**
 * TMDB eşlemesi (MAL → TMDB). Aynı ani.zip yanıtından üretilir.
 *
 * NEDEN GEREKLİ: `vidsrc.to` gibi TMDB tabanlı sağlayıcılar şablonlarında TMDB
 * kimliği ister (`/embed/tv/{tmdb}/{sezon}/{bölüm}`). MAL kimliği o şablonlarda
 * işe yaramaz — bu yüzden ayrı bir eşleme tutulur.
 *
 * Örnek (25.09.2026 ölçümü): 40748 → 95479 (Jujutsu Kaisen), 31240 → 65942
 * (Re:Zero), 31043 → 65249 (Erased), 39535 → 94664 (Mushoku Tensei).
 */
const tmdbMap = BAKED_TMDB as Record<string, string>;

/** MAL kimliğine karşılık gelen TMDB kimliği; eşleme yoksa null. */
export function tmdbIdForMal(malId: number | null | undefined): number | null {
  if (!malId) return null;
  const value = Number(tmdbMap[String(malId)]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

type RawAirEpisode = {
  seasonNumber?: unknown;
  episodeNumber?: unknown;
  airDate?: unknown;
};

/**
 * Bir MAL kaydının bölüm yayın tarihleri (`"sezon:bölüm" → "YYYY-MM-DD"`).
 *
 * NEDEN: detay sayfasındaki bölüm kartları yayın tarihi rozeti taşır
 * (referans sitelerdeki gibi). Tarih veritabanında tutulmaz — ani.zip'ten
 * okunup uzun süreli önbelleğe yazılır (değişmez veri). Kayıt/istek başarısız
 * olursa BOŞ döner; kart tarihi atlar, sayfa düşmez.
 */
export async function fetchSeasonAirdates(malId: number): Promise<Record<string, string>> {
  if (!Number.isFinite(malId) || malId <= 0) return {};
  return cachedRead<Record<string, string>>(
    `anizip-airdates:${malId}`,
    TTL_AIRDATE_SECONDS,
    async () => {
      const out: Record<string, string> = {};
      let json: { episodes?: Record<string, RawAirEpisode> };
      try {
        const res = await fetch(`https://api.ani.zip/mappings?mal_id=${malId}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return out;
        json = (await res.json()) as { episodes?: Record<string, RawAirEpisode> };
      } catch {
        return out;
      }
      for (const ep of Object.values(json.episodes ?? {})) {
        const season = Number(ep.seasonNumber ?? NaN);
        const number = Number(ep.episodeNumber ?? NaN);
        const date = typeof ep.airDate === "string" ? ep.airDate.slice(0, 10) : "";
        if (!Number.isFinite(season) || !Number.isFinite(number)) continue;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        out[`${season}:${number}`] = date;
      }
      return out;
    },
  );
}

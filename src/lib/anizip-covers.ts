import BAKED_THUMBS from "@/data/episode-thumbs.json";

/**
 * Bölüm kapakları — GERÇEK bölüm görselleri (ani.zip / TVDB).
 *
 * NEDEN AYRI BİR KAYNAK: embed sağlayıcıları (megaplay, vidlink, videasy) bölüm
 * kapağı yayınlamıyor. `episode-posters.json` zinciri de yalnızca VidMoly/Voe
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

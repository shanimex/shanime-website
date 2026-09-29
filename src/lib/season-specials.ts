/**
 * SEZONUN "0. BÖLÜM"LERİ — ani.zip kataloğundaki `season: 0` (özel/ön bölüm).
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * NEDEN VAR (kullanıcı bildirimi, 29.09.2026, ikinci tur)
 *
 * "İzleme sayfasında 0. bölüm görünmüyor; `/anime/mushoku-tensei/season/2/
 *  episode/0` sessizce **ep 1 içeriğine düşüyor**."
 *
 * SEBEP: izleme sayfası bölüm listesini YALNIZCA `show_episodes` tablosundan
 * okuyordu; ani.zip kataloğu `season: 0` altında "0. Bölüm — Guardian Fitz"
 * verse bile (Mushoku S2) veritabanında satırı OLMADIĞI için ne listede
 * görünüyor ne de doğrudan `episode/0` adresi açılabiliyordu.
 *
 * ÇÖZÜM: özel bölümler KATALOGDAN okunur ve sezon verisine eklenir; DB'de satır
 * olmasa bile listede "0. Bölüm" olarak en üstte durur. Numaralandırma (1..N ya
 * da part aralığı 12..23) DEĞİŞMEZ — özel bölüm `number: 0` ile aralığın
 * DIŞINDA durur, part offset hesabına KATILMAZ.
 *
 * ÖNBELLEK: sonuç `cachedRead` ile saklanır (6 saat). Bu veri BİZİM kataloğumuz
 * değil, dış bir API'nin (ani.zip/TVDB) yanıtıdır ve gün mertebesinde değişir;
 * her sayfa açılışında upstream'e gidilmesi sayfa yükünü yavaşlatırdı (bkz.
 * `lib/server-cache.ts` — dev'de önbellek kapalı, üretimde açık).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { fetchCatalogEpisodes } from "@/lib/admin-anizip";
import { cachedRead } from "@/lib/server-cache";

/** İzleme sayfasında gösterilen özel/ön bölüm. */
export type SeasonSpecial = {
  /**
   * HER ZAMAN `0` — özel bölümün sezon içi numarası budur ve 1..N aralığının
   * DIŞINDA kalır (numaralandırmayı kaydırmaz).
   */
  number: 0;
  /** Katalogdaki gerçek (sezon-içi) numara; bilgi amaçlı taşınır (ör. 2). */
  catalogNumber: number;
  /** Bölüm adı (katalogdan; ör. "Guardian Fitz"). */
  title: string;
  /** Katalog görseli (varsa); kapak zincirinin ilk adayı olur. */
  image: string;
  /** Kararlı listeleme kimliği (veritabanı satırı YOK — sentetiktir). */
  id: string;
};

/**
 * Özel bölümlerin önbellek süresi: 6 saat.
 *
 * NEDEN 6 SAAT: bu veri dış API'den (ani.zip) gelir, sezon içinde değişmez ve
 * yalnızca katalog düzeltildiğinde güncellenir. Kısa TTL her izleme sayfası
 * açılışını upstream'e bağlardı; 6 saat, sayfa yükünü önbellekten karşılarken
 * düzeltmelerin aynı gün görünmesini sağlar.
 */
export const TTL_SPECIALS_SECONDS = 6 * 60 * 60;

/**
 * Bir MAL kaydının kataloğundan ÖZEL bölümleri (ani.zip `season: 0`) çeker.
 *
 * HATALAR YUTULUR: ani.zip 404/ağ hatası verirse `[]` döner — izleme sayfası
 * ASLA bu yüzden düşmez (özel bölüm göstermemek, sayfayı kaybetmekten iyidir).
 * Sonuç önbelleğe YALNIZCA başarılıysa yazılır (`cachedRead` sözleşmesi).
 *
 * @param malId Sezonun KENDİ MAL kimliği (`show_seasons.mal_id`); yoksa serinin
 *        kimliği (`shows.mal_id`) çağıran tarafından verilir.
 */
export async function fetchSeasonSpecials(malId: number): Promise<SeasonSpecial[]> {
  if (!Number.isFinite(malId) || malId <= 0) return [];
  return cachedRead(`season-specials:${malId}`, TTL_SPECIALS_SECONDS, async () => {
    try {
      const catalog = await fetchCatalogEpisodes(malId);
      return catalog
        .filter((episode) => episode.season === 0)
        .sort((a, b) => a.number - b.number)
        .map((episode) => ({
          number: 0 as const,
          catalogNumber: episode.number,
          title: episode.title,
          image: episode.image,
          id: `special-${malId}-${episode.number}`,
        }));
    } catch {
      // 404 / ağ hatası: özel bölüm yokmuş gibi davran (sayfa bozulmaz).
      return [];
    }
  });
}

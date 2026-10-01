/**
 * SEZONUN "0. BÖLÜM"LERİ — ani.zip kataloğundaki `season: 0` (özel/ön bölüm).
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * NEDEN VAR  ·  İLK SÜRÜMÜN HATASI  ·  DOĞRU KURAL (30.09.2026)
 *
 * İLK SÜRÜM (29.09.2026): katalogdan gelen `season: 0` kayıtları doğrudan
 * listeye "0. Bölüm" olarak EKLENİYORDU; veritabanında satırı OLMAYA BİLİRDİ.
 * Amaç, "episode/0 sessizce ep 1'e düşüyor" şikâyetini gidermekti (Mushoku S2
 * "Guardian Fitz").
 *
 * ── ÖLÇÜLEN HATA (kullanıcı bildirimi, 30.09.2026) ──────────────────────────
 * "Re:Zero'yu eklerken bir sürü 0. bölüm vardı; hiçbirini seçmeden yalnızca 0
 *  OLMAYAN bölümleri yükledim. Ama oynatıcı sayfasında neden o eklemediğim
 *  bölümler var? Kaynakları da yok ki."
 *
 * Sebep: ani.zip kataloğu Re:Zero S2 (MAL 42203) için `season: 0` altında 12 adet
 * "Re:Zero - Starting Break Time from Zero" kaydı döndürüyor. Bunlar veritabanında
 * KARŞILIĞI OLMADIĞI hâlde listeye sentetik "0. Bölüm" olarak ekleniyordu —
 * hiçbiri oynatılamıyordu (kaynak yok).
 *
 * ── DOĞRU KURAL ─────────────────────────────────────────────────────────────
 * Bir "0. Bölüm" listede YALNIZCA şu iki koşul BİRLİKTE sağlanırsa görünür:
 *   (a) `show_episodes`ta o sezona ait `number = 0` satırı VAR, ve
 *   (b) o satırın en az bir KAYNAĞI var (`episode_sources`).
 * Aksi hâlde HİÇ görünmez. Yani KATALOG TEK BAŞINA satır ÜRETMEZ.
 *
 * Bu dosya artık YALNIZCA bir "katalog eşleştirme" yardımcısıdır: veritabanında
 * KARŞILIĞI OLAN özel bölümün başlığını katalogla doğrular. SENTETİK KAYIT
 * ÜRETMEZ. (Katalog GÖRSELİ bilinçli olarak kullanılmaz: kapak sistemi bu
 * değişikliğin kapsamı DIŞINDADIR — TVDB-tek kapak akışına dokunulmaz.)
 *
 * ÖNBELLEK: sonuç `cachedRead` ile saklanır (6 saat). Bu veri BİZİM
 * kataloğumuz değil, dış bir API'nin (ani.zip/TVDB) yanıtıdır ve gün mertebesinde
 * değişir (bkz. `lib/server-cache.ts`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { fetchCatalogEpisodes } from "@/lib/admin-anizip";
import { cachedRead } from "@/lib/server-cache";

/** ani.zip kataloğundaki tek bir özel/ön bölüm kaydı. */
export type CatalogSpecial = {
  /** Katalogdaki gerçek (sezon-içi) numara; bilgi amaçlı (ör. 43). */
  catalogNumber: number;
  /** Katalog başlığı (ör. "Guardian Fitz"). */
  title: string;
  /**
   * Katalog görseli (varsa). NOT: kapak akışı bu değişikliğin KAPSAMI DIŞINDA
   * olduğu için (TVDB-tek kapak politikası) BURADAN KAPAK ÜRETİLMEZ.
   */
  image: string;
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
 * ⚠️ ARTIK SENTETİK SATIR ÜRETİLMEZ. Dönen liste yalnızca veritabanında
 * KARŞILIĞI OLAN özel bölümü eşleştirmek için kullanılır; çağıran taraf
 * (`lib/content.ts`) her kaydı bir DB satırıyla eşleştirmedikçe listeye HİÇBİR
 * ŞEY eklemez (bkz. `matchCatalogSpecial`).
 *
 * HATALAR YUTULUR: ani.zip 404/ağ hatası verirse `[]` döner — izleme sayfası
 * ASLA bu yüzden düşmez. Sonuç önbelleğe YALNIZCA başarılıysa yazılır
 * (`cachedRead` sözleşmesi).
 *
 * @param malId Sezonun KENDİ MAL kimliği (`show_seasons.mal_id`); yoksa serinin
 *        kimliği (`shows.mal_id`) çağıran tarafından verilir.
 */
export async function fetchSeasonSpecials(malId: number): Promise<CatalogSpecial[]> {
  if (!Number.isFinite(malId) || malId <= 0) return [];
  return cachedRead(`season-specials:${malId}`, TTL_SPECIALS_SECONDS, async () => {
    try {
      const catalog = await fetchCatalogEpisodes(malId);
      return catalog
        .filter((episode) => episode.season === 0)
        .sort((a, b) => a.number - b.number)
        .map((episode) => ({
          catalogNumber: episode.number,
          title: episode.title,
          image: episode.image,
        }));
    } catch {
      // 404 / ağ hatası: özel bölüm yokmuş gibi davran (sayfa bozulmaz).
      return [];
    }
  });
}

/**
 * Katalog kaydını veritabanındaki ÖZEL bölümle EŞLEŞTİRİR.
 *
 * EŞLEŞME ÖLÇÜTÜ: başlık (Türkçe küçük/büyük harf duyarsız, kırpılmış) BİREBİR
 * eşitliği. NUMARA ile eşleştirme GÜVENİLMEZ (katalog numarası sezon-içi, DB
 * satırının numarası ise her zaman `0`) — bu yüzden yalnızca başlık esas alınır.
 * Güvenilir eşleşme YOKSA `null` döner ve çağıran taraf DB satırındaki başlığı
 * KULLANIR (katalog başlığı zorla yazılmaz).
 */
export function matchCatalogSpecial(
  dbTitle: string | null | undefined,
  catalog: CatalogSpecial[],
): CatalogSpecial | null {
  const name = (dbTitle ?? "").trim().toLocaleLowerCase("tr");
  if (!name) return null;
  return (
    catalog.find((special) => (special.title ?? "").trim().toLocaleLowerCase("tr") === name) ?? null
  );
}

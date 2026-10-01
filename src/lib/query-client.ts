import { QueryClient } from "@tanstack/react-query";

/**
 * Sorgu tazelik süreleri — TEK KAYNAK.
 *
 * NEDEN VAR (kota/egress): site şu ana kadar her sayfa görüntülemesinde Supabase'e
 * yeniden okuma atıyordu. `new QueryClient()` varsayılanı `staleTime: 0`dır; yani
 * veri bellekte duruyorken bile her yeniden çizim, her sekme odağı ve sayfadan
 * çıkıp geri dönüş sorguyu tekrar çalıştırıyordu. Binlerce seri barındırılacak
 * sitede bu doğrudan kotayı yakıyor. Bu yüzden tazelik dakika mertebesine çekildi.
 *
 * SEÇİLEN DEĞERLER VE SEBEBİ:
 *   · `QUERY_STALE_MS` = 5 dk — panelden yapılan bir düzenlemenin (yeni bölüm,
 *     kapak, reklam kodu, seri bilgisi) sitede görünmesi için en kötü gecikme.
 *     Daha uzun tutmak paneli "kaydettim ama değişmedi" durumuna düşürürdü
 *     (admin bu verileri sık düzenliyor); daha kısa tutmak kazancı azaltırdı.
 *     5 dk, tazelik ile kota arasındaki dengedir.
 *   · `QUERY_GC_MS` = 30 dk — sayfalar arasında gezinip geri dönüldüğünde
 *     önbelleğin bellekte kalma süresi. Bu süre içinde geri dönüş YENİ okuma
 *     yapmaz; ziyaretçinin tipik oturumundan uzun olduğu için sayfa gezintisi
 *     boyunca okuma sayısı sabit kalır.
 *
 * DİKKAT: bu değerleri düşürmek doğrudan okuma (egress) sayısını artırır.
 */
export const QUERY_STALE_MS = 5 * 60_000; // 5 dakika
const QUERY_GC_MS = 30 * 60_000; // 30 dakika

/**
 * Uygulamanın TEK `QueryClient`ı (bkz. `src/router.tsx`).
 *
 * `refetchOnWindowFocus: false` NEDEN: varsayılan `true` iken sekme her öne
 * geldiğinde React Query aktif TÜM sorguları tazeliyordu — seri listesi, son
 * bölümler, reklam kodları, seri detayı. Ziyaretçi sekmeyi 10 kez öne getirirse
 * 10 kez veritabanı okuması oluyordu. Veri zaten `QUERY_STALE_MS` boyunca taze
 * sayıldığı için bu tazeleme boşa okuma demekti.
 * `refetchOnReconnect` de aynı sebeple kapalıdır: kopan bağlantı geri geldiğinde
 * tüm sorguların topluca tazelenmesi sınırlı kotada istenmeyen bir yüktür.
 * `retry: 1` — hatalı okuma varsayılanda 3 kez daha deneniyordu (tek hata = 4
 * okuma). Tek deneme, geçici ağ hatalarını yine tolere ederken kotayı korur.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_MS,
        gcTime: QUERY_GC_MS,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 1,
      },
    },
  });
}

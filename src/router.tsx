import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { createQueryClient, QUERY_STALE_MS } from "./lib/query-client";

export const getRouter = () => {
  // Önbellek varsayılanları tek yerde: bkz. lib/query-client.ts.
  // (Eskiden `new QueryClient()` çıplak kuruluyordu → `staleTime: 0` → her
  // görüntülemede Supabase'e yeniden okuma.)
  const queryClient = createQueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // NEDEN SIFIR DEĞİL (kota/egress): `0`, önden çekilen (preload) rota verisini
    // ANINDA bayat sayar; yani önden çekme bir okuma yapar, tıklamada rota
    // yükleyicisi AYNI veriyi bir daha okur — kota iki kez yanar. Değer React
    // Query tazelik penceresiyle hizalandı (bkz. lib/query-client.ts →
    // QUERY_STALE_MS). NOT: rota önden çekme (`defaultPreload`) bugün KAPALI
    // olduğu için bu ayar şu an yalnızca emniyet kemeridir. `defaultPreload`
    // AÇILMAMALIDIR: her hover o rotanın yükleyicisini yani bir okumayı tetikler
    // ve tıklanmayan kartlar için okuma boşa gider (sunucu tarafı paylaşımlı
    // önbellek kurulmadan okuma sayısını artırır).
    defaultPreloadStaleTime: QUERY_STALE_MS,
  });

  return router;
};

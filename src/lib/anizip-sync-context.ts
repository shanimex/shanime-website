/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KATALOG PANELİ — UYGULAMA DÜZEYİ CONTEXT (store kayıt defteri köprüsü)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * NEDEN AYRI DOSYA: React Context nesnesini ve onu tüketen kancayı sağlar; PROVIDER
 * bileşeni (`components/admin/AnizipSyncProvider.tsx`) yalnızca bileşen dışa
 * aktarsın (react-refresh kuralı) diye context buraya ayrıldı.
 *
 * NEDEN VAR (kullanıcı şikâyeti, 30.09.2026): iş durumu panel bileşeninin İÇİNDE
 * tutulduğu için panel kapanınca sıfırlanıyordu. Durum artık
 * `lib/anizip-sync-store.ts` içindeki MODÜL DÜZEYİ store'da `show + sezon`
 * anahtarıyla yaşar. Bu context, o store kayıt defterini React ağacına bağlar:
 * hem katalog paneli hem üst panel (SeasonsPanel) AYNI sezon için AYNI store
 * örneğini kullanır → ilerleme iki tarafta da tutarlı.
 *
 * Provider yoksa kanca modül store'una düşer (davranış aynı).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createContext, useContext, useMemo } from "react";
import {
  anizipStoreKey,
  getOrCreateStore,
  type AnizipSyncState,
  type AnizipSyncStore,
} from "@/lib/anizip-sync-store";

export type AnizipSyncRegistry = {
  getStore: (showId: string, season: number, factory: () => AnizipSyncState) => AnizipSyncStore;
};

export const AnizipSyncContext = createContext<AnizipSyncRegistry | null>(null);

/** Bu seri+sezon için kalıcı store — provider varsa ondan, yoksa modül store'undan. */
export function useAnizipSyncStore(
  showId: string,
  season: number,
  factory: () => AnizipSyncState,
): AnizipSyncStore {
  const registry = useContext(AnizipSyncContext);
  // `factory` bağımlılıkta: her render yeni bir işlev olsa da `getOrCreateStore`
  // anahtar başına TEK örnek döndürdüğü için elde edilen store kimliği KARARLIDIR
  // (sonsuz çizim olmaz). Yalnızca ilk oluşturmada çağrılır.
  return useMemo(
    () =>
      registry
        ? registry.getStore(showId, season, factory)
        : getOrCreateStore(anizipStoreKey(showId, season), factory),
    [registry, showId, season, factory],
  );
}

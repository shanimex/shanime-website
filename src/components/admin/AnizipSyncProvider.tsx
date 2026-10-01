/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * KATALOG PANELİ — UYGULAMA DÜZEYİ PROVIDER (store kayıt defteri)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * NEDEN VAR (kullanıcı şikâyeti, 30.09.2026): katalog yazma/çekme işinin durumu
 * panel bileşeninin İÇİNDE tutulduğu için panel kapanınca sıfırlanıyordu. İş artık
 * `lib/anizip-sync-store.ts` içindeki MODÜL DÜZEYİ store'da yaşar. Bu provider, o
 * store kayıt defterini uygulama düzeyinde bir React context'ine bağlar: hem panel
 * hem üst panel (SeasonsPanel) AYNI sezon için AYNI store örneğini kullanır, böylece
 * ilerleme iki tarafta da tutarlı olur.
 *
 * Provider yoksa kancalar (`lib/anizip-sync-context.ts`) modül store'una düşer —
 * davranış aynıdır; bu katman açık ve tek noktadan yönetilebilir olsun diye var.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { useMemo, type ReactNode } from "react";
import { anizipStoreKey, getOrCreateStore, type AnizipSyncState } from "@/lib/anizip-sync-store";
import { AnizipSyncContext, type AnizipSyncRegistry } from "@/lib/anizip-sync-context";

export function AnizipSyncProvider({ children }: { children: ReactNode }) {
  const value = useMemo<AnizipSyncRegistry>(
    () => ({
      getStore: (showId: string, season: number, factory: () => AnizipSyncState) =>
        getOrCreateStore(anizipStoreKey(showId, season), factory),
    }),
    [],
  );
  return <AnizipSyncContext.Provider value={value}>{children}</AnizipSyncContext.Provider>;
}

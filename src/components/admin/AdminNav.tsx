/** Admin navigation shows one selected section on every screen size. */
import { Activity, Clapperboard, Film, LayoutList } from "lucide-react";

/** Bölüm kimlikleri — `admin.tsx` bölümlerinin `id`'leriyle BİREBİR aynı. */
export const ADMIN_VIEWS = ["panel-series", "panel-movies", "panel-ads", "panel-health"] as const;
export type AdminView = (typeof ADMIN_VIEWS)[number];

const ITEMS: ReadonlyArray<{
  id: AdminView;
  label: string;
  Icon: typeof LayoutList;
}> = [
  { id: "panel-series", label: "Diziler", Icon: LayoutList },
  { id: "panel-movies", label: "Filmler", Icon: Film },
  { id: "panel-ads", label: "Reklamlar", Icon: Clapperboard },
  { id: "panel-health", label: "Sağlık", Icon: Activity },
];

/** Desktop sidebar uses the same section state as the mobile tabs. */
export function AdminSidebar({
  view,
  onChange,
}: {
  view: AdminView;
  onChange: (view: AdminView) => void;
}) {
  return (
    <nav aria-label="Panel bölümleri" className="sticky top-24 hidden self-start md:block">
      <div className="flex w-44 flex-col gap-1 rounded-2xl border border-border bg-card p-2">
        {ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-current={view === id ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-secondary hover:text-foreground ${view === id ? "bg-secondary text-primary" : "text-muted-foreground"}`}
          >
            <Icon size={16} aria-hidden="true" className="shrink-0" />
            {label}
          </button>
        ))}
      </div>
    </nav>
  );
}

/**
 * Mobil alt sekme: `md` ve üstünde gizlidir.
 *
 * Artık AKTİF DURUM kaydırmadan türetilmez: kullanıcı hangi sekmeye bastıysa
 * `view` odur (tek kaynak, sade). Aktif öğe site tarafındaki `MobileTabBar` ile
 * aynı dilde: `text-primary` + `aria-current="page"`.
 */
export function AdminTabBar({
  view,
  onChange,
}: {
  view: AdminView;
  onChange: (view: AdminView) => void;
}) {
  return (
    <nav
      aria-label="Panel bölümleri"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-stretch">
        {ITEMS.map(({ id, label, Icon }) => {
          const on = view === id;
          return (
            <button
              key={id}
              type="button"
              aria-current={on ? "page" : undefined}
              onClick={() => onChange(id)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 font-sans text-[10px] font-bold transition-colors ${
                on ? "text-primary" : "text-muted-foreground active:text-primary"
              }`}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

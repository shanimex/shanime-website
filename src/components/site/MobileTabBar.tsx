/**
 * Mobil alt sekme çubuğu (02.10.2026, referans hissi).
 *
 * YALNIZCA telefonda görünür (`md:hidden`): ANA SAYFA / ARA / TAKVİM.
 *   · ANA SAYFA → `/` (aktifken vurgulu).
 *   · ARA → başlıktaki aramayı açar (olayla; `SiteHeader` dinler). Her sayfada çalışır.
 *   · TAKVİM → ana sayfadaki yayın takvimi paneline kaydırır (`#schedule`).
 *
 * `/admin` ve `/auth` ekranlarında ÇİZİLMEZ (yönetim/giriş akışını örtmesin).
 */
import { Link } from "@tanstack/react-router";
import { CalendarDays, House, Search } from "lucide-react";

import { useLang } from "@/lib/i18n";

export const MOBILE_TABBAR_EVENT = "shanime:open-search";

export function MobileTabBar({ pathname }: { pathname: string }) {
  const { t } = useLang();
  const isHome = pathname === "/";
  const item =
    "flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-bold transition-colors";
  const idle = "text-muted-foreground";
  const active = "text-primary";
  return (
    <nav
      aria-label={t("common.mainNav")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-stretch">
        <Link
          to="/"
          aria-current={isHome ? "page" : undefined}
          className={`${item} ${isHome ? active : idle}`}
        >
          <House size={20} aria-hidden="true" />
          <span>{t("common.home")}</span>
        </Link>
        <button
          type="button"
          aria-label={t("common.search")}
          onClick={() => window.dispatchEvent(new CustomEvent(MOBILE_TABBAR_EVENT))}
          className={`${item} ${idle}`}
        >
          <Search size={20} aria-hidden="true" />
          <span>{t("common.searchTab")}</span>
        </button>
        <Link to="/" hash="schedule" className={`${item} ${idle}`}>
          <CalendarDays size={20} aria-hidden="true" />
          <span>{t("common.schedule")}</span>
        </Link>
      </div>
    </nav>
  );
}

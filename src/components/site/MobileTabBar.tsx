/**
 * Mobil alt sekme çubuğu (02.10.2026, referans hissi).
 *
 * YALNIZCA telefonda görünür (`md:hidden`): ANA SAYFA / DİZİLER / TAKVİM.
 * Ortada ARAMA YOKTUR (bilerek): arama zaten başlık şeridinde duruyor,
 * ikinci bir arama düğmesi kafa karıştırıyordu.
 *
 * `/admin` ve `/auth` ekranlarında ÇİZİLMEZ (yönetim/giriş akışını örtmesin).
 */
import { Link } from "@tanstack/react-router";
import { CalendarDays, House, LayoutGrid } from "lucide-react";

import { useLang } from "@/lib/i18n";

export function MobileTabBar({ pathname }: { pathname: string }) {
  const { t } = useLang();
  const item =
    "flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-bold transition-colors";
  const idle = "text-muted-foreground";
  const active = "text-primary";
  const on = (path: string) => pathname === path || (path !== "/" && pathname.startsWith(path));
  return (
    <nav
      aria-label={t("common.mainNav")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur md:hidden"
      /* Yazı tipi açıklama yazısıyla AYNI (kullanıcı isteği): Manrope. */
      style={{
        paddingBottom: "env(safe-area-inset-bottom)",
        fontFamily: '"Manrope", var(--font-sans)',
      }}
    >
      <div className="flex items-stretch">
        <Link
          to="/"
          aria-current={on("/") ? "page" : undefined}
          className={`${item} ${on("/") ? active : idle}`}
        >
          <House size={18} aria-hidden="true" />
          <span>{t("common.home")}</span>
        </Link>
        <Link
          to="/animes"
          aria-current={on("/animes") ? "page" : undefined}
          className={`${item} ${on("/animes") ? active : idle}`}
        >
          <LayoutGrid size={18} aria-hidden="true" />
          <span>{t("common.series")}</span>
        </Link>
        <Link
          to="/schedule"
          aria-current={on("/schedule") ? "page" : undefined}
          className={`${item} ${on("/schedule") ? active : idle}`}
        >
          <CalendarDays size={18} aria-hidden="true" />
          <span>{t("common.schedule")}</span>
        </Link>
      </div>
    </nav>
  );
}

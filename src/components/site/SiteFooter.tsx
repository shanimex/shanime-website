/** Ana sayfanın düşük profilli, tek satırlık alt bilgi çubuğu. */
import { Link } from "@tanstack/react-router";

import {
  BRAND_FOOTER_LOGO_HEIGHT,
  BRAND_FOOTER_LOGO_SRC,
  BRAND_FOOTER_LOGO_WIDTH,
} from "@/lib/brand";
import { useLang } from "@/lib/i18n";

export function SiteFooter() {
  const { t } = useLang();

  return (
    <footer className="site-footer">
      <div className="site-footer-shell mx-auto flex min-h-[116px] w-full max-w-[1360px] flex-col gap-5 px-4 py-7 sm:flex-row sm:items-center sm:gap-6 sm:px-4">
        <div className="site-footer-brand flex shrink-0 flex-col items-start border-r border-[#2b3138] pr-6">
          <Link to="/" aria-label={t("common.homeAria")} className="inline-flex">
            <img
              src={BRAND_FOOTER_LOGO_SRC}
              alt={t("common.logoAlt")}
              width={BRAND_FOOTER_LOGO_WIDTH}
              height={BRAND_FOOTER_LOGO_HEIGHT}
              loading="lazy"
              decoding="async"
              className="h-auto w-[8.5rem] object-contain object-center"
            />
          </Link>
          <p className="site-footer-copyright mt-2 text-xs leading-4 text-[#858b95]">
            {t("footer.copyright")}
          </p>
        </div>
        <p className="site-footer-copy max-w-[420px] flex-1 text-center text-sm leading-6 text-[#b4b4bc] sm:text-left">
          {t("footer.updatedCopy")}
        </p>
        <nav
          aria-label={t("footer.siteInfo")}
          className="site-footer-nav ml-auto flex shrink-0 items-center gap-6 text-sm text-[#b4b4bc]"
        >
          <Link to="/about" className="link-hover">
            {t("footer.about")}
          </Link>
          <Link to="/terms" className="link-hover">
            {t("footer.terms")}
          </Link>
          <Link to="/contact" className="link-hover">
            {t("footer.contact")}
          </Link>
        </nav>
      </div>
    </footer>
  );
}

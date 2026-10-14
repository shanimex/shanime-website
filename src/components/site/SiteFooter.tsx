/**
 * Ana sayfanın sade alt alanı.
 *
 * A-Z ve sezon filtreleri artık katalog ekranında (`/animes`) tutulur; ana
 * sayfa yalnızca keşif akışını ve hafif bir footer'ı gösterir.
 */
import { Link } from "@tanstack/react-router";

import { PAGE_CONTAINER } from "@/components/home/homeClass";
import { BRAND_LOGO_HEIGHT, BRAND_LOGO_SRC, BRAND_LOGO_WIDTH } from "@/lib/brand";
import { useLang } from "@/lib/i18n";

export function SiteFooter() {
  const { t } = useLang();

  return (
    <footer className="border-t border-border bg-secondary text-foreground">
      <div className={`${PAGE_CONTAINER} grid gap-10 py-12 md:grid-cols-2`}>
        <div>
          <Link to="/" aria-label={t("common.homeAria")} className="inline-flex">
            <img
              src={BRAND_LOGO_SRC}
              alt={t("common.logoAlt")}
              width={BRAND_LOGO_WIDTH}
              height={BRAND_LOGO_HEIGHT}
              loading="lazy"
              decoding="async"
              className="h-12 w-auto object-contain"
            />
          </Link>
          <p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">
            {t("footer.tagline")}
          </p>
        </div>
        <div>
          <p className="text-sm font-extrabold">{t("footer.explore")}</p>
          <div className="mt-4 flex flex-col gap-1 text-sm text-muted-foreground">
            <Link to="/animes" className="link-hover w-fit py-2">
              {t("common.explore")}
            </Link>
            <Link to="/animes" className="link-hover w-fit py-2">
              {t("footer.allSeries")}
            </Link>
            <Link to="/animes" className="link-hover w-fit py-2">
              {t("footer.genres")}
            </Link>
          </div>
        </div>
      </div>
      <div className="border-t border-border px-5 py-5 text-center text-xs text-muted-foreground">
        {t("footer.copyright")}
      </div>
    </footer>
  );
}

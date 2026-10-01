/**
 * Vitrin başlığı bileşeni (index.tsx'ten bölündü, 01.10.2026).
 *
 * Saf yardımcılar `src/lib/home-static.ts` içindedir (react-refresh kuralı:
 * bileşenle sabit aynı dosyada olmaz). Davranış birebir aynıdır.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { useLang } from "@/lib/i18n";
import { LOGO_NEEDS_OUTLINE, LOGO_RESOLVED, logoCandidates } from "@/lib/home-static";

/** Vitrin başlığı: manifest'teki ilk uygun logo → yoksa düz yazı. */
export function ShowLogo({
  slug,
  title,
  className,
}: {
  slug?: string | null;
  title: string;
  className?: string;
}) {
  const { t } = useLang();
  // Sıra tek yerde tutulur, seri listesi tutulmaz. Yalnızca MANİFEST'teki yollar
  // döner; var olmayan bir uzantı hiç istenmez.
  const sources = useMemo(() => logoCandidates(slug), [slug]);
  // Kaçıncı kaynakta olduğumuz: 0 = ilk mevcut logo, sonrası sıradaki; kaynak
  // kalmayınca düz yazı başlık çizilir.
  // Daha önce bulunmuşsa doğrudan oradan başlanır; boşa istek gitmez.
  const [step, setStep] = useState(() => {
    const known = slug ? LOGO_RESOLVED.get(slug) : undefined;
    const index = known ? sources.indexOf(known) : -1;
    return index > 0 ? index : 0;
  });

  const source = sources[step];
  const imgRef = useRef<HTMLImageElement>(null);
  // SSR'da sunucu HTML'e ilk kaynağı koyar. O dosya yoksa tarayıcı hatayı React
  // hidrasyondan ÖNCE alır ve `onError` hiç çalışmaz → kaynak değişiminde durum
  // elle de kontrol edilir.
  useEffect(() => {
    const node = imgRef.current;
    if (node && node.complete && node.naturalWidth === 0) {
      setStep((value) => value + 1);
    }
  }, [source]);

  if (!source) {
    // Logosu olmayan seri: beyaz, kalın ve gölgeli düz yazı başlık.
    return <span className="hero-title">{title.toLocaleUpperCase("tr")}</span>;
  }
  return (
    <img
      // Kaynak değişince <img> yeniden kurulsun; yoksa tarayıcı hatayı taşır.
      key={source}
      ref={imgRef}
      src={source}
      alt={t("home.logoAlt", { title })}
      width={800}
      height={187}
      loading="eager"
      decoding="async"
      onLoad={() => {
        if (slug) LOGO_RESOLVED.set(slug, source);
      }}
      onError={() => setStep((value) => value + 1)}
      className={`${className ?? ""}${
        slug && LOGO_NEEDS_OUTLINE.has(slug) ? " hero-logo--outline" : ""
      }`}
    />
  );
}

/**
 * Plasmic Studio sürükle-bırak kartı (02.10.2026).
 *
 * NEDEN AYRI BİLEŞEN (mevcut `SeriesCard` doğrudan olmaz):
 *   · `SeriesCard` TanStack `Link` + `useLang` ister — Studio önizlemesinde
 *     router/i18n bağlamı yoktur, çökerdi.
 *   · Bu kart sade desteksiz `<a>` + düz metin kullanır; Studio'da ve sitede
 *     aynı görünür. Ölçü sınıfları `SeriesCard` ile birebir aynıdır.
 */
export function PlasmicAnimeCard({
  title,
  image,
  subtitle,
  slug,
}: {
  title: string;
  image: string;
  subtitle: string;
  slug: string;
}) {
  const cardClassName =
    "group card-hover relative block overflow-hidden rounded-2xl bg-card shadow-2xl";
  const body = (
    <>
      <div className="aspect-[5/7] overflow-hidden bg-muted">
        <img
          src={image}
          alt={title}
          width={768}
          height={1152}
          loading="lazy"
          className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
        />
      </div>
      <div className="px-3 pt-3 pb-2.5">
        <h3 className="truncate text-[16px] font-medium leading-5 text-foreground">{title}</h3>
        <p className="mt-1 line-clamp-2 text-[13.5px] leading-[18px] text-muted-foreground">
          {subtitle}
        </p>
      </div>
    </>
  );
  if (!slug.trim()) return <a className={cardClassName}>{body}</a>;
  return (
    <a href={`/anime/${slug.trim()}`} className={cardClassName}>
      {body}
    </a>
  );
}

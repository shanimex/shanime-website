// BU DOSYA YALNIZCA ESKİ/SEO BAĞLANTILARI İÇİNDİR.
//
// Yeni adres yapısında izleme sayfası `/anime/<slug>/season/<n>/episode/<n>` olur.
// Burada yalnızca ESKİ adresler, kaybolmasın diye yeni yapıya yönlendirilir:
//   · `/izle/<slug>?sezon=<n>&b=<e>`  →  `/anime/<slug>/season/<n>/episode/<e>`
//   · `/izle/<slug>` (parametresiz)   →  `/anime/<slug>` (seri detayı)
// `kaynak` sorgu parametresi KORUNUR: kaynak seçimi AYNI bölümün bir varyantıdır
// (yolun parçası değildir), bu yüzden hedef adreste sorgu parametresi olarak kalır.
// Eski bağlantılar bugün arama motoru indekslerinde, paylaşılmış adreslerde ve
// yer imlerinde yaşıyor; bu yönlendirme olmadan hepsi 404 olurdu.
//
// MEKANİZMA: `beforeLoad` + `redirect` (arayüz bileşeni YOK). Tek adımlı yönlendirme
// sunucuda (SSR) da çalışır, tarayıcıya hiçbir zaman eski adresin sayfası çizilmez ve
// istemciye ekstra bileşen/JS yüklenmez.
import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `?kaynak=` için izinli değerler — izleme sayfasındaki doğrulamanın AYNISI.
 * Yönlendirme hedefi bu değerleri olduğu gibi taşır; değer ayrıca izleme sayfasında
 * bir kez daha doğrulanır (`validateSearch`), yani burada liste daraltılmaz.
 */
type WatchSource = "megaplay" | "vidsrc" | "videasy" | "anizm";

type LegacyWatchSearch = {
  sezon?: number | undefined;
  b?: number | undefined;
  kaynak?: WatchSource | undefined;
};

/** Sorgu parametresini pozitif tam sayıya çevirir; geçersizse `undefined` döner. */
function toPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

/** `kaynak` değerini bilinen sağlayıcılarla sınırlar; başka her şey yok sayılır. */
function toWatchSource(value: unknown): WatchSource | undefined {
  return value === "megaplay" || value === "vidsrc" || value === "videasy" || value === "anizm"
    ? value
    : undefined;
}

export const Route = createFileRoute("/izle/$slug")({
  validateSearch: (search: Record<string, unknown>): LegacyWatchSearch => ({
    sezon: toPositiveInt(search["sezon"]),
    b: toPositiveInt(search["b"]),
    kaynak: toWatchSource(search["kaynak"]),
  }),
  beforeLoad: ({ params, search }) => {
    // `kaynak` yalnızca VARSA taşınır: yoksa hedef adres sorgu dizesiz/temiz kalır.
    const keepSource = search.kaynak !== undefined ? { search: { kaynak: search.kaynak } } : {};
    // Sezon VE bölüm birlikte varsa izleme sayfasına gidilir.
    if (search.sezon !== undefined && search.b !== undefined) {
      throw redirect({
        to: "/anime/$slug/season/$season/episode/$episode",
        params: {
          slug: params.slug,
          season: String(search.sezon),
          episode: String(search.b),
        },
        ...keepSource,
      });
    }
    // Sezon/bölüm yoksa (ya da yalnızca biri verilmişse) seri detayına düşülür:
    // hangi bölümün açılacağı belirsizken yanlış bölüm uydurulmaz.
    throw redirect({ to: "/anime/$slug", params: { slug: params.slug }, ...keepSource });
  },
});

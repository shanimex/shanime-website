/**
 * Bölüm yayın tarihi biçimlendirme.
 *
 * NEDEN AYRI DOSYA: bu fonksiyon eskiden `components/site/EpisodeCard.tsx` içinde
 * yaşıyordu ve oradan dışa aktarılıyordu. Bir bileşen dosyasının bileşen DIŞINDA
 * bir şey dışa aktarması React Fast Refresh'i bozar (`react-refresh/only-export-components`
 * uyarısı) ve geliştirme sunucusunda SSR'ın fonksiyonu bulamamasına yol açar:
 *
 *     (0 , __vite_ssr_import_8__.formatAirdate) is not a function
 *
 * Bu hata `.dev-log.jsonl`de kayıtlıdır ve sayfayı istemci tarafına düşürüyordu.
 * Yardımcı fonksiyonu kendi modülüne taşımak hem uyarıyı hem çakışmayı bitirir.
 */

/**
 * `YYYY-MM-DD` → yerelleştirilmiş kısa tarih ("3.04.2016" / "4/3/2016").
 * `weekday=true` ise gün adıyla ("3 Nisan 2016, Cuma").
 *
 * Girdi beklenen biçimde değilse (veya geçersiz tarihse) **girdiyi olduğu gibi**
 * döndürür — çağıran taraf bu yüzden ayrıca kontrol etmek zorunda kalmaz.
 */
export function formatAirdate(iso: string, lang: string, weekday: boolean): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return iso;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return iso;
  const locale = lang === "tr" ? "tr-TR" : "en-US";
  return date.toLocaleDateString(locale, {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    ...(weekday ? { weekday: "long" as const } : {}),
  });
}

/**
 * MyBid VAST etiketleri — video öncesi reklam ad-pod'u (TEK kaynak).
 *
 * Neden ayrı modül: aynı iki spot hem `PrerollGate` (sağlayıcı embed'li bölümler)
 * hem `FluidPlayer` (doğrudan mp4/HLS olan bölümler) tarafından kullanılıyor.
 * Adresler iki dosyada ayrı ayrı durunca biri güncellenip diğeri unutuluyordu.
 *
 * Adresler koda GÖMÜLÜ: Vite `.env` değişikliklerini çalışma anında yeniden
 * okumaz (dev sunucusunun yeniden başlaması gerekir), o yüzden varsayılan burada
 * durur — "reklam görünmüyor" durumu oluşmaz. `.env` doluysa o kazanır.
 *
 * 25.09.2026 ölçümü (ikisi de HTTP 200):
 *   spot 2028789 → 1 `<Ad>` (Wrapper)   spot 2028790 → 1 `<Ad>` (Wrapper)
 *   Bu yüzden ad-pod İKİ AYRI spotla kurulur; eskiden tek spot aynı etiket iki kez
 *   çağrılarak ikinci reklam elde edilmeye çalışılıyordu (2028774 artık 403 veriyor).
 */

/** Birincil MyBid spotu (ad-pod 1. reklam). */
export const MYBID_VAST_SPOT_1 = "https://vast.vstserv.com/vast?spot_id=2028789";

/** İkincil MyBid spotu (ad-pod 2. reklam). */
export const MYBID_VAST_SPOT_2 = "https://vast.vstserv.com/vast?spot_id=2028790";

/**
 * Kullanılacak VAST etiketleri — **iki adet** (ad-pod).
 *
 * Fluid Player `vastTag` alanında bir **URL** bekler; VAST yanıtının Content-Type'ı
 * `application/xml` veya `text/xml` olmalıdır. Panelden yalnızca bir kimlik/hex
 * anahtar kopyalandıysa bu değer geçersizdir; bu yüzden **yalnızca http(s)** ile
 * başlayan değerler kullanılır, diğerleri sessizce atlanır.
 *
 * Tek etiket kalırsa ikinci reklam yine çıksın diye etiket iki kez çağrılır
 * (her çağrı ayrı bir açık artırma açar).
 */
export function prerollVastUrls(): string[] {
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  const tags = [
    env["VITE_MYBID_VAST_1"] || MYBID_VAST_SPOT_1,
    env["VITE_MYBID_VAST_2"] || MYBID_VAST_SPOT_2,
  ]
    .map((value) => (value ?? "").trim())
    .filter((value) => /^https?:\/\//i.test(value));

  const first = tags[0];
  if (!first) return [];
  if (tags.length === 1) return [first, first];
  return tags;
}

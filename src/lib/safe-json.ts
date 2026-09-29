/**
 * ── GÜVENLİ YANIT OKUMA ───────────────────────────────────────────────────────
 *
 * NEDEN VAR (kullanıcı kuralı, 27.09.2026): "kodun hiçbir yerinde `data.property`
 * şeklinde doğrudan okuma yapma." Sunucu rotaları hata durumunda JSON yerine HTML
 * (Cloudflare hata sayfası) ya da boş gövde dönebiliyor; `res.json()` o anda
 * fırlatıyor ve o çağrıyı yapan kalemin tamamı düşüyordu. Bu yardımcı her koşulda
 * `null` ya da doğrulanmış nesne döner — fırlatmaz.
 */

/** Nesne (dizi değil) mi? */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Yanıt gövdesini JSON olarak okur; **asla fırlatmaz**.
 *
 * @returns başarılıysa nesne, aksi hâlde `null` (boş gövde, HTML, bozuk JSON).
 */
export async function readJsonObject<T extends object = Record<string, unknown>>(
  response: Response | null | undefined,
): Promise<T | null> {
  try {
    if (!response) return null;
    const text = await response.text();
    if (!text.trim()) return null;
    const parsed: unknown = JSON.parse(text);
    return isPlainObject(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}

/** Yanıttan GÜVENLE metin alanı okur (`{reason: "..."}` → `"..."`, yoksa `null`). */
export function textField(source: unknown, key: string): string | null {
  if (!isPlainObject(source)) return null;
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Yanıttan GÜVENLE mantıksal alan okur (`{ok: true}` → `true`, yoksa `false`). */
export function boolField(source: unknown, key: string): boolean {
  if (!isPlainObject(source)) return false;
  return source[key] === true;
}

/** Yanıttan GÜVENLE dizi alanı okur (dizi değilse boş dizi). */
export function arrayField<T = unknown>(source: unknown, key: string): T[] {
  if (!isPlainObject(source)) return [];
  const value = source[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

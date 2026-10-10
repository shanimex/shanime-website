/**
 * Cihazdaki kütüphane durumları.
 *
 * Kullanıcı hesabı/Supabase gerektirmeyen katalog kısayolu olarak tutulur.
 * Böylece kart üzerindeki ani.pm tarzı durum menüsü giriş yapmadan da çalışır.
 */
const KEY = "shanime:library:v1";

export const LIBRARY_STATUS_VALUES = [
  "watching",
  "completed",
  "on-hold",
  "dropped",
  "plan-to-watch",
] as const;

export type LibraryStatus = (typeof LIBRARY_STATUS_VALUES)[number];

export function isLibraryStatus(value: unknown): value is LibraryStatus {
  return typeof value === "string" && (LIBRARY_STATUS_VALUES as readonly string[]).includes(value);
}

function read(): Record<string, LibraryStatus> {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const result: Record<string, LibraryStatus> = {};
    for (const [slug, status] of Object.entries(parsed)) {
      if (isLibraryStatus(status)) result[slug] = status;
    }
    return result;
  } catch {
    return {};
  }
}

export function getLibraryStatus(slug: string): LibraryStatus | null {
  return read()[slug] ?? null;
}

export function setLibraryStatus(slug: string, status: LibraryStatus | null): void {
  if (typeof window === "undefined" || !slug) return;
  const next = read();
  if (status) next[slug] = status;
  else delete next[slug];

  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
  } catch {
    /* Depolama kapalıysa kart menüsü bellekte hata vermeden kalır. */
  }
}

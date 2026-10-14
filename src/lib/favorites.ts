const KEY = "shanime:favorites:v1";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function hasFavorite(slug: string): boolean {
  return read().includes(slug);
}

export function toggleFavorite(slug: string): boolean {
  const favorites = read();
  const next = favorites.includes(slug)
    ? favorites.filter((item) => item !== slug)
    : [...favorites, slug];
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
  return next.includes(slug);
}

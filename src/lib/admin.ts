import type { ClipboardEvent } from "react";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as any;

export const inputCls =
  "h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary";
export const areaCls =
  "min-h-24 w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground outline-none focus:border-primary";
export const tinyLabelCls = "mb-1 block text-[11px] font-bold text-muted-foreground";

/** Başlıktan URL dostu slug üretir (Türkçe karakterler sadeleştirilir). */
export function slugify(text: string): string {
  const src = text.trim().toLocaleLowerCase("tr");
  const from = "çğıöşü";
  const to = "cgiosu";
  let out = "";
  for (const ch of src) {
    const i = from.indexOf(ch);
    out += i >= 0 ? to[i] : ch;
  }
  return (
    out
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "anime"
  );
}

/** Aynı slug iki seride kullanılmasın: çakışmada sonuna -2, -3 … ekler. */
export function uniqueSlug(base: string, taken: (string | null | undefined)[]): string {
  const used = new Set(taken.filter((value): value is string => Boolean(value)));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Yeni kaydın sırası: mevcut en büyük sort_order + 1. */
export function nextSortOrder(rows: { sort_order: number }[]): number {
  return rows.reduce((max, row) => Math.max(max, row.sort_order), 0) + 1;
}

/** Dizideki bir elemanı bir yukarı/aşağı taşır ve sıralarını veritabanına yazar. */
export async function moveAndPersist<T extends { id: string }>(
  table: string,
  rows: T[],
  index: number,
  dir: -1 | 1,
): Promise<T[] | null> {
  const target = index + dir;
  if (target < 0 || target >= rows.length) return null;
  const next = [...rows];
  const [row] = next.splice(index, 1);
  if (!row) return null;
  next.splice(target, 0, row);
  await Promise.all(
    next.map((item, i) => db.from(table).update({ sort_order: i }).eq("id", item.id)),
  );
  return next;
}

/** NOT: Burada eskiden sabit bir "kabul edilen video host" listesi vardı
 *  (VIDEO_HOST_KEYWORDS) ve listede olmayan sağlayıcılar reddediliyordu. Kullanıcı Voe
 *  linki eklerken "bu video host tanınmıyor" hatası aldı; liste kaldırıldı. Artık her
 *  embed linki kabul edilir (bkz. `watchUrlError`). */

/**
 * Bilinen sağlayıcılarda linki kanonik EMBED adresine çevirir; tanımadığında
 * linke dokunmaz.
 *
 * Neden gerekli: Filemoon'da doğru embed biçimi `https://filemoon.org/<kod>/embed`
 * biçimidir. Kullanıcı `/e/<kod>` yapıştırdı; o adres ana sayfaya yönlendiği için
 * oynatıcıda Filemoon'un tanıtım sayfası göründü ("oynatıcı bozuk"). Voe'da da
 * indirme sayfası (`/d/<kod>`) yerine embed (`/e/<kod>`) kullanılmalı.
 */
export function canonicalEmbedUrl(url: string): string {
  const value = (url ?? "").trim();
  if (!value) return "";
  let parsed: URL;
  try {
    parsed = new URL(value.split(/[?#]/)[0] ?? "");
  } catch {
    return value;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname.replace(/\/+$/, "");

  // Filemoon / Byse: <kod>/embed biçimine çevrilir.
  if (/(^|\.)(filemoon\.(org|sx|to)|byse\.sx)$/.test(host)) {
    const code =
      path.match(/\/(?:e|embed)\/([A-Za-z0-9]{6,})$/)?.[1] ??
      path.match(/^\/([A-Za-z0-9]{6,})\/(?:embed|watch|file)$/)?.[1] ??
      path.match(/^\/([A-Za-z0-9]{6,})$/)?.[1] ??
      "";
    return code ? `https://filemoon.org/${code}/embed` : value;
  }

  // Voe: embed yolu `/e/<kod>`.
  if (/(^|\.)voe\.sx$/.test(host)) {
    const code =
      path.match(/\/(?:e|embed|d)\/([A-Za-z0-9]{6,})$/)?.[1] ??
      path.match(/^\/([A-Za-z0-9]{8,})$/)?.[1] ??
      "";
    return code ? `https://voe.sx/e/${code}` : value;
  }

  return value;
}

/** Yapıştırılan metinden video linkini ayıklar ve bilinen sağlayıcıda kanonik
 *  embed biçimine çevirir:
 *  - <IFRAME ...> embed kodu yapıştırılırsa src="..." içindeki linki döndürür
 *  - düz link yapıştırılırsa aynen (gerekirse düzeltilerek) döndürür */
export function extractEmbedUrl(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  const src = text.match(/src\s*=\s*["']([^"']+)["']/i);
  if (src?.[1]) return canonicalEmbedUrl(src[1].trim());
  const bare = text.match(/https:\/\/[^\s"'<>]+/i);
  return canonicalEmbedUrl(bare ? bare[0] : text);
}

/** Input'a yapıştırılan tam embed kodunu link'e çevirir (normal yazma davranışı bozulmaz). */
export function pasteEmbed(onSet: (value: string) => void) {
  return (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text");
    if (!text) return;
    event.preventDefault();
    onSet(extractEmbedUrl(text));
  };
}

/**
 * Video linkini doğrular; sorun yoksa null, varsa kullanıcıya gösterilecek mesajı döndürür.
 *
 * Host listesi YOK: her embed linki kabul edilir (Voe, Filemoon, kendi sunucun, bilinmeyen
 * bir ayna…). Eskiden sabit bir liste vardı ve listede olmayan sağlayıcı reddediliyordu;
 * kullanıcı Voe linki eklerken "bu video host tanınmıyor" hatası aldı. Artık yalnızca
 * linkin gerçekten bir adres olup olmadığına bakılır.
 */
export function watchUrlError(url: string): string | null {
  const value = extractEmbedUrl(url);
  if (!value) return null;
  if (value.length > 500) return "Video linki çok uzun.";
  if (/["'<>\s]/.test(value))
    return "Link geçersiz karakter içeriyor. Embed kodunun içindeki link otomatik alınır, düz linki yapıştır.";
  // Alan adı olan bir https adresi yeterli; sağlayıcının kim olduğu önemli değil.
  if (!/^https:\/\/[^\s/?#]+\.[^\s/?#]+/i.test(value))
    return "Link https:// ile başlamalı ve bir alan adı içermeli (ör. https://voe.sx/e/xxxxxxx).";
  return null;
}

export type SchemaState = { ready: boolean; message: string | null };

/**
 * Panelin ihtiyaç duyduğu kolon/tablolar var mı diye bakar.
 * Migration çalıştırılmadıysa panelde uyarı gösterilir; sessiz veri kaybı olmaz.
 */
export async function checkSchema(): Promise<SchemaState> {
  const [seasons, seasonColumn, bannerColumn] = await Promise.all([
    db.from("show_seasons").select("id").limit(1),
    db.from("show_episodes").select("season").limit(1),
    db.from("shows").select("banner_image_path").limit(1),
  ]);
  const missing: string[] = [];
  if (seasons.error) missing.push("show_seasons tablosu");
  if (seasonColumn.error) missing.push("show_episodes.season kolonu");
  if (bannerColumn.error) missing.push("shows.banner_image_path kolonu");
  if (missing.length === 0) return { ready: true, message: null };
  return {
    ready: false,
    message:
      `Veritabanı güncellemesi eksik: ${missing.join(", ")}. ` +
      "supabase/migrations/20260923_seasons_banner_content.sql dosyasını Supabase SQL Editor'de çalıştır.",
  };
}

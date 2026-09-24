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

/** Kabul edilen video host aileleri: alan adında bu kelimeler geçen linkler geçerlidir.
 *  StreamWish aynaları sık değiştiği için (hgcloud.to, hglink.to, awish.pro…) isim bazlı liste tutuyoruz. */
export const VIDEO_HOST_KEYWORDS = [
  "earnvids",
  "earnvid",
  "dood",
  "vidmoly",
  "streamwish",
  "awish.",
  "hgcloud",
  "hglink",
  "hgonline",
  "hgwatch",
  "hgplay",
  "khcloud",
  "filemoon",
  "streamtape",
  "strcloud",
  "streamta",
  "tapecontent",
  "mp4upload",
  "vidhide",
  "oneupload",
  "movhide",
  "morencius",
];

/** Yapıştırılan metinden video linkini ayıklar:
 *  - <IFRAME ...> embed kodu yapıştırılırsa src="..." içindeki linki döndürür
 *  - düz link yapıştırılırsa aynen döndürür */
export function extractEmbedUrl(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  const src = text.match(/src\s*=\s*["']([^"']+)["']/i);
  if (src?.[1]) return src[1].trim();
  const bare = text.match(/https:\/\/[^\s"'<>]+/i);
  return bare ? bare[0] : text;
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

/** Video linkini doğrular; sorun yoksa null, varsa kullanıcıya gösterilecek mesajı döndürür. */
export function watchUrlError(url: string): string | null {
  const value = extractEmbedUrl(url);
  if (!value) return null;
  if (value.length > 300) return "Video linki çok uzun.";
  if (/["'<>\s]/.test(value))
    return "Link geçersiz karakter içeriyor. Embed kodunun içindeki link otomatik alınır, düz linki yapıştır.";
  if (!value.startsWith("https://")) return "Link https:// ile başlamalı.";
  const host =
    value
      .replace(/^https:\/\//i, "")
      .split("/")[0]
      ?.toLowerCase() ?? "";
  if (!VIDEO_HOST_KEYWORDS.some((keyword) => host.includes(keyword)))
    return "Bu video host tanınmıyor. Earnvids, VidMoly, Doodstream, StreamWish/hgcloud, Morencius aileleri kabul edilir.";
  const path = value.replace(/^https:\/\/[^/]+/i, "");
  if (!/^\/[\w/.~?=&%-]*$/.test(path)) return "Link yolu geçersiz görünüyor.";
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

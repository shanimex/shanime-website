/**
 * Altyazı (.vtt / .srt) çözümleyici.
 *
 * NEDEN AYRI DOSYA: `SubtitleOverlay` bileşeni sağlayıcı iframe'inin üstüne kendi
 * altyazımızı çizer; çözümleme mantığı bileşenden bağımsız çalışabilsin diye
 * burada durur (fast-refresh kuralı ve test kolaylığı).
 *
 * VTT ve SRT aynı blok yapısını paylaşır:
 *
 *   1                                  (SRT'de sıra numarası, VTT'de opsiyonel)
 *   00:00:01,000 --> 00:00:03,500      (VTT'de virgül yerine nokta olabilir)
 *   Merhaba dünya
 */

/** Tek altyazı satırı. */
export type Cue = { start: number; end: number; text: string };

/** `00:01:02.345` · `00:01:02,345` · `01:02.3` biçimlerini saniyeye çevirir. */
function parseTimestamp(value: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1] ?? 0);
  const minutes = Number(m[2] ?? NaN);
  const seconds = Number(m[3] ?? NaN);
  const millis = Number((m[4] ?? "0").padEnd(3, "0"));
  if (![hours, minutes, seconds, millis].every(Number.isFinite)) return null;
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

export function parseSubtitles(raw: string): Cue[] {
  const text = raw.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  const cues: Cue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    if (lines.length === 0) continue;
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex < 0) continue;
    const timeLine = lines[timeIndex] ?? "";
    const [rawStart, rawEnd] = timeLine.split("-->");
    if (!rawStart || !rawEnd) continue;
    const start = parseTimestamp(rawStart);
    // SRT bitiş damgasından sonra "X1:..." ayarları gelebilir; ilk boşlukta keser.
    const end = parseTimestamp(rawEnd.trim().split(/\s+/)[0] ?? "");
    if (start === null || end === null) continue;
    const body = lines
      .slice(timeIndex + 1)
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!body) continue;
    cues.push({ start, end, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** Sitеде sunabildiğimiz altyazı dilleri. */
export const SUBTITLE_LANGS = ["tr", "en"] as const;
export type SubtitleLang = (typeof SUBTITLE_LANGS)[number];

/** Menüde görünecek adlar. */
export const SUBTITLE_LABELS: Record<SubtitleLang, string> = {
  tr: "Türkçe",
  en: "İngilizce",
};

/**
 * Altyazı dosyasının YERLEŞİK yolu: `/subs/{slug}-s{sezon}b{bölüm}.{dil}.vtt`.
 *
 * NEDEN KURAL: her bölüm ve her dil için panelde ayrı ayrı JSON girmek
 * istemiyoruz. Betik (`scripts/sync-tr-subtitles.mjs`) dosyaları bu adla
 * `public/subs/` altına yazıyor; site de bu yolu kendiliğinden arıyor. Dosya
 * yoksa istek 404 döner ve o dil menüde hiç görünmez — hiçbir şey bozulmaz.
 *
 * Panelden açıkça bir adres girilmişse (`episodes.subtitles`) o tercih edilir.
 */
export function conventionSubtitlePath(
  slug: string,
  season: number,
  episode: number,
  lang: SubtitleLang,
): string {
  if (!slug) return "";
  return `/subs/${slug}-s${season}b${episode}.${lang}.vtt`;
}

/** Verilen saniyede gösterilecek satırı bulur (yoksa null). */
export function cueAt(cues: Cue[], time: number): Cue | null {
  return cues.find((cue) => time >= cue.start && time < cue.end) ?? null;
}

import BAKED_ANIZM from "@/data/anizm-hashes.json";

/**
 * anizm/puffy oynatıcı adresleri.
 *
 * NEDEN: anizm/puffy hattı (puffytr.com + anizm.net aynı ağ) Türkçe altyazıyı
 * videoya GÖMÜLÜ veriyor, 1080p, **pre-roll reklamı yok** (`"advertising": []`)
 * ve pop-up açmıyor. Ölçüm: docs/SAGLAYICI-VE-KAPAK-ARASTIRMASI.md §23.
 *
 * Gömülebilir adres `https://anizmplayer.com/video/<hash>`; sarmalayıcı
 * (`puffytr.com/player/<id>`) referer korumalı olduğu için doğrudan kullanılamaz.
 * Hash **bölüme özel** olduğundan burada derleme zamanında gömülü bir tablo
 * tutulur:
 *
 *   scripts/resolve-anizm-hashes.mjs  →  src/data/anizm-hashes.json
 *
 * Anahtar biçimi: `{malId}-s{sezon}b{bölüm}`. Hash çözülemeyen bölümlerde
 * `null` döner ve oynatıcı megaplay'e (kendi Türkçe altyazı katmanımızla) düşer
 * — yani bu kaynak yoksa hiçbir şey bozulmaz.
 */

type AnizmEntry = {
  hash: string;
  playerUrl: string;
  server: string;
  titleNumber: number | null;
  resolvedAt: string;
};

const TABLE = BAKED_ANIZM as Record<string, AnizmEntry>;

/** Tablodaki kayıt sayısı (teşhis/panel için). */
export function anizmResolvedCount(): number {
  return Object.keys(TABLE).length;
}

/**
 * Bölümün anizm oynatıcı adresi. Hash yoksa `null`.
 *
 * @param malId   MyAnimeList kimliği (şemada yoksa null)
 * @param season  Sezon numarası (1 tabanlı)
 * @param episode Bölüm numarası (1 tabanlı)
 */
export function anizmPlayerUrl(
  malId: number | null | undefined,
  season: number,
  episode: number,
): string | null {
  if (!malId) return null;
  const entry = TABLE[`${malId}-s${season}b${episode}`];
  const url = entry?.playerUrl ?? "";
  // Yalnızca doğrulanmış biçim döner; şaşırtıcı bir değer varsa üretme.
  return /^https:\/\/anizmplayer\.com\/video\/[0-9a-f]{16,}$/i.test(url) ? url : null;
}

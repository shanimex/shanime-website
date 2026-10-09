import BAKED_THUMBS from "@/data/episode-thumbs.json";
import BAKED_TMDB from "@/data/mal-tmdb.json";
// OTOMATİK ÇÖZÜLMÜŞ SEZON MAL KİMLİKLERİ (bkz. scripts/resolve-season-mal-ids.mjs).
import BAKED_SEASON_MAL_IDS from "@/data/season-mal-ids.json";
// Seri başına TAM sezon zinciri — bölünmüş sezonlar için kardeş kayıt araması.
import BAKED_SEASON_CHAINS from "@/data/season-chains.json";
import { cachedRead } from "@/lib/server-cache";

/**
 * Yayın tarihi önbellek ömrü: 7 gün.
 *
 * NEDEN UZUN: yayın tarihi DEĞİŞMEZ bir veridir (bölüm bir kez yayınlanır).
 * Katalog okumaları (120 sn) gibi taze tutmaya gerek yok; uzun TTL hem
 * upstream'i hem kotayı korur.
 */
export const TTL_AIRDATE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Bölüm kapakları — GERÇEK bölüm görselleri (ani.zip / TVDB).
 *
 * NEDEN AYRI BİR KAYNAK: embed sağlayıcıları (megaplay, vidlink, videasy) bölüm
 * kapağı yayınlamıyor. `episode-posters.json` zinciri de yalnızca VidMoly
 * adreslerinden türetme yapabildiği için sağlayıcı embed'li bölümlerde kart
 * boş kalıyordu ve tek çare seri posteriydi (her bölüm aynı görsel).
 *
 * ÇÖZÜM: `scripts/sync-anizip-covers.mjs` MAL kimliğiyle `api.ani.zip`'ten bölüm
 * bölüm gerçek görseli çekip `src/data/episode-thumbs.json` dosyasına yazar.
 * Görseller `artworks.thetvdb.com` üzerinden geliyor; referer'sız HTTP 200 +
 * `image/jpeg` (hotlink serbest). Veri DERLEME ZAMANINDA dosyaya gömüldüğü için
 * çalışma anında dış istek yapılmaz, sayfa yavaşlamaz.
 *
 * SINIR (dürüstçe): bu, videodan alınmış bir KARE DEĞİLDİR. Cross-origin
 * iframe'in içindeki videodan kare çıkarılamaz; gerçek kare ancak videoyu
 * kendimiz barındırırsak (R2 + kendi oynatıcı) üretilebilir. Amaç, boş/kırık
 * kapak yerine bölüme ait gerçek bir görsel göstermek.
 *
 * Yeni seri ekledikten sonra: `node scripts/sync-anizip-covers.mjs`
 */
const thumbs = BAKED_THUMBS as Record<string, Record<string, string>>;
/** Otomatik çözülmüş sezon kimlikleri: `{ "<seri MAL>": { "<sezon>": <MAL> } }`. */
const seasonMalIds = BAKED_SEASON_MAL_IDS as Record<string, Record<string, number>>;

/**
 * Sezonun kapak aramasında kullanılacak MAL kimliğini belirler.
 *
 * SIRA:
 *   1. Veritabanındaki `show_seasons.mal_id` — elle girilmiş değer ESAS alınır
 *   2. OTOMATİK çözülmüş kimlik — AniList PREQUEL/SEQUEL zinciri + bölüm sayısı
 *      eşleşmesiyle üretilir (`scripts/resolve-season-mal-ids.mjs`)
 *   3. Hiçbiri yoksa `null` → arama seri kimliğine düşer
 *
 * NEDEN GEREKLİ: MAL'de her sezon AYRI bir anime kaydıdır (Jujutsu Kaisen
 * S2 = 51009). Seri kimliğiyle o sezonların görselleri bulunamıyordu; bu
 * fonksiyon boşluğu panele ELLE KİMLİK GİRMEYE GEREK KALMADAN kapatır.
 */
export function resolveSeasonMalId(
  showMalId: number | null | undefined,
  seasonNumber: number,
  explicit: number | null | undefined,
): number | null {
  if (explicit) return explicit;
  if (!showMalId) return null;
  return seasonMalIds[String(showMalId)]?.[String(seasonNumber)] ?? null;
}

/**
 * Verilen seri/bölüm için gerçek bölüm kapağı; yoksa boş dizge.
 *
 * Arama sırası:
 *   1. `s<sezon>e<bölüm>` — sezon + bölüm birebir eşleşmesi.
 *   2. `abs<bölüm>`       — mutlak bölüm numarası (sezon bilgisi tutmayan
 *                            serilerde MAL bölüm numarası sezonu yok sayar).
 */
export function anizipCover(
  malId: number | null | undefined,
  season: number,
  episode: number,
): string {
  if (!malId) return "";
  const table = thumbs[String(malId)];
  if (!table) return "";
  const direct = table[`s${season}e${episode}`];
  if (direct) return direct;
  // ── `abs{N}` TAKVİYESİ YALNIZCA 1. SEZON İÇİNDİR ──────────────────────────
  // `abs{N}` kaydın N. bölümüdür — SEZONLAR ARASI MUTLAK sıra. Yani 2. sezonun
  // 1. bölümü `abs1`e düşerse 1. SEZONUN 1. BÖLÜMÜNÜ gösterir.
  // Ölçüm (30.09.2026): bu yüzden HER SEZON 1. SEZONUN kapaklarını gösteriyordu
  // (kullanıcı bildirimi: "her sezona sadece ilk sezonun kapaklarını yüklüyor").
  // 2+ sezonlarda bu yedek KAPATILDI; doğru kaynak sezonun kendi MAL kaydıdır
  // (`anizipCoverForSeason` → `resolveSeasonMalId`).
  if (season > 1) return "";
  return table[`abs${episode}`] ?? "";
}

/** Otomatik çözülmüş TAM sezon zincirleri: `{ "<seri MAL>": [MAL, MAL, …] }`. */
const seasonChains = BAKED_SEASON_CHAINS as Record<string, number[]>;

/**
 * Bir MAL kaydının tablosunda GEÇEN sezon numaraları (`s<sezon>e<bölüm>` anahtarlarından).
 *
 * NEDEN: ani.zip kayıtları SERİNİN GENEL sezon numarasını yazar. Jujutsu Kaisen S3
 * kaydı (57658) → `s3e1…s3e12`; re-zero S2 Part 2 (42203) → `s2e14…s2e25`. Bazı
 * kayıtlar ise TEK sezonludur ve `s1e…` yazar (ör. re-zero S1 = 31240). Bu ayrım
 * bilinmeden `s1e` yedeği yanlış sezonun görselini getirir.
 */
function tableSeasons(table: Record<string, string>): number[] {
  const seasons = new Set<number>();
  for (const key of Object.keys(table)) {
    const match = /^s(\d+)e\d+$/.exec(key);
    if (match) seasons.add(Number(match[1]));
  }
  return [...seasons];
}

/**
 * BİR MAL KAYDININ tablosundan (sezon, bölüm) görselini bulur — kaydın KENDİSİ o
 * bölümü İÇERİYORSA eşleşir, aksi hâlde boş.
 *
 * ── NEDEN KAYIT-FARKINDA EŞLEŞME (düzeltme 30.09.2026) ───────────────────────
 * Eski kod koşulsuz `s1e<bölüm>` (ve `abs`) yedeğine düşüyordu. Bölünmüş
 * sezonlarda bu YANLIŞ sezonun görselini getiriyordu: re-zero S2 B13 için zincir
 * sırası `42203 → 31240` olduğundan ve 31240 = S1 kaydı `s1e13` içerdiğinden
 * S2 B13 kartı S1 B13 görselini gösteriyordu.
 *
 * KURAL:
 *   1) `s<sezon>e<bölüm>` → birebir (ani.zip genel sezon numarasını yazar).
 *   2) Kayıt TEK sezonluysa (yalnız `s1e…`/`s0e…`) ve istenen sezon 1 ise `s1e<bölüm>`.
 *   3) Aksi hâlde eşleşme YOK — uydurma yerine bir sonraki kaynağa düşülür.
 */
function imageFromTable(
  table: Record<string, string> | undefined,
  season: number,
  episode: number,
): string {
  if (!table) return "";
  const direct = table[`s${season}e${episode}`];
  if (direct) return direct;
  const onlyFirst = tableSeasons(table).every((value) => value === 0 || value === 1);
  if (onlyFirst && season === 1) return table[`s1e${episode}`] ?? "";
  return "";
}

/**
 * SEZONUN KENDİ KAYDI bölümü İÇERMİYORSA zincirdeki KARDEŞ kayıtlara bakar.
 *
 * NEDEN GEREKLİ (ölçüm 30.09.2026): bazı sezonlar MAL'de İKİ kayda bölünür —
 * re-zero S2 = 39587 (bölüm 1-13) + 42203 (bölüm 14-25). Arama elindeki sezon
 * kimliği yalnızca 42203 olduğu için 1-13. bölümler eşleşmiyordu ve o satırlar
 * aynı yedek görsele düşüyordu. Kardeş kayıt (39587) o bölümleri İÇERİR.
 *
 * `abs` yedeği BİLEREK kullanılmaz: yanlış sezonun görselini getirir.
 */
export function anizipCoverFromChain(
  showMalId: number | null | undefined,
  seasonNumber: number,
  episode: number,
  primarySeasonMalId: number | null | undefined,
): string {
  if (!showMalId) return "";
  const chain = seasonChains[String(showMalId)] ?? [];
  const order = [
    ...(primarySeasonMalId ? [primarySeasonMalId] : []),
    ...chain.filter((id) => id !== primarySeasonMalId),
  ];
  for (const id of order) {
    // Kayıt-farkında eşleşme: yalnızca o kaydın GERÇEKTEN içerdiği bölümü döndürür.
    const hit = imageFromTable(thumbs[String(id)], seasonNumber, episode);
    if (hit) return hit;
  }
  return "";
}

/**
 * SEZONUN KENDİ MAL KİMLİĞİYLE kapak arar.
 *
 * ── NEDEN GEREKLİ (30.09.2026 ölçümü) ───────────────────────────────────────
 * MAL'de her sezon AYRI bir anime kaydıdır: Jujutsu Kaisen S1 = 40748, ama S2 ve
 * S3'ün kendi kimlikleri vardır. `anizipCover` her zaman SERİ kimliğini
 * kullandığı için o sezonların görselleri hiç bulunamıyordu — 59 bölümün 35'i
 * kapaksız kalıyordu ve kullanıcı "kapaklar hâlâ bozuk" diyordu.
 *
 * Sezonun kendi kaydı TEK sezonluk bir anime olduğu için bölümleri `s1e<bölüm>`
 * biçimindedir (mutlak numaralandıran kayıtlarda `abs<bölüm>`). `content.ts`
 * katalog eşleşmesinde bu tercihi zaten yapıyor (`catalogMalId`); aynı kural
 * kapak aramasına da uygulandı.
 */
export function anizipCoverForSeason(
  seasonMalId: number | null | undefined,
  seasonNumber: number,
  episode: number,
): string {
  if (!seasonMalId) return "";
  // ÜÇ BİÇİM DE DENENİR. ani.zip, sezon kaydında bile SERİNİN GENEL sezon
  // numarasını kullanır: Jujutsu Kaisen S2 kaydı (MAL 51009) `s2e1…s2e23`,
  // S3 kaydı (57658) `s3e1…s3e12`, re-zero S2 Part 2 (42203) `s2e14…s2e25`.
  // Tek sezonluk kayıtlarda ise `s1e…` görülür (re-zero S1 = 31240).
  //
  // ⚠️ `s1e` yedeği artık KOŞULSUZ DEĞİL: kayıt gerçekten tek sezonluysa ve
  // istenen sezon 1 ise denenir (bkz. `imageFromTable`). Aksi hâlde yanlış
  // sezonun görseli gösteriliyordu (ölçüm 30.09.2026: re-zero S2 B13 → S1 B13).
  return imageFromTable(thumbs[String(seasonMalId)], seasonNumber, episode);
}

/**
 * TMDB eşlemesi (MAL → TMDB). Aynı ani.zip yanıtından üretilir.
 *
 * NEDEN GEREKLİ: `vidsrc.to` gibi TMDB tabanlı sağlayıcılar şablonlarında TMDB
 * kimliği ister (`/embed/tv/{tmdb}/{sezon}/{bölüm}`). MAL kimliği o şablonlarda
 * işe yaramaz — bu yüzden ayrı bir eşleme tutulur.
 *
 * Örnek (25.09.2026 ölçümü): 40748 → 95479 (Jujutsu Kaisen), 31240 → 65942
 * (Re:Zero), 31043 → 65249 (Erased), 39535 → 94664 (Mushoku Tensei).
 */
const tmdbMap = BAKED_TMDB as Record<string, string>;

/** MAL kimliğine karşılık gelen TMDB kimliği; eşleme yoksa null. */
export function tmdbIdForMal(malId: number | null | undefined): number | null {
  if (!malId) return null;
  const value = Number(tmdbMap[String(malId)]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

type RawAirEpisode = {
  seasonNumber?: unknown;
  episodeNumber?: unknown;
  airDate?: unknown;
};

/**
 * Bir MAL kaydının bölüm yayın tarihleri (`"sezon:bölüm" → "YYYY-MM-DD"`).
 *
 * NEDEN: detay sayfasındaki bölüm kartları yayın tarihi rozeti taşır
 * (referans sitelerdeki gibi). Tarih veritabanında tutulmaz — ani.zip'ten
 * okunup uzun süreli önbelleğe yazılır (değişmez veri). Kayıt/istek başarısız
 * olursa BOŞ döner; kart tarihi atlar, sayfa düşmez.
 */
export async function fetchSeasonAirdates(malId: number): Promise<Record<string, string>> {
  if (!Number.isFinite(malId) || malId <= 0) return {};
  return cachedRead<Record<string, string>>(
    `anizip-airdates:${malId}`,
    TTL_AIRDATE_SECONDS,
    async () => {
      const out: Record<string, string> = {};
      let json: { episodes?: Record<string, RawAirEpisode> };
      try {
        const res = await fetch(`https://api.ani.zip/mappings?mal_id=${malId}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return out;
        json = (await res.json()) as { episodes?: Record<string, RawAirEpisode> };
      } catch {
        return out;
      }
      for (const ep of Object.values(json.episodes ?? {})) {
        const season = Number(ep.seasonNumber ?? NaN);
        const number = Number(ep.episodeNumber ?? NaN);
        const date = typeof ep.airDate === "string" ? ep.airDate.slice(0, 10) : "";
        if (!Number.isFinite(season) || !Number.isFinite(number)) continue;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        out[`${season}:${number}`] = date;
      }
      return out;
    },
  );
}

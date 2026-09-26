/**
 * Panelden "bir sezonun TÜM bölümlerini tek basışta çek" için katalog kaynağı.
 *
 * KAYNAK: `api.ani.zip` (TVDB + AniDB + AniList birleşik eşleme servisi).
 * NEDEN BU: MAL kimliğiyle bölüm bölüm `seasonNumber`, `episodeNumber`,
 * `absoluteEpisodeNumber`, `title` ve `image` veriyor; kapak senkronu
 * (`scripts/sync-anizip-covers.mjs`) zaten aynı uçtan besleniyor.
 *
 * ÖLÇÜM (26.09.2026): `OPTIONS/GET` yanıtı `Access-Control-Allow-Origin: *`
 * döndürüyor → panelden TARAYICIDA doğrudan çağrılabilir, sunucu/proxy gerekmez.
 * (Jikan aynı anda 504 verdi; ani.zip 200 döndü.)
 *
 * `image` alanı burada yalnızca bilgi amaçlı taşınır; kapakları
 * `episode-covers` zinciri hallediyor.
 */

/** Katalogdan gelen tek bir bölüm. */
export type CatalogEpisode = {
  /** Sezon numarası (TVDB numaralandırması; 0 = özel bölüm). */
  season: number;
  /** Sezon içi bölüm numarası. */
  number: number;
  /** Mutlak (seri geneli) bölüm numarası — sezon ayrımı olmayan serilerde işe yarar. */
  absolute: number;
  /** Bölüm adı (varsa); yoksa boş dizge. */
  title: string;
  /** Gerçek bölüm görseli (varsa); kapak zinciri için. */
  image: string;
};

/** ani.zip `episodes` kaydındaki alanlar — hepsi opsiyonel gelebilir. */
type RawEpisode = {
  seasonNumber?: number | string;
  episodeNumber?: number | string;
  absoluteEpisodeNumber?: number | string;
  title?: string | { en?: string; tr?: string; ja?: string; x_jat?: string };
  image?: string;
};

/** Başlık düz dizge de, dil nesnesi de olabiliyor — ikisini de karşılar. */
function readTitle(value: RawEpisode["title"]): string {
  const pick = (v?: string) => (typeof v === "string" ? v.trim() : "");
  const text =
    typeof value === "string"
      ? value.trim()
      : pick(value?.tr) || pick(value?.en) || pick(value?.ja) || pick(value?.x_jat);
  // "Episode 12" gibi jenerik adlar bilgi taşımıyor; başlıksız bırak.
  if (!text || /^episode\s*\d+$/i.test(text)) return "";
  return text;
}

/**
 * MAL kimliği için tüm bölüm listesini çeker (tüm sezonlar birlikte).
 *
 * @param malId MyAnimeList kimliği
 * @throws ani.zip hata verirse ya da ağ düşerse
 */
export async function fetchCatalogEpisodes(malId: number): Promise<CatalogEpisode[]> {
  if (!Number.isFinite(malId) || malId <= 0) throw new Error("Geçersiz MAL kimliği");

  const res = await fetch(`https://api.ani.zip/mappings?mal_id=${malId}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`ani.zip ${res.status}`);

  const json = (await res.json()) as { episodes?: Record<string, RawEpisode> };
  const map = new Map<string, CatalogEpisode>();

  for (const [key, ep] of Object.entries(json.episodes ?? {})) {
    const number = Number(ep.episodeNumber ?? key);
    if (!Number.isFinite(number) || number <= 0) continue;
    const season = Number(ep.seasonNumber ?? 1);
    const absolute = Number(ep.absoluteEpisodeNumber ?? number);
    const entry: CatalogEpisode = {
      season: Number.isFinite(season) ? season : 1,
      number,
      absolute: Number.isFinite(absolute) ? absolute : number,
      title: readTitle(ep.title),
      image: typeof ep.image === "string" ? ep.image : "",
    };

    // MÜKERRER KAYIT: ani.zip aynı bölümü birden çok kaynak için iki kez
    // döndürüyor. Ölçüm (26.09.2026): MAL 40748 → 46 ham kayıt ama yalnızca 25
    // tekil (sezon:bölüm); MAL 31043 → 15 ham, 13 tekil. Tekilleştirilmezse panel
    // hem mükerrer satır gösterir hem de "eksik" sayısını yanlış hesaplar
    // (tarayıcıda "aynı anahtar" uyarısı da bundan çıkıyordu).
    const unique = `${entry.season}:${entry.number}`;
    const previous = map.get(unique);
    if (!previous) {
      map.set(unique, entry);
      continue;
    }
    // İki kayıttan bilgisi daha zengin olanı tut (boş alan dolu olanı ezmesin).
    map.set(unique, {
      ...previous,
      title: previous.title || entry.title,
      image: previous.image || entry.image,
      absolute: previous.absolute || entry.absolute,
    });
  }

  return [...map.values()].sort((a, b) => a.season - b.season || a.number - b.number);
}

/**
 * Veritabanındaki başlık işe yaramaz mı — boş ya da tamamen jenerik mi?
 *
 * NEDEN GEREKLİ: katalog başlıklarını körlemesine karşılaştırmak paneli yanıltıyor.
 * Ölçüm (26.09.2026):
 *   · `erased`  → veritabanı başlıkları `"1. Bölüm"`, `"2. Bölüm"`… (jenerik),
 *     ani.zip'te ise gerçek Türkçe ad var ("Film Şeridi Gibi Gözümün Önünden Geçiyor")
 *     → güncelleme GERÇEKTEN gerekli.
 *   · `jujutsu-kaisen` → veritabanında "Kendim İçin", "Çelik Kız" gibi gerçek adlar
 *     var; ani.zip'in Türkçesi farklı bir çeviri olduğu için 24 bölümün 23'ü
 *     "güncellenecek" görünüyordu — oysa başlıklar yanlış değil, sadece başka çeviri.
 * Kural: yalnızca boş/jenerik başlıklar önerilir; zevk meselesi olan çeviri farkı
 * kendiliğinden işaretlenmez (kullanıcı isterse satırı elle seçip güncelleyebilir).
 */
export function isPlaceholderTitle(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  if (text === "") return true;
  return /^(\d+\.\s*b[oö]l[uü]m|b[oö]l[uü]m\s*\d+|episode\s*\d+|ep\.?\s*\d+)$/i.test(text);
}

/** Katalogda geçen sezon numaraları (küçükten büyüğe). */
export function catalogSeasons(list: CatalogEpisode[]): number[] {
  return [...new Set(list.map((ep) => ep.season))].sort((a, b) => a - b);
}

/**
 * Bir sezonun bölümlerini seçer.
 *
 * FALLBACK: bazı serilerde ani.zip sezon ayrımı yapmaz (tüm bölümler `season: 1`
 * altında, mutlak numarayla). İstenen sezonda hiç kayıt yoksa ve tek sezon
 * varsa, o liste döner ve `exact: false` işaretlenir — panel bunu kullanıcıya
 * "katalogda sezon ayrımı yok" diye bildirir (sessizce yanlış ekleme olmaz).
 */
export function pickSeason(
  list: CatalogEpisode[],
  season: number,
): { episodes: CatalogEpisode[]; exact: boolean } {
  const exact = list.filter((ep) => ep.season === season);
  if (exact.length > 0) return { episodes: exact, exact: true };
  const seasons = catalogSeasons(list);
  if (seasons.length === 1 && list.length > 0) return { episodes: list, exact: false };
  return { episodes: [], exact: false };
}

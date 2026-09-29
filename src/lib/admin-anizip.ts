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
      : /**
         * DİL SIRASI — İNGİLİZCE ÖNCE (kullanıcı, 28.09.2026: "katalogdan yabancı
         * isimle çekiliyor, orijinal ismiyle gelsin … sitemiz tamamen İngilizce
         * olacak, orijinal doğru İngilizce kullansın").
         *
         * ESKİ SIRA `tr → en → ja → x_jat` İDİ: ani.zip kaydında Türkçe ad varsa
         * liste onu gösteriyordu. Site İngilizce varsayılan olduğu için artık
         * `en` birinci sırada. Türkçe EN SONA düşürüldü — yalnızca İngilizce ad
         * hiç yoksa devreye girer; metin uydurulmaz, yalnızca sıra değişir.
         */
        pick(value?.en) || pick(value?.x_jat) || pick(value?.ja) || pick(value?.tr);
  // "Episode 12" gibi jenerik adlar bilgi taşımıyor; başlıksız bırak.
  if (!text || /^episode\s*\d+$/i.test(text)) return "";
  return text;
}

/**
 * ani.zip'in HTTP hatası — durum kodu KORUNUR.
 *
 * NEDEN ÖZEL SINIF: panel, hedef sezonun kaydı bulunamadığında kullanıcıya ne
 * olduğunu açıkça söylemek zorunda (kullanıcı şikâyeti: "yeni sezon/bölüm
 * ekleyemiyorum"). Düz `Error` mesajı ("ani.zip 404") ayırt edilemediği için
 * panel "kayıt yok" ile "ağ hatası"nı AYIRAMIYORDU. Durum kodu burada taşınır,
 * mesaj `catalogFailureMessage` ile üretilir.
 */
export class CatalogHttpError extends Error {
  /** ani.zip'in döndürdüğü HTTP durum kodu (404 = kayıt yok). */
  readonly status: number;
  /** Hangi MAL kimliği için denendiği — mesajda kullanıcıya gösterilir. */
  readonly malId: number;

  constructor(malId: number, status: number) {
    super(`ani.zip ${status} (MAL ${malId})`);
    this.name = "CatalogHttpError";
    this.status = status;
    this.malId = malId;
  }
}

/**
 * MAL kimliği için tüm bölüm listesini çeker (tüm sezonlar birlikte).
 *
 * @param malId MyAnimeList kimliği
 * @throws {CatalogHttpError} ani.zip 4xx/5xx dönerse (durum kodu korunur)
 * @throws ağ düşerse (fetch reddi; `CatalogHttpError` DEĞİL → geçici hata sayılır)
 */
export async function fetchCatalogEpisodes(malId: number): Promise<CatalogEpisode[]> {
  if (!Number.isFinite(malId) || malId <= 0) throw new Error("Geçersiz MAL kimliği");

  const res = await fetch(`https://api.ani.zip/mappings?mal_id=${malId}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new CatalogHttpError(malId, res.status);

  const json = (await res.json()) as { episodes?: Record<string, RawEpisode> };
  const map = new Map<string, CatalogEpisode>();

  for (const [key, ep] of Object.entries(json.episodes ?? {})) {
    const number = Number(ep.episodeNumber ?? key);
    if (!Number.isFinite(number) || number < 0) continue;
    const season = Number(ep.seasonNumber ?? 1);
    /**
     * "0. BÖLÜM" DESTEĞİ (kullanıcı bildirimi, 29.09.2026: "Guardian Fitz 0. bölüm
     * eklenemiyor").
     *
     * Eski filtre `number <= 0` idi ve ani.zip bir özel/ön bölümü `episodeNumber: 0`
     * olarak verdiğinde (bazı special/OVA kayıtlarında görülür) onu HİÇBİR ZAMAN
     * listeye almıyordu — panelde ne görünür ne yazılabilirdi.
     *
     * KURAL: `0` YALNIZCA gerçek bir ÖZEL bölümde (`season === 0`) geçerlidir.
     * Normal bir sezonun (`season >= 1`) içinde 0 numaralı bölüm OLMAZ; gelseydi
     * ana listeye karışıp numaralandırmayı/part offset'ini kaydırırdı — o yüzden
     * o durumda atlanır. Negatif ve sayısal olmayan değerler eskisi gibi elenir.
     */
    if (number === 0 && season !== 0) continue;
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

/** Serinin ilişkili kaydı (devam sezonu, film, yan hikâye…). */
export type RelatedRecord = {
  malId: number;
  title: string;
  english: string;
  year: number | null;
  episodes: number | null;
  format: string;
  relationType: string;
};

type AniListRelation = {
  relationType?: string;
  node?: {
    idMal?: number | null;
    type?: string | null;
    format?: string | null;
    episodes?: number | null;
    startDate?: { year?: number | null };
    title?: { romaji?: string | null; english?: string | null };
  };
};

const ANILIST_RELATIONS = `query ($mal: Int) {
  Media(idMal: $mal, type: ANIME) {
    relations {
      edges {
        relationType
        node {
          idMal
          type
          format
          episodes
          startDate { year }
          title { romaji english }
        }
      }
    }
  }
}`;

/**
 * Serinin İLİŞKİLİ kayıtlarını getirir (AniList `relations`).
 *
 * NEDEN GEREKLİ: kullanıcı "tek tek seri adını (MAL kodunu) nereden bulacağım,
 * bulduğum da hata veriyor" dedi. Devam sezonları ayrı MAL kaydıdır ve bu kayıtlar
 * serinin kendi sayfasında bağlantılıdır — elle kod aramak yerine panel bunları
 * kendisi listeler: "Jujutsu Kaisen 2nd Season · 2023 · 23 bölüm · MAL 51009".
 *
 * SIRALAMA: DEVAM (SEQUEL) önce, sonra yıl; böylece "2. Sezon" en üstte olur.
 */
export async function fetchRelatedRecords(malId: number): Promise<RelatedRecord[]> {
  if (!malId || malId <= 0) return [];
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: ANILIST_RELATIONS, variables: { mal: malId } }),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const json = (await res.json()) as {
    data?: { Media?: { relations?: { edges?: AniListRelation[] } } };
  };
  const edges = json.data?.Media?.relations?.edges ?? [];
  const rank: Record<string, number> = { SEQUEL: 0, PREQUEL: 1, SIDE_STORY: 2 };
  return edges
    .map((edge) => {
      const node = edge.node;
      const relatedMal = Number(node?.idMal ?? 0);
      const title = (node?.title?.romaji || node?.title?.english || "").trim();
      if (!Number.isFinite(relatedMal) || relatedMal <= 0 || !title) return null;
      return {
        malId: relatedMal,
        title,
        english: (node?.title?.english ?? "").trim(),
        year: node?.startDate?.year ?? null,
        episodes: node?.episodes ?? null,
        format: (node?.format ?? "").trim(),
        relationType: (edge.relationType ?? "").trim(),
      } satisfies RelatedRecord;
    })
    .filter((record): record is RelatedRecord => record !== null)
    .sort(
      (a, b) =>
        (rank[a.relationType] ?? 9) - (rank[b.relationType] ?? 9) ||
        (a.year ?? 0) - (b.year ?? 0) ||
        a.malId - b.malId,
    );
}

/**
 * Verilen MAL kaydının ANİLİST ZİNCİRİNDEKİ doğrudan ÖNCESİNİ (PREQUEL) bulur.
 *
 * ── NEDEN GEREKLİ (kullanıcı bildirimi, 29.09.2026) ─────────────────────────
 * "Mushoku Tensei eklediğim 2 tanesi part'tı, 1. sezona aitti aslında, ama 2
 *  ayrı sezon olarak yükledi." Panel, girilen MAL kimliğinin GERÇEKTEN hangi
 *  sezona ait olduğunu KONTROL ETMİYOR; yalnızca "serinin kimliğinden farklıysa
 *  SIRADAKİ sezon" varsayıyordu. 45576 (S1'in Part 2'si) bu yüzden S2 gibi
 *  açılabiliyordu.
 *
 * ÇÖZÜM: girilen kaydın AniList ilişkilerindeki PREQUEL (TV) kimliği okunur;
 * çağıran bunu serideki MEVCUT sezonların `mal_id`leriyle karşılaştırır. Eşleşme
 * varsa girilen kayıt O sezonun devamıdır (yeni sezon değil). YENİ DIŞ SERVİS
 * YOK — AniList sorgusu projede zaten var (`fetchRelatedRecords`).
 *
 * @returns Önceki TV kaydının MAL kimliği; yoksa/erişilemezse `null`.
 */
export async function findPrequelMalId(malId: number): Promise<number | null> {
  if (!Number.isFinite(malId) || malId <= 0) return null;
  try {
    const records = await fetchRelatedRecords(malId);
    const prequel = records.find(
      (record) =>
        record.relationType === "PREQUEL" &&
        (record.format === "TV" || record.format === "TV_SHORT"),
    );
    return prequel ? prequel.malId : null;
  } catch {
    // AniList erişilemezse tahmin YAPILMAZ; çağıran mevcut davranışına düşer.
    return null;
  }
}

/** Ada göre arama sonucu (Jikan). */
export type SeriesHit = {
  malId: number;
  /** Seri adı (romaji; panelde asıl gösterilen). */
  title: string;
  /** İngilizce ad (varsa) — aynı adlı serileri ayırt etmeye yarar. */
  english: string;
  /** Yayın yılı (varsa). */
  year: number | null;
  /** Bölüm sayısı (varsa) — "TV" ve uzun serileri ayırt eder. */
  episodes: number | null;
  type: string;
  image: string;
};

type RawSearchHit = {
  mal_id?: number;
  title?: string;
  title_english?: string | null;
  type?: string | null;
  episodes?: number | null;
  year?: number | null;
  aired?: { prop?: { from?: { year?: number | null } } };
  images?: { jpg?: { image_url?: string } };
};

/**
 * AniList GraphQL sorgusu — aramanın BİRİNCİL kaynağı.
 *
 * NEDEN ANILIST: arama için önce Jikan (MAL sarmalayıcı) kullanıldı; ölçümde
 * sık sık `HTTP 504` döndürdü ("Jikan failed to connect to MyAnimeList") —
 * yani MAL tarafı kapalıyken panelde arama hiç çalışmıyordu. AniList kendi
 * API'sini servis ediyor, CORS'a açık ve `idMal` alanıyla MAL kimliğini
 * doğrudan veriyor (ani.zip de MAL kimliğiyle çalıştığı için birebir uyumlu).
 */
const ANILIST_SEARCH = `query ($search: String) {
  Page(page: 1, perPage: 12) {
    media(search: $search, type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
      idMal
      title { romaji english native }
      startDate { year }
      episodes
      format
      coverImage { medium }
    }
  }
}`;

type AniListHit = {
  idMal?: number | null;
  title?: { romaji?: string | null; english?: string | null; native?: string | null };
  startDate?: { year?: number | null };
  episodes?: number | null;
  format?: string | null;
  coverImage?: { medium?: string | null };
};

async function searchViaAniList(text: string): Promise<SeriesHit[]> {
  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: ANILIST_SEARCH, variables: { search: text } }),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const json = (await res.json()) as { data?: { Page?: { media?: AniListHit[] } } };
  return (json.data?.Page?.media ?? [])
    .map((hit) => {
      const malId = Number(hit.idMal ?? 0);
      const title = (hit.title?.romaji || hit.title?.english || hit.title?.native || "").trim();
      if (!Number.isFinite(malId) || malId <= 0 || !title) return null;
      return {
        malId,
        title,
        english: (hit.title?.english ?? "").trim(),
        year: hit.startDate?.year ?? null,
        episodes: hit.episodes ?? null,
        type: (hit.format ?? "").trim(),
        image: hit.coverImage?.medium ?? "",
      } satisfies SeriesHit;
    })
    .filter((hit): hit is SeriesHit => hit !== null);
}

/** Yedek arama: Jikan (MAL sarmalayıcı). AniList çökerse devreye girer. */
async function searchViaJikan(text: string): Promise<SeriesHit[]> {
  const url =
    "https://api.jikan.moe/v4/anime?sfw&limit=12&order_by=members&sort=desc&q=" +
    encodeURIComponent(text);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Jikan ${res.status}`);
  const json = (await res.json()) as { data?: RawSearchHit[] };
  return (json.data ?? [])
    .map((hit) => {
      const malId = Number(hit.mal_id ?? 0);
      const title = (hit.title ?? "").trim();
      if (!Number.isFinite(malId) || malId <= 0 || !title) return null;
      return {
        malId,
        title,
        english: (hit.title_english ?? "").trim(),
        year: hit.year ?? hit.aired?.prop?.from?.year ?? null,
        episodes: hit.episodes ?? null,
        type: (hit.type ?? "").trim(),
        image: hit.images?.jpg?.image_url ?? "",
      } satisfies SeriesHit;
    })
    .filter((hit): hit is SeriesHit => hit !== null);
}

/**
 * Seriyi ADINA göre arar → MAL kimliğini bulmak için.
 *
 * NEDEN: panelde katalog için MAL kimliği elle giriliyordu; kullanıcı bunu
 * "kod girmek" olarak gördü ve haklı — kimse MAL numarası ezberlemez. Artık ad
 * yazılıp sonuçtan seri seçilir, kimlik kendiliğinden dolar.
 *
 * SIRA: AniList → (olmadı) Jikan. İkisi de olmazsa hata mesajı kullanıcıya
 * AYNEN gösterilir; "sessizce boş liste" dönmez (kullanıcı hangi servisin
 * bozuk olduğunu bilsin).
 *
 * @throws iki arama servisi de hata verirse
 */
export async function searchSeriesByName(query: string): Promise<SeriesHit[]> {
  const text = query.trim();
  if (text.length < 2) return [];

  const problems: string[] = [];
  for (const attempt of [searchViaAniList, searchViaJikan]) {
    try {
      const hits = await attempt(text);
      if (hits.length > 0) return hits;
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (problems.length === 2) throw new Error(problems.join(" · "));
  return [];
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

/** Sezon zincirindeki tek bir halka: serinin kendi kaydı ya da bir devam kaydı. */
export type SeasonChainEntry = {
  malId: number;
  /** Kaydın adı (AniList); serinin KENDİ kaydında boş kalır. */
  title: string;
};

/** Sezon zinciri ve belirsizlik bilgisi. */
export type SeasonChain = {
  /** Sıralı halkalar: İLK halka serinin KENDİ MAL kaydıdır. */
  entries: SeasonChainEntry[];
  /**
   * Zincir yürünürken aynı basamakta BİRDEN ÇOK TV devam kaydı bulundu mu.
   * `true` ise hangisinin sıradaki sezon olduğu bilinemez → eşleme YAPILMAZ.
   */
  ambiguous: boolean;
};

/**
 * Sezon zincirini kurar: serinin kendi kaydından başlar, ardından TV DEVAM
 * (SEQUEL) kayıtlarını ZİNCİR BOYUNCA adım adım takip eder.
 *
 * NEDEN GEREKLİ: ani.zip/AniList her kaydın bölümlerini KENDİ içinde yeniden
 * numaralandırır — bir devam kaydı bölümlerini "1. sezon" ya da "0. sezon" altında
 * verebilir. Bu yüzden "3. sezon"u aramak, aslında zincirin 3. halkasını bulmak
 * demektir; birebir `season === 3` eşleşmesi her devam sezonunda kırılır. Üstelik
 * devam kaydı serinin KENDİ ilişkilerinde değil, bir ÖNCEKİ kaydın ilişkilerinde
 * görünür (AniList ilişkileri GEÇİŞLİ DEĞİL) — bu yüzden zincir tek karelik değil,
 * sırayla yürünür. Ölçüm (27.09.2026): MAL 40748 → SEQUEL 51009 → SEQUEL 57658.
 *
 * @param malId Serinin MAL kimliği (zincirin ilk halkası)
 * @param depth Kaç halkaya kadar yürünecek (hedef sezon numarası yeterlidir)
 * @returns Zincir + belirsizlik işareti (belirsizse panel tahmin YAPMAZ)
 */
export async function fetchSeasonChain(malId: number, depth: number): Promise<SeasonChain> {
  if (!Number.isFinite(malId) || malId <= 0) return { entries: [], ambiguous: false };
  const limit = Math.max(1, Math.floor(depth));
  const entries: SeasonChainEntry[] = [{ malId, title: "" }];
  const seen = new Set<number>([malId]);

  while (entries.length < limit) {
    const current = entries[entries.length - 1];
    if (!current) break;
    let records: RelatedRecord[];
    try {
      records = await fetchRelatedRecords(current.malId);
    } catch {
      break; // tek adımın hatası zinciri bitirir; elde olanla devam edilir
    }
    // Sezon = TV formatındaki DEVAM kaydı. Film/OVA/ONA bir "sezon" DEĞİLDİR;
    // onları zincire katmak yanlış kayda eşlemeye yol açardı.
    const sequels = records.filter(
      (record) =>
        record.relationType === "SEQUEL" &&
        (record.format === "TV" || record.format === "TV_SHORT"),
    );
    if (sequels.length === 0) break; // zincir bitti
    if (sequels.length > 1) return { entries, ambiguous: true }; // hangisi sıradaki sezon? belirsiz
    const next = sequels[0];
    if (!next) break;
    if (seen.has(next.malId)) break; // döngü koruması
    seen.add(next.malId);
    entries.push({ malId: next.malId, title: next.title });
  }

  return { entries, ambiguous: false };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GİRİŞ TÜRÜ SINIFLANDIRMASI — "YENİ SEZON" mu, "AYNI SEZONUN DEVAMI" mı?
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * NEDEN GEREKLİ (kullanıcı bildirimi, 29.09.2026, ikinci tur): hedef sezon/part
 * tespiti yalnızca VERİTABANINDA SATIRI OLAN sezonların `mal_id`siyle eşleşiyordu.
 * DB'de S1 satırı OLMADIĞI için (Mushoku: tek satır `{number:2, mal_id:51179}`)
 * 45576 (S1'in Part 2'si) hiçbir mevcut sezonla eşleşmiyor ve kod "son sezonun
 * part'ı" dalına düşüp hedefi **S2** yapıyordu (uyarı da çıkmıyordu). Doğru karar
 * DB satırlarından BAĞIMSIZ olmalı: girilen kimlik AniList SEQUEL zincirinde
 * nereye düşüyorsa oraya bağlanır.
 *
 * SINYAL LİSTESİ:
 *   · AYNI SEZONUN DEVAMI (part/cour): "Part 2" · "Cour 2" · "2nd Cour" ·
 *     "Kōhen / Kouhen" · "Kısım 2"
 *   · YENİ SEZON: "Season 2/3/…" · "2nd Season / 3rd Season" ·
 *     "II / III / IV / …" (Romen rakamı)
 * PART SİNYALİ SEZON SİNYALİNDEN ÖNCELİKLİDİR: "Mushoku Tensei III: … Part 2"
 * hem "III" hem "Part 2" içerir; doğru cevap S3'ün 2. cour'udur → part.
 *
 * BELİRSİZ: iki sinyal de yoksa `"ambiguous"` döner. Çağıran (SeasonsPanel) bu
 * durumda küçük bir seçim gösterir ("Bu sezonun devamı" / "Yeni sezon") —
 * heuristiğin önerisi varsayılan seçili olur; böylece hiçbir animede yanlış
 * sezona yazma yapılmaz.
 */
export type SeasonEntryKind = "season" | "part" | "ambiguous";

/** PART/COUR ibaresi — `lib/puffy.ts → isPartContinuation` ile AYNI kural. */
const PART_SIGNAL_RE = /\b(?:part|cour|k[ıi]s[ıi]m|k[oō]u?hen)\b/i;
/** YENİ SEZON ibaresi — numaralı sezon ("Season 2") ya da Romen rakamı ("II"). */
const SEASON_SIGNAL_RE =
  /\b(?:season\s*\d+|\d+(?:st|nd|rd|th)\s+season|(?:ii|iii|iv|v|vi|vii|viii|ix|x))\b/i;

/**
 * Bir başlığı "yeni sezon" / "aynı sezonun devamı" olarak sınıflandırır.
 *
 * @param title Başlık (romaji + İngilizce birlikte verilebilir; ikisi de taranır)
 * @returns `"part"` · `"season"` · `"ambiguous"` (iki sinyal de yok)
 */
export function classifySeasonTitle(title: string): SeasonEntryKind {
  const text = (title ?? "").trim();
  if (!text) return "ambiguous";
  // PART ÖNCE: "Season 3 Part 2" = S3'ün 2. cour'u (yeni sezon DEĞİL).
  if (PART_SIGNAL_RE.test(text)) return "part";
  if (SEASON_SIGNAL_RE.test(text)) return "season";
  return "ambiguous";
}

/** Zincirdeki TEK halka + çözülmüş sezon/part konumu. */
export type NumberedSeasonEntry = {
  malId: number;
  /** Kaydın adı (AniList; serinin KENDİ kaydında boş kalır). */
  title: string;
  /** Kaçıncı sezon (1 tabanlı). */
  season: number;
  /** Aynı sezonun kaçıncı part'ı (1 tabanlı); part DEĞİLSE `null`. */
  part: number | null;
  /** Sınıflandırma sonucu (belirsiz girişler panelde sorulur). */
  kind: SeasonEntryKind;
};

/** Numaralandırılmış sezon zinciri. */
export type NumberedSeasonChain = {
  /** Sıralı halkalar: İLK halka serinin KENDİ kaydıdır (S1, part yok). */
  entries: NumberedSeasonEntry[];
  /**
   * Zincir yürünürken aynı basamakta BİRDEN ÇOK TV devam kaydı bulundu mu.
   * `true` ise hangisinin sıradaki sezon olduğu bilinemez → zincir kesilir.
   */
  ambiguous: boolean;
};

/**
 * Serinin KENDİ kimliğinden başlar, TV DEVAM (SEQUEL) kayıtlarını sırayla yürür
 * ve her halkayı "kaçıncı sezonun kaçıncı part'ı" olarak NUMARALANDIRIR.
 *
 * NEDEN AYRI FONKSİYON: `fetchSeasonChain` yalnızca sıralı halkaları verir ve
 * "bu halka yeni sezon mu, part mı?" bilgisini TAŞIMAZ; hedef sezon/part kararı
 * için konum şarttır. Bu fonksiyon konumu başlık sinyalleriyle çözer ve DB
 * satırlarından BAĞIMSIZ çalışır (S1 satırı olmayan seride de doğru sonuç).
 *
 * @param rootMalId Serinin MAL kimliği (`shows.mal_id`) — zincirin ilk halkası
 * @param depth En fazla kaç halka yürünecek
 * @param stopAtMalId Bu kimliğe ulaşılınca DUR (panel yalnızca onu arar; gereksiz
 *        AniList isteği yapılmaz — ör. 45576 için 2 istek yeter)
 */
export async function fetchNumberedSeasonChain(
  rootMalId: number,
  depth: number,
  stopAtMalId?: number | null,
): Promise<NumberedSeasonChain> {
  if (!Number.isFinite(rootMalId) || rootMalId <= 0) return { entries: [], ambiguous: false };
  const limit = Math.max(1, Math.floor(depth));
  const entries: NumberedSeasonEntry[] = [
    // Serinin kendi kaydı HER ZAMAN 1. sezonun kendisidir (part yok).
    { malId: rootMalId, title: "", season: 1, part: null, kind: "season" },
  ];
  const stop = Number.isFinite(stopAtMalId ?? NaN) ? (stopAtMalId as number) : null;
  if (stop !== null && stop === rootMalId) return { entries, ambiguous: false };
  const seen = new Set<number>([rootMalId]);

  while (entries.length < limit) {
    const current = entries[entries.length - 1];
    if (!current) break;
    let records: RelatedRecord[];
    try {
      records = await fetchRelatedRecords(current.malId);
    } catch {
      break; // tek adımın hatası zinciri bitirir; elde olanla devam edilir
    }
    const sequels = records.filter(
      (record) =>
        record.relationType === "SEQUEL" &&
        (record.format === "TV" || record.format === "TV_SHORT"),
    );
    if (sequels.length === 0) break; // zincir bitti
    if (sequels.length > 1) return { entries, ambiguous: true }; // hangisi sıradaki sezon? belirsiz
    const next = sequels[0];
    if (!next) break;
    if (seen.has(next.malId)) break; // döngü koruması
    seen.add(next.malId);
    // Sınıflandırma HEM romaji HEM İngilizce ad üzerinden yapılır: sinyal
    // başlığın yalnızca birinde olabilir (ör. romaji "Part 2" ↔ İngilizce "Cour 2").
    const kind = classifySeasonTitle(`${next.title} ${next.english}`.trim());
    if (kind === "part") {
      entries.push({
        malId: next.malId,
        title: next.title,
        season: current.season,
        part: (current.part ?? 1) + 1,
        kind,
      });
    } else {
      entries.push({
        malId: next.malId,
        title: next.title,
        season: current.season + 1,
        part: null,
        kind,
      });
    }
    if (stop !== null && next.malId === stop) break; // hedef bulundu → dur
  }

  return { entries, ambiguous: false };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * HEDEF SEZON/PART KARARI — SAF FONKSİYON (DB satırlarından BAĞIMSIZ UNIVERSAL).
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Karar TABLOSU (öncelik sırası):
 *   (a) girilen kimlik MEVCUT bir sezonun KENDİ kimliği → o sezon; yeni sezon YOK
 *   (b) girilen kimlik ZİNCİRDE bir PART (aynı sezonun devamı) → hedef O sezon,
 *       part kaydı girilen kimlik; "S{n+1} DEĞİL" uyarısı
 *   (c) girilen kimlik ZİNCİRDE BELİRSİZ → yeni sezon varsayılır + panelde küçük
 *       seçim (kullanıcı "bu sezonun devamı" diyebilir)
 *   (d) girilen kimlik ZİNCİRDE bir YENİ SEZON → zincirdeki N. sezon
 *   (e) hiçbiri değil → `null` (çağıran yedek (prequel) akışına düşer)
 *
 * NEDEN SAF FONKSİYON: karar metni ve hedef numarası, "hangi DB satırı var?"
 * sorusundan AYRI doğrulanabilmelidir. Bu fonksiyonun GİRDİSİ zincir + mevcut
 * sezon listesidir; yan etkisi YOKTUR. Böylece kural tek yerde durur ve
 * gerçek veriyle (canlı AniList zinciri) doğrudan sınanabilir.
 *
 * ⚠️ ÇAĞRI SÖZLEŞMESİ (regresyon koruması, 29.09.2026) — `rootMalId` SERİNİN KENDİ
 * kimliği OLMALIDIR (`shows.mal_id`), KULLANICININ GİRDİĞİ kimlik DEĞİL. Girdi
 * kimliği kök yapılırsa `fetchNumberedSeasonChain` zinciri o kimlikten başlar,
 * `rootMalId === pendingMalId` olur ve zincir ANINDA tek halka döner:
 * `{malId: pending, season: 1, part: null}`. O zaman bir PART (ör. 45576) "1.
 * sezonun kendisi" sanılır ve "part" dalı HİÇ çalışmaz → "S1'in 2. part'ı"
 * uyarısı yerine "serinin kendi kimliği" metni çıkar (ölçülen hata buydu).
 *
 * @param input.pendingMalId Girilen MAL kimliği (`null` → karar verilmez)
 * @param input.rootMalId Serinin KENDİ kimliği (`shows.mal_id`)
 * @param input.seasons Mevcut `show_seasons` satırları (number + mal_id)
 * @param input.chainEntries `fetchNumberedSeasonChain` halkaları
 * @param input.chainAmbiguous Zincir aynı basamakta çatallandı mı (tahmin yok)
 * @returns Hedef sezon/part + kullanıcıya gösterilecek uyarı; karar yoksa `null`
 */
export type CatalogTarget = {
  /** Hedef sezon numarası (DB satırı olmasa da doğrudur). */
  season: number;
  /** Girilen kimlik aynı sezonun part'ıysa o kimlik; değilse `null`. */
  part: number | null;
  /** Yeni sezon hedefleniyorsa sezona YAZILACAK kimlik; değilse `null`. */
  pending: number | null;
  /** Panelin amber kutuda gösterdiği, kararın NEDENİNİ anlatan metin. */
  notice: string;
  /** Belirsiz giriş: panelde küçük seçim gösterilir (öneri: "yeni sezon"). */
  ambiguous: { malId: number; partSeason: number; seasonNumber: number } | null;
};

export function resolveCatalogTarget(input: {
  pendingMalId: number | null;
  rootMalId: number | null;
  seasons: { number: number; mal_id?: number | null }[];
  chainEntries: NumberedSeasonEntry[];
  chainAmbiguous: boolean;
}): CatalogTarget | null {
  const { pendingMalId, rootMalId, seasons, chainEntries, chainAmbiguous } = input;
  if (pendingMalId === null || !Number.isFinite(pendingMalId) || pendingMalId <= 0) return null;

  // (a) MEVCUT BİR SEZONUN KENDİ KİMLİĞİ Mİ?
  const owner = seasons.find((season) => season.mal_id === pendingMalId);
  if (owner) {
    return {
      season: owner.number,
      part: null,
      pending: null,
      notice:
        `MAL ${pendingMalId} zaten S${owner.number} sezonunun kimliği — ` +
        `YENİ SEZON AÇILMADI, mevcut sezon hedeflendi.`,
      ambiguous: null,
    };
  }

  // (b-d) ZİNCİRDEN ÇÖZ. Zincir çatallandıysa (birden çok SEQUEL) TAHMİN YOK.
  if (rootMalId != null && !chainAmbiguous) {
    const hit = chainEntries.find((entry) => entry.malId === pendingMalId);
    if (hit) {
      if (hit.part !== null) {
        return {
          season: hit.season,
          part: pendingMalId,
          pending: null,
          notice:
            `MAL ${pendingMalId} → S${hit.season}'in ${hit.part}. part'ı (AYNI sezonun DEVAMI), ` +
            `S${hit.season + 1} DEĞİL — numaralar ${hit.season}. sezonun bölümlerinden sonra sürer.`,
          ambiguous: null,
        };
      }
      if (hit.kind === "ambiguous") {
        const seasonNumber = hit.season;
        return {
          season: seasonNumber,
          part: null,
          pending: pendingMalId,
          notice:
            `MAL ${pendingMalId} → S${seasonNumber} (yeni sezon) VARSAYILDI — başlıkta sezon/part ibaresi yok. ` +
            `Yanlışsa paneldeki seçimden "Bu sezonun devamı"nı seç.`,
          ambiguous: {
            malId: pendingMalId,
            partSeason: Math.max(1, seasonNumber - 1),
            seasonNumber,
          },
        };
      }
      return {
        season: hit.season,
        part: null,
        pending: pendingMalId,
        notice:
          hit.season === 1
            ? `MAL ${pendingMalId} serinin kendi kimliği — 1. sezon hedeflendi.`
            : `MAL ${pendingMalId} → S${hit.season} (zincirdeki ${hit.season}. sezon) — hedef S${hit.season}.`,
        ambiguous: null,
      };
    }
  }

  // (e) karar yok → çağıran yedek akışına düşer (prequel / yeni sezon ipucu).
  return null;
}

/**
 * Hedef sezonu zincirden ORDİNAL (sıra) ile seçer.
 *
 * KURAL: `ordinal` 0 tabanlıdır; zincirin o basamağındaki kaydın kataloğundan:
 *   1) birebir hedef sezon numarası varsa onu alır,
 *   2) yoksa katalogda TEK (0 dışı) sezon varsa o sezonu alır — kayıt bölümlerini
 *      "1" ya da "0" altında numaralandırmış olabilir; bu yüzden SIRA esas alınır,
 *   3) birden çok sezon varsa hangisinin hedef olduğu bilinemez → `null` (tahmin YOK).
 *
 * @returns Hedef sezonun bölümleri ya da belirlenemezse `null`
 */
export function pickChainSeason(
  entries: SeasonChainEntry[],
  catalogs: CatalogEpisode[][],
  ordinal: number,
  seasonNumber: number,
): CatalogEpisode[] | null {
  if (ordinal < 0 || ordinal >= entries.length) return null; // zincir hedeften kısa
  const catalog = catalogs[ordinal] ?? [];
  const exact = catalog.filter((ep) => ep.season === seasonNumber);
  if (exact.length > 0) return exact;
  const seasons = catalogSeasons(catalog).filter((value) => value > 0); // 0 = özel bölüm
  if (seasons.length === 1) return catalog.filter((ep) => ep.season === seasons[0]);
  return null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PART (KISIM) BÖLÜMLERİNİN MUTLAK NUMARALARINI ÜRETİR — SAF FONKSİYON.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * NEDEN AYRI FONKSİYON: "part'ın 1–12'si sezonun 15–26'sı olur" kuralı, aksi
 * hâlde panelin içinde satır arası bir `map` olarak kalıyordu ve gerçek veriyle
 * sınanamıyordu. Kural burada tek yerde, saf olarak durur; panel yalnızca çağırır.
 *
 * KURAL: kaydırma (`offset`) = PART'tan ÖNCE gelen toplam bölüm sayısı
 * (ör. Mushoku S3'ün kendi kataloğu 14 bölüm → Part 2'nin 1..N'i 15..14+N olur).
 *
 * `offset > 0` DEĞİLSE (katalog numaraları ZATEN mutlak: ani.zip bazı part'ları
 * 12..23 gibi sürekli verir) liste BİREBİR korunur — çift sayma olmaz.
 *
 * @param episodes Part'ın katalog bölümleri (katalog numaralarıyla)
 * @param offset  Uygulanacak kaydırma (0 veya negatif → kaydırma YOK)
 * @returns Yeni dizi; girdi DEĞİŞTİRİLMEZ (her öğe kopyalanır)
 */
export function numberPartEpisodes<T extends { number: number }>(
  episodes: T[],
  offset: number,
): T[] {
  if (!(offset > 0)) return episodes;
  return episodes.map((episode) => ({ ...episode, number: episode.number + offset }));
}

/**
 * Katalog araması sırasında TEK bir MAL kimliği için denemenin sonucu.
 * Panel bu kayıtları, "kayıt yok" (404) ile "geçici ağ/sunucu hatası"nı AYIRT
 * edip kullanıcıya DOĞRU mesajı göstermek için toplar.
 */
export type CatalogAttempt = {
  malId: number;
  /** true → ani.zip 200 döndü (kayıt var; hedef sezon o kayıtta olmayabilir). */
  ok: boolean;
  /** HTTP durum kodu; `0` → ağ hatası (yanıt hiç gelmedi). */
  status: number;
};

/**
 * Hedef sezonun katalog kaydı bulunamadığında panele gösterilecek DÜRÜST ve
 * EYLEME DÖNÜK Türkçe mesajı üretir.
 *
 * NEDEN GEREKLİ (kullanıcı şikâyeti, 27.09.2026): yeni bir sezon açıldığında seri
 * SEVİYESİNDEKİ MAL kimliğiyle aranıyor; sezonun KENDİ kaydı ani.zip'te yoksa
 * upstream HTTP 404 dönüyor (ör. MAL 70259 / 70261). Panel eskiden yalnızca
 * "bölüm listesi bulunamadı" diyordu — kullanıcı ne olduğunu anlamıyor ve
 * "yeni sezon/bölüm ekleyemiyorum" diyordu. Bu fonksiyon denenen MAL kimliklerini
 * ve 404'ü AÇIKÇA yazar; bölümlerin ELLE eklenmesi gerektiğini söyler.
 *
 * UYDURMA YOK: hiçbir durumda bölüm üretilmez ve başka bir sezonun listesine
 * sessizce düşülmez; yalnızca durum açıklanır.
 *
 * @param attempts Denenen MAL kimlikleri ve sonuçları (sırayla)
 * @param seasonNumber Hedef sezon numarası (mesajda S{n} olarak geçer)
 */
export function catalogFailureMessage(attempts: CatalogAttempt[], seasonNumber: number): string {
  const triedText = attempts.length > 0 ? attempts.map((a) => a.malId).join(", ") : "—";
  // 404 DIŞINDAKİ başarısızlıklar (ağ hatası, 5xx…) GEÇİCİ sayılır.
  const transient = attempts.filter((a) => !a.ok && a.status !== 404);
  const notFound = attempts.filter((a) => !a.ok && a.status === 404);

  // (a) GEÇİCİ hata: kayıt yok hükmü VERİLMEZ; önce tekrar denenmesi söylenir.
  if (transient.length > 0) {
    const details = transient
      .map((a) =>
        a.status === 0 ? `MAL ${a.malId} (ağ hatası)` : `MAL ${a.malId} (HTTP ${a.status})`,
      )
      .join(" · ");
    return (
      `Katalog (ani.zip) şu an YANIT VERMİYOR — bu GEÇİCİ bir sorun: ${details}. ` +
      `Denenen MAL kimlikleri: ${triedText}. Bu "kayıt yok" anlamına GELMEZ. ` +
      `Sağ üstteki yenile (↻) düğmesiyle tekrar dene; sürerse ${seasonNumber}. sezonun ` +
      `bölümlerini aşağıdaki "Bölümler" bölümünden ELLE ekle.`
    );
  }

  // (b) GERÇEK 404: sezonun kaydı upstream'de YOK — katalogdan asla gelmeyecek.
  if (notFound.length > 0) {
    return (
      `Bu sezonun (S${seasonNumber}) katalog kaydı ani.zip'te YOK — denenen MAL kimlikleri: ` +
      `${triedText} → ani.zip HTTP 404 döndü. Yani bu sezonun kendi kaydı upstream'de ` +
      `bulunmuyor; bölüm listesi katalogdan ÇEKİLEMEZ (başka sezonun bölümleri KARIŞTIRILMAZ). ` +
      `Çözüm: bölümleri aşağıdaki "Bölümler" bölümünden ELLE ekle (numara otomatik atanır). ` +
      `Katalog kaydı sonradan düzelirse "Katalogdan çek" ile tekrar deneyebilirsin.`
    );
  }

  // (c) Kayıtlar erişilebildi ama hedef sezona uyan bölüm çıkmadı.
  return (
    `Denenen MAL kayıtlarında (${triedText}) ${seasonNumber}. sezona ait bölüm bulunamadı. ` +
    `Bölümler başka bir sezona sessizce YAZILMAZ. Gerekirse bölümleri aşağıdaki "Bölümler" ` +
    `bölümünden ELLE ekle.`
  );
}

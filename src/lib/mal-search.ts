/**
 * MAL (MyAnimeList) KİMLİĞİ / ADI İLE ANİME ARAMA — TEK ORTAK KAYNAK.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NEDEN AYRI DOSYA (kullanıcı isteği, 29.09.2026)
 *
 * Aynı AniList sorgusu iki ayrı bileşende KOPYALANMIŞTI:
 *   · `components/admin/ShowEditor.tsx` → "Düzenle" panelindeki `searchMal()`
 *   · `components/admin/AddShowButton.tsx` → "Yeni seri ekle" formu
 *
 * Kopyala-yapıştır kod, bir düzeltmenin yalnızca bir forma yapılmasına ve iki
 * akışın zamanla AYRIŞMASINA yol açıyordu (ör. 404 yönlendirme metni, biçim/yıl
 * alanlarının eklenmesi). Sorgu, hata metni ve tür eşlemesi artık BURADA; iki
 * bileşen de buradan kullanır.
 *
 * ── ANILIST SEÇİMİ ────────────────────────────────────────────────────────
 * Anahtar/giriş GEREKMEZ ve CORS'u açıktır (`https://graphql.anilist.co`), bu
 * yüzden arama doğrudan tarayıcıdan yapılır (projede `/api/anilist` sunucu
 * rotası yalnızca önbelleklenmesi gereken ana sayfa verisi içindir).
 *
 * ── İKİ ARAMA YOLU, TEK BİÇİM ─────────────────────────────────────────────
 *   1. Kutuya SAYI yazılırsa → doğrudan o MAL kimliği sorgulanır (`Media`).
 *   2. Kutu boşsa → seri adıyla aranır (`Page.media`).
 * İki sorgu da AYNI alanları ister, sonuç `MalHit`e indirgenir.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const ANILIST_ENDPOINT = "https://graphql.anilist.co";

/** AniList yanıtındaki tek kayıt — yalnızca kullandığımız alanlar. */
type AniListMedia = {
  idMal?: number | null;
  title?: { romaji?: string | null; english?: string | null } | null;
  format?: string | null;
  startDate?: { year?: number | null } | null;
  genres?: string[] | null;
  coverImage?: { extraLarge?: string | null; large?: string | null } | null;
};

/**
 * Aramanın istemciye dönen TEK sonuç biçimi.
 *
 * NOT: `ShowEditor` eskiden yalnızca `malId/title/format/year` taşıyordu;
 * "Yeni seri ekle" formu tür ve kapak da ister. Tek tip kullanıldığı için
 * alanlar buraya eklendi — mevcut kullanımlar etkilenmez.
 */
export type MalHit = {
  malId: number;
  /** Tercihen İngilizce başlık, yoksa romaji (ikisi de yoksa boş). */
  title: string;
  /** AniList biçimi: `TV`, `MOVIE`, `ONA`… Boş olabilir. */
  format: string;
  year: number | null;
  /** AniList türleri (İngilizce, ör. `["Action","Sci-Fi"]`). */
  genres: string[];
  /** Kapak adresi: `coverImage.extraLarge` (yoksa `large`). Boş olabilir. */
  cover: string;
};

/**
 * MAL KİMLİĞİ ANILIST'TE "ANİME" OLARAK YOKKEN GÖSTERİLEN MESAJ.
 *
 * ── NEDEN (ölçülen hata, 29.09.2026) ──────────────────────────────────────────
 * Kullanıcı Mushoku S2'nin özel bölümünün kimliğini (MAL **55818**, "Guardian
 * Fitz") kutuya yazıp "MAL'de ara" dediğinde şu ÖLÜ-SON hata çıkıyordu:
 *
 *   "MAL 55818 AniList'te yok (404) — kimliği kontrol et."
 *
 * Oysa 55818 MAL'de GERÇEK bir kayıttır; yalnızca AniList'in `idMal` eşlemesinde
 * ANİME kaydı yoktur (AniList `Media(idMal:55818, type:ANIME)` → 404 döner) ve
 * ani.zip de bu kimlik için 0 bölüm verir. Yani kimlik "yanlış" DEĞİLDİR; panel
 * yanlış yeri aramıştır. Mesaj kullanıcıyı "kimliği kontrol et" diye boşuna
 * yönlendiriyor ve gerçek çıkış yolunu söylemiyordu.
 *
 * ── DOĞRU YOL (uydurma yok) ──────────────────────────────────────────────────
 * Özel/ön bölümler (0. Bölüm) bu projede SEZONUN KENDİ kataloğundan gelir
 * (`lib/season-specials.ts` → ani.zip `season: 0`). Mushoku S2 kataloğu
 * (MAL 51179) "Guardian Fitz"i `0. Bölüm` olarak zaten listeler. Yani mesaj,
 * kullanıcıyı ALT SEZONUN KENDİ kimliğiyle aramaya yönlendirir; hiçbir kayıt
 * uydurulmaz, hiçbir dış servis eklenmez.
 */
export function malIdMissText(malId: number): string {
  return (
    `MAL ${malId} AniList'te "ANİME" kaydı olarak yok (404) — kimlik yanlış olmayabilir. ` +
    `Özel/ön bölümler (0. Bölüm) çoğu dizide SEZONUN KENDİ MAL kimliğinin kataloğunda listelenir; ` +
    `ait olduğu sezonun kimliğiyle ara (ör. Mushoku S2 → 51179'u ara; "Guardian Fitz" 0. Bölüm olarak çıkar).`
  );
}

/**
 * ANILIST TÜRLERİNİN TÜRKÇE KARŞILIKLARI.
 *
 * AniList `genres` alanı İngilizce sabit bir kümedir (aşağıdakiler). Site ise
 * türü serbest metin olarak tutar ve paneldeki öneri listesi mevcut kayıtların
 * `genre` değerlerinden üretilir (bkz. `routes/admin.tsx` → `genreOptions`).
 * Bu yüzden çeviri burada yapılır; `mapGenres` ilaveten VAR OLAN bir seçeneğin
 * yazımını korur (aynı tür için ikinci bir kategori doğmasın).
 *
 * Sözlükte olmayan bir ad gelirse OLDUĞU GİBİ bırakılır — uydurma yok.
 */
const GENRE_TR: Record<string, string> = {
  Action: "Aksiyon",
  Adventure: "Macera",
  Comedy: "Komedi",
  Drama: "Drama",
  Ecchi: "Ecchi",
  Fantasy: "Fantastik",
  Horror: "Korku",
  "Mahou Shoujo": "Mahou Shoujo",
  Mecha: "Mecha",
  Music: "Müzik",
  Mystery: "Gizem",
  Psychological: "Psikolojik",
  Romance: "Romantizm",
  "Sci-Fi": "Bilim Kurgu",
  "Slice of Life": "Günlük Yaşam",
  Sports: "Spor",
  Supernatural: "Doğaüstü",
  Thriller: "Gerilim",
};

/**
 * AniList türlerini panelin `genre` alanına yazılacak metne çevirir.
 *
 *   ["Action","Sci-Fi"] + mevcut ["Aksiyon","Dram"]
 *     → "Aksiyon, Bilim Kurgu"
 *
 * KURALLAR:
 *   · Her ad önce Türkçeye çevrilir (`GENRE_TR`); karşılığı yoksa aynen kalır.
 *   · Çevrilen ad, `existing` içinde (büyük/küçük harf duyarsız) varsa VAR OLAN
 *     yazım kullanılır. Böylece DB'de "aksiyon" yazılmışsa "Aksiyon" diye ikinci
 *     bir kategori açılmaz.
 *   · Tekrarlar atılır, SIRA AniList'in verdiği sıradır (ilk tür sitede öne
 *     çıkar: hero/şerit yalnızca ilk türü yazar).
 *   · Uzunluk KISITLANMAZ: site türü zaten `"A, B, C"` biçiminde tutuyor ve
 *     süzme/sayım bu biçime göre çalışıyor; tür sayısını kırpmak bilgi kaybı olurdu.
 */
export function mapGenres(genres: string[], existing: string[] = []): string {
  const normalized = new Map<string, string>();
  for (const option of existing) {
    const value = option.trim();
    if (value) normalized.set(value.toLocaleLowerCase("tr"), value);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of genres ?? []) {
    const name = raw.trim();
    if (!name) continue;
    const translated = GENRE_TR[name] ?? name;
    const label = normalized.get(translated.toLocaleLowerCase("tr")) ?? translated;
    const key = label.toLocaleLowerCase("tr");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out.join(", ");
}

/**
 * MAL KİMLİĞİ ya da AD ile AniList'ten kayıt arar.
 *
 * `malId` pozitif bir tam sayıysa KİMLİKLE (tek kayıt), değilse `title` İLE
 * (en fazla 8 kayıt) aranır. İkisi de yoksa boş liste döner.
 *
 * ⚠️ Ağ hatası ve 404 YUTULMAZ (`throw`): çağıran taraf hangi mesajı göstereceğine
 * karar verir — kimlikle aramada `malIdMissText`, adla aramada genel mesaj.
 */
export async function searchMal(opts: {
  malId?: number | null;
  title?: string;
}): Promise<MalHit[]> {
  const typedId = Number(opts.malId);
  const byId = Number.isFinite(typedId) && typedId > 0;
  const query = (opts.title ?? "").trim();
  if (!byId && !query) return [];

  const gql = byId
    ? {
        query:
          "query($id:Int){Media(idMal:$id,type:ANIME)" +
          "{idMal title{romaji english} format startDate{year} genres coverImage{extraLarge large}}}",
        variables: { id: typedId },
      }
    : {
        query:
          "query($q:String){Page(perPage:8){media(search:$q,type:ANIME,sort:SEARCH_MATCH)" +
          "{idMal title{romaji english} format startDate{year} genres coverImage{extraLarge large}}}}",
        variables: { q: query },
      };

  const res = await fetch(ANILIST_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(gql),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const json = (await res.json()) as {
    data?: { Media?: AniListMedia | null; Page?: { media?: AniListMedia[] | null } | null } | null;
  };

  // Kimlikle arama tek kayıt döner; adla arama sayfa döner. İkisi de aynı
  // `MalHit` biçimine indirgenir.
  const raw = (byId ? [json.data?.Media] : (json.data?.Page?.media ?? [])).filter(
    (item): item is AniListMedia => Boolean(item),
  );

  return (
    raw
      // `idMal` yoksa (nadiren) o kayıt işe yaramaz — listeye hiç konmaz.
      .filter((item) => Number.isFinite(item.idMal ?? Number.NaN))
      .map((item) => ({
        malId: Number(item.idMal),
        title: (item.title?.english || item.title?.romaji || "").trim(),
        format: (item.format ?? "").trim(),
        year: item.startDate?.year ?? null,
        genres: (item.genres ?? []).filter((genre): genre is string => typeof genre === "string"),
        cover: (item.coverImage?.extraLarge || item.coverImage?.large || "").trim(),
      }))
  );
}

/**
 * ANILIST KAPAĞINI SAME-ORIGIN VEKİLDEN İNDİRİR ve Storage'a yüklemeye hazır
 * `File` döndürür.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NEDEN VEKİL ROTA (`/api/anilist-cover`) — ölçüldü, tahmin değil:
 * AniList kapak CDN'i (`s4.anilist.co`) `Access-Control-Allow-Origin` BAŞLIĞI
 * GÖNDERMİYOR. Doğrudan `fetch(coverUrl)` bu yüzden tarayıcıda CORS ile
 * reddedilir (kapak yalnızca `<img src>` ile GÖSTERİLEBİLİR, indirilemez).
 * Poster R2'ye yüklenmesi gerektiği için (projedeki desen:
 * `uploadImage(file,"posters")` → herkese açık R2 URL'si → `shows.image_path`) baytlar
 * sunucu vekilinden alınır; vekil yalnızca AniList alan adlarına izin verir.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * NOT: Bu yardımcı TARAYICIDA çalışır (göreli `/api/...` adresi kullanır).
 */
export async function fetchMalCoverFile(coverUrl: string): Promise<File> {
  const url = (coverUrl ?? "").trim();
  if (!url) throw new Error("Kapak adresi boş.");
  const res = await fetch(`/api/anilist-cover?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`Kapak indirilemedi (${res.status}).`);
  const blob = await res.blob();
  const type = blob.type || "image/jpeg";
  // Uzantı, Storage yolunu üreten `uploadToBucket` (file.name → uzantı) için gerekir.
  const ext = (type.split("/")[1] || "jpg").replace("jpeg", "jpg");
  return new File([blob], `mal-cover.${ext}`, { type });
}

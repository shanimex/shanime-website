import { supabase } from "@/integrations/supabase/client";
import EPISODE_COVER_FILES from "@/data/episode-cover-files.json";
import { fetchSeasonAirdates } from "@/lib/anizip-covers";
import type { SeasonPartEntry } from "@/lib/embed-provider";
import { QUERY_STALE_MS } from "@/lib/query-client";
import { cachedRead, TTL_DETAIL_SECONDS } from "@/lib/server-cache";
import { fetchSeasonSpecials, matchCatalogSpecial } from "@/lib/season-specials";

export type Show = {
  id: string;
  title: string;
  subtitle: string;
  image_path: string;
  banner_image_path?: string | null;
  /** Panelden yüklenen vitrin videosu (mp4). Boşsa koddaki statik video kullanılır. */
  banner_video_path?: string | null;
  /** Ana sayfa vitrininde (hero) dönecek seri mi? Panelden açılır. */
  is_featured: boolean;
  /**
   * Kayıt türü: `"series"` (dizi — sezon/bölüm akışı) veya `"movie"` (tek parça
   * film). Panelde iki AYRI bölümde listelenir (bkz. `routes/admin.tsx`).
   *
   * İstek (kullanıcı, 28.09.2026): "filmler eklemek için ayrı yer ekle, seriler
   * değil de filmler diye."
   *
   * `select("*")` kullanıldığı için kolon veritabanında YOKSA alan hiç gelmez
   * (`undefined`) ve uygulama yine çalışır — o durumda her kayıt "seri" sayılır.
   * Bu yüzden tip opsiyoneldir ve okurken `?? "series"` ile varsayılana düşülür.
   * Kolonu ekleyen migration: `supabase/migrations/20260928_show_kind.sql`.
   */
  kind?: string | null;
  sort_order: number;
  slug: string | null;
  description: string;
  year: string;
  genre: string;
  watch_url: string;
  /**
   * MyAnimeList kimliği. Embed sağlayıcısı (megaplay) bölüm adresini bu kimlikle
   * üretir: `https://megaplay.buzz/stream/mal/{mal_id}/{bölüm}/sub`.
   *
   * Kolon veritabanında yoksa ya da boşsa `undefined`/`null` gelir; o durumda
   * sağlayıcı adres ÜRETEMEZ (bölümde "video yok" durumu oluşur).
   * `fetchShowDetail` `select("*")` kullandığı için kolon eklenir eklenmez gelir.
   */
  mal_id?: number | null;
  /**
   * animecix.tv dizi kimliği (titleId). Türkçe (hardsub) kaynağı bu kimlikle
   * çözülür: `/api/animecix?titleId=…&season=…&episode=…`.
   *
   * Ada göre arama YERİNE saklanır: ölçümde (27.09.2026) "mushoku tensei"
   * aramasının ilk sonucu ana dizi değil SPECIALS kaydıydı; ada güvenmek yanlış
   * seriye bölüm yazma riski taşıyordu. Kolon veritabanında yoksa `undefined` gelir.
   */
  animecix_id?: number | null;
};

export type Season = {
  id: string;
  show_id: string;
  number: number;
  title: string;
  sort_order: number;
  /**
   * SEZONUN KENDİ MAL KİMLİĞİ — kullanıcı isteği (29.09.2026).
   *
   * Kolon `supabase/migrations/20260929_season_mal_id.sql` ile gelir. Sezon
   * yüklemesi `select("*")` yaptığı için kolon eklenir eklenmez buraya düşer;
   * kolon YOKSA `undefined` gelir ve hiçbir şey bozulmaz.
   *
   * · `null`/`undefined` → katalog SERİNİN kimliğinden + AniList zincirinden
   *   çözülür (bugüne kadarki davranış).
   * · dolu → o sezonun katalogu DOĞRUDAN bu kimlikten çekilir; zincir tahmini
   *   devre dışı kalır, yanlış sezon gelme riski ortadan kalkar.
   */
  mal_id?: number | null;
  /**
   * ÇOK PART'LI SEZON KAYDI — `show_seasons.parts` (jsonb).
   *
   * Şekil: `[{ malId, start, count, animecixId? }]` (bkz. AnizipSyncPanel → part
   * senkronu). `start` = part'ın SEZON İÇİ mutlak başlangıç bölümü (1 tabanlı),
   * `count` = part'taki bölüm sayısı.
   *
   * NEDEN GEREKLİ: bir sezon kaydı birden çok MAL kaydına (part) yayılabilir
   * (ör. Mushoku Tensei S1: 1–11 Part 1 = MAL 39535, 12–23 Part 2 = MAL 45576).
   * MegaPlay bölümü KENDİ part kaydının kimliğiyle + PART İÇİ göreli numarayla
   * verir; mutlak bölümü doğru part'a çevirmek için bu eşleme şarttır
   * (bkz. lib/embed-provider.ts → megaplayTarget).
   *
   * `groupSeasons` satırı `...row` ile yaydığı ve okuma `select("*")` yaptığı için
   * alan kendiliğinden gelir; kolon yoksa/boşsa `undefined`/`null` olur ve mevcut
   * davranış korunur.
   */
  parts?: SeasonPartEntry[] | null;
};

export type Episode = {
  id: string;
  show_id: string;
  season: number;
  number: number;
  title: string;
  summary: string;
  duration: string;
  watch_url: string;
  /**
   * Panelden yüklenen bölüm kapağı (Storage yolu). Kolon henüz eklenmemişse
   * `undefined` gelir; arayüz bu durumda serinin vitrin görselini yedek kapak
   * olarak kullanır.
   */
  thumbnail_path?: string | null;
  /** Çözümlenmiş kapak adresi. Bölüme özel kapak yoksa boş string döner. */
  thumbnail?: string;
  /**
   * Yayın tarihi (`YYYY-MM-DD`, ani.zip). Veritabanında tutulmaz — detay
   * okunurken sezon (+ part) MAL kimliklerinden çözülüp nesneye yazılır.
   * Yoksa kart tarih rozetini atlar.
   */
  airdate?: string;
  /**
   * Bölümün VERİTABANINA EKLENME anı (ISO) — `show_episodes.created_at`.
   *
   * Tabloda YAYIN tarihi kolonu yoktur; bu alan "ne zaman eklendi"dir (şema
   * doğrulandı; ana sayfanın "YENİ ÇIKANLAR" bandı da aynı alana bakar —
   * bkz. `routes/index.tsx`). Satırlar `select("*")` ile okunduğu için alan
   * zaten geliyordu, yalnızca tip tanımına yazıldı.
   * Detay sayfasındaki "YENİ" rozeti bu alana göre karar verir.
   */
  created_at?: string;
};

export type ShowWithImage = Show & {
  image: string;
  banner_image: string;
  banner_video: string;
  /** Bölüm sayısı: kartlardaki "Yakında" rozeti ve vitrindeki "N bölüm" satırı için. */
  episode_count: number;
  /** Sezon sayısı: panel listesindeki "N sezon · M bölüm" etiketi için. */
  season_count: number;
};
export type SeasonWithEpisodes = Season & {
  /**
   * Sezonun bölümleri — `number` ARTAN sıralı.
   *
   * NOT: Olası bir "0. Bölüm" de bu dizinin İÇİNDEDİR (`number = 0`, en başta).
   * Ayrı bir `specials` dizisi KALDIRILDI: özel bölüm de bir `show_episodes`
   * satırıdır ve `episode_sources` kaynağı varsa burada durur. Kaynağı olmayan
   * `0` satırları bu diziye HİÇ girmez (bkz. `loadShowDetail`) — katalogdan
   * gelen sentetik "0. Bölüm" üretilmez (bkz. `lib/season-specials.ts`).
   */
  episodes: Episode[];
};

export type ShowDetail = {
  show: ShowWithImage;
  /** Tüm bölümler: önce sezon, sonra bölüm numarasına göre sıralı düz liste. */
  episodes: Episode[];
  /** Bölümlerin sezonlara göre gruplanmış hâli (tek sezonlu seride de tek elemanlı olur). */
  seasons: SeasonWithEpisodes[];
};

const BUCKET = "images";
const SIGNED_URL_TTL = 60 * 60; // 1 saat (yalnızca ESKİ Supabase yolları için)

/** R2 herkese açık adresi (istemci). Örn. https://pub-xxx.r2.dev — `.env` → `VITE_R2_PUBLIC_URL`. */
function r2PublicBase(): string {
  return ((import.meta.env["VITE_R2_PUBLIC_URL"] as string | undefined) ?? "").replace(/\/+$/, "");
}

/** R2 URL'sinden nesne anahtarını çıkarır (`posters/…`); bizim adresimiz değilse "". */
function r2KeyOf(url: string): string {
  const base = r2PublicBase();
  if (!base || !url.startsWith(`${base}/`)) return "";
  const key = url.slice(base.length + 1).split(/[?#]/)[0] ?? "";
  return /^[\w./-]+$/.test(key) && !key.includes("..") ? key : "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// "static/" ile başlayan yollar sitenin kendi dosyalarıdır (public/static/),
// imzalı URL gerekmez; doğrudan servis edilir.
function isStaticPath(path: string): boolean {
  return path.startsWith("static/") || path.startsWith("/");
}

function staticUrl(path: string): string {
  return path.startsWith("static/") ? `/${path}` : path;
}

export async function signImagePath(path: string): Promise<string> {
  if (!path) return "";
  if (isStaticPath(path)) return staticUrl(path);
  // R2/dış adresler olduğu gibi kullanılır (bkz. `signImagePaths`teki aynı kontrol).
  // Bu satır eksikken panelde banner yüklendikten SONRA önizleme BOŞ kalıyordu:
  // yükleme tam adres (`https://cdn.shanime.xyz/banners/…`) döndürüyor, o adres
  // `createSignedUrl`e gidiyor, hata dönüyor ve `""` yazılıyordu.
  if (/^https?:\/\//i.test(path)) return path;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  return data?.signedUrl ?? "";
}

/** Tek seferde imzalanacak en fazla yol sayısı (Storage üst sınırına karşı). */
const SIGN_BATCH = 100;

/**
 * Birden çok görsel yolunu TOPLU imzalar. Kapak açılışında her görsel için
 * ayrı ayrı istek atmak yerine tek istek yapılır; sayfa daha hızlı açılır.
 */
export async function signImagePaths(paths: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const toSign = new Set<string>();
  for (const path of paths) {
    if (!path) continue;
    if (isStaticPath(path)) result.set(path, staticUrl(path));
    // R2/dış adresler olduğu gibi kullanılır: herkese açık + önbelleklenebilir,
    // imza döngüsü (kota katili) yok. Yalnızca ESKİ Supabase yolları imzalanır.
    else if (/^https?:\/\//i.test(path)) result.set(path, path);
    else toSign.add(path);
  }
  const unique = [...toSign];
  for (let i = 0; i < unique.length; i += SIGN_BATCH) {
    const { data } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(unique.slice(i, i + SIGN_BATCH), SIGNED_URL_TTL);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) result.set(item.path, item.signedUrl);
    }
  }
  return result;
}

/**
 * BOŞ KAPAK YEDEĞİ — satır içi koyu karo (harici istek yok).
 *
 * NEDEN: `image_path` ölü bir yolu gösterirse imzalama boş döner ve `<img
 * src="">` çizilir; React uyarır, tarayıcı tüm sayfayı BAŞTAN indirir
 * (konsolda onlarca uyarı + gereksiz trafik). Bu yedekle veri katmanı asla
 * boş kapak üretmez; gerçek kapak gelince (R2/panel) zaten değişir.
 */
const FALLBACK_COVER =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='856'%3E%3Crect width='600' height='856' fill='%2317171c'/%3E%3C/svg%3E";

/** Seri satırı + gömülü sayımlar (`show_episodes(count)`, `show_seasons(count)`). */
type ShowRow = Show & {
  show_episodes?: { count: number }[];
  show_seasons?: { count: number }[];
};

/**
 * Serileri kapaklarıyla ve sezon/bölüm SAYILARIYLA getirir — tek istek.
 *
 * Sayımlar veritabanında yapılır (`show_episodes(count)`), satırlar çekilip
 * sayılmaz: 1000+ bölümlü seride de doğru ve ucuz. Kartlardaki "Yakında" rozeti
 * ile vitrindeki "N bölüm" satırı bu sayılardan beslenir.
 *
 * DİKKAT: Sayımlar daha önce `show_stats` görünümünden okunuyordu. O görünüm
 * `anon` role kapalı (bkz. supabase/migrations/20260924_featured_and_stats.sql:
 * `REVOKE ALL ... FROM anon`), bu yüzden siteye giriş yapmamış ziyaretçide sayılar
 * boş dönüyor ve TÜM kartlarda "Yakında" rozeti çıkıyordu. Sayımlar artık
 * serilerle aynı istekte geldiği için oturum açmış/açmamış herkeste aynı sonuç.
 */
export async function fetchShows(): Promise<ShowWithImage[]> {
  const { data, error } = await db
    .from("shows")
    .select("*, show_episodes(count), show_seasons(count)")
    .order("sort_order", { ascending: true });
  if (error || !data) return [];
  const shows = data as ShowRow[];

  // Kapak + banner yolları tek imzalama isteğinde çözülür.
  const urls = await signImagePaths(
    shows.flatMap((s) => [s.image_path, s.banner_image_path ?? "", s.banner_video_path ?? ""]),
  );

  return shows.map((row) => {
    // Gömülü sayım dizileri nesneden çıkarılır; taşınan veri kuru kalsın.
    const { show_episodes, show_seasons, ...show } = row;
    return {
      ...show,
      image: urls.get(show.image_path) ?? FALLBACK_COVER,
      banner_image: urls.get(show.banner_image_path ?? "") ?? "",
      banner_video: urls.get(show.banner_video_path ?? "") ?? "",
      episode_count: show_episodes?.[0]?.count ?? 0,
      season_count: show_seasons?.[0]?.count ?? 0,
    };
  });
}

/**
 * Panelden görsel yükleme — R2'ye (`/api/upload`), DB'ye herkese açık URL yazılır.
 *
 * ESKİDEN Supabase Storage'a gidiyordu (`images/posters/…` + imzalı URL). İmzalar
 * 1 saatte bir ölüyor, her ziyaretçi kapakları baştan indiriyordu → 33 GB egress
 * ile kota patladı. R2 adresleri sabit + önbelleklenebilir + egress ücretsiz.
 */
async function uploadToBucket(file: File, folder: string, fallbackExt: string): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  const form = new FormData();
  form.set("folder", folder);
  form.set("file", file, file.name || `upload.${fallbackExt}`);
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) throw new Error(`Yükleme başarısız (${res.status}).`);
  const json = (await res.json()) as { ok?: boolean; url?: string };
  if (!json.ok || !json.url) throw new Error("Yükleme başarısız.");
  return json.url;
}

/**
 * Vitrin görselinin EN KÜÇÜK genişliği.
 *
 * Vitrin `<img>`i 1536×864 olarak çiziliyor (retina ekranda daha fazlası gerekir),
 * yani bundan küçük bir dosya tarayıcı tarafından BÜYÜTÜLÜR ve bulanık görünür.
 * ÖLÇÜM (30.09.2026): kullanıcı kaliteli sandığı bir görsel yükledi; dosya
 * 600×375 çıktı ve vitrinde 2,6 kat büyütülüp bulanık göründü. Kaynak dosya
 * olduğu gibi R2'ye yüklendiği için (sunucu küçültmüyor/iyileştirmiyor) sorun
 * baştan engellenmeli: yükleme anında ölçü denetlenir ve SEBEBİ açıkça söylenir.
 */
const HERO_MIN_WIDTH = 1536;

/** Görselin gerçek piksel ölçüsü; okunamazsa `null` (denetim atlanır, akış durmaz). */
async function imagePixelSize(file: File): Promise<{ w: number; h: number } | null> {
  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file);
      const size = { w: bitmap.width, h: bitmap.height };
      bitmap.close?.();
      return size;
    }
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("görsel okunamadı"));
        element.src = url;
      });
      return { w: image.naturalWidth, h: image.naturalHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

export async function uploadImage(file: File, folder: string): Promise<string> {
  // Vitrin klasöründe ÖLÇÜ ŞARTI: küçük dosya yüklenirse sonuç her zaman bulanık olur.
  if (folder === "banners") {
    const size = await imagePixelSize(file);
    if (size && size.w < HERO_MIN_WIDTH) {
      throw new Error(
        `Görsel ${size.w}×${size.h} piksel. Vitrin ${HERO_MIN_WIDTH} piksel genişliğinde ` +
          `gösteriyor; bu yüzden bulanık çıkar. En az ${HERO_MIN_WIDTH}×864 (ideal 1920×1080) yükle.`,
      );
    }
  }
  return uploadToBucket(file, folder, "jpg");
}

/** Vitrin videosu yükleme (mp4/webm). */
export async function uploadVideo(file: File, folder: string): Promise<string> {
  return uploadToBucket(file, folder, "mp4");
}

/**
 * Depodaki eski dosyayı siler. Yeni görsel eskisinin YERİNE geçsin diye
 * yükleme sonrası çağrılır; aksi hâlde her değişiklikte depoda yeni bir
 * kopya birikir ve hiçbiri silinmez.
 */
export async function deleteImage(path: string): Promise<void> {
  if (!path || isStaticPath(path)) return;
  // R2 adresi → sunucu rotasından silinir (başarısızlık sessiz geçilir;
  // yetim dosya kotaya girmez, sonra temizlenebilir).
  if (/^https?:\/\//i.test(path)) {
    const key = r2KeyOf(path);
    if (!key) return;
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? "";
      await fetch(`/api/upload?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {
      // Sessiz geçilir (bkz. yukarı).
    }
    return;
  }
  await supabase.storage.from(BUCKET).remove([path]);
}

export async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await db
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return Boolean(data);
}

/** Adreslerde kullanılacak seri kimliği: slug varsa slug, yoksa id. */
export function showSlug(show: { id?: string | null; slug?: string | null }): string {
  return show.slug && show.slug.trim() ? show.slug : (show.id ?? "");
}

/**
 * `public/static/episode-covers/` altında GERÇEKTEN var olan dosyaların kümesi.
 *
 * Manifest `scripts/generate-episode-cover-manifest.mjs` (`npm run covers:manifest`)
 * tarafından üretilir; klasör yoksa BOŞ listedir. Böylece var olmayan bir yola
 * istek atılmaz (bkz. `localCoverPath` ve aşağıdaki nota).
 */
const localCoverFiles = new Set<string>(EPISODE_COVER_FILES as string[]);

/**
 * Yerelde üretilmiş bölüm kapağının yolu — YALNIZCA dosya gerçekten varsa.
 *
 * Dosyalar TVDB bölüm görselinden indirilip `public/static/episode-covers/`
 * altına yazılır (`scripts/sync-anizip-local-covers.mjs`). TVDB'de görseli
 * olmayan bölüm için dosya ÜRETİLMEZ.
 *
 * ── NEDEN MANİFEST (düzeltme, 29.09.2026) ────────────────────────────────────
 * Eskiden yol KÖRLEMESİNE kuruluyordu. Ama `public/static/episode-covers/`
 * klasörü projede HİÇ YOKTU; dolayısıyla her bölüm kartı bu adrese istek atıp
 * %100 **404** alıyordu (tarayıcıda görülen 404'lerin kaynağı buydu). Artık yol
 * yalnızca manifest'te kayıtlıysa döndürülür; aksi hâlde boş dizge döner ve
 * `EpisodeCover` bu adayı hiç denemez → **0 istek, 0 404**.
 *
 * `static/` ile başladığı için imzalı URL gerekmez, doğrudan servis edilir
 * (bkz. `isStaticPath`). Dosyalar YALNIZCA TVDB görselinden üretilir
 * (`scripts/sync-anizip-local-covers.mjs`).
 */
export function localCoverPath(slug: string, season: number, episodeNumber: number): string {
  if (!slug) return "";
  const path = `/static/episode-covers/${slug}-s${season}e${episodeNumber}.jpg`;
  return localCoverFiles.has(path) ? path : "";
}

/**
 * Bölümleri sezonlara göre gruplar.
 * `show_seasons` kaydı olmayan bir sezon numarası görülürse (ör. migration
 * öncesinden kalan veri) o sezon için sanal bir kayıt üretilir; böylece
 * hiçbir bölüm arayüzde kaybolmaz.
 */
function groupSeasons(
  seasonRows: Season[],
  episodes: Episode[],
  showId: string,
): SeasonWithEpisodes[] {
  const map = new Map<number, SeasonWithEpisodes>();
  for (const row of seasonRows) {
    map.set(row.number, { ...row, episodes: [] });
  }
  for (const episode of episodes) {
    let season = map.get(episode.season);
    if (!season) {
      season = {
        id: `sanal-sezon-${showId}-${episode.season}`,
        show_id: showId,
        number: episode.season,
        title: "",
        sort_order: episode.season,
        episodes: [],
      };
      map.set(episode.season, season);
    }
    season.episodes.push(episode);
  }
  return [...map.values()]
    .sort((a, b) => a.sort_order - b.sort_order || a.number - b.number)
    .map((season) => ({
      ...season,
      episodes: [...season.episodes].sort((a, b) => a.number - b.number),
    }));
}

/**
 * Seri detayının GERÇEK (önbelleksiz) okuması — DÖRT tablo sorgusu
 * (`shows`, `show_episodes`, `show_seasons`, `site_settings`) + Storage imzalaması.
 *
 * Ayrı tutulur çünkü dışa açık `fetchShowDetail` bunu SUNUCU önbelleği üzerinden
 * çağırır (bkz. lib/server-cache.ts). Bu ayrım yan etkiler için de doğrudur:
 * burada `applyPosterMap` ile modül durumu güncellenir; önbellekten gelen sonuç
 * zaten çözülmüş kapakları taşıdığı için o yan etkinin tekrarlanması gerekmez.
 */
async function loadShowDetail(slug: string): Promise<ShowDetail | null> {
  const bySlug = await db.from("shows").select("*").eq("slug", slug).maybeSingle();
  let show = bySlug.data as Show | null;
  if (!show) {
    const byId = await db.from("shows").select("*").eq("id", slug).maybeSingle();
    show = (byId.data as Show | null) ?? null;
  }
  if (!show) return null;

  const [episodesRes, seasonsRes] = await Promise.all([
    db.from("show_episodes").select("*").eq("show_id", show.id),
    db.from("show_seasons").select("*").eq("show_id", show.id),
  ]);

  const rawEpisodes = ((episodesRes.data ?? []) as (Episode & { season?: number })[])
    .map((ep) => ({
      ...ep,
      season: typeof ep.season === "number" && ep.season > 0 ? ep.season : 1,
    }))
    .sort((a, b) => a.season - b.season || a.number - b.number);

  // Bölüm kapakları da AYNI imzalama isteğine katılır: 300 bölüm için 300 ayrı
  // istek atmak yerine tek çağrı yapılır. Kapağı olmayan bölümler atlanır
  // (signImagePaths boş yolları zaten dışarıda bırakır).
  const urls = await signImagePaths([
    show.image_path,
    show.banner_image_path ?? "",
    show.banner_video_path ?? "",
    ...rawEpisodes.map((ep) => ep.thumbnail_path ?? ""),
  ]);

  // Bölüm kapağı (PANELDEN yüklenen manuel kapak → `thumbnail_path` imzalı/dogrudan
  // adres). TVDB görselleri ve TVDB'den üretilmiş yerel dosyalar BİLEŞENDE
  // (`EpisodeCover` aday listesi) çözülür; burada yalnızca manuel panel kapağı
  // nesneye yazılır. TVDB dışı hiçbir kaynak (sağlayıcı/katalog/seri posteri)
  // kapak olarak KULLANILMAZ.
  const episodes: Episode[] = rawEpisodes.map((ep) => ({
    ...ep,
    thumbnail: ep.thumbnail_path ? (urls.get(ep.thumbnail_path) ?? "") : "",
  }));

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * ÖZEL BÖLÜMLER (`number = 0`) — YALNIZCA "DB SATIRI + KAYNAK" İSE LİSTEDE.
   *
   * NEDEN (kullanıcı bildirimi, 30.09.2026): "Re:Zero'yu eklerken bir sürü 0.
   * bölüm vardı; hiçbirini seçmeden yalnızca 0 OLMAYAN bölümleri yükledim. Ama
   * oynatıcı sayfasında neden o eklemediğim bölümler var? Kaynakları da yok."
   *
   * ÖLÇÜM: ani.zip kataloğu Re:Zero S2 (MAL 42203) için `season: 0` altında 12
   * "Starting Break Time from Zero" kaydı veriyor. İlk sürüm bunları katalogdan
   * SENTETİK olarak listeye ekliyordu; hiçbirinin veritabanı satırı ve kaynağı
   * yoktu → oynatılamayan hayalet satırlar.
   *
   * KURAL: `0` numaralı bir satır listede ancak (a) veritabanında o sezona ait
   * `number = 0` satırı VARSA ve (b) o satırın `episode_sources` içinde en az bir
   * kaynağı VARSA görünür. Aksi hâlde listeden TAMAMEN çıkarılır. Böylece
   * katalogdaki kayıt TEK BAŞINA satır üretmez; katalog yalnızca DB'de karşılığı
   * olan özel bölümün başlığını doğrulamak için kullanılır (aşağıda).
   *
   * MALİYET: sorgu YALNIZCA `0` satırı varsa atılır (çoğu seride hiç yoktur →
   * hiç istek yok). Tek sorgu, tüm özel bölüm kimlikleri için.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  const specialEpisodeIds = episodes.filter((ep) => ep.number === 0).map((ep) => ep.id);
  const sourcedSpecialIds = new Set<string>();
  if (specialEpisodeIds.length > 0) {
    const { data } = await db
      .from("episode_sources")
      .select("episode_id")
      .in("episode_id", specialEpisodeIds);
    for (const row of (data ?? []) as { episode_id: string }[]) {
      if (row?.episode_id) sourcedSpecialIds.add(row.episode_id);
    }
  }
  /** Kaynağı olmayan `0` satırı listede GÖRÜNMEZ (yukarıdaki kural). */
  const visibleEpisodes = episodes.filter((ep) => ep.number !== 0 || sourcedSpecialIds.has(ep.id));

  // Sezon gruplaması bir kez yapılır: hem sayfa verisinde hem sezon sayısında kullanılır.
  const grouped = groupSeasons((seasonsRes.data ?? []) as Season[], visibleEpisodes, show.id);

  /**
   * YAYIN TARİHLERİ — sezon (+ part) MAL kimliklerinden, uzun önbellekli.
   *
   * Eşleşen bölüme `airdate` yazılır; eşleşmeyene YAZILMAZ (kart rozeti atlar).
   * Anahtar katalogun kendi `sezon:bölüm`üdür — part kataloğu mutlak numaralı
   * olduğu için part bölümleri de tutar (S1 13–25 ↔ 50602 kataloğu 1:13–1:25).
   * Hata yutulur: tarihsiz kart, tarihsiz kalır; sayfa düşmez.
   */
  const airBySeason = new Map<number, Record<string, string>>();
  await Promise.all(
    grouped.map(async (season) => {
      const mals = [
        Number(season.mal_id ?? 0),
        ...(season.parts ?? []).map((part) => Number(part.malId ?? 0)),
      ].filter((id) => Number.isFinite(id) && id > 0);
      const merged: Record<string, string> = {};
      for (const id of mals) {
        try {
          const table = await fetchSeasonAirdates(id);
          for (const [key, value] of Object.entries(table)) merged[key] ??= value;
        } catch {
          // Sessiz (bkz. yukarı).
        }
      }
      airBySeason.set(season.number, merged);
    }),
  );
  for (const ep of visibleEpisodes) {
    const date = airBySeason.get(ep.season)?.[`${ep.season}:${ep.number}`];
    if (date) ep.airdate = date;
  }

  /**
   * ÖZEL BÖLÜM BAŞLIĞI — YALNIZCA veritabanında KARŞILIĞI OLAN için katalogla
   * doğrulanır (kullanıcı kuralı, 30.09.2026).
   *
   * KATALOG SENTETİK SATIR ÜRETMEZ: burada yalnızca, yukarıda "DB satırı +
   * kaynak" süzgecinden GEÇMİŞ özel bölümlerin başlığı katalog kaydıyla
   * eşleştirilir. Eşleşme BİREBİR başlık eşitliğidir (`matchCatalogSpecial`);
   * güvenilir eşleşme yoksa DB satırındaki başlık AYNEN kalır.
   *
   * MAL KİMLİĞİ SEÇİMİ: önce sezonun kendi kimliği; yoksa ve seri TEK sezonluysa
   * serinin kimliği (`show.mal_id`). Katalog, o sezonda DB'de özel bölüm YOKSA
   * hiç çekilmez (upstream'e boşa gidilmez).
   *
   * HATA YUTULUR: katalog çekilemezse başlık DB'den kalır, sayfa ASLA düşmez.
   */
  await Promise.all(
    grouped.map(async (season) => {
      const specialsInSeason = season.episodes.filter((ep) => ep.number === 0);
      if (specialsInSeason.length === 0) return;
      const catalogMalId = season.mal_id ?? (grouped.length === 1 ? (show.mal_id ?? null) : null);
      if (!catalogMalId) return;
      try {
        const catalog = await fetchSeasonSpecials(catalogMalId);
        if (catalog.length === 0) return;
        for (const special of specialsInSeason) {
          const match = matchCatalogSpecial(special.title, catalog);
          if (match && match.title.trim()) special.title = match.title;
        }
      } catch {
        // Sessiz (bkz. yukarı): başlık DB satırından kalır.
      }
    }),
  );

  return {
    show: {
      ...show,
      image: urls.get(show.image_path) ?? FALLBACK_COVER,
      banner_image: urls.get(show.banner_image_path ?? "") ?? "",
      banner_video: urls.get(show.banner_video_path ?? "") ?? "",
      episode_count: visibleEpisodes.length,
      season_count: grouped.length,
    },
    episodes: visibleEpisodes,
    seasons: grouped,
  };
}

/**
 * Seri detayı — SUNUCU önbellekli, herkese açık okuma.
 *
 * NEDEN ÖNBELLEK (kota/egress): `/anime/$slug` detayı ve izleme sayfası aynı detayı okur
 * ve her yeni ziyaretçi isteği bu DÖRT tablo sorgusu + Storage imzalamasını
 * yeniden yapıyordu. Sonuç `TTL_DETAIL_SECONDS` (120 sn) boyunca hatırlanır
 * (bkz. lib/server-cache.ts).
 *
 * KULLANICIYA ÖZEL DEĞİL: detay tamamen herkese açık katalog verisidir; oturum
 * açmış/açmamış aynı sonucu alır. Bu yüzden önbellek güvenlidir.
 *
 * EN KÖTÜ GECİKME: panelden yapılan bir bölüm/kapak/seri düzenlemesi
 * ziyaretçiye en fazla ~120 saniye içinde yansır.
 *
 * NOT: yalnızca BAŞARILI okuma saklanır; hata durumunda `loadShowDetail`'in
 * hatası önbelleğe yazılmaz (bkz. dosya başı notu, lib/server-cache.ts).
 */
async function fetchShowDetail(slug: string): Promise<ShowDetail | null> {
  return cachedRead(`show-detail:${slug}`, TTL_DETAIL_SECONDS, () => loadShowDetail(slug));
}

/**
 * Seri detayı sorgusunun TEK önbellek anahtarı + sorgu tanımı.
 *
 * NEDEN ORTAK TANIM (kota/egress): aynı okuma üç ayrı yerde yapılıyordu —
 *   1) `/anime/$slug` rota yükleyicisi (rota verisi),
 *   2) ana sayfa ve detay sayfasındaki "üzerine gelince önden çek" (`prefetchQuery`),
 *   3) izleme sayfasındaki `useQuery`.
 * Anahtar literali her yerde elle yazıldığı için rota yükleyicisi React Query
 * önbelleğini ATLIYORDU: ana sayfada kartın üzerine gelip tıklayan ziyaretçi aynı
 * detayı bir kez seri sayfasında, bir kez de izleme sayfasında okuyordu. Tek
 * `fetchShowDetail` çağrısı ise DÖRT okuma demek (`shows`, `show_episodes`,
 * `show_seasons`, `site_settings`) ve buna Storage imzalama isteği de eklidir.
 * Ortak anahtar sayesinde aynı detay bir oturumda BİR kez okunur; anahtarı
 * değiştirmek gerekiyorsa artık yalnızca burası değişir.
 */
export function showDetailQueryOptions(slug: string) {
  return {
    queryKey: ["show-detail", slug] as const,
    queryFn: () => fetchShowDetail(slug),
    // Tazelik tek yerden yönetilir: bkz. lib/query-client.ts → QUERY_STALE_MS.
    staleTime: QUERY_STALE_MS,
  };
}

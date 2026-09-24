import { supabase } from "@/integrations/supabase/client";
import EPISODE_POSTERS from "@/data/episode-posters.json";
import { POSTER_SETTINGS_KEY } from "@/lib/episode-covers";

/**
 * Kapak haritası: dosyadaki tohum + veritabanındaki güncel kayıtlar.
 * Anahtarlar `"<slug>-s<sezon>e<bölüm>"` biçiminde. `fetchShowDetail` veritabanı
 * katmanını yükleyip buraya uygular; yeni bölümlerin kapakları böyle görünür.
 */
let posterMap: Record<string, string> = EPISODE_POSTERS as Record<string, string>;

/** Veritabanından gelen kapak haritasını (dosya tohumunun üzerine) uygular. */
export function applyPosterMap(map: Record<string, string>): void {
  posterMap = { ...(EPISODE_POSTERS as Record<string, string>), ...map };
}

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
  sort_order: number;
  slug: string | null;
  description: string;
  year: string;
  genre: string;
  watch_url: string;
};

export type Season = {
  id: string;
  show_id: string;
  number: number;
  title: string;
  sort_order: number;
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
   * Sağlayıcıdan çözülmüş bölüm kapağı (VidMoly karesi).
   *
   * Bölüm nesnesinin İÇİNDE taşınır: sunucuda üretilip istemciye serileştirilir,
   * böylece ilk çizimde iki taraf aynı adresi kullanır. Modül durumundan
   * okunsaydı sunucu/istemci farkı hydration hatasına yol açardı.
   */
  poster?: string;
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
export type SeasonWithEpisodes = Season & { episodes: Episode[] };

export type ShowDetail = {
  show: ShowWithImage;
  /** Tüm bölümler: önce sezon, sonra bölüm numarasına göre sıralı düz liste. */
  episodes: Episode[];
  /** Bölümlerin sezonlara göre gruplanmış hâli (tek sezonlu seride de tek elemanlı olur). */
  seasons: SeasonWithEpisodes[];
};

const BUCKET = "images";
const SIGNED_URL_TTL = 60 * 60; // 1 saat

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
      image: urls.get(show.image_path) ?? "",
      banner_image: urls.get(show.banner_image_path ?? "") ?? "",
      banner_video: urls.get(show.banner_video_path ?? "") ?? "",
      episode_count: show_episodes?.[0]?.count ?? 0,
      season_count: show_seasons?.[0]?.count ?? 0,
    };
  });
}

async function uploadToBucket(file: File, folder: string, fallbackExt: string): Promise<string> {
  const ext = file.name.split(".").pop() ?? fallbackExt;
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file);
  if (error) throw error;
  return path;
}

export async function uploadImage(file: File, folder: string): Promise<string> {
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
 * İzleme sayfası adresi. Sezon/bölüm verilmezse sayfa kendi ilk bölümüne düşer,
 * bu yüzden sorgu parametresi olmadan da geçerli bir adrestir.
 */
export function watchHref(
  show: Pick<Show, "id" | "slug">,
  season?: number,
  episodeNumber?: number,
): string {
  const base = `/izle/${showSlug(show)}`;
  if (season === undefined || episodeNumber === undefined) return base;
  return `${base}?sezon=${season}&b=${episodeNumber}`;
}

/** Embed adresinden video kodunu çıkarır (`embed-<kod>.html`, `embed/<kod>`, `<kod>`). */
export function videoCodeFromWatchUrl(watchUrl?: string | null): string {
  if (!watchUrl) return "";
  const clean = (watchUrl.split(/[?#]/)[0] ?? "").replace(/\/+$/, "");
  const last = clean.split("/").filter(Boolean).pop() ?? "";
  const dashed = /^embed-([a-z0-9]{6,})\.html$/i.exec(last);
  if (dashed) return dashed[1] ?? "";
  const plain = /^([a-z0-9]{6,})\.html$/i.exec(last);
  if (plain) return plain[1] ?? "";
  return /^[a-z0-9]{6,}$/i.test(last) ? last : "";
}

/**
 * Bölüm kapağını oynatıcının embed adresinden TÜRETİR — yalnızca türetmenin
 * gerçekten geçerli olduğu sağlayıcı için.
 *
 *   https://morencius.com/embed/<kod>   →   https://pixibay.cc/<kod>.jpg
 *
 * ÖNEMLİ: aynı kodun `_xt.jpg` eki de var ama o 25 küçük kareden oluşan bir
 * MOZAİK (storyboard); kapak olarak kullanılamaz. Kapak için eki olmayan
 * `.jpg` kullanılır — tek, temiz, 16:9 sahne karesi verir.
 *
 * ALAN ADI KONTROLÜ ŞART: VidMoly kapakları `pixibay` üzerinden gelmez. Eskiden
 * yalnızca son yol parçasına bakılıyordu; `vidmoly.org/embed/<kod>` biçiminde bir
 * adres girilse kod geçerli sayılıp `pixibay.cc/<kod>.jpg` istenirdi — o da 404.
 * Bu yüzden türetme yalnızca morencius adresleri için yapılır; VidMoly kapakları
 * `fetchShowDetail` içinde çözülüp bölümün `poster` alanına yazılır.
 */
export function episodeCoverFromWatchUrl(watchUrl?: string | null): string {
  if (!watchUrl) return "";
  let host = "";
  try {
    host = new URL(watchUrl.split(/[?#]/)[0] ?? "").hostname.toLowerCase();
  } catch {
    return "";
  }
  if (!/(^|\.)morencius\.com$/.test(host)) return "";
  const code = videoCodeFromWatchUrl(watchUrl);
  return code ? `https://pixibay.cc/${code}.jpg` : "";
}

/**
 * Yerelde üretilmiş bölüm kapağının yolu.
 *
 * Sağlayıcı bazı bölümler için hiç görsel yayınlamıyor (o bölümlerin videosu da
 * bozuk olabiliyor — DURUM-RAPORU §20.3). O bölümlerin karesi videodan alınıp
 * `public/static/episode-covers/` altına konur ve arayüz bu yolu dener.
 *
 * `static/` ile başladığı için imzalı URL gerekmez, doğrudan servis edilir
 * (bkz. `isStaticPath`). Dosya yoksa istek 404 döner ve kapak zinciri bir
 * sonraki kaynağa geçer; bu yüzden bu yol ZİNCİRİN SONUNDA denenir.
 */
export function localCoverPath(slug: string, season: number, episodeNumber: number): string {
  if (!slug) return "";
  return `/static/episode-covers/${slug}-s${season}e${episodeNumber}.jpg`;
}

/**
 * Bölümleri sezonlara göre gruplar.
 * `show_seasons` kaydı olmayan bir sezon numarası görülürse (ör. migration
 * öncesinden kalan veri) o sezon için sanal bir kayıt üretilir; böylece
 * hiçbir bölüm arayüzde kaybolmaz.
 */
export function groupSeasons(
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

export async function fetchShowDetail(slug: string): Promise<ShowDetail | null> {
  const bySlug = await db.from("shows").select("*").eq("slug", slug).maybeSingle();
  let show = bySlug.data as Show | null;
  if (!show) {
    const byId = await db.from("shows").select("*").eq("id", slug).maybeSingle();
    show = (byId.data as Show | null) ?? null;
  }
  if (!show) return null;

  // Kapak haritası da paralel çekilir: sağlayıcıdan çözülmüş güncel kapaklar
  // `site_settings` içinde durur (bkz. lib/episode-covers.ts). Yeni bölüm
  // eklendiğinde kapak, yayına almaya gerek kalmadan buradan gelir.
  const [episodesRes, seasonsRes, posterRes] = await Promise.all([
    db.from("show_episodes").select("*").eq("show_id", show.id),
    db.from("show_seasons").select("*").eq("show_id", show.id),
    db.from("site_settings").select("value").eq("key", POSTER_SETTINGS_KEY).maybeSingle(),
  ]);

  try {
    const raw = ((posterRes?.data as { value?: string } | null)?.value ?? "").trim();
    if (raw) applyPosterMap(JSON.parse(raw) as Record<string, string>);
  } catch {
    // Bozuk/eski kayıt kapakları bozmasın; dosyadaki tohum geçerli kalır.
  }

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

  // Sağlayıcıdan çözülmüş kapak, bölüm NESNESİNE yazılır (modül durumundan
  // okunmaz). Sebep: bu nesne sunucuda üretilip istemciye serileştirilir; kapak
  // ayrı bir modül durumundan okunursa sunucu ile tarayıcı farklı adres
  // üretebiliyor ve React "hydration mismatch" hatası veriyordu.
  const posterSlug = show.slug ?? slug;
  const episodes: Episode[] = rawEpisodes.map((ep) => ({
    ...ep,
    thumbnail: ep.thumbnail_path ? (urls.get(ep.thumbnail_path) ?? "") : "",
    poster: posterMap[`${posterSlug}-s${ep.season}e${ep.number}`] ?? "",
  }));

  // Sezon gruplaması bir kez yapılır: hem sayfa verisinde hem sezon sayısında kullanılır.
  const seasons = groupSeasons((seasonsRes.data ?? []) as Season[], episodes, show.id);

  return {
    show: {
      ...show,
      image: urls.get(show.image_path) ?? "",
      banner_image: urls.get(show.banner_image_path ?? "") ?? "",
      banner_video: urls.get(show.banner_video_path ?? "") ?? "",
      episode_count: episodes.length,
      season_count: seasons.length,
    },
    episodes,
    seasons,
  };
}

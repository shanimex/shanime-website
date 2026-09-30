import { supabase } from "@/integrations/supabase/client";
import EPISODE_COVER_FILES from "@/data/episode-cover-files.json";
import EPISODE_POSTERS from "@/data/episode-posters.json";
import { anizipCover } from "@/lib/anizip-covers";
import type { SeasonPartEntry } from "@/lib/embed-provider";
import {
  animecixCoversForEpisodes,
  posterFromMap,
  POSTER_SETTINGS_KEY,
} from "@/lib/episode-covers";
import { QUERY_STALE_MS } from "@/lib/query-client";
import { cachedRead, TTL_DETAIL_SECONDS } from "@/lib/server-cache";
import { fetchSeasonSpecials, type SeasonSpecial } from "@/lib/season-specials";
import { fetchSiteSettings } from "@/lib/site-settings";

/**
 * Kapak haritası: dosyadaki tohum + veritabanındaki güncel kayıtlar.
 * Anahtarlar `"<slug>-s<sezon>e<bölüm>"` biçiminde. `fetchShowDetail` veritabanı
 * katmanını yükleyip buraya uygular; yeni bölümlerin kapakları böyle görünür.
 */
let posterMap: Record<string, unknown> = EPISODE_POSTERS as Record<string, string>;

/** Veritabanından gelen kapak haritasını (dosya tohumunun üzerine) uygular. */
export function applyPosterMap(map: Record<string, unknown>): void {
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
   * Sağlayıcıdan çözülmüş bölüm kapağı (VidMoly karesi).
   *
   * Bölüm nesnesinin İÇİNDE taşınır: sunucuda üretilip istemciye serileştirilir,
   * böylece ilk çizimde iki taraf aynı adresi kullanır. Modül durumundan
   * okunsaydı sunucu/istemci farkı hydration hatasına yol açardı.
   */
  poster?: string;
  /**
   * ANIMECIX'ten çözülmüş BÖLÜME ÖZEL kapak (29.09.2026).
   *
   * Yalnızca başka hiçbir kaynaktan kapağı OLMAYAN bölümler için sunucuda
   * çözülür (bkz. `fillAnimecixCovers`). `poster` gibi bölüm NESNESİNDE taşınır:
   * sunucuda üretilip istemciye serileştirilir, hydration farkı olmaz.
   */
  animecixC?: string;
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
  episodes: Episode[];
  /**
   * ÖZEL / ÖN BÖLÜMLER (`0. Bölüm`) — ani.zip kataloğunun `season: 0` kayıtları.
   *
   * NEDEN AYRI DİZİ (bölümlere eklenmez): özel bölümün numarası `0`dır ve
   * `episodes` aralığının (1..N ya da part aralığı 12..23) DIŞINDA durur; ayrı
   * tutulunca numaralandırma/kaydırma hesapları HİÇ etkilenmez. İzleme sayfası
   * bunları listenin EN ÜSTÜNDE "0. Bölüm" olarak gösterir.
   *
   * Veritabanında satırı OLMAYABİLİR (katalogdan gelir) ve bu yüzden
   * `volume`/`parts` gibi hesaplara katılmaz. Boş/undefined ise özel bölüm yok.
   * (Detay: `lib/season-specials.ts`.)
   */
  specials?: SeasonSpecial[];
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
export function r2KeyOf(url: string): string {
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
export const FALLBACK_COVER =
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
 * İzleme sayfası adresi: `/anime/<slug>/season/<n>/episode/<n>`.
 *
 * Sezon/bölüm verilmezse YALNIZCA seri detay yolu (`/anime/<slug>`) döner. Sebep:
 * izleme sayfasının yolu bu iki değeri ZORUNLU tutar; eksik değerlerle uydurma bir
 * bölüm adresi üretmek yanlış sayfa açardı. "İlk bölüme düşme" kararı izleme
 * sayfasının kendi içindedir (oradaki yedek mantık korunur).
 *
 * Kaynak seçimi (`?kaynak=`) bu yardımcıdan GEÇMEZ: o, aynı bölümün bir varyantıdır
 * (yolun parçası değildir) ve gerekirse çağıran taraf sorgu parametresi olarak ekler.
 */
export function watchHref(
  show: Pick<Show, "id" | "slug">,
  season?: number,
  episodeNumber?: number,
): string {
  const base = `/anime/${showSlug(show)}`;
  if (season === undefined || episodeNumber === undefined) return base;
  return `${base}/season/${season}/episode/${episodeNumber}`;
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
 * Sağlayıcı bazı bölümler için hiç görsel yayınlamıyor (o bölümlerin videosu da
 * bozuk olabiliyor — DURUM-RAPORU §20.3). O bölümlerin karesi videodan alınıp
 * `public/static/episode-covers/` altına konursa arayüz bu yolu kullanır.
 *
 * ── NEDEN MANİFEST (düzeltme, 29.09.2026) ────────────────────────────────────
 * Eskiden yol KÖRLEMESİNE kuruluyordu. Ama `public/static/episode-covers/`
 * klasörü projede HİÇ YOKTU; dolayısıyla her bölüm kartı bu adrese istek atıp
 * %100 **404** alıyordu (tarayıcıda görülen 404'lerin kaynağı buydu). Artık yol
 * yalnızca manifest'te kayıtlıysa döndürülür; aksi hâlde boş dizge döner ve
 * `EpisodeCover` bu adayı hiç denemez → **0 istek, 0 404**.
 *
 * `static/` ile başladığı için imzalı URL gerekmez, doğrudan servis edilir
 * (bkz. `isStaticPath`). Zincirin SONUNDA denenir (seri posterinden hemen önce).
 */
export function localCoverPath(slug: string, season: number, episodeNumber: number): string {
  if (!slug) return "";
  const path = `/static/episode-covers/${slug}-s${season}e${episodeNumber}.jpg`;
  return localCoverFiles.has(path) ? path : "";
}

/**
 * Kapağı OLMAYAN bölümler için animecix'ten BÖLÜME ÖZEL kapak çözer.
 *
 * ── NEDEN (kullanıcı isteği, 29.09.2026) ─────────────────────────────────────
 * "bazı videolarda kapak olmayınca (boş kalınca) … embedlerden kapak al."
 * Türkçe kaynak (`anizmplayer.com/video/<hash>`) kapak vermez; puffytr bazı
 * ağlarda 403 döner; Cyberpunk gibi serilerde ani.zip/TVDB kaydı da yoktur.
 * Bu durumda bölüm kartı boş kalıp yalnızca seri posterini gösteriyordu.
 *
 * ── MALİYET DENETİMİ ─────────────────────────────────────────────────────────
 * Yalnızca HİÇBİR kaynağı olmayan bölümler için istek atılır: panel kapağı,
 * `poster` haritası (VidMoly/Türkçe kaynak), ani.zip/TVDB (`anizipCover`)
 * ve `watch_url`'den türetilen kapak varsa animecix HİÇ SORULMAZ. Kalan bölümler
 * SINIRLI eşzamanlılıkla (`animecixCoversForEpisodes`) ve kısa timeout'la
 * çözülür; sonuç `lib/episode-covers.ts` içinde önbelleğe alınır (üretimde
 * `server-cache`, dev'de modül söz önbelleği). Seri `animecix_id`'si yoksa
 * hiçbir istek atılmaz.
 */
async function fillAnimecixCovers(show: Show, episodes: Episode[]): Promise<Episode[]> {
  const animecixId = Number(show.animecix_id ?? 0);
  if (!Number.isFinite(animecixId) || animecixId <= 0) return episodes;
  const need = episodes.filter(
    (ep) =>
      !ep.thumbnail &&
      !ep.poster &&
      !anizipCover(show.mal_id, ep.season, ep.number) &&
      !episodeCoverFromWatchUrl(ep.watch_url),
  );
  if (need.length === 0) return episodes;
  try {
    const covers = await animecixCoversForEpisodes(
      animecixId,
      need.map((ep) => ({ season: ep.season, number: ep.number })),
    );
    if (covers.size === 0) return episodes;
    return episodes.map((ep) => {
      const cover = covers.get(`${ep.season}:${ep.number}`);
      return cover ? { ...ep, animecixC: cover } : ep;
    });
  } catch {
    // Kapak çözülemedi: sayfa düşmez, zincir seri posterine kadar iner.
    return episodes;
  }
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
    map.set(row.number, { ...row, episodes: [], specials: [] });
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
        specials: [],
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

  // Kapak haritası da paralel çekilir: sağlayıcıdan çözülmüş güncel kapaklar
  // `site_settings` içinde durur (bkz. lib/episode-covers.ts). Yeni bölüm
  // eklendiğinde kapak, yayına almaya gerek kalmadan buradan gelir.
  //
  // NEDEN PAYLAŞIMLI OKUMA (kota/egress): bu satır TÜM serilerde AYNIDIR. Eskiden
  // her seri sayfası (anime detayı ve izleme yolu) onu sıfırdan okuyordu; 20 farklı seri
  // açan ziyaretçi aynı satırı 20 kez çekiyordu. Artık okuma `fetchSiteSettings`
  // üzerinden gider ve `QUERY_STALE_MS` boyunca hatırlanır (bkz.
  // lib/site-settings.ts) — yani pencere başına TEK okuma.
  const [episodesRes, seasonsRes, settings] = await Promise.all([
    db.from("show_episodes").select("*").eq("show_id", show.id),
    db.from("show_seasons").select("*").eq("show_id", show.id),
    fetchSiteSettings([POSTER_SETTINGS_KEY]),
  ]);

  try {
    const raw = (settings[POSTER_SETTINGS_KEY] ?? "").trim();
    if (raw) applyPosterMap(JSON.parse(raw) as Record<string, unknown>);
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
  const mapped: Episode[] = rawEpisodes.map((ep) => ({
    ...ep,
    thumbnail: ep.thumbnail_path ? (urls.get(ep.thumbnail_path) ?? "") : "",
    // `posterFromMap`: kayıt, bölümün GÜNCEL videosunun koduyla çözülmüşse kullanılır.
    // Link değiştirildiğinde eski kapak gösterilmez (bkz. lib/episode-covers.ts).
    poster: posterFromMap(posterMap[`${posterSlug}-s${ep.season}e${ep.number}`], ep.watch_url),
  }));

  /**
   * Son halka: kapağı başka hiçbir kaynaktan OLMAYAN bölümler için animecix'ten
   * bölüme özel kapak (`animecixC`). Sunucuda çözülür ve bölüm NESNESİNE yazılır
   * → SSR ile istemci aynı adresi görür (hydration farkı yok). Detay sonucu zaten
   * `cachedRead` ile tutulduğu ve animecix kapağı da ayrıca önbelleklendiği için
   * maliyet sınırlıdır (bkz. `fillAnimecixCovers`).
   */
  const episodes: Episode[] = await fillAnimecixCovers(show, mapped);

  // Sezon gruplaması bir kez yapılır: hem sayfa verisinde hem sezon sayısında kullanılır.
  const grouped = groupSeasons((seasonsRes.data ?? []) as Season[], episodes, show.id);

  /**
   * ÖZEL / ÖN BÖLÜMLER (`0. Bölüm`) — KATALOGDAN, önbellekli.
   *
   * ── NEDEN BURADA (kullanıcı isteği, 29.09.2026, ikinci tur) ─────────────────
   * İzleme sayfasının bölüm listesi özel bölümleri de içermeli (Mushoku S2 →
   * "0. Bölüm — Guardian Fitz") ve özel bölümün DB'de satırı OLMAYABİLİR. Bu
   * yüzden özel bölümler sezonun KENDİ MAL kimliğiyle (`show_seasons.mal_id`)
   * ani.zip'ten okunur. Sonuç `fetchSeasonSpecials` içinde 6 saat önbelleklenir,
   * yani sayfa yükü upstream'e bağlanmaz (bkz. lib/season-specials.ts).
   *
   * MAL KİMLİĞİ SEÇİMİ: önce sezonun kendi kimliği; yoksa ve seri TEK sezonluysa
   * serinin kimliği (`show.mal_id`). Böylece satırı olmayan (tek sezonlu) seride
   * de özel bölüm bulunur; çok sezonlu seride bilinmeyen kimlikle YANLIŞ sezona
   * özel bölüm iliştirilmez.
   *
   * HATA YUTULUR: özel bölüm çekilemezse liste boş kalır, sayfa ASLA düşmez.
   */
  const seasons: SeasonWithEpisodes[] = await Promise.all(
    grouped.map(async (season) => {
      const catalogMalId = season.mal_id ?? (grouped.length === 1 ? (show.mal_id ?? null) : null);
      const specials = catalogMalId ? await fetchSeasonSpecials(catalogMalId) : [];
      return { ...season, specials };
    }),
  );

  return {
    show: {
      ...show,
      image: urls.get(show.image_path) ?? FALLBACK_COVER,
      banner_image: urls.get(show.banner_image_path ?? "") ?? "",
      banner_video: urls.get(show.banner_video_path ?? "") ?? "",
      episode_count: episodes.length,
      season_count: seasons.length,
    },
    episodes,
    seasons,
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
export async function fetchShowDetail(slug: string): Promise<ShowDetail | null> {
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

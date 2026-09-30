// /anime/<dizi-adı> — Anime (seri) detayı: tanıtım, sezon/bölüm listesi ve benzer animeler.
//
// DOSYA ADI NEDEN `anime.$slug.index.tsx` (düz `anime.$slug.tsx` DEĞİL):
// izleme sayfası URL'yi uzatıyor (`/anime/<slug>/season/<n>/episode/<n>`) ve TanStack
// Router'ın düz dosya adlandırmasında bir rota, yol öneki kendisiyle eşleşen HER
// rotanın ALTINA yerleşir. Detay dosyası `anime.$slug.tsx` olsaydı izleme sayfası
// onun ÇOCUĞU olurdu; o zaman detay sayfasının bir `<Outlet/>` çizmesi gerekir ve her
// bölüm açılışında detay içeriği oynatıcının ÜSTÜNDE kalırdı — yani görünür davranış
// URL dışında da değişirdi. `index` rotası (`createFileRoute("/anime/$slug/")`) bu
// ebeveynliği doğurmaz: `/anime/<slug>` ile izleme yolu KARDEŞ iki rota olur ve detay
// sayfasının görünümü AYNEN korunur.
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, Home, LayoutGrid, List, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AdSlot, useAdCode } from "@/components/site/AdSlot";
import { AdsterraLeaderboard, AdsterraNative } from "@/components/site/AdsterraUnit";
import { EpisodeCard, formatAirdate } from "@/components/site/EpisodeCard";
import { EpisodeCover } from "@/components/site/EpisodeCover";
import { LanguageToggle } from "@/components/site/LanguageToggle";
import { supabase } from "@/integrations/supabase/client";
import { anizipCover } from "@/lib/anizip-covers";
import { resolvePosterForEpisode } from "@/lib/episode-covers";
import {
  episodeCoverFromWatchUrl,
  localCoverPath,
  showDetailQueryOptions,
  showSlug,
  signImagePaths,
  type Episode,
  type Show,
  type ShowWithImage,
} from "@/lib/content";
import { cachedRead, TTL_SIMILAR_SECONDS } from "@/lib/server-cache";
// `translate`: modül seviyesindeki `t`nin takma adı. Sayfa başlığı/meta bilgisi
// bileşen DIŞINDA üretildiği için orada hook çağrılamaz. Takma ad şart — doğrudan
// `t` import etmek `useLang()`ün döndürdüğü `t`yi gölgelerdi.
import { plural, t as translate, useDocumentTitle, useLang, type Translate } from "@/lib/i18n";
import { useTranslatedTexts } from "@/lib/content-translate";
import { episodeKey, getLastEpisode, getWatched, markWatched } from "@/lib/watch-progress";

/** Bir seferde gösterilen bölüm sayısı. 1000+ bölümlü seride sayfa kilitlenmesin. */
const GRID_PAGE_SIZE = 24;

// Şema tipleri üretilmediği için proje genelindeki kaçış kapısı (bkz.
// lib/content.ts, lib/episode-sources.ts). Gömülü sayım (`show_episodes(count)`)
// ancak bu kaçışla yazılabiliyor.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const Route = createFileRoute("/anime/$slug/")({
  // Sayfa verisi loader'da çekilir. Kazanç: (1) sayfa sunucuda gerçek içerikle
  // render edilir, arama motoru bölümleri görür; (2) başlık/açıklama seriye
  // özel üretilebilir (eskiden TÜM seri sayfaları aynı başlığı taşıyordu).
  //
  // DİKKAT (kota/egress): veri artık React Query önbelleği ÜZERİNDEN gelir
  // (`ensureQueryData`), doğrudan `fetchShowDetail` ÇAĞRILMAZ. Sebep: aynı detay
  // `/anime/$slug/season/$season/episode/$episode` sayfasında da aynı anahtarla okunuyor ve gelen bazı
  // bağlantılar İSTEMCİ İÇİ gezinmedir (`Link`, ör. izleme sayfası başlığındaki
  // seri adı). Eskiden rota yükleyicisi sorgu önbelleğini atladığı için o
  // geçişlerde aynı seri ikinci kez okunuyordu — her okuma 4 tablo sorgusu
  // (`shows`, `show_episodes`, `show_seasons`, `site_settings`) + Storage
  // imzalaması demektir. Ortak anahtarla bu okuma önbellekten gelir.
  //
  // DÜZELTME (S3): var olmayan bir seri adresi (`/anime/does-not-exist-xyz`) yalnızca
  // "Series not found" gövdesini HTTP **200** ile döndürüyordu (soft 404 — arama
  // motoru yok sayılan sayfayı geçerli sanır). Loader artık veri yokken `notFound()`
  // fırlatır; TanStack Start yanıtı gerçek **404** yapar ve `notFoundComponent` çizilir.
  loader: async ({ params, context }) => {
    const detail = await context.queryClient.ensureQueryData(showDetailQueryOptions(params.slug));
    if (!detail) throw notFound();
    return detail;
  },
  staleTime: 5 * 60_000,
  head: ({ loaderData }) => {
    const detail = loaderData;
    if (!detail) {
      return {
        meta: [
          { title: translate("meta.seriesNotFoundTitle") },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const { show, episodes, seasons } = detail;
    // `show.title` VERİTABANI içeriğidir (çevrilmez); şablon sözlükten gelir.
    const title = translate("meta.seriesTitle", { title: show.title });
    const summary = (show.description ?? "").replace(/\s+/g, " ").trim();
    // Açıklama yoksa üretilen künye cümlesi: parçaları sözlükte durur. `seasons`
    // yalnızca ikiden çok sezon varken yazılır, yani İngilizcede "1 seasons" olmaz.
    const description = summary
      ? `${summary.slice(0, 150)}${summary.length > 150 ? "…" : ""}`
      : translate("meta.seriesDescription", {
          title: show.title,
          seasons:
            seasons.length > 1
              ? translate("meta.seriesDescriptionSeasons", { count: seasons.length })
              : "",
          count: episodes.length,
        });
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "video.tv_show" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: ShowDetailPage,
  // Hata/404 ekranları ADLANDIRILMIŞ bileşen: çeviri hook'u ancak bileşen
  // olarak çağrıldıklarında çalışır (rota seçeneği düz fonksiyon olamaz).
  errorComponent: LoadErrorCentered,
  notFoundComponent: ShowNotFoundCentered,
});

function LoadErrorCentered() {
  const { t } = useLang();
  // Hata ekranında sekme başlığı eski sayfada kalıyordu (bkz. kök NotFound deseni).
  useDocumentTitle(`${t("error.title")} | shanime`);
  return <Centered>{t("series.loadError")}</Centered>;
}

function ShowNotFoundCentered() {
  const { t } = useLang();
  // `meta.seriesNotFoundTitle` zaten "… | shanime" biçimindedir.
  useDocumentTitle(t("meta.seriesNotFoundTitle"));
  return <Centered>{t("series.notFound")}</Centered>;
}

function Centered({ children }: { children: React.ReactNode }) {
  const { t } = useLang();
  return (
    <div className="grid min-h-screen place-items-center bg-background px-5 text-center">
      <div>
        <p className="text-sm text-muted-foreground">{children}</p>
        <Link to="/" className="mt-4 inline-flex text-sm font-extrabold text-primary">
          {t("common.backHome")}
        </Link>
      </div>
    </div>
  );
}

/**
 * Sezon etiketi. `season.title` VERİTABANI içeriğidir (bilerek çevrilmez);
 * yalnızca başlık boşsa yazılan "N. Sezon" kalıbı bizim metnimizdir → çevrilir.
 */
function seasonLabel(season: { number: number; title: string }, t: Translate): string {
  return season.title.trim() || t("series.seasonFallback", { number: season.number });
}

/**
 * Bölüm satırı — GENİŞ YATAY SATIR (poster kartı DEĞİL).
 *
 * Yerleşim (soldan sağa): kapak + köşesinde `S 03 B 01` etiketi → bölüm başlığı
 * (altında açıklama) → SAĞDA rozetler (`3. Bölüm`).
 *
 * ÖLÇÜLER YAKLAŞIKTIR (bir referans dosyasından okunmadı): kapak 16:9 kutu,
 * telefonda 112 px / masaüstünde 160 px genişlik; satır dolgusu 12 px, köşe
 * yuvarlaklığı 12 px, satırlar arası 12 px. Amaç referansın "geniş satır"
 * ritmini kurmak; bu değerler sabit bir ölçümden ALINMAMIŞTIR.
 *
 * RENKLER bizim temamızdan (`bg-card`, hover `bg-secondary`, rozet `accent`).
 *
 * NEDEN SATIRIN TAMAMI `<Link>`: tıklanabilir alan satırın tamamıdır ve projedeki
 * diğer kartlarla aynı istemci içi gezinme kalıbını kullanır (`preload={false}` —
 * gerekçe ana sayfa kartlarındaki kota/egress notuyla aynı).
 *
 * YAYIN TARİHİ ROZETİ: `episode.airdate`ten gelir (ani.zip `airDate`, detay
 * okunurken 7 günlük önbellekle çözülür — bkz. `lib/anizip-covers.ts`
 * `fetchSeasonAirdates`). Tarih yoksa rozet atlanır; uydurma yazılmaz.
 * (`show_episodes` tablosunda tarih kolonu yoktur; `created_at` eklenme anıdır.)
 *
 * AÇIKLAMA SATIRI: `episode.summary` (şemada VAR) doluysa tek/iki satır yazılır;
 * boşsa satır hiç çizilmez.
 *
 * KAPAK ZİNCİRİ: `EpisodeCard` ile AYNI sıra (bölüm kapağı → sağlayıcı karesi →
 * gerçek bölüm görseli → adresten türetme → yerel dosya → seri posteri). Zincirin
 * sonu seri posteridir; hiçbiri yoksa `EpisodeCover` nötr "numara" kutusunu
 * gösterir (kırık görsel çizilmez).
 */
function EpisodeRow({
  slug,
  episode,
  watchSeason,
  seriesPoster,
  malId,
  watched,
  onOpen,
}: {
  /** Serinin slug'ı: yerel kapak yolu ve izleme bağlantısı için. */
  slug: string;
  episode: Episode;
  /** Bağlantının açacağı sezon (aktif sezon; bölümün kendisi değilse ona düşülür). */
  watchSeason: number;
  /** Zincirin son adımı: seri posteri. */
  seriesPoster?: string | undefined;
  /** MAL kimliği: bölüme ait gerçek görseli (ani.zip) kullanmak için. */
  malId?: number | null | undefined;
  /** Cihazdaki kayıtta bu bölüm izlendi mi? */
  watched: boolean;
  /** Satıra tıklanınca ilerleme kaydını günceller (mevcut davranış korunur). */
  onOpen: () => void;
}) {
  const { t, lang } = useLang();
  /**
   * BÖLÜM ADI/AÇIKLAMASI ARTIK İÇERİK ÇEVİRİSİNDEN GEÇER (kullanıcı, 28.09.2026:
   * "TR butonuna basınca bölüm adları da TR olacak … bütün her şeyi TR çevirsin").
   *
   * Bunlar VERİTABANI içeriğidir (dizi/bölüm adları, özetler) — arayüz sözlüğünde
   * (`lib/i18n.ts`) elle yazılmaz, çünkü binlerce satır olabilir ve admin
   * tarafından değiştirilebilir. Bu yüzden `lib/content-translate.ts` üzerinden
   * DeepL'e çevirtilir ve ÖNBELLEĞE alınır (her metin bir kez çevrilir).
   *
   * DİKKAT — yedek etiket ÇEVRİLMEZ: `series.episodeLabel` ("N. Bölüm") zaten
   * sözlükten gelir ve dil doğru kurulmuştur. Yalnızca veritabanından gelen ad
   * çeviriye gönderilir; böylece gereksiz istek ve kota harcaması olmaz.
   *
   * Dil İngilizce iken `useTranslatedTexts` HİÇBİR ŞEY yapmaz ve metni aynen
   * döndürür — varsayılan dilde ek istek/gecikme yoktur.
   */
  const sourceTitle = episode.title?.trim() ?? "";
  const sourceSummary = episode.summary?.trim() ?? "";
  const [translatedTitle, translatedSummary] = useTranslatedTexts([sourceTitle, sourceSummary]);
  const label = sourceTitle
    ? translatedTitle
    : t("series.episodeLabel", { number: episode.number });
  const summary = translatedSummary;
  // Köşe etiketi: numaralar iki basamağa tamamlanır ("S 03 B 01"). Harf (B/E)
  // dile bağlı olduğu için sözlükten gelir; doldurma GÖRÜNÜR METNİN düzenidir.
  const overlay = t("series.seasonEpisodeOverlay", {
    season: String(episode.season).padStart(2, "0"),
    number: String(episode.number).padStart(2, "0"),
  });

  return (
    <Link
      to="/anime/$slug/season/$season/episode/$episode"
      params={{ slug, season: String(watchSeason), episode: String(episode.number) }}
      preload={false}
      onClick={onOpen}
      className="group flex items-center gap-3 rounded-xl border border-border bg-card p-2.5 transition-colors hover:border-accent/60 hover:bg-secondary focus-visible:border-accent focus-visible:outline-none sm:gap-4 sm:p-3"
    >
      {/* KAPAK + alt gölge + sol alt köşe etiketi (16:9 yatay kutu). */}
      <span className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-secondary sm:w-40">
        <EpisodeCover
          number={episode.number}
          numberClassName="font-display text-2xl text-foreground/70"
          // ÖNCELİK: (a) panel → (b) animecix bölüm kapağı → (c) sağlayıcı →
          // (d) ani.zip/TVDB → (e) manifest'te VARSA yerel → (f) seri posteri.
          candidates={[
            episode.thumbnail ?? "",
            episode.animecixC ?? "",
            episode.poster ?? "",
            anizipCover(malId, episode.season, episode.number),
            episodeCoverFromWatchUrl(episode.watch_url),
            localCoverPath(slug, episode.season, episode.number),
            seriesPoster ?? "",
          ]}
          resolveFallback={() => resolvePosterForEpisode(episode.watch_url)}
        />
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-background/95 to-transparent"
        />
        <span className="absolute bottom-1 left-2 font-mono text-[11px] font-bold tracking-wider text-foreground/90">
          {overlay}
        </span>
      </span>

      {/* BAŞLIK + (varsa) AÇIKLAMA. */}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-bold text-foreground sm:text-base">{label}</span>
        {summary ? (
          <span className="line-clamp-2 text-xs text-muted-foreground sm:text-sm">{summary}</span>
        ) : null}
      </span>

      {/* SAĞDAKİ ROZETLER: "3. Bölüm" (+ izlendi işareti) + yayın tarihi.
          Tarih `episode.airdate`ten gelir (ani.zip, uzun önbellekli); yoksa rozet
          atlanır, uydurma yazılmaz. */}
      <span className="flex shrink-0 items-center gap-2">
        {watched && (
          <span className="rounded-full border border-accent/40 bg-background/95 px-2 py-0.5 text-[10px] font-bold text-accent">
            {t("series.watchedBadge")}
          </span>
        )}
        <span className="rounded-lg border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-bold text-accent">
          {t("series.episodeLabel", { number: episode.number })}
        </span>
        {episode.airdate ? (
          <span
            className="rounded-lg border border-border px-2 py-0.5 text-[11px] font-bold text-muted-foreground"
            title={formatAirdate(episode.airdate, lang, true)}
          >
            {formatAirdate(episode.airdate, lang, false)}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

/**
 * "Benzer seriler": en az BİR ORTAK TÜR etiketi olan diğer seriler.
 *
 * NEDEN SÜZME VERİTABANINDA: tür alanı virgülle ayrılmış serbest metindir ve tüm
 * serileri çekip tarayıcıda süzmek her seri sayfasında gereksiz veri indirirdi.
 * Sorgu yalnızca ilgili satırları ister (`genre.ilike.%<tür>%`).
 *
 * CAP (kota/egress): sorgu SUNUCUDA `.limit(limit)` ile sınırlanır ve arayüzde en
 * fazla 6 kart gösterilir. Binlerce serilik bir katalogda sınırsız sorgu, sayfa
 * başına yüzlerce satır demek olurdu. Tür süzgeci de veritabanında yapıldığı için
 * ("JS'te süz" yaklaşımının aksine) `limit`in üstünde aday havuzu GEREKMEZ:
 * `limit` doğrudan ekranda gösterilecek sayı kadardır. Gösterim = 6, cap = 6.
 *
 * Bölüm sayıları (`episode_count`, "Yakında" rozeti) AYNI sorguda GÖMÜLÜ sayım
 * (`show_episodes(count)`) ile alınır. Eskiden bu sayı için aday serilerin TÜM
 * bölüm satırları ayrı bir sorguyla çekilip tarayıcıda sayılıyordu; 1000 bölümlü
 * bir seride bu 1000 satırlık indirme demekti. Sayım artık veritabanında yapılır.
 *
 * YEDEK: tür eşleşmesi hiç çıkmazsa (ya da serinin tür alanı boşsa) son eklenen
 * seriler gösterilir. O da boşsa boş dizi döner → arayüz bölümü hiç çizmez.
 *
 * Hiçbir hata dışarı sızmaz: veri katmanı erişilemezse bu bölüm görünmez,
 * sayfanın geri kalanı etkilenmez.
 */
async function fetchSimilarShows(show: ShowWithImage, limit = 6): Promise<ShowWithImage[]> {
  try {
    // PostgREST `or` süzgeci virgül ve parantezle ayrıştırılır; tür adında bu
    // karakterler geçerse sorgu bozulur. Bu yüzden anahtar karakterler temizlenir.
    const genres = (show.genre ?? "")
      .split(",")
      .map((part) => part.replace(/[,()"'%*]/g, "").trim())
      .filter(Boolean);

    // Gömülü sayım için dar satır tipi: sayım dizisi arayüze taşınmasın.
    type SimilarRow = Show & { show_episodes?: { count: number }[] };

    let rows: SimilarRow[] = [];
    if (genres.length > 0) {
      const { data } = await db
        .from("shows")
        .select("*, show_episodes(count)")
        .neq("id", show.id)
        .or(genres.map((genre) => `genre.ilike.%${genre}%`).join(","))
        .limit(limit);
      rows = (data ?? []) as SimilarRow[];
    }
    if (rows.length === 0) {
      const { data } = await db
        .from("shows")
        .select("*, show_episodes(count)")
        .neq("id", show.id)
        .order("sort_order", { ascending: true })
        .limit(limit);
      rows = (data ?? []) as SimilarRow[];
    }
    if (rows.length === 0) return [];

    // Kapaklar TEK imzalama isteğinde çözülür (bkz. lib/content.ts → signImagePaths).
    const urls = await signImagePaths(
      rows.flatMap((row) => [row.image_path, row.banner_image_path ?? ""]),
    );

    return rows.map((row) => {
      // Gömülü sayım nesneden çıkarılır; taşınan veri kuru kalsın.
      const { show_episodes, ...rest } = row;
      return {
        ...rest,
        image: urls.get(rest.image_path) ?? "",
        banner_image: urls.get(rest.banner_image_path ?? "") ?? "",
        banner_video: "",
        episode_count: show_episodes?.[0]?.count ?? 0,
        season_count: 0,
      };
    });
  } catch {
    return [];
  }
}

function ShowDetailPage() {
  const { t } = useLang();
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  // Detay sayfası reklamları: panelde kod varsa PANEL kazanır, boşsa koddaki
  // Adsterra birimi çalışır (slotlar vardı ama içleri boştu → reklam yoktu).
  // Üst slot banner, alt slot native: aynı sayfada tek bir `highrevenueformat`
  // birimi bulunmalıdır, çünkü o birim `window.atOptions` global'ini kullanır.
  const adDetailTop = useAdCode("ad_detail_top");
  const adDetailBottom = useAdCode("ad_detail_bottom");
  // Varsayılan görünüm animecix tarzı SATIR düzeni; kapak ızgarası alternatif.
  const [view, setView] = useState<"row" | "grid">("row");
  const [visibleCount, setVisibleCount] = useState(GRID_PAGE_SIZE);
  // Uzun açıklama 3 satırda kısaltılır; sayfa "kompakt" kalsın diye.
  const [descOpen, setDescOpen] = useState(false);

  // Veri loader'dan gelir; sayfa sunucuda içerikle birlikte render edildiği
  // için ayrı bir "yükleniyor" ekranına gerek yok.
  const data = Route.useLoaderData();

  // CİHAZA ÖZEL İLERLEME (ekleme). Kayıt localStorage'da olduğu için sunucuda
  // YOKTUR: ilk render boş ilerlemeyle çıkar, gerçek değerler tarayıcıda bağlanan
  // effect ile okunur. Bu sayede sunucu HTML'i ile istemci çizimi aynı kalır
  // (hydration uyuşmazlığı olmaz) ve ilk boyamada yanlış bir "izlendi" görünmez.
  const progressSlug = data ? showSlug(data.show) : "";
  const [watched, setWatched] = useState<Set<string>>(() => new Set());
  const [lastEpisode, setLastEpisode] = useState<{ season: number; episode: number } | null>(null);
  useEffect(() => {
    if (!progressSlug) return;
    const sync = () => {
      setWatched(getWatched(progressSlug));
      setLastEpisode(getLastEpisode(progressSlug));
    };
    sync();
    // İlerleme başka bir sekmede değişirse (storage olayı) bu sekme de güncellenir.
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [progressSlug]);

  // BENZER SERİLER yalnızca tarayıcıda yüklenir: sunucuda boşuna sorgu atılmaz ve
  // ilk istemci çizimi sunucu HTML'iyle birebir aynı kalır.
  const [canLoadSimilar, setCanLoadSimilar] = useState(false);
  useEffect(() => {
    setCanLoadSimilar(true);
  }, []);
  const similarQuery = useQuery({
    queryKey: ["similar-shows", progressSlug],
    enabled: canLoadSimilar && progressSlug.length > 0,
    // Tazelik istemci varsayılanından gelir (bkz. lib/query-client.ts):
    // burada ayrıca yazmak değerlerin zamanla ayrışmasına yol açıyordu.
    // ÖNBELLEK (kota/egress): benzer seriler seri başına EK bir okuma demektir;
    // aynı seriyi birkaç kez açan ziyaretçi için sonuç değişmez. Sonuç
    // `TTL_SIMILAR_SECONDS` (120 sn) hatırlanır (bkz. lib/server-cache.ts).
    // Anahtar seriye özeldir (`fetchSimilarShows` yalnızca bu seriye bağlıdır) ve
    // kullanıcıya özel veri içermez.
    queryFn: () =>
      data
        ? cachedRead(`public:similar-shows:${progressSlug}`, TTL_SIMILAR_SECONDS, () =>
            fetchSimilarShows(data.show, 6),
          )
        : Promise.resolve([]),
  });
  const similarShows = similarQuery.data ?? [];

  /**
   * SERİ AÇIKLAMASI + TÜR — içerik çevirisi (bkz. `lib/content-translate.ts`).
   *
   * ⚠️ KANCA YERİ: bu çağrı aşağıdaki `if (!data)` erken dönüşünden ÖNCE olmak
   * ZORUNDA. Sonraya konursa veri yokken kanca atlanır, veri gelince fazladan
   * kanca çizilir ve React "Rendered more hooks than during the previous render"
   * hatası verir (bu hata bir kez izleme sayfasında yaşandı — bkz. proje notları).
   * Bu yüzden kaynak metinler `data?.` ile GÜVENLİ okunur.
   *
   * Dil İngilizce iken kanca hiçbir istek yapmaz, metinleri aynen döndürür.
   */
  const [translatedDescription, translatedGenre] = useTranslatedTexts([
    data?.show?.description?.trim() ?? "",
    data?.show?.genre?.trim() ?? "",
  ]);

  if (!data) return <Centered>{t("series.notFound")}</Centered>;

  const { show, episodes, seasons } = data;
  const playableSeasons = seasons.filter((season) => season.episodes.length > 0);
  // Boş sezonlar (henüz bölümü olmayan, panelde hazırlananlar) halka açık
  // sayfada görünmez; yalnızca içinde bölüm olan sezonlar listelenir.
  const activeSeason =
    playableSeasons.find((season) => season.number === selectedSeason) ??
    playableSeasons[0] ??
    null;
  const firstEpisode = playableSeasons[0]?.episodes[0] ?? null;
  const backdrop = show.banner_image || show.image;
  const activeEpisodes = activeSeason?.episodes ?? [];
  const visibleEpisodes = activeEpisodes.slice(0, visibleCount);
  const hiddenCount = activeEpisodes.length - visibleEpisodes.length;
  // Açıklama ve tür İÇERİK çevirisinden gelir (yukarıdaki kanca): TR seçiliyse
  // DeepL karşılığı, İngilizce'de orijinal metin.
  const description = translatedDescription || (show.description?.trim() ?? "");
  const genre = translatedGenre || (show.genre?.trim() ?? "");
  // Bu uzunluğun üstündeki açıklamalar 3 satırı aşar; "devamını oku" gösterilir.
  const longDescription = description.length > 280;

  // KÜNYE: "2020 · Aksiyon, Shounen · 24 bölüm". Tüm parçalar sayfada zaten
  // yüklü (bölüm sayısı = `episodes` uzunluğu), bu yüzden EK SORGU yapılmadı.
  // KÜNYE parçaları: yıl veritabanı içeriğidir (sayı, çevrilmez), tür içerik
  // çevirisinden geçer (`genre`), bölüm sayısı bizim metnimizdir.
  const kunye = [
    show.year,
    genre,
    // `plural`: İngilizcede "1 episode" / "24 episodes" ayrımı şart (Türkçede iki
    // anahtarın değeri aynıdır; bkz. i18n.ts `plural` notu).
    episodes.length > 0
      ? plural(t, episodes.length, "home.episodeCountOne", "home.episodeCount")
      : "",
  ]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join(" · ");

  // Aktif sezonun ilerlemesi: "5/24 izlendi".
  const watchedInActiveSeason = activeEpisodes.filter((episode) =>
    watched.has(episodeKey(episode.season, episode.number)),
  ).length;

  // Bir bölüm açıldığında (kart tıklaması) ilerleme kaydedilir ve ekran anında
  // güncellenir — yeniden yükleme beklemeden "izlendi" işareti ve buton çıkar.
  function recordWatched(season: number, episode: number) {
    markWatched(progressSlug, season, episode);
    setWatched(getWatched(progressSlug));
    setLastEpisode(getLastEpisode(progressSlug));
  }

  // Sezon değişince liste başa döner; yoksa 2. sezona geçince 1. sezonun
  // açılmış "daha fazla" hâli kalıyor.
  function selectSeason(number: number) {
    setSelectedSeason(number);
    setVisibleCount(GRID_PAGE_SIZE);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background">
        <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between px-5 lg:px-8">
          <Link
            to="/"
            aria-label={t("common.homeAria")}
            className="flex items-center gap-2 rounded-full px-1 py-1"
          >
            <img
              src="/shanime-logo.png?v=6"
              alt={t("common.logoAlt")}
              width={1060}
              height={856}
              loading="eager"
              decoding="async"
              className="h-11 w-auto object-contain sm:h-12"
            />
            <span className="sr-only">shanime</span>
          </Link>
          {/* "Geri" kaldırıldı: tarayıcıda zaten geri düğmesi var, burada
              tekrar etmek yerine her sayfada aynı olan ana sayfa bağlantısı
              duruyor. */}
          <Link
            to="/"
            className="ml-auto flex items-center gap-1.5 text-sm font-bold text-muted-foreground transition-colors hover:text-accent"
          >
            <Home size={16} /> {t("series.home")}
          </Link>
          {/* Dil değiştirici: her sayfada görünür (paylaşılan başlık şeridi). */}
          <LanguageToggle />
        </div>
      </header>

      <section className="relative isolate overflow-hidden border-b border-border">
        {/* Vitrin bandı SABİT yükseklikte. Eskiden görsel `inset-0` idi: "Devamını
            oku" ile bölüm uzayınca görsel de büyüyor, kadraj değişiyordu
            (kullanıcı geri bildirimi: "üstteki resimle beraber büyüyor").
            Artık bandın yüksekliği içerikten bağımsız: mobil 240 px, masaüstü 320 px. */}
        <div className="absolute inset-x-0 top-0 -z-20 h-60 md:h-80">
          <img
            src={backdrop}
            alt=""
            aria-hidden
            className="size-full object-cover object-center opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/85 to-background/40" />
        </div>
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-9 md:flex-row md:gap-8 md:py-12 lg:px-8">
          <img
            src={show.image}
            alt={t("home.coverAlt", { title: show.title })}
            // self-start: masaüstünde flex satırı yükseldikçe (açıklama açılınca)
            // kapak da uzuyordu — `align-items: stretch` yüzünden. Kapak artık
            // satırın yüksekliğine uymaz, kendi poster oranında kalır.
            className="aspect-[2/3] w-32 shrink-0 self-start rounded-2xl object-cover shadow-2xl sm:w-44"
          />
          <div className="min-w-0">
            <h1 className="font-display text-3xl leading-none text-accent sm:text-5xl">
              {show.title}
            </h1>
            {show.subtitle && (
              <p className="mt-3 text-sm font-bold text-muted-foreground">{show.subtitle}</p>
            )}
            {/* KÜNYE satırı: başlığın altında tek ince satır (yıl · türler · bölüm). */}
            {kunye && (
              <p className="mt-3 text-xs font-bold tracking-wide text-muted-foreground">{kunye}</p>
            )}
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold text-muted-foreground">
              {show.year && (
                <span className="rounded-full border border-border bg-background px-3 py-1">
                  {show.year}
                </span>
              )}
              {genre && (
                <span className="rounded-full border border-border bg-background px-3 py-1">
                  {genre}
                </span>
              )}
              {episodes.length > 0 && (
                <span className="rounded-full border border-border bg-background px-3 py-1">
                  {plural(t, episodes.length, "series.episodePillOne", "series.episodePill")}
                </span>
              )}
              {playableSeasons.length > 1 && (
                <span className="rounded-full border border-border bg-background px-3 py-1">
                  {plural(t, playableSeasons.length, "series.seasonPillOne", "series.seasonPill")}
                </span>
              )}
            </div>
            {description && (
              <>
                <p
                  className={`mt-4 max-w-2xl text-sm leading-6 text-foreground md:text-base md:leading-7 ${
                    descOpen || !longDescription ? "" : "line-clamp-3"
                  }`}
                >
                  {description}
                </p>
                {longDescription && (
                  // Blok sarmalayıcı: buton eskiden satır içi kalıyordu ve hemen
                  // altındaki "Şimdi izle" düğmesiyle AYNI satıra düşüp üst üste
                  // görünüyordu (mobilde okunmuyordu).
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => setDescOpen((open) => !open)}
                      // py-2: dokunma alani 20 px yuksekligindeydi, mobilde zor basılıyordu.
                      className="py-2 text-sm font-bold text-accent hover:underline"
                    >
                      {descOpen ? t("series.showLess") : t("series.readMore")}
                    </button>
                  </div>
                )}
              </>
            )}
            {firstEpisode ? (
              <Button asChild variant="hero" size="lg" className="mt-6 rounded-full">
                {/* İstemci içi gezinme (`Link` çizilen `<a href>` semantiği korur:
                    orta tık / yeni sekme çalışır). `preload={false}`: hedef
                    izleme sayfasının rota yükleyicisi yoktur, yani önden
                    çekme görünür bir kazanç sağlamaz; kapalı tutulur ki ileride
                    yükleyici eklenirse hover başına boşa okuma doğmasın. */}
                <Link
                  to="/anime/$slug/season/$season/episode/$episode"
                  params={{
                    slug: showSlug(show),
                    season: String(firstEpisode.season),
                    episode: String(firstEpisode.number),
                  }}
                  preload={false}
                >
                  <Play size={17} fill="currentColor" /> {t("common.watchNow")}
                </Link>
              </Button>
            ) : (
              <Button variant="hero" size="lg" className="mt-7 rounded-full" disabled>
                <Play size={17} fill="currentColor" /> {t("common.comingSoon")}
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* "KALDIĞIN YERDEN DEVAM ET" — YALNIZCA cihazda kayıtlı ilerleme varsa
          çizilir. Kayıt yoksa hiçbir şey görünmez: boş/kırık düğme yok, ayrıca
          kullanıcının istemediği bir "izlemeye başla" düğmesi de eklenmedi. */}
      {lastEpisode && (
        <div className="mx-auto max-w-6xl px-5 pt-6 lg:px-8">
          <Button asChild variant="hero" size="lg" className="rounded-full">
            {/* İstemci içi gezinme; önden çekme kapalı (bkz. yukarıdaki not). */}
            <Link
              to="/anime/$slug/season/$season/episode/$episode"
              params={{
                slug: showSlug(show),
                season: String(lastEpisode.season),
                episode: String(lastEpisode.episode),
              }}
              preload={false}
            >
              <Play size={17} fill="currentColor" />
              {/* Devam etiketinin sezon/bölüm biçimi dile bağlıdır
                  (TR "S1B3" · EN "S1E3") → metin sözlükten gelir. */}
              {t("series.continueFrom", {
                season: lastEpisode.season,
                episode: lastEpisode.episode,
              })}
            </Link>
          </Button>
        </div>
      )}

      <main className="mx-auto max-w-6xl space-y-12 px-5 py-12 lg:px-8">
        {adDetailTop.isFetched && adDetailTop.code ? (
          <AdSlot slot="ad_detail_top" className="flex justify-center" />
        ) : (
          <AdsterraLeaderboard />
        )}
        {/* Katalog, sayfanın geri kalanından daha dar bir sütunda durur: satırlar
            kısalır, kapaklar sayfaya göre daha küçük kalır (animecix düzeni). */}
        <section className="mx-auto w-full max-w-4xl">
          {/* BAŞLIK ŞERİDİ — solda başlık + künye, SAĞDA `SEZON` etiketi ve
              sezonun AÇILIR LİSTESİ (referans düzeni). Sezon seçimi sayfanın
              mevcut durumundan (`selectedSeason`) okunur/yazılır: ikinci bir
              doğruluk kaynağı eklenmedi, eski sekmeler kaldırıldı çünkü aynı
              seçimi iki farklı denetimle sunmak ekranda çelişki üretirdi. */}
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <div>
              <h2 className="font-display text-3xl text-foreground">
                {t("series.episodesHeading")}
              </h2>
              {activeSeason && (
                <p className="mt-1 text-sm font-bold text-muted-foreground">
                  {seasonLabel(activeSeason, t)} ·{" "}
                  {plural(t, activeEpisodes.length, "home.episodeCountOne", "home.episodeCount")}
                </p>
              )}
            </div>
            {playableSeasons.length > 0 && (
              <label className="flex shrink-0 items-center gap-2">
                {/* Görünen etiket referansın dilidir ("SEZON"); ekran okuyucu için
                    anlamlı metin `aria-label`da (Sezon seçimi) durur. */}
                <span className="text-[11px] font-extrabold tracking-[0.16em] text-muted-foreground">
                  {t("series.seasonLabel")}
                </span>
                <select
                  aria-label={t("series.seasonSelectAria")}
                  value={activeSeason?.number ?? ""}
                  onChange={(event) => selectSeason(Number(event.target.value))}
                  className="h-9 rounded-lg border border-border bg-background px-2 text-sm font-bold text-foreground outline-none focus:border-accent"
                >
                  {playableSeasons.map((season) => (
                    <option key={season.id} value={season.number}>
                      {seasonLabel(season, t)} ({season.episodes.length})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {playableSeasons.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("series.noEpisodes")}</p>
          ) : (
            <>
              {/* Araç çubuğu: solda izleme ilerlemesi, sağda görünüm değiştirici. */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                {/* AKTİF SEZON İLERLEMESİ — cihazdaki kayda göre. İlerleme yokken
                    de "0/24 izlendi" görünür: düğme değil, bilgi satırıdır. */}
                {activeSeason && activeEpisodes.length > 0 ? (
                  <span className="text-xs font-bold text-muted-foreground">
                    {t("series.watchedProgress", {
                      watched: watchedInActiveSeason,
                      total: activeEpisodes.length,
                    })}
                  </span>
                ) : (
                  <span />
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 rounded-full border border-border p-1">
                    <button
                      type="button"
                      aria-pressed={view === "row"}
                      aria-label={t("series.rowView")}
                      onClick={() => setView("row")}
                      className={`grid size-8 place-items-center rounded-full transition-colors ${
                        view === "row"
                          ? "bg-accent/15 text-accent"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <List size={16} />
                    </button>
                    <button
                      type="button"
                      aria-pressed={view === "grid"}
                      aria-label={t("series.gridView")}
                      onClick={() => setView("grid")}
                      className={`grid size-8 place-items-center rounded-full transition-colors ${
                        view === "grid"
                          ? "bg-accent/15 text-accent"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <LayoutGrid size={16} />
                    </button>
                  </div>
                </div>
              </div>

              {/* SATIR GÖRÜNÜMÜ (varsayılan): geniş yatay satırlar — kapak solda,
                  başlık/açıklama ortada, rozetler sağda. Satırlar arası boşluk
                  12 px (YAKLAŞIK). IZGARA görünümü alternatif olarak KORUNDU
                  (`EpisodeCard` çizimi değişmedi). */}
              <div
                className={
                  view === "row"
                    ? "mt-5 flex flex-col gap-3"
                    : "mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
                }
              >
                {visibleEpisodes.map((episode) => {
                  const isWatched = watched.has(episodeKey(episode.season, episode.number));
                  // Kartın açacağı sezon: aktif sezon (bölümün kendi sezonu
                  // yoksa ona düşülür). Rota bunu izleme YOLUNA
                  // (`/anime/<slug>/season/<n>/episode/<n>`) çevirir.
                  const watchSeason = activeSeason?.number ?? episode.season;
                  if (view === "row") {
                    return (
                      // Tıklama kaydı (recordWatched) eskiden sarmalayıcı <div>
                      // üzerindeydi; satır artık doğrudan <Link> olduğu için aynı
                      // iş bağlantının onClick'inde yapılır: tarayıcı sayfayı
                      // değiştirmeden ÖNCE ilerleme kaydedilir.
                      <EpisodeRow
                        key={episode.id}
                        slug={showSlug(show)}
                        episode={episode}
                        watchSeason={watchSeason}
                        seriesPoster={show.image}
                        malId={show.mal_id ?? null}
                        watched={isWatched}
                        onOpen={() => recordWatched(episode.season, episode.number)}
                      />
                    );
                  }
                  return (
                    // IZGARA: eski sarmalayıcı + EpisodeCard + "izlendi" işareti
                    // AYNEN korunur (yalnızca satır görünümü değişti).
                    <div
                      key={episode.id}
                      className="relative"
                      onClick={() => recordWatched(episode.season, episode.number)}
                    >
                      <EpisodeCard
                        slug={showSlug(show)}
                        episode={episode}
                        seriesPoster={show.image}
                        malId={show.mal_id ?? null}
                        variant="grid"
                        watchSeason={watchSeason}
                      />
                      {/* "izlendi" işareti yalnızca kayıtlı bölümde; tıklamayı
                          engellemez (pointer-events-none). */}
                      {isWatched && (
                        <span className="pointer-events-none absolute left-4 top-4 z-10 rounded-full border border-accent/40 bg-background/95 px-2 py-0.5 text-[10px] font-bold text-accent">
                          {t("series.watchedBadge")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {hiddenCount > 0 && (
                <div className="mt-6 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => setVisibleCount((count) => count + GRID_PAGE_SIZE)}
                  >
                    <ChevronDown size={16} />
                    {plural(t, hiddenCount, "series.showMoreOne", "series.showMore")}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>

        {adDetailBottom.isFetched && adDetailBottom.code ? (
          <AdSlot slot="ad_detail_bottom" className="flex justify-center" />
        ) : (
          <AdsterraNative className="flex justify-center" />
        )}

        {/* BENZER SERİLER — ortak tür etiketi olan diğer seriler. Kart çizimi ana
            sayfadakiyle (index.tsx) AYNI; yeni bir tasarım yok. Hiç eşleşme
            yoksa başlık dâhil hiçbir şey çizilmez (boş bölüm/başlık kalmaz). */}
        {similarShows.length > 0 && (
          <section className="mx-auto w-full max-w-4xl">
            <h2 className="font-display text-3xl text-foreground">{t("series.similar")}</h2>
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {similarShows.map((similar) => {
                const similarSlug = showSlug(similar);
                return (
                  // İSTEMCİ İÇİ GEZİNME (`Link`): tıklamada tam sayfa yüklemesi
                  // yoktur; sunucu sayfayı yeniden çizmez, reklam slotları yeniden
                  // kurulmaz ve istemci sorgu önbelleği atılmaz.
                  // ÖNDEN ÇEKME (preload) BİLEREK KAPALI — KOTA/EGRESS. Sebep
                  // (ana sayfadaki kartlarla aynı): bu bir ızgaradır ve fareyle
                  // üzerinden geçmek tıklama demek değildir. Önden çekme her
                  // hover'da `/anime/$slug` rota yükleyicisini çalıştırır; o
                  // yükleyici `showDetailQueryOptions` ile 4 tablo okuması
                  // (`shows`, `show_episodes`, `show_seasons`, `site_settings`) +
                  // Storage imzalaması yapar. Yani kartlara hiç tıklanmadan
                  // hover başına bir okuma yanardı; aynı karar ana sayfa
                  // ızgarasında da uygulandı. Gezinme yine anındadır (istemci içi).
                  <Link
                    key={similar.slug ?? similar.title}
                    to="/anime/$slug"
                    params={{ slug: similarSlug }}
                    preload={false}
                    className="group card-hover relative block overflow-hidden rounded-2xl bg-card shadow-2xl"
                  >
                    {similar.episode_count === 0 && (
                      <span className="absolute left-2 top-2 z-10 rounded-full bg-background/95 px-2.5 py-1 text-[11px] font-extrabold text-accent">
                        {t("common.comingSoon")}
                      </span>
                    )}
                    <div className="aspect-[2/3] overflow-hidden bg-muted">
                      <img
                        src={similar.image}
                        alt={t("home.coverAlt", { title: similar.title })}
                        width={768}
                        height={1152}
                        loading="lazy"
                        className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                      />
                    </div>
                    <div className="p-3">
                      <h3 className="truncate text-sm font-extrabold text-foreground">
                        {similar.title}
                      </h3>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                        {similar.subtitle}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-border bg-secondary">
        <div className="mx-auto max-w-6xl px-5 py-8 text-center text-xs text-muted-foreground lg:px-8">
          {t("footer.copyright")}
        </div>
      </footer>
    </div>
  );
}

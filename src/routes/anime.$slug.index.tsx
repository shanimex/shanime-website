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
import { ChevronDown, Heart, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AdPlacement } from "@/components/site/AdPlacement";
import { EpisodeCover } from "@/components/site/EpisodeCover";
import { ControlSelect } from "@/components/site/ControlSelect";
import { supabase } from "@/integrations/supabase/client";
import {
  anizipCover,
  anizipCoverForSeason,
  anizipCoverFromChain,
  resolveSeasonMalId,
} from "@/lib/anizip-covers";
import { formatAirdate } from "@/lib/format-airdate";
import {
  episodeCoverUrl,
  showDetailQueryOptions,
  showSlug,
  signImagePaths,
  displayEpisodeTitle,
  type Episode,
  type Show,
  type ShowWithImage,
} from "@/lib/content";
import { cachedRead, TTL_SIMILAR_SECONDS } from "@/lib/server-cache";
import { hasFavorite, toggleFavorite } from "@/lib/favorites";
// `translate`: modül seviyesindeki `t`nin takma adı. Sayfa başlığı/meta bilgisi
// bileşen DIŞINDA üretildiği için orada hook çağrılamaz. Takma ad şart — doğrudan
// `t` import etmek `useLang()`ün döndürdüğü `t`yi gölgelerdi.
import { plural, t as translate, useDocumentTitle, useLang, type Translate } from "@/lib/i18n";
import { useTranslatedTexts } from "@/lib/content-translate";
import { episodeKey, getLastEpisode, getWatched } from "@/lib/watch-progress";

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
  head: ({ loaderData, params }) => {
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
    const canonical = `https://shanime.xyz/anime/${encodeURIComponent(show.slug || params.slug)}`;
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
        { property: "og:url", content: canonical },
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
  const title = season.title.trim();
  // AniList zincirinden gelen başlıklar çoğu zaman "Shingeki no Kyojin
  // Season 2" biçimindedir. Bunları ham hâliyle göstermek yerine sitenin
  // seçili dilindeki kısa sezon etiketini kullan.
  if (!title || /\bseason\s*\d+/i.test(title)) {
    return t("series.seasonFallback", { number: season.number });
  }
  return title;
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
 * KAPAK ZİNCİRİ (TVDB-TEK): panelden yüklenen kapak → ani.zip/TVDB bölüm görseli
 * → R2'deki bölüm kapağı. Sağlayıcı kareleri, animecix/katalog kapağı ve
 * seri posteri kapak olarak KULLANILMAZ; hiçbiri yoksa `EpisodeCover` nötr
 * "numara" kutusunu gösterir (kırık/uydurma görsel çizilmez).
 */
/**
 * BÖLÜMÜN YÜKLENME TAZELİĞİ — yalnızca "BUGÜN" ve "DÜN".
 *
 * ── NEDEN DEĞİŞTİ (kullanıcı isteği, 04.10.2026) ─────────────────────────────
 * Kullanıcı: "bunun mantığını değiştir; sadece DÜN ve BUGÜN olsun, yüklendiği
 * belli olsun". Eskiden rozet "YENİ" yazıyordu ve ölçüt "sezonun EN SON EKLENEN
 * bölümü"ydü (`newestEpisodeIds`) — yani sabah eklenen bölüm ertesi gün hâlâ
 * "YENİ" diyordu, ama NE ZAMAN eklendiği bilinmiyordu. Artık rozet doğrudan
 * `created_at`e bakar: bugün eklenmişse BUGÜN, dün eklenmişse DÜN, daha eskisiyse
 * HİÇ. Böylece rozet "taze mi" değil "ne zaman geldi" sorusunu yanıtlar.
 *
 * ── SAAT OKUMA YALNIZCA İSTEMCİDE ───────────────────────────────────────────
 * `now` sunucuda hesaplanırsa gece yarısını geçen bir istekte sunucu ile tarayıcı
 * farklı gün üretir ve React "hydration mismatch" uyarısı doğar. Bu yüzden saat
 * `useState(null)` + `useEffect` ile YALNIZCA mount sonrası okunur; sunucu
 * çiziminde rozet hiç yoktur.
 *
 * Ölçüt `show_episodes.created_at`tir (eklenme anı) — tabloda yayın tarihi kolonu
 * yoktur; aynı alanı ana sayfanın "YENİ ÇIKANLAR" bandı da kullanır.
 */
type UploadDayLabel = "today" | "yesterday";

/**
 * Sezonun EN YENİ yükleme anı (`created_at`) — ham metin olarak döner.
 *
 * Rozet yalnızca bu anın DÜŞTÜĞÜ güne verilir: aynı toplu ekleme (ör. 12 bölüm
 * birden) hep aynı gün damgasını taşıdığı için grup ya topluca işaretlenir ya da
 * hiç. Tarihi okunamayan bölümler yok sayılır — uydurma rozet üretilmez.
 */
function newestUploadAt(episodes: Episode[]): string | undefined {
  let best = Number.NEGATIVE_INFINITY;
  let bestValue: string | undefined;
  for (const episode of episodes) {
    const parsed = Date.parse(episode.created_at ?? "");
    if (!Number.isNaN(parsed) && parsed > best) {
      best = parsed;
      bestValue = episode.created_at;
    }
  }
  return bestValue;
}

/** `createdAt` bugünse "today", dünse "yesterday", daha eski/okunamazsa `null`. */
function uploadDayLabel(createdAt: string | undefined, now: number): UploadDayLabel | null {
  const created = Date.parse(createdAt ?? "");
  if (Number.isNaN(created)) return null;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (created >= startOfToday.getTime()) return "today";
  if (created >= startOfYesterday.getTime()) return "yesterday";
  return null;
}

/**
 * Detay hero'sundaki çağrı düğmesi sınıfı.
 *
 * NEDEN: `Button` temeli `shrink-0` taşır ve uzun etiket ("Kaldığın yerden devam
 * et — S1B1") dar telefonda kendi kolonundan taşarak TÜM sayfayı sağa kaydırıyordu
 * (ölçüm 03.10.2026: 360 px ekranda düğme sağ kenarı 407 px). `w-full` +
 * `whitespace-normal` ile düğme kolon genişliğine oturur ve metin alt satıra sarar;
 * `h-auto`+`py-3` sarılan metne yer verir. `sm` ve üstünde eski ölçüye döner.
 */
const CTA_BUTTON =
  "h-auto w-full max-w-full whitespace-normal py-3 text-center rounded-full sm:h-12 sm:w-auto sm:py-0";

function EpisodeRow({
  slug,
  episode,
  bannerImage,
  watchSeason,
  malId,
  seasonMalId,
  isMovie,
  watched,
  newLabel,
}: {
  /** Serinin slug'ı: R2 kapak anahtarı ve izleme bağlantısı için. */
  slug: string;
  episode: Episode;
  /** Güncel yatay vitrin kapağı. */
  bannerImage?: string;
  /** Bağlantının açacağı sezon (aktif sezon; bölümün kendisi değilse ona düşülür). */
  watchSeason: number;
  /** Serinin MAL kimliği (ani.zip yedeği). */
  malId?: number | null | undefined;
  /**
   * Sezonun KENDİ MAL kimliği (`show_seasons.mal_id`). MAL'de her sezon ayrı bir
   * anime kaydı olduğu için (ör. Jujutsu Kaisen S2) kapak aramasında seri
   * kimliğinden ÖNCE denenir — `anizipCoverForSeason` bunu kullanır. Boşsa
   * arama seri kimliğine düşer.
   */
  seasonMalId?: number | null | undefined;
  /** Film detayında sezon/bölüm rozeti kullanılmaz. */
  isMovie?: boolean;
  /** Cihazdaki kayıtta bu bölüm izlendi mi? */
  watched: boolean;
  /**
   * Bölüm bugün/dün mü eklendi? `null` = rozet çizilmez (daha eski ya da saat
   * henüz okunmadı). İzlenmiş satırda rozet göstermemek ÇAĞIRANIN işidir.
   */
  newLabel: UploadDayLabel | null;
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
  const sourceTitle = displayEpisodeTitle(episode.title);
  const sourceSummary = episode.summary?.trim() ?? "";
  const [translatedTitle, translatedSummary] = useTranslatedTexts([sourceTitle, sourceSummary]);
  const label = sourceTitle
    ? translatedTitle
    : t("series.episodeLabel", { number: episode.number });
  const summary = translatedSummary;

  return (
    // İZLENEN SATIRIN TAMAMI SOLUKLAŞIR (30.09.2026). Kullanıcı geri bildirimi:
    // "siyah beyaza çevirdin, ben kutuyu da soluklaştırsan sandım" → kapak artık
    // GRİLEŞTİRİLMEZ, rengi korunur; solukluk satırın BÜTÜNÜNE uygulanır.
    <Link
      to="/anime/$slug/season/$season/episode/$episode"
      params={{ slug, season: String(watchSeason), episode: String(episode.number) }}
      preload={false}
      className={`group flex items-center gap-3 rounded-xl border border-border bg-card p-2 transition-all hover:border-accent/60 hover:bg-secondary hover:opacity-100 focus-visible:border-accent focus-visible:outline-none sm:gap-4 sm:p-3 ${
        watched ? "opacity-55" : ""
      }`}
    >
      {/* Kapak üstündeki sezon/bölüm rozeti ve Animex tarzı alttan karartma,
          görselin üzerinde okunaklı bir bilgi katmanı olarak tutulur. */}
      <span className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-secondary sm:w-44 md:w-48">
        <EpisodeCover
          number={episode.number}
          numberClassName="font-display text-2xl text-foreground/70"
          // ── TVDB-TEK KAYNAK (kullanıcı kuralı) ─────────────────────────────
          // Yalnızca: (a) panelden ELLE yüklenen kapak → (b) ani.zip/TVDB bölüm
          // görseli (sezonun kendi kaydı → seri kaydı → zincirdeki kardeş kayıt)
          // → (c) R2 bölüm kapağı. Sağlayıcı kareleri (voe/
          // morencius/vidmoly), animecix/mangacix, katalog kapağı ve SERİ POSTERİ
          // kapak olarak KULLANILMAZ; hiçbiri yoksa kart numara rozetiyle kalır.
          candidates={[
            // Güncel yatay vitrin kapağı; bölüm kapağı yalnızca banner yoksa kullanılır.
            isMovie ? (bannerImage ?? "") : "",
            episode.thumbnail ?? "",
            // SEZONUN KENDİ MAL kaydı ÖNCE denenir: MAL'de her sezon ayrı bir
            // anime kaydıdır (ör. Jujutsu Kaisen S2), seri kimliği o sezonun
            // görsellerini İÇERMEZ. Boşsa alttaki seri-kimliği aramasına düşer.
            anizipCoverForSeason(seasonMalId, episode.season, episode.number),
            anizipCover(malId, episode.season, episode.number),
            // BÖLÜNMÜŞ SEZONLAR (ör. re-zero S2 = 39587 + 42203): sezonun kendi
            // kaydı bu bölümü içermiyorsa zincirdeki KARDEŞ kayda bakılır.
            anizipCoverFromChain(malId, episode.season, episode.number, seasonMalId),
            // R2'ye taşınmış TVDB görseli (manifest'te varsa).
            episodeCoverUrl(slug, episode.season, episode.number),
          ]}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[68%] bg-gradient-to-t from-black/95 via-black/50 to-transparent"
        />
        {!isMovie ? (
          <span className="absolute bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap font-ui text-[10px] font-medium tracking-wide text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)] sm:text-xs">
            {t("series.seasonEpisodeOverlay", {
              season: String(episode.season),
              number: String(episode.number),
            })}
          </span>
        ) : null}
        {/* YÜKLEME TAZELİĞİ ROZETİ (04.10.2026) — artık "YENİ" değil "BUGÜN" /
            "DÜN" (kullanıcı isteği: "sadece DÜN ve BUGÜN olsun, yüklendiği belli
            olsun"). Metin doğrudan `created_at`e bakarak gelir (bkz.
            `uploadDayLabel`); daha eski bölümlerde rozet HİÇ çizilmez.
            İzlenen bölümde rozet YOKTUR: onun işareti satırın soluklaşmasıdır ve
            bu kapıyı ÇAĞIRAN taraf tutar (`newLabel` null geçirir). */}
        {newLabel ? (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-accent px-1.5 py-0.5 font-ui text-[10px] font-bold text-accent-foreground">
            {t(newLabel === "today" ? "series.addedToday" : "series.addedYesterday")}
          </span>
        ) : null}
      </span>

      {/* BAŞLIK + (varsa) AÇIKLAMA. Yazı tipi `font-ui` (Manrope, sade geometrik sans).
          Başlık rengi NÖTR kalır: "izlendi" bilgisini artık satırın bütününün
          soluklaşması taşır, metni ayrıca donuklaştırmaya gerek yok. */}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {/* BÖLÜM ADI: başlık formunda, EN FAZLA İKİ SATIR (kullanıcı isteği,
            05.10.2026: "yazıyı sığdırcam diye kutu büyümüş, böyle istemiyorum;
            daha mantıklı bir şey yap").

            ÖNCEKİ DURUM: satır `truncate` idi → ad "The End of the…" diye tek
            satırda kesiliyordu; sonra kırpma kaldırıldı → uzun adlar 3-4 satıra
            çıkıp SATIRI şişiriyordu. DENGE: `line-clamp-2` — ad iki satıra kadar
            görünür (çoğu ad tek satırda biter), satır yüksekliği kapağın
            boyunu aşmaz, liste düzenli kalır. Tipografi başlık olarak korunur:
            kalın + tam kontrast, sıkı satır aralığı. */}
        <span className="line-clamp-2 font-ui text-sm font-bold leading-snug text-foreground sm:text-base">
          {label}
        </span>
        {summary ? (
          <span className="line-clamp-2 font-ui text-xs text-muted-foreground sm:text-sm">
            {summary}
          </span>
        ) : null}
      </span>

      {/* SAĞDAKİ ROZETLER: "1. Bölüm" ve tarih AYRI yuvarlak kutularda (kullanıcı
          isteği, 30.09.2026: "tarih şeyi ile bölüm yazısını böyle yapsana").
          Tarih `episode.airdate`ten gelir (ani.zip, uzun önbellekli); tarih YOKSA
          o kutu hiç çizilmez — uydurma yazılmaz. İzlendi işareti kapağın köşesindedir. */}
      {/* RENK (30.09.2026): tarih rozeti NÖTR kalır; yalnızca BÖLÜM rozeti renk alır
          ("geri al, sadece bölüm pillinin rengini değiş"). İki rozet birden
          renklenince sayfa yapay duruyordu.

          Ton, admin paneldeki `Reklam kodları` kartının YUMUŞAK tonuyla aynı mantık:
            `.admin-card--ads { background: color-mix(in oklab, var(--card) 88%, var(--accent) 12%) }`
          → "tam renk" değil, kartın üstünde ince bir vurgu.
          Marka kırmızısı (`primary`) burada KULLANILMAZ: detay sayfasında o renk
          oynat düğmesinin ve ilerleme çubuğunun; burada vurgu rengi `accent`.

          ÇERÇEVE (stroke) YOK (30.09.2026, kullanıcı isteği: "bg'nin dışındaki
          stroke'u kaldır") — rozeti yalnızca yumuşak dolgu taşır. */}
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {/* "Episode N" rozeti MOBİLDE GİZLİ (03.10.2026 düzenlemesi): kapakta zaten
            `S1E17` yazıyor — bu rozet dar telefonda başlığa yer bırakmayıp onu
            "The..." diye kesiyordu. Masaüstünde (geniş) yeniden görünür. */}
        <span className="hidden rounded-full bg-accent/10 px-2.5 py-1 font-ui text-[11px] font-semibold text-accent sm:inline-block">
          {t("series.episodeLabel", { number: episode.number })}
        </span>
        {episode.airdate ? (
          <span
            className="rounded-full border border-border bg-secondary px-2 py-0.5 font-ui text-[10px] font-semibold text-muted-foreground sm:px-2.5 sm:py-1 sm:text-[11px]"
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
  const { t, lang } = useLang();
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  // Detay sayfası reklamları: panelde kod varsa PANEL kazanır, boşsa koddaki
  // Adsterra birimi çalışır (slotlar vardı ama içleri boştu → reklam yoktu).
  // Üst slot banner, alt slot native: aynı sayfada tek bir `highrevenueformat`
  // birimi bulunmalıdır, çünkü o birim `window.atOptions` global'ini kullanır.
  const [visibleCount, setVisibleCount] = useState(GRID_PAGE_SIZE);
  // Uzun açıklama 3 satırda kısaltılır; sayfa "kompakt" kalsın diye.
  const [descOpen, setDescOpen] = useState(false);
  // Tür listesi açık/kapalı: varsayılan kapalı → yalnız ilk 3 etiket görünür.
  const [genresOpen, setGenresOpen] = useState(false);
  /**
   * ROZET SAATİ — yalnızca mount sonrası dolar (`null` = sunucu çizimi).
   * Sunucuda `Date.now()` okunsaydı gece yarısını geçen istekte sunucu "DÜN" /
   * tarayıcı "BUGÜN" yazabilir ve React hydration uyuşmazlığı uyarısı doğardı.
   * Bu yüzden saat İSTEMCİDE okunur; dolana kadar hiçbir rozet çizilmez.
   */
  const [now, setNow] = useState<number | null>(null);

  // Veri loader'dan gelir; sayfa sunucuda içerikle birlikte render edildiği
  // için ayrı bir "yükleniyor" ekranına gerek yok.
  const data = Route.useLoaderData();

  // CİHAZA ÖZEL İLERLEME (ekleme). Kayıt localStorage'da olduğu için sunucuda
  // YOKTUR: ilk render boş ilerlemeyle çıkar, gerçek değerler tarayıcıda bağlanan
  // effect ile okunur. Bu sayede sunucu HTML'i ile istemci çizimi aynı kalır
  // (hydration uyuşmazlığı olmaz) ve ilk boyamada yanlış bir "izlendi" görünmez.
  const progressSlug = data ? showSlug(data.show) : "";
  const [watched, setWatched] = useState<Set<string>>(() => new Set());
  const [favorite, setFavorite] = useState(false);
  const [lastEpisode, setLastEpisode] = useState<{ season: number; episode: number } | null>(null);
  useEffect(() => {
    if (!progressSlug) return;
    const sync = () => {
      setWatched(getWatched(progressSlug));
      setLastEpisode(getLastEpisode(progressSlug));
      setFavorite(hasFavorite(progressSlug));
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

  // ROZET SAATİ: `now` yalnızca tarayıcıda set edilir (yukarıdaki nota bakınız).
  useEffect(() => {
    setNow(Date.now());
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
   * Seçili dile göre sunucu çevirisi istenir; açıklamalar uzun olsa da API
   * sınırı içinde çevrilir, hata olursa özgün metin korunur.
   */
  // ⚠️ ADLAR (1. ad + 2. ad) SORULMAZ: yalnızca AÇIKLAMA ve TÜRLER çevrilir
  // (kullanıcı kuralı, 04.10.2026: "anime isimleri değişmemeli").
  const [translatedDescription, translatedGenre] = useTranslatedTexts([
    data?.show?.description?.trim() ?? "",
    data?.show?.genre?.trim() ?? "",
  ]);

  if (!data) return <Centered>{t("series.notFound")}</Centered>;

  const { show, episodes, seasons, relatedMovies } = data;
  /**
   * ADLAR (1. ad + 2. ad) ÇEVRİLMEZ, DİLE GÖRE DE DEĞİŞMEZ (kullanıcı kuralı,
   * 04.10.2026: "anime isimleri değişmemeli"). `show.title`/`show.subtitle`
   * doğrudan katalogdaki özgün hâliyle çizilir; DeepL özel isimleri bozuyordu
   * ("Mushoku Tensei" → "Reincarnation of a Murderer"). Yalnızca açıklama ve
   * türler çevrilir.
   */
  const title = show.title;
  const subtitle = show.subtitle?.trim() || "";
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
  /**
   * SEZONUN EN YENİ YÜKLEME GÜNÜ — rozet yalnızca bu güne verilir.
   *
   * NEDEN GRUP SINIRI (04.10.2026): kullanıcı isteği "YENİ yerine BUGÜN/DÜN
   * olsun" idi. İlk denemede `created_at`i bugün/dün olan HER bölüm işaretlendi;
   * ama panelden bölümler TOPLU eklendiği için ölçümde aynı anda 23 rozet
   * çıktı (tek toplu ekleme = 23 bölüm). Kullanıcının daha önceki geri
   * bildirimi de "2 tane YENİ ne alaka" idi. Bu yüzden sınır, takvim günü değil
   * EN YENİ YÜKLEME GRUBU: bugün yükleme varsa yalnız BUGÜN'ünkiler, yoksa
   * yalnız DÜN'ünkiler işaretlenir; grup iki günden eskiyse rozet HİÇ çizilmez.
   */
  const freshestUpload: UploadDayLabel | null =
    now === null ? null : uploadDayLabel(newestUploadAt(activeEpisodes), now);
  /** Bir satırın rozeti: yalnızca en yeni yükleme grubunda ve izlenmemişse. */
  function uploadLabelFor(episode: Episode, isWatched: boolean): UploadDayLabel | null {
    if (isWatched || freshestUpload === null || now === null) return null;
    return uploadDayLabel(episode.created_at, now) === freshestUpload ? freshestUpload : null;
  }
  const hiddenCount = activeEpisodes.length - visibleEpisodes.length;
  // Açıklama ve tür İÇERİK çevirisinden gelir (yukarıdaki kanca): TR seçiliyse
  // DeepL karşılığı, İngilizce'de orijinal metin.
  const description = translatedDescription || (show.description?.trim() ?? "");
  const genre = translatedGenre || (show.genre?.trim() ?? "");
  // Bu uzunluğun üstündeki açıklamalar 3 satırı aşar; "devamını oku" gösterilir.
  const longDescription = description.length > 280;
  /**
   * TÜR ETİKETLERİ — "+N" AÇ/KAPA (karar, 03.10.2026).
   *
   * İki seçenek tartıldı ve "+N" seçildi (yana kaydırma yerine): kaydırılan
   * şeritte fazladan türler GÖRÜNMEZ oluyor, kullanıcı kaydırılabildiğini
   * anlamıyor. "+N" açıkça "burada daha var" der; tek dokunuşla hepsi açılır ve
   * varsayılan tek satır kalır. Liste en fazla 8 etiketle sınırlı.
   */
  const genreList = genre
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8);
  const visibleGenres = genresOpen ? genreList : genreList.slice(0, 3);

  // KÜNYE: "2020 · TV · 4 Sezon · 24 bölüm". Tüm parçalar sayfada zaten yüklü
  // (bölüm sayısı = `episodes` uzunluğu, sezon sayısı = `playableSeasons`), bu
  // yüzden EK SORGU yapılmadı.
  // KÜNYE parçaları: yıl veritabanı içeriğidir (sayı, çevrilmez); geri kalanı
  // bizim metnimizdir (arayüz sözlüğünden çevrilir).
  // ⚠️ TÜR (`genre`) KÜNYEDEN ÇIKARILDI (03.10.2026): türler artık hero'da ayrı
  // etiketler hâlinde gösteriliyor; künyede tekrar yazmak bilgi tekrarıydı.
  //
  // ── KAYIT TÜRÜ (TV/Film) VE SEZON SAYISI BURAYA TAŞINDI (04.10.2026) ────────
  // Kullanıcı isteği: başlığın üstündeki ayrı "TV" rozeti kaldırılıp yıl ile
  // bölüm arasına konsun; tür etiketleri satırındaki ayrı "N Sezon" hapı da
  // oradan çıkarılsın (kategorilerin arasında sezon sayısının yeri yoktu).
  // Hepsi tek ince künye satırında toplanınca hero daha az yer kaplıyor.
  const kunye = [
    show.year,
    "kind" in show ? (show.kind === "movie" ? t("common.movieKind") : t("common.tvKind")) : "",
    // Sezon sayısı yalnızca BİRDEN FAZLA oynatılabilir sezon varsa yazılır: tek
    // sezonlu seride "1 Sezon" gereksiz tekrar olurdu.
    playableSeasons.length > 1
      ? plural(t, playableSeasons.length, "home.seasonCountOne", "home.seasonCount")
      : "",
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

  // Sezon değişince liste başa döner; yoksa 2. sezona geçince 1. sezonun
  // açılmış "daha fazla" hâli kalıyor.
  function selectSeason(number: number) {
    setSelectedSeason(number);
    setVisibleCount(GRID_PAGE_SIZE);
  }

  return (
    <div className="min-h-screen bg-background">
      {/* ESKI SAYFA-ICI BASLIK SERIDI KALDIRILDI (01.10.2026): "header her yerde ayni olsun". */}
      {/* Serit artik TEK yerde: `SiteHeader` -> `__root.tsx`. */}

      <section className="relative isolate overflow-hidden border-b border-border">
        {/* Vitrin bandı SABİT yükseklikte. Eskiden görsel `inset-0` idi: "Devamını
            oku" ile bölüm uzayınca görsel de büyüyor, kadraj değişiyordu
            (kullanıcı geri bildirimi: "üstteki resimle beraber büyüyor").
            Artık bandın yüksekliği içerikten bağımsız: mobil 240 px, masaüstü 320 px. */}
        <div className="absolute inset-x-0 top-0 -z-20 h-64 sm:h-72 md:h-80">
          <img
            src={backdrop}
            alt=""
            aria-hidden
            // object-top: görselin ÜSTÜ hizalansın (kullanıcı isteği, 03.10.2026:
            // "hep en üstten hizalasın, ortadan hizalamasın"). opacity-50: banner
            // artık GÖRÜNÜR — eskiden 30% + yoğun karartmayla neredeyse kayboluyordu.
            className="size-full object-cover object-top opacity-50"
          />
          {/* Karartma YUMUŞATILDI ki banner görünsün: üst bölge daha açık, alt bölge
              (yazının durduğu yer) koyu kalır — okunurluk korunur. */}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/25" />
          <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-background/30 to-transparent" />
        </div>
        {/* HERO — GRID (mobil uyarlama, 03.10.2026).

            MOBİL: 1. satır = poster + başlık künyesi (yan yana); 2. satır = türler,
            açıklama ve düğme TAM GENİŞLİK (iki kolonu birden kaplar). Böylece metin
            posterin sağına sıkışıp alt alta yayılmıyor — yanlara açılıp daha az
            satıra sığar (kullanıcı isteği: "sağa yapışık olmasın, yanlara genişleyip
            sığar, aşağı çok inmez").

            `sm`+: poster iki satırı kaplar (row-span-2) ve her şey SAĞ kolonda kalır
            — masaüstü görünüm bilerek değiştirilmedi. */}
        <div className="mx-auto grid max-w-6xl grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 px-5 pb-6 pt-6 sm:gap-x-7 sm:gap-y-4 md:pb-12 md:pt-14 lg:px-8">
          <img
            src={show.image}
            // `alt` çevrilmiş başlığı kullanır (ekran okuyucu da doğru dili okusun).
            alt={t("home.coverAlt", { title })}
            // self-start: satır yükseldikçe (açıklama açılınca) kapak uzamasın —
            // `align-items: stretch` kapakta çirkin bir orantı bozulması yapıyordu.
            className="row-span-1 aspect-[2/3] w-24 shrink-0 self-start rounded-2xl object-cover shadow-2xl ring-1 ring-white/10 sm:row-span-2 sm:w-40 md:w-44"
          />
          <div className="min-w-0 flex-1">
            {/* TÜR (TV/Film) rozeti KALDIRILDI (04.10.2026, kullanıcı isteği):
                artık başlığın ALTINDAKİ künye satırında yıl ile sezon/bölüm
                arasında yazılıyor — ayrı rozet bilgi tekrarıydı. */}
            {/* Başlık artık VİTRİN başlığıyla AYNI ailede: Manrope (`font-ui`),
                kalın. Eskiden Archivo Black + altın renkti; vitrindeki anime
                başlıkları beyaz/düz olduğu için uyumsuz duruyordu. */}
            <div className="flex items-start justify-between gap-3">
              <h1 className="page-title font-display text-2xl text-foreground sm:text-4xl md:text-5xl">
                {title}
              </h1>
              <button
                type="button"
                aria-label={favorite ? "Favorilerden çıkar" : "Favorilere ekle"}
                title={favorite ? "Favorilerden çıkar" : "Favorilere ekle"}
                onClick={() => setFavorite(toggleFavorite(progressSlug))}
                className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-background/60 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <Heart size={17} fill={favorite ? "currentColor" : "none"} aria-hidden="true" />
              </button>
            </div>
            {/* 2. AD (alt başlık) BURADAN KALDIRILDI (04.10.2026, kullanıcı
                isteği): artık açıklamanın HEMEN ÜSTÜNDE durur (aşağıda, gövde
                bölümünde) — başlıkla iç içe durup açıklama gibi görünmesin. */}
            {/* KÜNYE: yıl · bölüm sayısı — tek ince satır. TÜRLER buradan çıkarıldı:
                ayrı, okunaklı etiketler hâlinde ALT satırda gösteriliyor. */}
            {kunye && (
              <p className="page-subtitle mt-2 font-display text-xs tracking-wide text-muted-foreground">
                {kunye}
              </p>
            )}
            {/* TÜR ETİKETLERİ — KÜNYENİN HEMEN ALTINDA (kullanıcı isteği,
                04.10.2026). Eskiden posterin ALTINDA tam genişlikte ayrı bir
                satırdı ve künyenin sağındaki alan BOŞ kalıyordu. Artık başlık,
                künye ve türler AYNI kolonda, posterin yanında toplanır; gövde
                bloğu (alt başlık · açıklama · düğme) posterin altına iner.

                "+N" AÇ/KAPA: varsayılan ilk 3 etiket + kalanı için küçük,
                altın tonlu "+N" düğmesi; dokununca kalanlar açılır. Yazı tipi
                KÜÇÜK (`text-[10px]`) — daha ince, az yer kaplar. */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {visibleGenres.map((genreName) => (
                <span
                  key={genreName}
                  className="rounded-full bg-secondary/80 px-2 py-0.5 font-ui text-[10px] font-semibold text-foreground/80"
                >
                  {genreName}
                </span>
              ))}
              {genreList.length > 3 && (
                <button
                  type="button"
                  onClick={() => setGenresOpen((open) => !open)}
                  aria-expanded={genresOpen}
                  aria-label={genresOpen ? t("series.showLess") : t("series.readMore")}
                  className="rounded-full bg-accent/15 px-2 py-0.5 font-ui text-[10px] font-bold text-accent transition-colors hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {genresOpen ? "−" : `+${genreList.length - 3}`}
                </button>
              )}
              {/* "N Sezon" HAPI KALDIRILDI (04.10.2026, kullanıcı isteği):
                  kategorilerin arasında sezon sayısının yeri yoktu; künye
                  satırına (yıl · TV · N Sezon · M bölüm) taşındı. */}
            </div>
          </div>

          {/* GÖVDE (alt başlık · açıklama · çağrı) — MOBİLDE TAM GENİŞLİK (iki
              kolonu da kaplar), `sm`+ ekranda sağ kolonda kalır. */}
          <div className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2">
            {/* 2. AD (alt başlık) — AÇIKLAMANIN HEMEN ÜSTÜNDE, araya boşluk
                bırakılarak (kullanıcı isteği, 04.10.2026: "2.ad'ı tam
                açıklamanın üzerine bir boşluk bırakarak koy"). Başlıkla iç içe
                durup açıklama gibi görünmesin diye buraya alındı; üstten tür
                etiketlerinden, alttan açıklamadan net biçimde ayrılır. */}
            {subtitle && (
              <p className="page-subtitle line-clamp-2 font-display text-xs text-muted-foreground sm:text-sm">
                {subtitle}
              </p>
            )}
            {description && (
              <>
                <p
                  // MOBİLDE 2 SATIR, MASAÜSTÜNDE 3: uzun açıklama dar telefonda
                  // hero'yu aşağı uzatıyordu (kullanıcı, 03.10.2026:
                  // "çok aşağı uzuyo fazlasıyla telefonda").
                  className={`page-description mt-4 max-w-2xl text-[13px] text-foreground/90 sm:text-sm ${
                    descOpen || !longDescription ? "" : "line-clamp-2 sm:line-clamp-3"
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
                      // YAZI TİPİ `font-ui` (Manrope) + küçük boy: varsayılan gövde
                      // fontu (Signika Negative) kalın hâliyle "kaba" duruyordu
                      // (kullanıcı, 03.10.2026: "çok kaba bu").
                      className="py-2 font-ui text-xs font-bold text-accent hover:underline"
                    >
                      {descOpen ? t("series.showLess") : t("series.readMore")}
                    </button>
                  </div>
                )}
              </>
            )}
            {/* ÇAĞRI DÜĞMELERİ — TEK SATIR, FARKLI ROL. Kullanıcı geri bildirimi
                (03.10.2026): iki düğme ("Şimdi izle" + "Kaldığın yerden devam et")
                alt alta durup BİREBİR AYNI görünüyordu. Artık:
                  · kayıtlı ilerleme VARSA → birincil (dolu) "devam et" + ikincil
                    (çerçeveli) "Şimdi izle" (baştan);
                  · yoksa → yalnız birincil "Şimdi izle".
                İkisi aynı satırda: hangisinin ana eylem olduğu bir bakışta belli.
                (`preload={false}`: hedefte rota yükleyici yok — önden çekme kazanç
                sağlamaz; bkz. ana sayfa kart notu.) */}
            {/* ÇAĞRI DÜĞMELERİ — TEK SATIR, TEK DÜĞME.
                Kullanıcı isteği (03.10.2026):
                  · kayıtlı ilerleme VARSA → YALNIZCA "Kaldığın yerden devam et";
                    "Şimdi izle" HİÇ görünmez (baştan izlemek isteyen bölüm listesinden seçer);
                  · yoksa → "Şimdi izle".
                Sınıf (`CTA_BUTTON`): dar ekranda TAM GENİŞLİK + sarılabilir metin —
                uzun "devam et" etiketi taşıp sayfayı sağa kaydırıyordu (ölçüm:
                360 px'de düğme sağ kenarı 407 px'e çıkıyordu). */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {lastEpisode ? (
                <Button asChild variant="hero" size="lg" className={CTA_BUTTON}>
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
                    {/* KISA ETİKET + BÖLÜM ROZETİ (03.10.2026): uzun cümle yerine
                        "Devam et" + düğme içinde `S1 B1` rozeti. Rozet metni
                        `seasonEpisodeOverlay`den gelir → dile göre B/E olur. */}
                    {t("series.continueShort")}
                    <span className="rounded-md bg-background/10 px-1.5 py-0.5 text-[11px] font-extrabold">
                      {t("series.seasonEpisodeOverlay", {
                        season: String(lastEpisode.season),
                        number: String(lastEpisode.episode),
                      })}
                    </span>
                  </Link>
                </Button>
              ) : firstEpisode ? (
                <Button asChild variant="hero" size="lg" className={CTA_BUTTON}>
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
                <Button variant="hero" size="lg" className={CTA_BUTTON} disabled>
                  <Play size={17} fill="currentColor" /> {t("common.comingSoon")}
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Bölümler arası boşluk 48 → 36 px (03.10.2026): reklam blokları ve
          bölümler arasında mobilde çok boşluk kalıyordu (kullanıcı geri bildirimi:
          "reklamlar mobilde çok yer kaplıyor"). Kompaktlık için aralık kısıldı. */}
      <main className="mx-auto max-w-6xl space-y-9 px-5 py-10 lg:px-8">
        <AdPlacement slot="ad_detail_top" desktopOnly />
        {relatedMovies.length > 0 ? (
          <section className="mx-auto w-full max-w-4xl">
            <div className="mb-4 flex items-center gap-3">
              <h2 className="flex items-center gap-3 font-display text-2xl font-bold text-foreground sm:text-3xl">
                <span className="h-6 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
                {t("series.relatedMovies")}
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {relatedMovies.map((movie) => (
                <Link
                  key={movie.id}
                  to="/anime/$slug"
                  params={{ slug: showSlug(movie) }}
                  className="group overflow-hidden rounded-2xl border border-border bg-card transition-transform hover:-translate-y-0.5"
                >
                  <img
                    src={movie.image}
                    alt={movie.title}
                    className="aspect-[2/3] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    loading="lazy"
                  />
                  <div className="p-3">
                    <p className="truncate text-sm font-bold text-foreground">{movie.title}</p>
                    <p className="mt-1 text-[11px] font-semibold text-primary">
                      {t("common.movieKind")}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
        {/* Katalog, sayfanın geri kalanından daha dar bir sütunda durur: satırlar
            kısalır, kapaklar sayfaya göre daha küçük kalır (animecix düzeni). */}
        <section className="mx-auto w-full max-w-4xl">
          {/* BAŞLIK ŞERİDİ — solda başlık + künye, SAĞDA `SEZON` etiketi ve
              sezonun AÇILIR LİSTESİ (referans düzeni). Sezon seçimi sayfanın
              mevcut durumundan (`selectedSeason`) okunur/yazılır: ikinci bir
              doğruluk kaynağı eklenmedi, eski sekmeler kaldırıldı çünkü aynı
              seçimi iki farklı denetimle sunmak ekranda çelişki üretirdi. */}
          {/* BAŞLIK ŞERİDİ — SOLDA başlık, SAĞDA sezon seçici. TEK SATIR, TEKRAR YOK:
              eskiden sezon bilgisi ÜÇ kez yazılıyordu — başlık altında "1. Sezon ·
              25 bölüm" + statik "SEZON" etiketi + seçicinin kendisi. Kullanıcı
              geri bildirimi (03.10.2026): "aynı şeylerden çok fazla yazıyor, düşür".
              Şimdi sezon adı ve bölüm sayısı YALNIZCA seçicide durur. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <h2 className="flex items-center gap-3 font-display text-2xl font-bold text-foreground sm:text-3xl">
              <span className="h-6 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
              {t("series.episodesHeading")}
            </h2>
            {playableSeasons.length > 0 && (
              // SEÇİCİ ARTIK SİTENİN KENDİ PANELİ (kullanıcı isteği, 04.10.2026:
              // "tarayıcı popup'ı çıkmasın, bizim panelimiz açılsın ve animasyonla
              // açılıp kapansın"). Bkz. `components/site/ControlSelect.tsx` (ortak seçici).
              //
              // BÖLÜM SAYISI KALDIRILDI (03.10.2026): seçici yalnız sezon adını
              // yazar ("1. Sezon"). Bölüm sayısı zaten altındaki ilerleme
              // çubuğunda ("x/25") ve listede görünür.
              <ControlSelect
                ariaLabel={t("series.seasonSelectAria")}
                align="right"
                options={playableSeasons.map((season) => ({
                  key: String(season.number),
                  label: seasonLabel(season, t),
                  active: season.number === (activeSeason?.number ?? playableSeasons[0]!.number),
                }))}
                onSelect={(key) => selectSeason(Number(key))}
              />
            )}
          </div>

          {playableSeasons.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("series.noEpisodes")}</p>
          ) : (
            <>
              {/* AKTİF SEZON DURUMU — FONKSİYONEL İLERLEME ÇUBUĞU + sayı.
                  Kullanıcı isteği (03.10.2026): "daha fonksiyonel olsun". Düz
                  "1/25 izlendi" yazısı yerini dolan bir çubuğa bıraktı; sezon
                  adı/sayısı TEKRARLANMAZ (yukarıdaki seçicide durur). */}
              {activeSeason && activeEpisodes.length > 0 ? (
                <div className="mt-4 flex items-center gap-3">
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={activeEpisodes.length}
                    aria-valuenow={watchedInActiveSeason}
                    className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary"
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-300"
                      style={{
                        width: `${Math.round((watchedInActiveSeason / activeEpisodes.length) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="shrink-0 text-[11px] font-bold text-muted-foreground">
                    {t("series.watchedProgress", {
                      watched: watchedInActiveSeason,
                      total: activeEpisodes.length,
                    })}
                  </span>
                </div>
              ) : null}

              {/* BÖLÜM LİSTESİ: geniş yatay satırlar — kapak solda, başlık/açıklama
                  ortada, rozetler sağda. Satırlar arası boşluk 12 px. */}
              <div className="mt-4 flex flex-col gap-2.5">
                {visibleEpisodes.map((episode) => {
                  const isWatched = watched.has(episodeKey(episode.season, episode.number));
                  // Kartın açacağı sezon: aktif sezon (bölümün kendi sezonu
                  // yoksa ona düşülür). Rota bunu izleme YOLUNA
                  // (`/anime/<slug>/season/<n>/episode/<n>`) çevirir.
                  const watchSeason = activeSeason?.number ?? episode.season;
                  // İzlenme kaydı oynatıcıda gerçek zaman akışı başlayınca
                  // yazılır; yalnızca bölümü açmak izlenmiş sayılmaz.
                  return (
                    <EpisodeRow
                      key={episode.id}
                      slug={showSlug(show)}
                      bannerImage={show.banner_image}
                      episode={episode}
                      watchSeason={watchSeason}
                      isMovie={show.kind === "movie"}
                      malId={show.mal_id ?? null}
                      // Veritabanındaki kimlik yoksa OTOMATİK ÇÖZÜLENDEN gelir
                      // (AniList sezon zinciri) — panele elle giriş gerekmez.
                      seasonMalId={resolveSeasonMalId(
                        show.mal_id,
                        activeSeason?.number ?? 0,
                        activeSeason?.mal_id,
                      )}
                      watched={isWatched}
                      // ROZET: yalnızca sezonun EN YENİ YÜKLEME GRUBUNDAKİ, henüz
                      // izlenmemiş bölümler "BUGÜN"/"DÜN" alır (bkz. `uploadLabelFor`).
                      // İzlenmişse rozet gösterilmez; grup dışındaki bölüme kaymaz.
                      newLabel={uploadLabelFor(episode, isWatched)}
                    />
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

        <AdPlacement slot="ad_detail_bottom" nativeOnDesktop />

        {/* BENZER SERİLER — ortak tür etiketi olan diğer seriler. Kart çizimi ana
            sayfadakiyle (index.tsx) AYNI; yeni bir tasarım yok. Hiç eşleşme
            yoksa başlık dâhil hiçbir şey çizilmez (boş bölüm/başlık kalmaz). */}
        {similarShows.length > 0 && (
          <section className="mx-auto w-full max-w-4xl">
            <h2 className="flex items-center gap-3 font-display text-2xl font-bold text-foreground sm:text-3xl">
              <span className="h-6 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
              {t("series.similar")}
            </h2>
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

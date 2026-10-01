// / — Ana sayfa: vitrin bandı, trend seriler ve tüm animelerin listelendiği ızgara.
// NOT (01.10.2026): başlık şeridi artık BURADA DEĞİL — `SiteHeader` tek yerde
// (`__root.tsx`) çizilir ve her sayfada aynıdır. Bu yüzden `useNavigate`,
// arama paneli ve arama durumu bu dosyadan kaldırıldı.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  Play,
  Tag,
  Tv,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ShowLogo } from "@/components/home/heroStatic";
import { AzList, SeriesCard } from "@/components/home/azList";
import { DiscoveryRowHeader, HomeCompactBand, RankedRow } from "@/components/home/homeLists";
import { ContinueRow } from "@/components/home/continueWatching";
import {
  DISCOVERY_GRID,
  DISCOVERY_GRID_CAPPED,
  HEAD_BAND,
  HEAD_GAP_BAND,
  HEAD_GAP_ROW,
  HEAD_ROW,
  PAGE_CONTAINER,
  SECTION_GAP,
} from "@/components/home/homeClass";
import {
  cardSlug,
  fallbackShows,
  heroBackdrop,
  heroVideo,
  type ContinueItem,
  type HeroCard,
} from "@/lib/home-static";
import { heroVideoSource } from "@/lib/hero-video";
import { AdSlot, useAdCode } from "@/components/site/AdSlot";
import { AdsterraLeaderboard } from "@/components/site/AdsterraUnit";
import { EpisodeCover } from "@/components/site/EpisodeCover";
import { FaSolid } from "@/components/site/FaSolid";
import { QuickAccessGlyph, RandomGlyph } from "@/components/site/HeaderGlyphs";
import { LanguageToggle } from "@/components/site/LanguageToggle";
import { supabase } from "@/integrations/supabase/client";
import { fetchShows, localCoverPath, showSlug, type ShowWithImage } from "@/lib/content";
// Bölüm kapağı çözümü — "İzlemeye devam et" kartı, bölüm listesiyle AYNI
// zinciri kullanır (kullanıcı isteği: "kaldığım bölümün kapağı olsun daima").
import {
  anizipCover,
  anizipCoverForSeason,
  anizipCoverFromChain,
  resolveSeasonMalId,
} from "@/lib/anizip-covers";
import { cachedRead, TTL_CATALOG_SECONDS, TTL_LATEST_SECONDS } from "@/lib/server-cache";
import {
  COMPACT_ROW_LIMIT,
  EMPTY_TREND_ACTIVITY,
  LATEST_GRID_LIMIT,
  RANK_TABS,
  RANKED_LIMIT,
  TREND_WINDOWS,
  latestPerShowItems,
  trendWindowCount,
  useLatestEpisodes,
  useTrendActivity,
  type LatestEpisode,
  type RankTab,
  type TrendActivity,
} from "@/lib/home-feed";
import {
  plural,
  t as translate,
  useDocumentTitle,
  useLang,
  type I18nKey,
  type Translate,
} from "@/lib/i18n";
import { forgetShow, getLastEpisode, getProgress, getResumeFrame } from "@/lib/watch-progress";
import { BRAND_LOGO_HEIGHT, BRAND_LOGO_SRC, BRAND_LOGO_WIDTH } from "@/lib/brand";

/**
 * Vitrinde her slaytın ekranda kalma süresi.
 *
 * Süre dağılımı: ilk 6 sn fotoğraf + yazı (HERO_VIDEO_DELAY), sonrasında video
 * görünür. 6 → 24 sn arası = **video 18 saniye** ekranda kalır. Video bundan
 * uzun olsa bile bu sürede kesilir; fazlası indirilmez (aşağıdaki nota bak).
 */
const HERO_AUTO_MS = 24_000; // 24 sn (video 18 sn görünür)

/**
 * Logo uzantısı seriden seriye değişiyor (.png veya .svg). Vitrin slaytı her
 * döndüğünde `ShowLogo` yeniden kurulduğu için, bulunan adres burada hatırlanır:
 * aynı tarayıcı oturumunda her seri için en fazla bir kez deneme yapılır.
 *
 * (Yalnızca statik dosya yollarını tutar; kişisel veri saklamaz. Sunucuda her
 * istek kendi modül örneğini kullandığı için istekler arası sızma olmaz.)
 */
/* Logoya ya da menüdeki "Ana sayfa"ya basınca adres çubuğuna `#top` YAZILMAZ
   (kullanıcı geri bildirimi: "sekmede #top etiketi çıkıyor"). Hash'e hiç
   dokunulmadan yukarı kaydırılır; `href="#top"` yalnızca JS'siz durumda yedek
   olarak kalır. */
function scrollToTop(event?: { preventDefault: () => void }) {
  event?.preventDefault();
  if (typeof window === "undefined") return;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// No head() here: the home route inherits title/description/og/twitter from
// __root.tsx, and ships no og:image so serve-time hosting can inject the
// project's social preview (explicit og:image or latest screenshot).
/**
 * ── VİTRİN TAKILMASINA KARŞI: AĞIR BÖLÜMLERİ HATIRLA ──────────────────────────
 *
 * ÖLÇÜM (kullanıcının Chrome kaydı, 30.09.2026):
 *   `[Violation] 'pointerdown' handler took 161ms` (react-dom)
 * Yani vitrine dokunulduğu an ana iş parçacığı **161 ms** kilitleniyor; tarayıcının
 * bir kareye ayırdığı süre ~16 ms olduğu için bu, gözle görülür bir takılma.
 *
 * SEBEP: vitrinin KENDİ durumu (slayt indeksi, sürükleme yüzdesi, video aşaması)
 * her değiştiğinde 4000+ satırlık ana sayfa bileşeni baştan çiziliyor ve içindeki
 * bütün bölümler (poster ızgarası, trend, sezon, A-Z) yeniden kuruluyordu. Vitrin
 * otomatik geçişte bile bir kez durum değiştirdiği için her slayt geçişi kare
 * düşürüyordu.
 *
 * ÇÖZÜM: ağır bölümler `memo` ile hatırlanır — KENDİ verileri değişmedikçe yeniden
 * çizilmezler; vitrin durumu onları etkilemez. (Bölümlerin içindeki kartlar da
 * aynı sebeple hatırlanır: kart başına değişen tek şey `show` nesnesi, o da veri
 * kaynağından geldiği için referansı sabittir.)
 *
 * DİL GEÇİŞİ BOZULMAZ: bu bölümlerin hepsi `useLang()` bağlamına abonedir
 * (ölçüldü: satır 1093 · 1440 · 1475 · 2232 · 2396 · 2867). Bağlam değişince
 * `memo`lu bileşen de yeniden çizilir; yani TR/EN geçişi eskisi gibi çalışır.
 */
const MemoHomeSections = memo(HomeSections);
const MemoHomeCompactBand = memo(HomeCompactBand);
const MemoAzList = memo(AzList);
const MemoSeriesCard = memo(SeriesCard);

/** Vitrin verisi henüz gelmediğinde kullanılan SABİT boş dizi (memo'nun işe
 *  yaraması için referans sabit olmalı — `?? []` her çizimde yeni dizi üretirdi). */
const EMPTY_SHOWS: ShowWithImage[] = [];

export const Route = createFileRoute("/")({
  // Vitrin verisi loader'da gelir; sayfa SUNUCUDA gerçek slaytlarla render edilir.
  // Böylece ilk anda projedeki yedek/statik görseller görünüp sonra gerçek slayta
  // atlamaz — "yenileyince önce başka slayt, sonra başlangıç slaytı" hatasının
  // ve eski görsellerin göz kırpması gibi görünmesinin sebebi buydu.
  // SUNUCU ÖNBELLEĞİ (kota/egress): vitrin listesi her istekte okunuyordu.
  // `fetchShows` panel (`/admin`) tarafından da kullanıldığı için önbellek KAYNAKTA
  // DEĞİL, yalnızca bu herkese açık çağrı yerinde uygulanır (bkz. lib/server-cache.ts).
  // En kötü gecikme: panelde yeni seri/bölüm eklendiğinde vitrin en fazla 120 sn
  // sonra güncellenir.
  loader: () => cachedRead("public:catalog:shows", TTL_CATALOG_SECONDS, fetchShows),
  staleTime: 5 * 60_000,
  // Başlık/künye SÖZLÜKTEN gelir: sunucuda `DEFAULT_LANG` yazılır (dil sunucuda yok), istemcide
  // ise sekme başlığı `useDocumentTitle` ile aktif dile bağlanır (bkz. Index()).
  head: () => ({
    meta: [
      { title: translate("meta.homeTitle") },
      {
        name: "description",
        content: translate("meta.siteDescription"),
      },
      { property: "og:title", content: translate("meta.homeTitle") },
      {
        property: "og:description",
        content: translate("meta.siteDescription"),
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

/** Tür filtresinin "hepsi" etiketi. */
const ALL_GENRES = "Tümü";

/**
 * ARAMA ÖNERİ PANELİ — KAZA SONUCU SİLİNMİŞTİ, GERİ GETİRİLDİ.
 * ----------------------------------------------------------------------------
 * NEDEN BURADA: kesintiye uğrayan bir oturum, arama kutusunun altındaki uçan
 * öneri panelini (masaüstü VE mobil) ve onun satır bileşenini kazayla SİLDİ.
 * KULLANICI BUNU İSTEMEMİŞTİ: "arama kutusu ve altındaki liste çalışmaya devam
 * etsin" diyor. Bu yüzden panel (tek bileşen olarak, iki konuma da) geri kondu.
 *
 * PANEL NASIL BESLENİR (YENİ SORGU YOK): satırlar, sayfada ZATEN yüklü ve
 * süzülmüş olan listeden — ızgarayı çizen listenin TA KENDİSİNDEN (`filtered`)
 * — alınır ve yalnızca ilk birkaç eşleşme gösterilir (`SEARCH_SUGGESTION_LIMIT`).
 * Supabase'e EK BİR SORGU ATILMAZ.
 *
 * PANEL NE ZAMAN GÖRÜNÜR: yalnızca arama kutusu AÇIKKEN ve yazı BOŞ DEĞİLKEN;
 * eşleşme yoksa HİÇ çizilmez (boş kart kalmaz). Bu kapı bileşenin İÇİNDEDİR.
 *
 * ARAMA YİNE ESKİSİ GİBİ ÇALIŞIR: `query` durumu harf harf süzmeyi sürdürür
 * (`filtered` → `#series` ızgarası). Panel bu süzmenin ÜSTÜNE eklenir; kutunun
 * kendisi, `searchOpen`, `desktopSearchRef`/`mobileSearchRef` ile dışarı tıklama
 * ve Escape ile kapanma davranışı DEĞİŞMEDİ.
 */
/* ============================================================================
 * HERO ALTINDAKİ KEŞİF ALANI — referans yerleşimi (anikoto.cz/home, hero altı).
 *
 * NEDEN İKİ KOLON: referans, hero'nun altını GENİŞ ANA KOLON (solda ~2/3) +
 * DAR SABİT KENAR ÇUBUĞU (sağda ~1/3) diye böler. Kenar çubuğu tek bir sıralı
 * liste taşır ve masaüstünde `sticky`dir: ana kolon uzun olsa da ekranda kalır.
 * İçeriği kısa tutulur (yalnızca sıralı liste) ki ana kolonun yanında sayfanın
 * altına doğru kocaman bir ölü boşluk bırakmasın.
 *
 * NEDEN SATIR BAŞLIKLARI KÜÇÜK BÜYÜK-HARF + OK: referanstaki "Latest Episode" /
 * "New Release" başlık dili bu; ana sayfadaki tüm bölüm başlıkları TEK
 * bileşenden (DiscoveryRowHeader) geldiği için ızgaralar tek site gibi görünür.
 *
 * BÖLÜM SIRASI — `docs/anikoto-anasayfa-yapisi.md` (canlı DOM blueprint'i, §0/§2/§5)
 * SIRASIDIR. Sayfa bu sırayı izler:
 *   0) header (referansta `HEADER.fixed`; bizde `sticky top-0`) →
 *   1) hero (DOKUNULMADI) →
 *   2) ANA KOLON (`aside.main`), sırayla:
 *        2.1 duyuru şeridi (`#anikoto-bookmark-alert`)  → VERİ YOK, not bırakıldı
 *        2.2 sabitlenmiş duyuru şeridi (`#community-pinned.cpin`) → VERİ YOK, not
 *        2.3 paylaşım satırı (`DIV.bsharing.mb-4`)      → KALDIRILDI (kullanıcı isteği)
 *        2.4 "Kaldığın yerden devam et" (`#continue-watching`) → bizde cihazdaki
 *            izleme kaydından dolar (referansta giriş yapılmış kullanıcıda dolar)
 *        2.5 "Latest Episode" (`#recent-update`)        → "Son Bölümler" ızgarası
 *        2.6 "Upcoming Anime" (`#upcoming-anime`)       → `UpcomingSection` (AniList, /api/anilist)
 *        2.7 üç kolonlu bant (`DIV.top-tables.mb-3`)    → `HomeCompactBand` (footer'ın hemen üstünde)
 *        2.8 "Estimated Schedule" (`#schedule-block`)   → `ScheduleSection` (AniList, /api/anilist)
 *   3) KENAR ÇUBUĞU (`aside.sidebar`): TOP TRENDING (DOKUNULMADI) + "Discussion"
 *      (VERİ YOK → çizilmedi, not bırakıldı).
 *   4) FOOTER: ilk blok A-Z listesidir (`FOOTER > DIV.container > DIV.azlist`).
 * Ana kolondaki "Kaldığın yerden devam et" satırı referansta da bu sıradadır
 * (2.4); kullanıcı isteğiyle korunmuştur.
 *
 * KOMPAKT BANT NEREDE: blueprint §2.7 → bant `#upcoming-anime`DEN SONRA gelen
 * `DIV.top-tables` bloğudur. KULLANICI İSTEĞİYLE bant, ana içeriğin EN SONUNA —
 * footer'ın hemen üstüne ve "Bu sezon" bölümünün hemen altına — TAŞINDI (ana
 * kolonun içinde değil). ÜÇ kolon da (YENİ ÇIKANLAR / YENİ EKLENENLER /
 * TAMAMLANANLAR) çizilir ve ızgara referansın kendi üç kolonlu düzenidir (sütun
 * sayısı veriye göre DEĞİŞMEZ).
 *
 * REFERANSTA OLUP BİZDE OLMAYAN BÖLÜMLER (VERİ OLMADIĞI İÇİN ÇİZİLMEZ, her biri
 * ait olduğu konumda kısa bir Türkçe notla belgelenir — bkz. `HomeSections`):
 *   · duyuru şeritleri (2.1 / 2.2) → bizde duyuru/topluluk içeriği yok.
 *   · "Discussion"        → projede yorum/tartışma sistemi ve tablosu yok.
 * ARTIK ÇİZİLENLER (VERİ ANILIST'TEN GELİYOR — `shows` şemasında hâlâ yayın
 * durumu/tarihi YOK, `show_episodes` yalnızca `created_at` taşır):
 *   · "Upcoming Anime" (2.6)     → `/api/anilist?section=upcoming` + `UpcomingSection`.
 *   · "Estimated Schedule" (2.8) → `/api/anilist?section=schedule` + `ScheduleSection`.
 *
 * BİZDEN ÇIKAN, REFERANSTA KARŞILIĞI OLMAYAN BÖLÜMLER (ikisi de SİLİNDİ):
 * Önce aynı çipleri İKİNCİ kez çizen büyük "Türlere göre keşfet" paneli, ardından
 * KULLANICI İSTEĞİYLE onun son kalıntısı olan tek satırlık GENRES çip şeridi
 * (başlığı ve `id="genres"` kimliği dâhil) TÜMÜYLE silindi. Şeride giden
 * bağlantılar ölü kalmasın diye `#series` ızgarasına yönlendirildi (bkz.
 * `Index()` içindeki header "Keşfet" düğmesi ve footer bağlantısı). (Başlığı
 * yeniden adlandırılan) "Bu sezon" ızgarası ise ana içeriğin sonunda durur;
 * "Bu sezon" bölümü üç kolonlu bandın HEMEN ÜSTÜNE, bant ise footer'ın hemen
 * üstüne alındı (bkz. `Index()` yerleşimi).
 *
 * KENAR ÇUBUĞU BAŞLIĞI — ARTIK DİLE BAĞLI (düzeltildi): başlığın `tr` ve `en`
 * değerleri BİLEREK AYNI ("TOP TRENDING") yazılmıştı; panel bu yüzden dil
 * değişince başlığını değiştirmiyordu ("TR'ye geçince panel hâlâ değişmiyor").
 * Paneldeki diğer TÜM metinler zaten sözlükten geldiği için (sekmeler, ipuçları,
 * meta şeridi, `aria-label`) dil değişiminde güncelleniyordu — takılan tek metin
 * başlıktı. Artık `tr` → "TREND OLANLAR", `en` → "TOP TRENDING".
 * Dürüstlük kaygısı yine de geçerli: projede görüntülenme, puan ya da trend verisi
 * TUTULMUYOR ve panelin arkasındaki sıralama BÖLÜM SAYISINA göredir; ölçüt
 * sekmelerde (BÖL. / SEZON / YENİ) ve ipucu balonlarında açıkça söylenir,
 * uydurma sıralama/veri gösterilmez.
 *
 * Savunmacılık: bölüm sorgusu hata verirse YALNIZCA ona bağlı bölümler (Son
 * Bölümler ızgarası ve "Yeni Çıkanlar" kolonu) çizilmez; seri listesinden
 * beslenen kolonlar, kenar çubuğu ve sayfanın geri kalanı etkilenmez. Veri
 * yoksa başlık da boşluk da bırakılmaz.
 *
 * OMİT EDİLENLER (veri kaynağı YOK, uydurulmaz):
 *   · "TAMAMLANANLAR" kolonu artık ÇİZİLİR, fakat GERÇEK bir "tamamlandı"
 *     alanından DEĞİL: şemada tamamlanma/yayın durumu alanı hâlâ YOK. Kolon,
 *     `HomeCompactBand` üstünde belgelenmiş bir VEKİL (proxy) ölçütle beslenir
 *     (`COMPLETED_STALE_DAYS`) ve o notta gerçek bir alanın nasıl ekleneceği
 *     (küçük migrasyon) yazılıdır.
 *   · All/Sub/Dub/Trending filtre sekmeleri — `shows` üzerinde altyazı/dublaj
 *     işareti yok; `episode_sources.language` yalnızca BÖLÜM bazında 'tr'/'en'
 *     ayrımı taşır, seri bazlı bir "Sub/Dub" etiketi üretemez.
 *   · Puan/yıldız ve süre — `shows` şemasında rating ya da duration alanı yok.
 *     Bu yüzden kenar çubuğu meta şeridi referanstaki "★ puan · süre" yerine
 *     YALNIZCA gerçekten var olan alanları yazar: yıl · bölüm · sezon · ilk tür.
 * ============================================================================ */

/**
 * REFERANSTAN ÖLÇÜLEN YERLEŞİM DEĞERLERİ — anikoto.cz/home, KULLANICININ GERÇEK
 * PENCERE GENİŞLİĞİNDE (1552×900) tarayıcıda ölçüldü; karşılaştırma için 1600×900
 * da ölçüldü. Ölçümler sitenin kendi kuralıyla birebir örtüşüyor
 * (`.container{max-width:1800px;padding:0 10px;margin:0 auto}`,
 *  `.ani.items .item{padding:0 10px;width:16.667%}`,
 *  `aside.main` %75 / `aside.sidebar` %25, `body.home #wrapper #body{padding-top:5rem}`).
 *
 * 1552×900 ÖLÇÜMÜ (HEDEF — kullanıcının penceresi ~1560 px):
 *   ilk posterin sol kenarı (içerik bloğunun etkin sol boşluğu) ..... 10 px
 *   içerik bloğu (ilk poster → "Top anime" sağ kenarı) .............. 1532 px (10 → 1542)
 *   poster kartı ................................................... 174 × 243.59 px (1:1.4)
 *   yatay kart boşluğu ............................................. 20 px (kart adımı 194 px)
 *   satır boşluğu .................................................. 20 px (satır adımı 326.36 px)
 *   satır başına kart .............................................. 6
 *   ana kolon : kenar çubuğu ....................................... 1144 : 368 px (%75 : %25)
 *   ana kolon ↔ kenar çubuğu boşluğu ............................... 20 px
 *   hero bandı → ilk içerik satırı ................................. 187.13 px
 *
 * 1600×900 ÖLÇÜMÜ (kartın pencereyle küçüldüğünün kanıtı):
 *   sol boşluk 10 px · içerik bloğu 1580 px · ana kolon 1180 px ·
 *   satır başına 6 kart · kart 180 × 252 px · boşluklar yine 20 / 20 px.
 *   Yani kart genişliği = pencerenin %12.5'i − 20 px (1552 → 174, 1600 → 180).
 *
 * YENİ REFERANS DOMAINİ — anikototv.to/home (aynı ürün, yeni adres), 1552×900'de
 * gerçek tarayıcıda yeniden ölçüldü. Kurallar anikoto.cz ile AYNI çıktı; yalnızca:
 *   · kart 172.13 × 240.97 px (bizde 174 × 243.6). Fark ~1.9 px ve kaynağı
 *     KAYDIRMA ÇUBUĞU: referans sayfasında dikey çubuk var, düzen genişliği
 *     1537 px (1552 değil). Kural aynı, ölçüm zemini 15 px dar → DEĞİŞİKLİK YOK.
 *   · ana kolon : kenar çubuğu = 1152.75 : 384.25 px (bizde 1144 : 368). Kenar
 *     çubuğu İÇERİĞİ referansta 364.25 px → aramızdaki fark ~3.75 px, 4 px
 *     eşiğinin ALTINDA; ana kolonun %75 ritmi korunur → DEĞİŞİKLİK YOK.
 *   · sol boşluk 10 px · kart boşluğu 20 px · satır boşluğu 20.27 px · satırda 6
 *     kart · kart ↔ kenar çubuğu görsel boşluğu 20 px → HEPSİ BİZDE AYNI.
 *   · HERO → İLK İÇERİK SATIRI: referansta başlık tepesi 257.13 px, ilk poster
 *     tepesi 312.63 px (bizde 187.5 px). Farkın TAMAMI, referansın hero'dan
 *     sonra koyduğu ve BİZDE BİLEREK OLMAYAN bloklardır (bookmark uyarısı 36 px +
 *     sabitlenmiş topluluk 50.75 px + paylaşım şeridi 89.38 px + aralarındaki
 *     boşluklar). Referansın KENDİ boşluk kuralı yine 40.5 px'tir
 *     (`#hotest{margin:2rem 0 3rem}`); bunu birebir uygulamak ~125 px ÖLÜ BOŞLUK
 *     demek olurdu. Veri uydurmadan boşluk eklenmez → 119 px KORUNDU.
 *   · KENAR ÇUBUĞU PANELİ KART DEĞİL: referansta `section#top-anime` için
 *     border-radius 0 / padding 0 / zemin şeffaf; görsel kart yalnızca her
 *     satırın `.inner` kabıdır. Eski dış HUD kabuğu (reanime.to ölçümü) bu yüzden
 *     KALDIRILDI. Panel başlığı 27 px / 600 / letter-spacing normal ve
 *     `padding-left: 5 px` (bizdeydi 20 px / 700 / tight) → DÜZELTİLDİ. Sekmeler
 *     artık "pill" grubu (kutu dolgusu 3 px, köşe 5 px; etiket 2×8 px dolgu,
 *     köşe 3 px, 13.5 px / 600, aktif DOLU) → DÜZELTİLDİ; RENKLER bizim
 *     temamızdan. Referansın 3 kolonlu bandı KOPYALANIR: YENİ ÇIKANLAR / YENİ
 *     EKLENENLER / TAMAMLANANLAR. Üçüncü kolon gerçek bir "tamamlandı" alanı
 *     bulunmadığı için belgelenmiş bir VEKİL ölçütle beslenir (bkz.
 *     `COMPLETED_STALE_DAYS`); program/reyting blokları da KOPYALANMAZ, çünkü
 *     şemada karşılıkları yok.
 *
 * NEDEN KAP 1800 px + 10 px: referansın kendi kabı bu. 1552 px'te kap 1800'e
 * henüz dayanmadığı için içerik 10 px yan boşlukla 1532 px kalır; pencere
 * ~1820 px'i geçince kap 1800'e oturur ve içerik ortalanır. Yan boşluğu 10 px'ten
 * büyütmek ölçülen referans değerlerinden uzaklaşır, bu yüzden 10 px korunur.
 *
 * NEDEN KART GENİŞLİĞİ SINIRLI (ızgara notu aşağıda): "posterler çok büyük ve sol
 * kenara yapışık" şikâyetinin sebebi, kabın TAM genişliğini kullanan ızgaralarda
 * kartın 1552 px'te 238.66 px'e çıkmasıydı; referansın kartı 174 px.
 *
 * Bölüm başlığı tipografisi (HEAD_ROW/HEAD_BAND) ve bölümler arası boşluk
 * (SECTION_GAP) da aynı ölçümden gelir:
 *   bölüm başlığı : 27 px / 600, başlık altı boşluk 15 px, bölümler arası 40 px
 *   bant başlığı  : 20.25 px, BÜYÜK HARF, soluk, başlık altı boşluk 10 px
 *
 * (Kenar çubuğu SATIR (RankedRow) ölçüleri reanime.to/home "Top Trending"
 *  panelinden; tam liste `RankedRow` üstündeki ölçüm notunda. Panelin DIŞ kart
 *  kabuğu ARTIK YOK: yeni referans anikototv.to panelde kart kabuğu kullanmaz.)
 *
 * NOT: buradaki değerler yalnızca ÖLÇÜDÜR. Referansın renkleri, markası, ikonları
 * KOPYALANMAZ; renkler bizim temamızdan (koyu yüzey + ana kırmızı) gelir.
 *
 * Izgara/başlık sabitleri homeClass.ts içindedir (tek kaynak).
 */

/** Bant ölçüleri homeClass.ts içindedir (tek kaynak). */

/**
 * Ana kolondaki TÜM poster ızgaralarının ("devam et" ve "Son Bölümler") ortak
 * kartı. Sınıflar ana sayfanın ana ızgarasındaki kartla birebir aynıdır:
 * `card-hover rounded-2xl bg-card shadow-2xl`, 2:3 poster, `group-hover:scale-105`,
 * altta kalın başlık + küçük meta satırı. Tek fark: alt satırın metni çağıran
 * tarafından verilir ("S1B5 · bölüm adı" ya da "S1B5'ten devam et").
 */
function PosterCard({
  slug,
  season,
  episode,
  title,
  image,
  meta,
  metaClassName,
  className,
}: {
  /**
   * Hedef serinin slug'ı. Boşsa kart BAĞLANTISIZ çizilir (veritabanı kaydı
   * olmayan yedek içerikte gidilecek bir sayfa yoktur).
   */
  slug?: string | undefined;
  /**
   * Kartın açacağı sezon. İzleme adresi artık YOL olarak kurulur
   * (`/anime/<slug>/season/<n>/episode/<n>`); değer verilmezse 1 yazılır ve izleme
   * sayfası kendi "ilk oynatılabilir sezon" mantığına düşer (eskiden parametresiz
   * izleme adresiyle açıldığında olan davranışın AYNISI).
   */
  season?: number | undefined;
  /** Kartın açacağı bölüm; yol adresi budur (bkz. `season` notu). */
  episode?: number | undefined;
  title: string;
  image: string;
  meta?: string | undefined;
  metaClassName?: string | undefined;
  className?: string | undefined;
}) {
  const { t } = useLang();
  // Kart sınıfı iki dalda da AYNI tutulur: değişen tek şey gezinme öğesidir.
  const cardClassName = `group card-hover relative block overflow-hidden rounded-2xl bg-card shadow-2xl ${
    className ?? ""
  }`;
  const body = (
    <>
      {/* Poster oranı referanstan ölçüldü: `.ani.poster>a { padding-bottom: 140% }`
          → 1:1.4 (masaüstünde 178×249 px). Eski 2:3 oranı kartı gereğinden uzun
          gösteriyordu. */}
      <div className="aspect-[5/7] overflow-hidden bg-muted">
        <img
          src={image}
          alt={t("home.coverAlt", { title })}
          width={768}
          height={1152}
          loading="lazy"
          className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
        />
      </div>
      {/* Yazı bloğu ölçüsü referanstan: kapağın altında 12 px boşluk, başlık
          16.2 px / 500, altında 10 px. Kart yükseklikleri böylece referanstaki
          gibi tek tip kalır. */}
      <div className="px-3 pt-3 pb-2.5">
        <h3 className="truncate text-[16px] font-medium leading-5 text-foreground">{title}</h3>
        {meta ? (
          <p
            className={
              metaClassName ??
              "mt-1 line-clamp-2 text-[13.5px] leading-[18px] text-muted-foreground"
            }
          >
            {meta}
          </p>
        ) : null}
      </div>
    </>
  );
  // Hedef yoksa (yedek içerik) bugünkü davranış birebir korunur: `href`siz `<a>`.
  if (!slug) {
    return <a className={cardClassName}>{body}</a>;
  }
  // İSTEMCİ İÇİ GEZİNME (`Link`) — ve ÖNDEN ÇEKME (preload) BİLEREK KAPALI.
  // NEDEN: bu kartlar yoğun raflarda/ızgarda yan yana durur ve fareyle üzerinden
  // geçmek tıklama anlamına GELMEZ. `Link`in önden çekmesi her hover'da hedef
  // rotanın yükleyicisini çalıştırır; izleme hedefinin bugün rota
  // yükleyicisi YOK (veri istemcide React Query ile gelir), yani bugün ölçülebilir
  // bir kazanç sağlamaz — ama yükleyici eklendiği gün hover başına boşa okuma
  // (kota/egress) doğar. Bu yüzden ana sayfadaki TÜM kartlarda önden çekme açıkça
  // kapatılır; gezinme yine istemci içi ve anındadır, yalnızca hover ön çekmesi
  // atlanır. (Tıklamada `/anime/$slug` hedefi verisini `showDetailQueryOptions`
  // önbelleğinden okur; ek okuma olmaz.)
  return (
    <Link
      to="/anime/$slug/season/$season/episode/$episode"
      params={{ slug, season: String(season ?? 1), episode: String(episode ?? 1) }}
      preload={false}
      className={cardClassName}
    >
      {body}
    </Link>
  );
}

/** Tek keşif satırı: başlık + poster kartı ızgarası. Boş satır çağıranda hiç çizilmez. */
function DiscoveryRow({
  title,
  moreHref,
  gridClassName,
  children,
}: {
  title: string;
  // `| undefined`: `exactOptionalPropertyTypes` açık (bkz. PosterCard notu).
  moreHref?: string | undefined;
  /**
   * Izgara düzeni. Varsayılan `DISCOVERY_GRID` (6 sütun) yalnızca ana kolon
   * referans genişliğindeyken doğrudur; kenar çubuğu verisi yoksa (ana kolon
   * tam genişliğe yayılır) çağıran `DISCOVERY_GRID_CAPPED` geçirir — yoksa
   * kartlar 174 px yerine 238.66 px'e çıkıyordu ("posterler çok büyük").
   */
  gridClassName?: string | undefined;
  children: ReactNode;
}) {
  return (
    // Bölüm arası boşluk referanstan: `section { margin-bottom: 40px }`.
    <section aria-label={title} className={`${SECTION_GAP} last:mb-0`}>
      <DiscoveryRowHeader title={title} moreHref={moreHref} />
      <div className={gridClassName ?? DISCOVERY_GRID}>{children}</div>
    </section>
  );
}

/* ============================================================================
 * ANILIST'TEN BESLENEN İKİ ANA KOLON BÖLÜMÜ — blueprint §2.6 ve §2.8
 * ----------------------------------------------------------------------------
 * NEDEN BURADA ÖNCEDEN HİÇBİR ŞEY ÇİZİLMİYORDU (ve neden artık çiziliyor): bu iki
 * bölüm sayfada "VERİ YOK" notuyla boş bırakılmıştı. Gerekçe gerçekti: `shows`
 * şemasında yayın durumu ya da ilk yayın tarihi tutan alan YOK (`status`,
 * `premiered`, `next_airing` bulunmuyor) ve `show_episodes` yalnızca `created_at`
 * (SİTEYE EKLENME zamanı) taşır, yayın saati taşımaz. Uydurma liste gösterilmedi.
 *
 * Artık İKİSİ DE GERÇEK VERİYLE dolar: AniList GraphQL API'si (anahtar GEREKMEZ,
 * giriş GEREKMEZ). Veri `/api/anilist` SUNUCU ROTASINDAN alınır.
 *
 * NEDEN SUNUCU ROTASI (tarayıcıdan doğrudan çağrı YOK) — İKİ SEBEP:
 *   1) ÖNBELLEK: AniList'in CORS'u açıktır ama yanıtlarında **CDN önbelleği
 *      YOKTUR** (`Cache-Control: no-cache, private` — ölçüldü). Tarayıcıdan
 *      çağrılsaydı her sayfa görüntülemesi AniList'e bir istek olurdu ve 30
 *      istek/dk sınırına çarpardık. Önbelleği BİZ kuruyoruz: rota sonucu
 *      `cachedRead` ile TTL boyunca hatırlanır (upcoming 6 saat, takvim 3 saat;
 *      gerekçeler lib/server-cache.ts içinde), yani upstream isteği "ziyaretçi
 *      başına" değil "önbellek dolumu başına" olur.
 *   2) SÖZLEŞME: rota yanıtı COMPACT'tır (yalnızca çizilen alanlar) ve saat/tarih
 *      metinleri sunucuda İstanbul saatine göre üretilir; istemci biçimlendirme
 *      yapmaz, tarayıcı saat dilimi sonucu değiştiremez.
 * Supabase'e bu bölümler için HİÇ yazılmaz, okuma da yapılmaz: aşağıdaki eşleştirme
 * sayfada ZATEN yüklü olan seri listesi üzerinden İSTEMCİDE yürür.
 *
 * KATALOĞA BAĞLAMA: AniList kayıtları `idMal` (MyAnimeList kimliği) taşır, bizim
 * `shows.mal_id` kolonu tam olarak onu tutar. Eşleşen kayıt `/anime/<slug>`
 * sayfamıza gider; eşleşmeyen kayıt HİÇBİR YERE gitmez (yerel sayfa UYDURULMAZ).
 * `idMal` `null` olabilir: o kayıtlar eşleştirmeye sokulmaz ve ASLA hata üretmez.
 *
 * SESSİZ BOZULMA: upstream ya da rota hata verirse ilgili bölüm HİÇ çizilmez
 * (boş başlık, hata kutusu, yükleme iskeleti yok) ve sayfanın geri kalanı
 * etkilenmez (bkz. `readAnilist`).
 * ========================================================================== */

/** "GELECEK ANİMELER" bölümünde gösterilen en fazla kart (2 satır × 6 sütun). */
const UPCOMING_CARD_LIMIT = 12;

/** React Query anahtarları: iki bölüm ayrı ayrı ve bağımsız bozulacak şekilde sorgular. */
const ANILIST_UPCOMING_QUERY_KEY = ["home-anilist-upcoming"] as const;
const ANILIST_SCHEDULE_QUERY_KEY = ["home-anilist-schedule"] as const;

/** `/api/anilist?section=upcoming` yanıtındaki kayıt. */
type UpcomingItem = {
  id: number;
  /** MyAnimeList kimliği; `null` ise eşleştirme yapılmaz (bkz. `useMalIndex`). */
  malId: number | null;
  title: string;
  english: string | null;
  cover: string;
  /** `YYYY-AA-GG` ya da gün bilinmiyorsa `YYYY-AA`. */
  date: string;
  format: string;
  episodes: number | null;
};

/** `/api/anilist?section=schedule` yanıtındaki tek yayın satırı. */
type ScheduleItem = {
  id: number;
  malId: number | null;
  title: string;
  episode: number | null;
  /** `HH:MM` — İstanbul saati, SUNUCUDA biçimlendirilmiş. */
  time: string;
};

/** Takvimin bir günü. */
type ScheduleDay = { date: string; items: ScheduleItem[] };

/**
 * Sunucu rotasından TEK bir bölümü okur.
 *
 * HATA YUTULUR (bilerek): ağ hatası, 5xx, `ok:false` ya da bozuk gövde → `null`.
 * Çağıran `null`/boş sonucu "bölümü hiç çizme" olarak yorumlar; sayfada hata
 * kutusu ya da boş başlık OLUŞMAZ ve sayfanın geri kalanı etkilenmez.
 */
async function readAnilist<T>(section: "upcoming" | "schedule"): Promise<T | null> {
  try {
    const response = await fetch(`/api/anilist?section=${section}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") return null;
    if ((body as { ok?: unknown }).ok !== true) return null;
    return body as T;
  } catch {
    return null;
  }
}

/** "GELECEK ANİMELER" sorgusu (sunucu önbellekli rota üzerinden). */
function useUpcomingAnime() {
  return useQuery({
    queryKey: ANILIST_UPCOMING_QUERY_KEY,
    queryFn: () => readAnilist<{ ok: true; items: UpcomingItem[] }>("upcoming"),
  });
}

/** Haftalık yayın takvimi sorgusu (sunucu önbellekli rota üzerinden). */
function useWeeklySchedule() {
  return useQuery({
    queryKey: ANILIST_SCHEDULE_QUERY_KEY,
    queryFn: () => readAnilist<{ ok: true; today: string; days: ScheduleDay[] }>("schedule"),
  });
}

/**
 * `idMal` → bizim seri slug'ı indeksi.
 *
 * KAYNAK: sayfada ZATEN yüklü olan seri listesi (`shows`) — EK SUPABASE OKUMASI
 * YOKTUR. `mal_id` tip tanımında `optional`/`nullable` olduğu için üç kapı vardır:
 * sayı değilse, 0/negatifse ya da serinin veritabanı kaydı yoksa (yedek içerik)
 * eşleştirmeye GİRMEZ — böylece kırık ya da uydurma bağlantı doğmaz.
 */
function useMalIndex(shows: ShowWithImage[]): Map<number, string> {
  return useMemo(() => {
    const index = new Map<number, string>();
    for (const show of shows) {
      const malId = show.mal_id;
      if (!show.id) continue;
      if (typeof malId !== "number" || !Number.isFinite(malId) || malId <= 0) continue;
      index.set(malId, showSlug(show));
    }
    return index;
  }, [shows]);
}

/**
 * `YYYY-AA-GG` / `YYYY-AA` metnini GÜN.AY.YIL biçimine çevirir.
 *
 * NEDEN İSTEMCİDE ÇEVİRİ YOK: sunucu tarihleri Türkçe kullanımına uygun biçimde
 * (gün önce) yazar; bu biçim hem `tr` hem `en` için site genelinde geçerlidir
 * (bkz. `isoDate` notu). Dil değişiminde metin değişmez çünkü bir TARİH biçimidir,
 * çeviri değildir; bozuk/eksik parça hiç yazılmaz.
 */
function startDateLabel(date: string): string {
  const [year, month, day] = date.split("-");
  return [day, month, year].filter(Boolean).join(".");
}

/**
 * "GELECEK ANİMELER" kartı: poster + başlık + tarih/biçim/bölüm meta satırı.
 *
 * ÖLÇÜLER sayfadaki diğer poster kartlarıyla (bkz. `PosterCard`/`SeriesCard`)
 * birebir aynıdır ki bu ızgara da tek site gibi görünsün: 5:7 poster, 16 px
 * başlık, 13.5 px meta. Başlık AniList İÇERİĞİDİR (veritabanı metni gibi):
 * romaji her zaman yazılır, arayüz İngilizceyken varsa İngilizce başlık tercih
 * edilir. Eşleşme yoksa kart bağlantısız çizilir (sayfadaki yedek içerik
 * kartlarıyla AYNI davranış: `href`siz `<a>`).
 */
function UpcomingCard({ item, slug }: { item: UpcomingItem; slug?: string | undefined }) {
  const { lang, t } = useLang();
  const cardClassName =
    "group card-hover relative block overflow-hidden rounded-2xl bg-card shadow-2xl";
  // Başlık: içerik metni (çevrilmez), yalnızca dil tercihiyle romaji/İngilizce seçilir.
  const title = lang === "en" && item.english ? item.english : item.title;
  // Meta: başlangıç tarihi · biçim · bölüm sayısı. Bölüm sayısı DİLE BAĞLI olduğu
  // için sözlükten gelir (`plural`: İngilizcede "1 episode"/"12 episodes").
  const meta = [
    startDateLabel(item.date),
    item.format,
    item.episodes ? plural(t, item.episodes, "home.episodeCountOne", "home.episodeCount") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const body = (
    <>
      <div className="aspect-[5/7] overflow-hidden bg-muted">
        <img
          src={item.cover}
          alt={t("home.coverAlt", { title })}
          width={768}
          height={1152}
          loading="lazy"
          className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
        />
      </div>
      <div className="px-3 pt-3 pb-2.5">
        <h3 className="truncate text-[16px] font-medium leading-5 text-foreground">{title}</h3>
        <p className="mt-1 line-clamp-2 text-[13.5px] leading-[18px] text-muted-foreground">
          {meta}
        </p>
      </div>
    </>
  );
  // Kataloğumuzda karşılığı yoksa (ya da `idMal` boşsa) gidilecek YEREL sayfa
  // yoktur: kart bağlantısız çizilir, uydurma adres üretilmez.
  if (!slug) return <a className={cardClassName}>{body}</a>;
  // Yoğun ızgara → önden çekme KAPALI (gerekçe: `PosterCard` notu).
  return (
    <Link to="/anime/$slug" params={{ slug }} preload={false} className={cardClassName}>
      {body}
    </Link>
  );
}

/**
 * Ana kolondaki "GELECEK ANİMELER" bölümü (blueprint §2.6 — referansta
 * `SECTION#upcoming-anime`). Veri gelmezse bölüm BAŞLIĞIYLA birlikte hiç çizilmez.
 */
function UpcomingSection({
  shows,
  gridClassName,
}: {
  shows: ShowWithImage[];
  /** Ana kolon genişliğine göre ızgara sınıfı (bkz. `mainGridClass`). */
  gridClassName: string;
}) {
  const { t } = useLang();
  const query = useUpcomingAnime();
  const malIndex = useMalIndex(shows);
  const items = (query.data?.items ?? []).slice(0, UPCOMING_CARD_LIMIT);
  // BOŞ BAŞLIK YOK: veri yoksa/hata varsa hiçbir şey çizilmez.
  if (items.length === 0) return null;
  return (
    <DiscoveryRow title={t("home.upcomingHeading")} gridClassName={gridClassName}>
      {items.map((item) => (
        <UpcomingCard
          key={item.id}
          item={item}
          slug={item.malId === null ? undefined : malIndex.get(item.malId)}
        />
      ))}
    </DiscoveryRow>
  );
}

/**
 * Ana kolondaki "Estimated Schedule" bölümü (blueprint §2.8 — referansta
 * `#schedule-block > #schedule`): 7 günlük yayın takvimi, GÜNE GÖRE GRUPLU.
 *
 * GÜN SEKMELERİ: referansın gün şeridinin karşılığıdır. Sekmeler SUNUCUDAN gelen
 * gün listesidir (uydurma sabit 7 gün değil, gerçekten yayını olan günler); varsayılan
 * gün sunucunun İstanbul saatine göre işaretlediği `today`dir, listede yoksa ilk gün.
 *
 * SAAT DİLİMİ: satır saatleri (`HH:MM`) ve gün sınırları SUNUCUDA Europe/Istanbul
 * ile üretilir (bkz. api.anilist.ts). İstemci `Intl` ile yalnızca HAFTA GÜNÜ adını
 * yazar; tarayıcının saat dilimi listeyi kaydıramaz.
 *
 * "Now: <tarih saat>" satırı BİLEREK ÇİZİLMEZ: sunucudan gelen önbellekli veriyle
 * canlı bir saat göstermek yanıltıcı olurdu (TTL 3 saat). Uydurma zaman yazılmaz.
 */
function ScheduleSection({ shows }: { shows: ShowWithImage[] }) {
  const { lang, t } = useLang();
  const query = useWeeklySchedule();
  const malIndex = useMalIndex(shows);
  // Kullanıcının seçtiği gün. `null` = seçim yok → sunucunun `today`si açılır.
  // NEDEN `useState` + türetme (effect DEĞİL): veri asenkron geldiği için effect ile
  // senkronlamak fazladan render demekti; değer render sırasında türetilir.
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const days = query.data?.days ?? [];
  const today = query.data?.today ?? "";

  /**
   * CANLI SAAT — panelin alt şeridinde `YYYY/MM/DD HH:mm:ss`.
   *
   * ── ÖNCEKİ KARAR DEĞİŞTİ (kullanıcı isteği, 27.09.2026) ──────────────────────
   * Bu dosyada daha önce "Now: <tarih saat>" satırı BİLEREK çizilmiyordu; gerekçe
   * şuydu: sunucudan gelen önbellekli takvim verisiyle (TTL 3 saat) canlı bir saat
   * yan yana konunca "veri de canlı" izlenimi doğuyordu.
   *
   * Kullanıcı referansı (reanime.to/home) birebir istedi ve ölçümde o panelin alt
   * şeridindeki saat GERÇEKTEN canlı akıyor (`2026/09/27 23:36:22` → `23:36:26`).
   * Bu yüzden saat eklendi — ama YALNIZCA tarayıcının kendi saati yazılır; takvim
   * verisinin tazeliği hakkında hiçbir iddia taşımaz (yanıltıcı etiket yok).
   */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  /**
   * GÜN PENCERESİ — referansta şerit 3 gün gösterir ve yanlarında ‹ › okları var.
   * `null` = kullanıcı ok kullanmadı; pencere AKTİF GÜNÜ SONA alacak şekilde
   * kurulur (referans ölçümü: aktif gün SUN 27, pencerenin son kutusu).
   */
  const [dayWindow, setDayWindow] = useState<number | null>(null);

  /**
   * LİSTE AÇ / KAPA — referansın alt şeridindeki `More ▾` düğmesinin karşılığı.
   *
   * Referans ölçümü: panelde 9 satır vardır (panel 583 px) ve alt şeritteki düğme
   * `<button>`dur — `href` YOK, yanında 14 px chevron-DOWN ikonu vardır; yani
   * "listeyi genişlet" demektir. Bizim günümüzde 20 yayın olabildiği için panel
   * gereksiz uzuyordu; bu yüzden ilk 9 satır gösterilip `More` kalanı açar. Böylece
   * panel referansın yüksekliğine oturur ve düğme GERÇEKTEN bir iş yapar (ölü
   * düğme konmaz — daha önce bu yüzden hiç koymamıştım).
   */
  const [expanded, setExpanded] = useState(false);
  const ROW_LIMIT = 9;
  const activeDate =
    pickedDay ?? (days.some((day) => day.date === today) ? today : (days[0]?.date ?? ""));
  const activeDay = days.find((day) => day.date === activeDate);

  /**
   * NOT: eski `dayLabel` ("Pzt 25" / "Bugün") KALDIRILDI. Referans panelinde gün
   * kutusu iki satırdır (üstte hafta günü, altta gün numarası) ve numara kendi
   * kutusunda gösterilir; tek satırlık etiket kullanılmıyor → yerini yukarıdaki
   * `dayWeekday` + `day.date.slice(8, 10)` aldı. Kullanılmayan fonksiyon
   * bırakmamak için silindi.
   */

  // VERİ YOKSA PANEL YOK: başlık, boşluk ve hata kutusu bırakılmaz.
  if (days.length === 0 || !activeDay || activeDay.items.length === 0) return null;

  /**
   * GÜN PENCERESİ (3 kutu) + ok durumları.
   * Referans ölçümü: şeritte 3 gün kutusu var, yanlarında 36×36 ‹ › düğmeleri
   * durur; pencere dışında gün kaldığında ilgili ok pasif olur (ölçümde `Next day`
   * `disabled` idi çünkü aktif gün pencerenin sonundaydı).
   */
  const activeIndex = Math.max(
    0,
    days.findIndex((day) => day.date === activeDate),
  );
  const maxStart = Math.max(0, days.length - 3);
  const startIndex = Math.min(dayWindow ?? Math.max(0, activeIndex - 2), maxStart);
  const windowDays = days.slice(startIndex, startIndex + 3);

  /** Gün kutusunun üst satırı: hafta günü kısaltması (bugünse "Bugün"/"Today"). */
  const dayWeekday = (date: string): string => {
    if (date === today) return t("home.scheduleToday");
    const parsed = new Date(`${date}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed
      .toLocaleDateString(lang === "en" ? "en-US" : "tr-TR", { weekday: "short" })
      .toUpperCase();
  };

  const pad2 = (value: number): string => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}/${pad2(now.getMonth() + 1)}/${pad2(now.getDate())} ${pad2(
    now.getHours(),
  )}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;

  /**
   * PANEL — reanime.to/home "Estimated Schedule" panelinin karşılığı.
   * Ölçüler gerçek tarayıcıda computed style ile alındı (1912×863, 27.09.2026):
   * · kutu 446×583, padding 16, radius 12, 1 px kenarlık rgba(255,255,255,.055),
   *   160° gradyan zemin, `0 16px 40px -18px` siyah gölge, `overflow: hidden`;
   * · BAŞLIK METNİ YOK — referansta da yok, panel doğrudan gün sekmeleriyle başlar;
   * · üst şerit: 36×36 ‹ › düğmeleri + 3 gün kutusu (üstte 10 px büyük harf gün adı,
   *   altta 64×30 gün numarası; aktif gün ana renk + 1.05 ölçek);
   * · satırlar 40 px yüksek, 8 px aralık, saat sütunu 48 px mono 12.5 px, başlık
   *   13.5 px, bölüm rozeti 11 px mono (arka plansız);
   * · alt şerit: canlı `YYYY/MM/DD HH:mm:ss` (12 px mono).
   *
   * `More` düğmesi ÇİZİLMEDİ: referansta tam takvim sayfasını açar, bizde o rota
   * yok; çalışmayan ölü düğme koymak yerine hiç konmadı (istenirse rota açılıp
   * bağlanır). Kutu köşeleri referansta 0 px'tir (gün kutuları/satırlar/oklar) —
   * yalnızca panelin kendisi 12 px yuvarlaktır; ölçüye sadık kalındı.
   */
  return (
    <div className="relative overflow-hidden rounded-[12px] border border-white/[0.055] bg-[repeating-linear-gradient(-82deg,rgba(255,255,255,0.008)_0px,rgba(255,255,255,0.008)_1px,transparent_1px,transparent_26px),linear-gradient(160deg,#101118,#0b0c11)] p-4 shadow-[0_16px_40px_-18px_rgba(0,0,0,0.9)]">
      {/* KÖŞE SÜSLERİ — referansın `.hud-corner-tl` / `.hud-corner-br` /
          `.hud-vents` elemanları (ölçüm: 14×14 px köşe çizgileri,
          rgba(255,255,255,0.14); 52×12 px çapraz tırnak şeridi).
          Süs oldukları için `aria-hidden`; tıklamayı engellemesinler diye
          `pointer-events-none`. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-2 top-2 z-[2] size-3.5 border-l border-t border-white/[0.14]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-2 right-2 size-3.5 border-b border-r border-white/[0.14]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[7px] right-[30px] h-3 w-[52px] bg-[repeating-linear-gradient(-82deg,rgba(255,255,255,0.13)_0px,rgba(255,255,255,0.13)_2px,transparent_2px,transparent_9px)]"
      />
      <div className="mb-4 flex items-center justify-between border-b border-white/[0.07] pb-4">
        <button
          type="button"
          onClick={() => setDayWindow(Math.max(0, startIndex - 1))}
          disabled={startIndex === 0}
          aria-label={t("home.schedulePrevDay")}
          className="grid size-9 shrink-0 place-items-center bg-secondary text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={16} />
        </button>
        <div
          role="tablist"
          aria-label={t("home.scheduleDayAria")}
          className="flex items-center gap-4"
        >
          {windowDays.map((day) => {
            const active = day.date === activeDate;
            return (
              <button
                key={day.date}
                type="button"
                role="tab"
                aria-selected={active}
                title={startDateLabel(day.date)}
                onClick={() => setPickedDay(day.date)}
                className="flex flex-col items-center gap-1.5"
              >
                <span
                  className={`text-[10px] font-bold uppercase tracking-[0.5px] ${
                    active ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {dayWeekday(day.date)}
                </span>
                <span
                  className={`grid h-[30px] w-16 place-items-center text-sm font-black transition-transform ${
                    active
                      ? "scale-105 bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground/85"
                  }`}
                >
                  {day.date.slice(8, 10)}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setDayWindow(Math.min(maxStart, startIndex + 1))}
          disabled={startIndex + 3 >= days.length}
          aria-label={t("home.scheduleNextDay")}
          className="grid size-9 shrink-0 place-items-center bg-secondary text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/*
        SATIRLAR — referansın `a.sched-row` yapısı (ölçüm, panel içi koordinatlar):
        · satır 40 px, `margin: 0 8px 8px`, `padding: 0 8px`, arka plan ŞEFFAF;
        · saat sütunu 48 px (`w-12`), SAĞA DAYALI, mono 12.5 px, en soluk ton;
        · arada 32 px'lik AYIRICI HÜCRE: 1 px dikey çizgi (ana renk %40) ve
          ortasında 5×1 px çentik (ana renk %60). Hover'da çentik büyür ve tam
          ana renge döner (referans: `-ml-6px`, `w-12px`, `bg-primary`);
        · başlık 13.5 px / 500, soluk; hover'da aydınlanır;
        · sağda `EP n` (mono 11 px) + 12 px play ikonu — ikon YALNIZ hover'da
          görünür (referans: `opacity: 0`).
        · TÜR ETİKETİ (TV / TV_SHORT / ONA) ÇİZİLMEDİ: referans bunu AniList'in
          `format` alanından basıyor, bizim takvim yanıtımızda böyle bir alan YOK;
          uydurma etiket yazılmaz (veri katmanına eklenirse buraya konur).
      */}
      <div>
        {(expanded ? activeDay.items : activeDay.items.slice(0, ROW_LIMIT)).map((item) => {
          const slug = item.malId === null ? undefined : malIndex.get(item.malId);
          const rowClassName =
            "group mx-2 mb-2 flex h-10 items-center px-2 transition-colors hover:bg-white/[0.04]";
          const row = (
            <>
              <span className="w-12 shrink-0 text-right font-mono text-[12.5px] font-medium tabular-nums text-foreground/35">
                {item.time}
              </span>
              <span className="relative h-10 w-8 shrink-0">
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-1/2 -ml-px w-px bg-primary/40"
                />
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 top-1/2 z-10 -ml-[2.5px] -mt-px h-px w-[5px] bg-primary/60 transition-all group-hover:-ml-1.5 group-hover:w-3 group-hover:bg-primary"
                />
              </span>
              {/* Başlık AniList İÇERİĞİDİR → bilerek ÇEVRİLMEZ. */}
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                {item.title}
              </span>
              {item.episode ? (
                <span className="ml-4 flex shrink-0 items-center gap-1.5 text-muted-foreground">
                  <span className="font-mono text-[11px] font-medium">EP {item.episode}</span>
                  <Play
                    aria-hidden="true"
                    className="size-3 opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </span>
              ) : null}
            </>
          );
          // Karşılığı olmayan kayıt bağlantısız çizilir (yerel sayfa uydurulmaz).
          return slug ? (
            <Link
              key={`${item.id}-${item.time}`}
              to="/anime/$slug"
              params={{ slug }}
              preload={false}
              className={rowClassName}
            >
              {row}
            </Link>
          ) : (
            <a key={`${item.id}-${item.time}`} className={rowClassName}>
              {row}
            </a>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
        <span className="font-mono text-xs text-muted-foreground">{stamp}</span>
        {/* `More ▾` — referansta `<button>`, href YOK, yanında chevron-DOWN. */}
        {activeDay.items.length > ROW_LIMIT ? (
          <button
            type="button"
            onClick={() => setExpanded((state) => !state)}
            className="flex items-center gap-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            {expanded ? t("home.scheduleLess") : t("home.scheduleMore")}
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={expanded ? "rotate-180 transition-transform" : "transition-transform"}
            />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * KOMPAKT BANTTAKİ SERİ satırının meta öğeleri: `yıl` ve `tür`.
 *
 * NEDEN TAM OLARAK BU İKİ ALAN: referansın bant satırı "format · tarih"
 * ritmini taşır ve bu iki alan şemada GERÇEKTEN var (`shows.year`,
 * `shows.genre`). Referanstaki puan/süre/trend alanlarının bizde karşılığı YOK;
 * uydurma değer yazmak yerine yalnızca var olan alanlar yazılır.
 *
 * NEDEN DİZİ DÖNER: şerit artık referansın ölçüsüne göre çizilir; öğeler
 * arasına referansın `/` ayracı (5 px sol / 8 px sağ, %10 opak) girer. Boş alan
 * hiç yazılmaz (satırda başıboş ayraç kalmaz). Yalnızca İLK tür yazılır çünkü
 * şerit tek satıra kırpılır (truncate) ve uzun tür listesi taşardı. Tür adı
 * veritabanı içeriğidir → bilerek ÇEVRİLMEZ.
 */
function seriesMetaParts(show: ShowWithImage): string[] {
  const year = (show.year ?? "").trim();
  const genre = (show.genre ?? "").split(",")[0]?.trim() ?? "";
  return [year, genre].filter(Boolean);
}

/**
 * Hero ALTINDAKİ tüm keşif alanı: iki kolonlu sayfa düzeni (solda geniş ana
 * kolon, sağda dar kenar çubuğu). Her bölüm kendi verisine bakar; veri
 * getirmeyen bölüm BAŞLIĞIYLA birlikte hiç çizilmez (boş başlık/boşluk kalmaz).
 *
 * NOT (kenar çubuğu artık STICKY DEĞİL): blueprint §6'ya göre referansta
 * `fixed`/`sticky` olan TEK eleman site header'ıdır; `aside.sidebar`ın
 * `position` değeri `static`'tir. Bu yüzden eski `lg:sticky lg:top-24`
 * kaldırıldı (bkz. aşağıdaki `aside` notu).
 */
function HomeSections({
  shows,
  continueItems,
  onContinueRemove,
}: {
  shows: ShowWithImage[];
  /** Cihazdaki izleme ilerlemesi (localStorage). Boşsa "devam et" satırı yoktur. */
  continueItems: ContinueItem[];
  /**
   * "İzlemeye devam et" kartını listeden çıkarır (referans: animex.one "Edit").
   * Liste verisi `Index`te tutulduğu için silme işi oraya devredilir — burada
   * yalnızca düzenleme kipi ve düğme çizilir.
   */
  onContinueRemove: (slug: string) => void;
}) {
  const { t } = useLang();
  /** "Düzenle" kipi: açıkken kartlar bağlantı olmaz, köşede "çıkar" düğmesi çıkar. */
  const [continueEditing, setContinueEditing] = useState(false);
  // NOT: "Yeni eklenenler" (`shows.created_at`) listesi BURADA DEĞİL, kompakt
  // banttadır (`HomeCompactBand`) — bant kullanıcı isteğiyle ana içeriğin SONUNA
  // taşındı. Liste tek yerde (bantta) hesaplanır ki iki yerde tutulup zamanla
  // birbirinden sapmasın.
  // NOT: tür çip şeridi KULLANICI İSTEĞİYLE TÜMÜYLE SİLİNDİ (bkz. `Index`
  // içindeki (a) notu): bu bileşende tür filtresiyle ilgili hiçbir şey çizilmez.

  // Kenar çubuğu sıralama sekmeleri (GÜN / HAFTA / AY). Sekmeler yalnızca SIRAYI
  // değiştirir; ek ağ isteği doğmaz — pencere sayaçları TEK sorgudan
  // (`useTrendActivity`) gelir ve React Query önbelleğinde paylaşılır.
  const [rankTab, setRankTab] = useState<RankTab>("day");

  // Seri başına pencere sayaçları. Sorgu düşerse sabit boş nesne kullanılır:
  // sekmeler yine çalışır, liste özgün sıraya düşer ve sayfa bozulmaz.
  const trendQuery = useTrendActivity();
  const trendActivity = trendQuery.data ?? EMPTY_TREND_ACTIVITY;

  // Kenar çubuğunun ANA KÜMESİ: bölümü olan seriler.
  //
  // NEDEN "En Çok Bölüm" DEĞİL DE PENCERE: projede görüntülenme ya da puan
  // verisi YOK (bkz. `readTrendActivity`); "en popüler" demek uydurma olurdu.
  // Sıralama, GERÇEK olan tek zaman sinyaliyle yapılır: seriye seçili pencerede
  // eklenen bölüm sayısı. Bölümü olmayan seriler listeye girmez (hiçbiri bölümlü
  // değilse panel hiç çizilmez). KÜME TÜM SEKMELERDE AYNIDIR: sekme yalnızca
  // sırayı değiştirir, böylece liste sekme değişiminde bir seriyi kaybedip
  // kazanmaz.
  const rankable = useMemo(
    () =>
      shows
        .filter((show) => Boolean(show.id) && show.episode_count > 0)
        .map((show, index) => ({ show, index })),
    [shows],
  );

  // Sekmeye göre yeniden sıralama — tamamen istemcide, ek istek yok.
  //
  // ÖLÇÜT: seçili PENCEREDE (gün / hafta / ay) seriye eklenen bölüm sayısı
  // (çok → az). Eşitlikte seriye EN SON eklenen bölümün tarihi (yeni → eski),
  // o da eşitse listenin özgün sırası korunur (kararlı, zıplamayan liste).
  //
  // NEDEN BU ÖLÇÜT: referans sitede bu sekmeler görüntülenmeye göre sıralar;
  // bizde görüntülenme/puan verisi yok (bkz. `readTrendActivity` notu). Uydurma
  // popülerlik yerine gerçek "siteye ne eklendi" sinyali kullanılır.
  const ranked = useMemo(() => {
    const window = TREND_WINDOWS[rankTab];
    const rows = [...rankable];
    rows.sort((a, b) => {
      const aAct = trendActivity[a.show.id];
      const bAct = trendActivity[b.show.id];
      const aCount = trendWindowCount(aAct, window);
      const bCount = trendWindowCount(bAct, window);
      if (aCount !== bCount) return bCount - aCount;
      const aNewest = aAct?.newest ?? "";
      const bNewest = bAct?.newest ?? "";
      if (aNewest !== bNewest) return aNewest < bNewest ? 1 : -1;
      return a.index - b.index;
    });
    return rows.slice(0, RANKED_LIMIT);
  }, [rankable, rankTab, trendActivity]);

  // "Son Bölümler" ızgarası ile bandın "YENİ ÇIKANLAR" kolonu AYNI sorguya bakar
  // (bkz. `useLatestEpisodes` / `readLatestEpisodes`): `queryKey` aynı olduğu için
  // React Query sonucu PAYLAŞIR — ikinci bir ağ okuması doğmaz.
  const latestQuery = useLatestEpisodes(shows);
  // Liste SERİ BAŞINA TEK (en yeni) bölüme indirilir; indirgeme kuralı ortaktır
  // (`latestPerShowItems`) ki ızgara ile bant aynı satırları göstersin. NEDEN: yeni
  // eklenmiş 30 bölümü olan bir seri tek başına 12 kartı doldurup keşif değerini
  // yok ederdi. `latestQuery.data` doğrudan burada okunur: araya bir `?? []` dizisi
  // koymak useMemo bağımlılığını her render'da değiştiriyordu (lint uyarısı).
  const latestPerShow = useMemo(
    () => latestPerShowItems(latestQuery.data ?? []),
    [latestQuery.data],
  );

  const latestCards = latestPerShow.slice(0, LATEST_GRID_LIMIT);
  // NOT: kompakt bant (YENİ ÇIKANLAR | YENİ EKLENENLER | TAMAMLANLAR) KULLANICI
  // İSTEĞİYLE ana içeriğin EN SONUNA taşındı (`Index()` sonundaki yerleşim).
  // Bu bölümün kendi satırları ve kenar çubuğu DEĞİŞMEDİ.
  // Panel ancak sıralanacak seri (bölümü olan) varsa çizilir; yoksa başlık ve
  // boşluk da bırakılmaz. Sekme ne olursa olsun aynı kümeye bakıldığı için
  // "panel var/yok" kararı sekmeye göre değişmez.
  const hasSidebar = rankable.length > 0;
  /**
   * Ana kolondaki ızgaraların sınıfı. Kenar çubuğu çizilirken ana kolon
   * içeriğin %75'i (1552 px'te 1144 px) olur ve 6 sütun tam referans kartını
   * (174 px) verir. Kenar çubuğu verisi yoksa ana kolon TAM genişliğe yayılır;
   * o durumda 6 sütun kartı 238.66 px'e çıkarırdı, bu yüzden kart genişliği
   * sınırlı düzen kullanılır (kart yine 174 px).
   */
  const mainGridClass = hasSidebar ? DISCOVERY_GRID : DISCOVERY_GRID_CAPPED;
  // ERKEN ÇIKIŞ KALDIRILDI: eskiden hiç keşif verisi yoksa bileşen `null` dönüyordu.
  // Erken çıkış yine de geri KONMADI (kapsam dışı bir davranış değişikliği
  // olurdu). Kenar çubuğu kendi verisine bakar; veri yoksa hiç çizilmez.
  // Bölümler yine kendi verisine bakar: veri yoksa yalnızca o bölüm (başlığıyla
  // birlikte) çizilmez, boş başlık/boşluk kalmaz.

  return (
    // İKİ KOLONLU SAYFA ALANI: solda GENİŞ ana kolon (masaüstünde 3 birimin
    // 2'si), sağda DAR kenar çubuğu. `items-start` kritik: kenar çubuğu ana
    // kolonun boyuna UZAMAZ (referansta olduğu gibi kendi içeriği kadar kalır).
    // Kenar çubuğu çizilmiyorsa (bölüm sayısı verisi yok) ana kolon FULL genişliğe
    // yayılır:
    // sağda boş bir üçte bir bırakmak ölü boşluk olurdu.
    // KAP + KOLON RİTMİ (referanstan; 1552 px pencerede ölçüldü): kap max-width
    // 1800 px + 10 px yan boşluk → içerik bloğu 1532 px, ilk kartın sol kenarı
    // 10 px. Masaüstünde 4 birimlik ızgara → ana kolon 3/4 (%75, 1144 px) +
    // 20 px boşluk + kenar çubuğu 1/4 (%25, 368 px): referansla birebir.
    // HERO → İLK İÇERİK SATIRI: eski referansta (anikoto.cz) 187.13 px'ti ve üst
    // boşluk 119 px buna göre seçilmişti (119 + 68.5 = 187.5, hedefe ~0.4 px).
    // Yeni referans (anikototv.to) aynı noktada 257.13 px ölçtü; farkın TAMAMI
    // onun hero'dan sonra koyduğu ve bizde OLMAYAN bloklardır (bookmark uyarısı,
    // sabitlenmiş topluluk, paylaşım şeridi ≈ 176 px + aralarındaki boşluklar).
    // Referansın kendi boşluk kuralı yine 40.5 px; birebir uygulamak ~125 px ÖLÜ
    // BOŞLUK eklerdi ve bu, veri uydurmadan boşluk yazmak olurdu → 119 px KORUNDU.
    <div className={`${PAGE_CONTAINER} grid items-start gap-10 pt-[119px] lg:grid-cols-4 lg:gap-5`}>
      <div className={hasSidebar ? "min-w-0 lg:col-span-3" : "min-w-0 lg:col-span-4"}>
        {/* ── REFERANS 2.1: `#anikoto-bookmark-alert` — DUYURU ŞERİDİ (ÇİZİLMEDİ) ──
            Blueprint §2.1: referans, ANA KOLONUN EN BAŞINDA (hero'nun hemen
            altında, "Latest Episode"dan önce) kapatılabilir bir duyuru şeridi
            çizer: `I.fas.fa-bookmark` ikonu + `P.anikoto-bookmark-alert__text`
            cümlesi + sağda kapatma düğmesi (`BUTTON.anikoto-bookmark-alert__close`);
            sayfa açılışında `is-visible` durumundadır ve ana kolonun tam
            genişliğindedir.
            NEDEN BURADA HİÇBİR ŞEY ÇİZİLMİYOR: bu şerit TAMAMEN İÇERİĞE bağlıdır
            (sitenin kendi duyuru cümlesini taşır). Bizde duyuru metni/alanı
            BULUNMUYOR; cümle uydurmak yasak olduğu için şerit çizilmez. Panelden
            yönetilen gerçek bir duyuru alanı eklendiğinde bu konumda çizilir. */}

        {/* ── REFERANS 2.2: `#community-pinned.cpin` — SABİTLENMİŞ DUYURU (ÇİZİLMEDİ) ─
            Blueprint §2.2: referans burada `Pinned` rozetli bir şerit
            (`DIV.cpin-bar` + `SPAN.cpin-badge` + `DIV.cpin-items` + `BUTTON.cpin-hide`)
            ve altında `DIV.cpin-spot` taşır. `cpin-items` içeriği üç topluluk
            başlığıdır (ör. `#Updates` / `#General` etiketleriyle, her öğe
            `/community/post/...` adresine gider ve yorum sayısı gösterir).
            NEDEN ÇİZİLMİYOR: projede topluluk gönderisi, yorum tablosu ve yorum
            sayısı YOK; blueprint'in verdiği başlıkları/metinleri kopyalamak ya da
            yorum sayısı uydurmak yasak. Şerit bu yüzden hiç çizilmez. */}

        {/* PAYLAŞIM SATIRI KALDIRILDI (kullanıcı isteği): önceki oturumda
            hero altına eklenen davet cümlesi ve düğme sırası (Paylaş / X /
            WhatsApp / Facebook / Reddit / Telegram) gereksiz bulundu ve tümüyle
            silindi. Bu konumda başka bir blok çizilmez. */}

        {/* REFERANS 2.4: "Kaldığın yerden devam et" → bizde cihazdaki izleme
            kaydından dolar (referansta `#continue-watching`, giriş yapılmış
            kullanıcıda dolar; anonim gözlemde boştu — blueprint §2.4 / §7).
            Cihazda ilerlemesi olan seri yoksa blok tamamen yok olur. */}
        {continueItems.length > 0 && (
          <section aria-label={t("home.continueAria")} className={SECTION_GAP}>
            <div
              className={`flex items-end justify-between gap-3 border-b border-border pb-3 ${HEAD_GAP_ROW}`}
            >
              <div>
                <p className="text-[15px] font-semibold text-primary">{t("home.continueTag")}</p>
                <h2 className={`mt-1 ${HEAD_ROW}`}>{t("home.continueHeading")}</h2>
              </div>
              {/* "DÜZENLE" — referans (animex.one) başlığın sağına bu düğmeyi
                  koyar. Gerçek işlev verir: düzenleme kipinde her kartın
                  köşesinde "listeden çıkar" düğmesi belirir (veri
                  `watch-progress`ten silinir). Boş bir düğme DEĞİLDİR. */}
              <button
                type="button"
                onClick={() => setContinueEditing((open) => !open)}
                className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {continueEditing ? t("home.continueDone") : t("home.continueEdit")}
              </button>
            </div>
            {/* GENİŞ SATIRLAR (poster ızgarası DEĞİL): her satır tek bir bölümü
                temsil eder ve doğrudan o bölümün izleme adresine gider. Alan
                kompakt kalsın diye sütun düzeni yerine dikey liste kullanılır;
                satırlar arası boşluk 12 px (YAKLAŞIK). */}
            {/* IZGARA (referans düzeni): kartlar yan yana 16:9 görsellerle
                dizilir; telefonda 2, masaüstünde 5 sütun. */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {continueItems.map(
                ({ show, season, episode, frame, fraction, position, duration, total, malId }) => (
                  <ContinueRow
                    key={show.slug ?? show.title}
                    // Doğrudan kaldığı bölümün izleme sayfasına gider
                    // (`/anime/<slug>/season/<n>/episode/<n>`); kart bunu `Link` ile kurar.
                    slug={cardSlug(show)}
                    season={season}
                    episode={episode}
                    title={show.title}
                    image={show.image}
                    frame={frame}
                    fraction={fraction}
                    position={position}
                    duration={duration}
                    total={total}
                    malId={malId}
                    editing={continueEditing}
                    onRemove={onContinueRemove}
                  />
                ),
              )}
            </div>
          </section>
        )}

        {/* ── REFERANS 2.5: `SECTION#recent-update` — "Latest Episode" ───────────
            (sözlükte TR "Son Bölümler"): referansın bu
            başlıktaki kendi kelimesi/başlık-cümlesi kullanılır. Yoğun büyük
            poster ızgarası (en fazla 12 kart, masaüstünde 6'lı satır). Kart, o
            bölümün izleme adresine gider.

            BAŞLIĞIN SAĞINDAKİ FİLTRE ŞERİDİ VE ←/→ OKLARI — BİLEREK YOK.
            Referans bu satırın sağına küçük bir filtre (All/Sub/Dub) ve ok
            düğmeleri koyar. Bu sekmeleri GERÇEKTEN besleyecek veri elimizde YOK:
            `shows` tablosunda seri bazlı altyazı/dublaj/trend işareti bulunmuyor;
            `episode_sources.language` (`tr`/`en`) YALNIZCA BÖLÜM KAYNAĞI
            bazındadır ve seri bazlı bir "Sub/Dub" etiketi üretmez — üstelik bu
            ızgara `show_episodes` okur, `episode_sources` okumaz. Veri uydurmamak
            için HİÇBİR sekme çizilmez. Oklar da çizilmez: ızgara sabit en fazla
            12 kartlık bir listedir; sayfalayıcı ya da kaydırıcı (slider) DEĞİLDİR.
            Bkz. yukarıdaki "OMİT EDİLENLER" notu. */}
        {latestCards.length > 0 && (
          <DiscoveryRow title={t("home.latestEpisodes")} gridClassName={mainGridClass}>
            {latestCards.map((item) => (
              <PosterCard
                key={item.id}
                // Bölüme doğrudan gider: /anime/<slug>/season/<s>/episode/<n>
                slug={showSlug(item.show)}
                season={item.season}
                episode={item.number}
                title={item.show.title}
                image={item.show.image}
                // Meta: "S1B5" (İngilizcede "S1E5") + varsa bölüm adı. Kısaltma
                // dile bağlı olduğu için harf burada birleştirilmez, sözlükten gelir.
                meta={`${t("series.seasonEpisodeCode", {
                  season: item.season,
                  number: item.number,
                })}${item.title ? ` · ${item.title}` : ""}`}
              />
            ))}
          </DiscoveryRow>
        )}

        {/* ── REFERANS 2.6: `SECTION#upcoming-anime` — "GELECEK ANİMELER" ──────
            KONUM DEĞİŞMEDİ: referansta bu bölüm hero'nun altındaki ana kolonda,
            "Latest Episode"dan SONRA ve üç kolonlu banttan ÖNCE durur; bizde de
            tam burada. ÖNCE ÇİZİLMİYORDU çünkü `shows` şemasında yayın durumu ya
            da ilk yayın tarihi tutan alan yoktu (`status`, `airing`, `premiered`,
            `next_airing` — hiçbiri yok; bkz. src/integrations/supabase/types.ts →
            shows) ve uydurma bir "yaklaşan anime" listesi gösterilmezdi. Artık
            GERÇEK veriyle dolar: AniList'in yayınlanmamış animeler sorgusu
            (`status: NOT_YET_RELEASED` + `startDate_greater`) `/api/anilist`
            sunucu rotası + uzun ömürlü `cachedRead` önbelleği üzerinden okunur
            (gerekçe: `UpcomingSection` üstündeki not). Veri gelmezse bölüm
            başlığıyla birlikte hiç çizilmez.

            Referansın sağ üstteki "View more →" bağlantısı ÇİZİLMEZ: gideceği
            ayrı bir "yaklaşan animeler" listesi sayfası projede yok, ölü bağlantı
            üretilmez. */}
        <UpcomingSection shows={shows} gridClassName={mainGridClass} />

        {/* ── REFERANS 2.7: `DIV.top-tables.mb-3` — ÜÇ KOLONLU KOMPAKT BANT ─────
            KULLANICI İSTEĞİ: bant BURADAN kaldırıldı; artık ana içeriğin EN
            SONUNDA, footer'ın hemen üstünde ve "Bu sezon" bölümünün hemen
            altında durur (bkz. `Index()` sonundaki yerleşim). Bantın üç
            kolonu, başlıkları ve veri kaynağı DEĞİŞMEDİ. */}

        {/* ── "Estimated Schedule" ARTIK ANA KOLONDA DEĞİL ─────────────────────
            KULLANICI İSTEĞİ (27.09.2026): "estimated schedule şeyini bu sitedeki
            gibi yap … şu an durduğu yer kötü … top trending'in tam altına."
            Referansta (reanime.to/home) bu panel ANA KOLONDA DEĞİL, SAĞ KENAR
            ÇUBUĞUNDA ve "Top Trending" panelinin HEMEN ALTINDA durur (ölçüm:
            kenar çubuğu 446 px; Top Trending y=636 h=1201 → Estimated Schedule
            y=1861 h=583, aralarında 24 px). Bu yüzden bölüm buradan kaldırıldı ve
            `aside` içinde Top Trending'in altına taşındı; panelin kendisi de
            referansın ölçüleriyle yeniden çizildi (`ScheduleSection` üstündeki not).

            Veri kaynağı DEĞİŞMEDİ: AniList `airingSchedules` → `/api/anilist` +
            `cachedRead` önbelleği, 7 günlük pencere, GÜNLERE bölünmüş. Veri
            gelmezse panel hiç çizilmez. */}

        {/* ── REFERANSTA KARŞILIĞI OLMAYAN BÖLÜMLER ───────────────────────────
            "Bu sezon" ızgarası ve tür çipleri referansta YOKTUR; kullanıcı
            isteğiyle SİLİNMEDİ, ana kolonun DIŞINA çıkarılıp A-Z bölümünden SONRA
            (footer'ın hemen üstüne) taşındı. Yerleşim için `Index()` gövdesine
            bakın. */}
      </div>

      {/* SAĞ: DAR KENAR ÇUBUĞU — YENİ referansın (anikototv.to/home) kenar
          çubuğunun DÜRÜST karşılığı. Ölçüler yeni referanstan alınır: başlık
          27 px / 600, sekmeler "pill" grubu; panel DIŞ kart kabuğu YOKTUR
          (referansta da yok — kart yalnızca satırların kendisidir). İçerik yine
          bizim dürüst verimizdir. Alan yalnızca içeriği kadar yüksektir;
          `self-start` sayesinde ana kolonun boyuna UZAMAZ (ölü boşluk olmaz).

          KENAR ÇUBUĞU ARTIK STICKY DEĞİL: blueprint §6, referansta `fixed`/`sticky`
          olan TEK elemanın site header'ı (`HEADER.fixed`) olduğunu ve
          `aside.sidebar`ın `position: static` kaldığını söyler. Bu yüzden eski
          `lg:sticky lg:top-24` KALDIRILDI; kenar çubuğu artık ana kolonla birlikte
          normal akışta kayar (yalnızca `self-start` kalır ki ızgara satırına
          gereksiz yere uzamasın). Ölçüler ve panel işaretlemesi DEĞİŞMEDİ.
          Masaüstü öncesi tek kolon akışında görünür. */}
      {hasSidebar && (
        <aside aria-label={t("home.rankingAria")} className="min-w-0 lg:col-span-1 lg:self-start">
          {/* PANEL DIŞ KABUĞU YOK — YENİ referans (anikototv.to/home, 1552×900'de
              gerçek tarayıcıda ölçüldü): `section#top-anime` KART DEĞİLDİR;
              border-radius 0 px, padding 0 px, zemin şeffaf. Görsel kart yalnızca
              her SATIRIN kendi kabıdır (bizde karşılığı `RankedRow`). Eski dış HUD
              kabuğu (12 px köşe + 16 px dolgu + kenarlık + 160° gradyan + HUD
              köşe/havalandırma süsleri) reanime.to ölçümünden geliyordu ve yeni
              referansla uyuşmuyordu → KALDIRILDI. Satırların kendi kart görünümü
              korunur (satır işaretlemesi / ölçüsü / hover davranışı dokunulmaz).
              Renkler yine bizim temamızdan gelir. */}
          <div>
            <div>
              {/* BAŞLIK ŞERİDİ — YENİ referans `section#top-anime .head`
                  (anikototv.to/home): flex + space-between + align-center, alt
                  çizgi YOK (referansta `border-bottom: 0`), başlık 27 px / 600 /
                  letter-spacing normal ve `padding-left: 5 px`. Eski 1 px çizgi
                  ile ona binen 72×2 px KIRIK (skew -8°) vurgu şeridi KALDIRILDI:
                  ikisi de artık kaldırılan HUD kart kabuğunun parçasıydı ve yeni
                  referansta YOK. `flex-wrap` yalnızca güvenlik ağıdır: dar sütunda
                  başlık ile sekmeler alt alta iner, taşma olmaz.

                  NEDEN BAŞLIK ŞERİDİ SIKIŞTIRILDI (ÖLÇÜM, 1552×900): kenar
                  çubuğunun İÇ genişliği 364 px. Başlık "TOP TRENDING" 27 px/600
                  iken 183 px, sol dolgu 5 px ile 188 px; ESKİ sekme grubu
                  ~203 px (kutu dolgusu 2×3 px + etiket araları 2×2 px + üç
                  etiketin kendi dolgusu 3×16 px + etiket metinleri ~145 px).
                  Üst şeritteki `gap-x-3` (12 px) ile gereken en az genişlik
                  188 + 203 + 12 = 403 px > 364 px olduğu için `flex-wrap`
                  şeridi İKİNCİ SATIRA kırıyordu (sekmeler başlığın ~41 px
                  altına düşüyordu); referansta ise tek satırdır.
                  DÜZELTME (başlık 27 px'te ve üç sekme yerinde KALARAK, taşma
                  olmadan tek satır): etiket dolgusu 8→6 px (`px-1.5`), etiket
                  arası 2→1 px (`gap-px`), kutu dolgusu 3→2 px (`p-[2px]`), hafif
                  sıkı harf aralığı `tracking-[-0.02em]` ve etiketler kısaltıldı
                  (BÖLÜM→BÖL., İngilizcede EPISODES→EPS. / SEASON→SEAS.; her iki
                  dil sözlükte güncellendi). Üst şerit aralığı da 12→8 px
                  (`gap-x-2`) ki kırılma eşiği daha geniş bir hataya payı bıraksın.
                  YENİ ARİTMETİK: grup = 203 − 4 (kutu dolgusu) − 12 (etiket
                  dolgusu) − 21 (BÖLÜM→BÖL.) − ~3.5 (harf aralığı) ≈ 162 px;
                  toplam 188 + 162 + 8 = 358 px ≤ 364 px → TEK SATIR (~6 px pay).
                   İngilizcede 188 + ~155 + 8 = 351 px → ~13 px pay. Not: `justify-between`
                   sayesinde artan boşluk zaten araya dağılır, yani sekme grubu
                   sağa yaslı kalır ve görsel aralık değişmez.

                   DİKKAT (dil): ölçüm "TOP TRENDING" (12 karakter) içindir. Türkçe
                   başlık "TREND OLANLAR" (13 karakter) birkaç px daha geniştir; 364 px
                   iç genişlikte TR'de satır İKİ SATIRA kırılabilir. Bu bilerek göze
                   alındı: `flex-wrap` tam olarak bunun için duruyor (taşma olmaz) ve
                   kullanıcı başlığın TÜRKÇE olmasını istedi. HİÇBİR ölçü (başlık 27 px,
                   etiket dolgusu, grup dolgusu, aralıklar) DEĞİŞTİRİLMEDİ. */}
              <div className="mb-[15px] flex flex-wrap items-center justify-between gap-x-2">
                {/* Başlık DİLE BAĞLI: `tr` → "TREND OLANLAR", `en` → "TOP TRENDING"
                    (bkz. i18n'deki `home.ranking` notu ve sayfa başındaki panel
                    açıklaması). Tipografi YENİ referanstan (27 px / 600 / harf
                    aralığı normal); renk bizim temamızdan (foreground %90). */}
                <h2 className="pl-[5px] text-[27px] font-semibold tracking-normal text-foreground/90">
                  {t("home.ranking")}
                </h2>
                {/* SEKMELER — YENİ referans `.tabs`: bir "pill" GRUBU (kutu dolgusu
                    3 px, köşe 5 px; her etiket 2×8 px dolgu, köşe 3 px,
                    13.5 px / 600; etiketler arası 2 px) ve aktif etiket DOLU.
                    RENKLER bizim temamızdan: kutu `bg-foreground/5`, aktif
                    `bg-primary`, pasif soluk. Etiket metinleri bizim DÜRÜST ölçüt
                    adlarımızdır; referansın kısa etiketleri
                    (Day/Week/Month) KOPYALANMAZ çünkü arkasında öyle bir veri yok.
                    Ölçüt açıklaması yine ipucu (title) balonundadır.

                    SIKIŞTIRMA (bkz. başlık şeridindeki ölçüm notu): 364 px'te tek
                    satıra sığmak için grup dolgusu 3→2 px, etiket dolgusu 8→6 px
                    (`px-1.5`), etiket arası 2→1 px (`gap-px`) ve harf aralığı
                    -0.02em yapıldı; görünüm (yuvarlak grup + soluk zemin + aktif
                    primary) AYNI kalır. */}
                <div
                  role="tablist"
                  aria-label={t("home.rankTabAria")}
                  className="flex items-center gap-px rounded-[5px] bg-foreground/5 p-[2px]"
                >
                  {RANK_TABS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={rankTab === item.id}
                      title={t(item.hintKey)}
                      onClick={() => setRankTab(item.id)}
                      className={`rounded-[3px] px-1.5 py-0.5 text-[13.5px] font-semibold tracking-[-0.02em] transition-colors ${
                        rankTab === item.id
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t(item.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
              {/* Satır listesi: referans `space-y-3` → satırlar arası 12 px.
                  Satırlar ayrı kartlardır; aralarında çizgi YOKTUR. */}
              <div className="space-y-3">
                {ranked.map(({ show }, index) => (
                  <RankedRow key={show.slug ?? show.title} show={show} rank={index + 1} />
                ))}
              </div>
            </div>
          </div>

          {/* ── "Estimated Schedule" — TOP TRENDING'İN HEMEN ALTINDA ──────────
              KULLANICI İSTEĞİ (27.09.2026): referansın (reanime.to/home) kenar
              çubuğu sırası birebir alındı: Top Trending → Estimated Schedule →
              (Top Posts). Ölçüm: panel 446×583, arada 24 px; bizde kenar çubuğu
              `space-y-6` (24 px) kullandığı için aralık zaten referansla aynı.
              Panel artık ana kolonda ÇİZİLMİYOR (bkz. ana kolondaki kaldırma notu).
              Dar ekranlarda ızgara tek kolona indiği için panel, kenar çubuğunun
              doğal akışında Top Trending'in altında görünür. */}
          <div className="mt-6">
            <ScheduleSection shows={shows} />
          </div>
          {/* ── REFERANS 5: kenar çubuğunda "Discussion" paneli — ÇİZİLMEDİ ───
               Referans, TOP TRENDING'in ALTINDA sağ kenar çubuğuna bir
               "Discussion" (son yorumlar / tartışma başlıkları) paneli koyar.
               NEDEN YOK: projede yorum/tartışma SİSTEMİ ve yorum TABLOSU
               bulunmuyor (`shows`, `show_episodes`, `show_seasons`,
               `show_images`, `show_characters` dışında bir yorum tablosu yok;
               bkz. src/integrations/supabase/types.ts). Uydurma tartışma
               başlıkları ya da yorum sayıları gösterilmez. Bu yüzden panel
               burada hiç çizilmez; TOP TRENDING paneli ise DOKUNULMADI.
               ─────────────────────────────────────────────────────────────── */}
        </aside>
      )}
    </div>
  );
}

function Index() {
  const { t } = useLang();
  // Sekme başlığı aktif dili izler (rota `head()`i sunucuda bir kez üretilir).
  useDocumentTitle(t("meta.homeTitle"));
  // Anasayfa reklamı: panelde `ad_home` kodu varsa PANEL kazanır, boşsa
  // koddaki Adsterra birimi çalışır (slot vardı ama içi boştu → reklam yoktu).
  const adHome = useAdCode("ad_home");
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState(ALL_GENRES);
  // Veri loader'dan gelir (sunucuda çekilmiş) — "yükleniyor" ara durumu yok.
  const dbShows = Route.useLoaderData();
  const shows: HeroCard[] = dbShows && dbShows.length > 0 ? dbShows : fallbackShows;

  // Vitrin slider'ı: YALNIZCA panelde "Vitrin'e ekle" ile işaretlenmiş seriler döner.
  //
  // ⚠️ DÜZELTİLEN HATA (kullanıcı bildirimi, 29.09.2026):
  //   "Panelden anime ekleyip 'Vitrin'e ekle' yapmadığım sürece ana sayfa
  //    vitrininde görünmemesi gerekiyordu — neden görünüyor?"
  //
  // Eski satır `featuredShows.length > 0 ? featuredShows : shows` idi: HİÇBİR seri
  // işaretli değilken vitrin TÜM serilere düşüyordu. Panelden eklenen her yeni
  // kayıt kendiliğinden vitrinde dönmeye başlıyordu — kullanıcının gördüğü buydu.
  //
  // Artık düşme (fallback) VERİTABANINA değil, sitenin koddaki statik vitrinine
  // (`fallbackShows`) yapılır: işaretsiz bir kayıt asla vitrine sızmaz, slayt da
  // boş kalmaz.
  const featuredShows = shows.filter((show) => show.is_featured);
  const heroShows: HeroCard[] = featuredShows.length > 0 ? featuredShows : fallbackShows;

  /**
   * "Kaldığın yerden devam et" satırının verisi.
   *
   * İzleme ilerlemesi cihazda (localStorage) tutulur; sunucuda `window` yoktur.
   * Bu yüzden liste ilk render'da BİLEREK boştur ve yalnızca mount sonrası
   * doldurulur — SSR ile istemci HTML'i uyuşmazlığı (hydration mismatch) olmaz.
   * Okuma asla hata fırlatmaz: bozuk/eksik depo "ilerleme yok" demektir ve
   * satır hiç çizilmez.
   *
   * KAYIT YOKSA SATIR DA YOK: liste yalnızca cihazda izlenmiş bölümü olan
   * serilerden kurulur (aşağıdaki `if (last)` kapısı). Yani "ilerleme yoksa
   * hiçbir şey çizilmez" kuralı bu kapıdır; kart/postercanlı boş bir satır
   * üretilmez.
   *
   * EK OKUMA YOK: kare ve konum aynı cihaz deposundan gelir (localStorage);
   * ne Supabase'e ne de ağa çıkılır.
   */
  const [continueItems, setContinueItems] = useState<ContinueItem[]>([]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const next: ContinueItem[] = [];
      for (const show of shows) {
        const showKey = cardSlug(show);
        const last = getLastEpisode(showKey);
        if (!last) continue;
        // Konum kaydı: oran yalnızca süre de biliniyorsa hesaplanır. Konum
        // kaydı yoksa `null` kalır ve çubuk çizilmez (uydurma %0 yok).
        const progress = getProgress(showKey, last.season, last.episode);
        const fraction =
          progress && progress.duration > 0
            ? Math.min(1, Math.max(0, progress.position / progress.duration))
            : null;
        // Kare YALNIZCA kendi oynatıcımızda yakalanmışsa vardır; embed/iframe
        // durumunda boş gelir ve satır postere düşer (bkz. lib/watch-progress.ts).
        const frame = getResumeFrame(showKey, last.season, last.episode);
        next.push({
          show,
          season: last.season,
          episode: last.episode,
          frame,
          fraction,
          // Referans düzeni (animex.one) için gereken ÜÇ ek değer. Hepsi GERÇEK
          // kayıtlardan gelir; eksikse 0 kalır ve ilgili satır hiç çizilmez
          // (uydurma "0:00" / "%0" gösterilmez).
          position: progress?.position ?? 0,
          duration: progress?.duration ?? 0,
          total:
            "episode_count" in show && typeof show.episode_count === "number"
              ? show.episode_count
              : 0,
          malId: (show as { mal_id?: number | null }).mal_id ?? null,
        });
      }
      setContinueItems(next);
    } catch {
      // Depo okunamadıysa satır gösterilmez; sayfanın geri kalanı etkilenmez.
      setContinueItems([]);
    }
  }, [shows]);

  /**
   * "İzlemeye devam et" kartını listeden çıkarır (referans: animex.one "Edit").
   *
   * İKİ İŞ BİRDEN YAPILIR: (1) cihaz deposundan o serinin TÜM ilerleme kaydı
   * silinir, (2) ekrandaki liste anında güncellenir. Yalnızca listeden çıkarmak
   * YETMEZDİ — kayıt depoda kaldığı sürece sayfa yenilendiğinde kart geri gelir.
   *
   * `useCallback`: `MemoHomeSections` memo'lu; her render'da yeni bir fonksiyon
   * üretilse memoizasyon bozulur ve bölümler gereksiz yeniden çizilirdi.
   */
  const handleContinueRemove = useCallback((slug: string) => {
    forgetShow(slug);
    setContinueItems((prev) => prev.filter((item) => cardSlug(item.show) !== slug));
  }, []);

  const [heroIndex, setHeroIndex] = useState(0);
  // Sürükleme sırasında slaytların yatay kayması (yüzde) ve tutma durumu.
  const [dragX, setDragX] = useState<number | null>(null);
  const [heroDragging, setHeroDragging] = useState(false);
  /**
   * ── SÜRÜKLEME GÜNCELLEMELERİNİ KARE BAŞINA BİRE İNDİR ──────────────────────
   *
   * NEDEN (kullanıcı bildirimi, 30.09.2026: "vitrin geçişlerde aşırı kasıyor,
   * uzun süredir var"): `pointermove` farede saniyede YÜZLERCE kez tetiklenebiliyor
   * ve her tetiklemede `setDragX` çağırmak bu ana sayfa bileşeninin TAMAMINI
   * (4000+ satır, 60+ poster kartı, trend listesi, vitrin) yeniden çizdiriyordu —
   * sürükleme boyunca saniyede yüzlerce kez. Artık kare başına EN FAZLA BİR kez
   * güncelleniyor; ayrıca %0,25'ten küçük farklar ATLANIYOR (gözle görülmeyen
   * güncellemeler için çizim yapılmaz).
   *
   * NOT: CSS'e dokunulmadı — daha önce buradaki bir "takılma düzeltmesi"
   * (will-change/backface-visibility) görüntüyü bozmuş ve geri alınmıştı.
   */
  const dragPercentRef = useRef<number | null>(null);
  const dragFrame = useRef<number | null>(null);
  /** Slayt DOM düğümleri — sürüklemede DOĞRUDAN yazmak için (React'siz). */
  const slideEls = useRef<Map<number, HTMLDivElement>>(new Map());

  /**
   * SÜRÜKLEMEYİ DOĞRUDAN DOM'A YAZ (React'e HİÇ uğramadan).
   *
   * NEDEN (kullanıcı bildirimi, 30.09.2026): "o sitede kaydırırken en ufak kasma
   * yok, bizde ne kadar yavaş kaydırsam kasıyor." Sebep: sürüklemenin her karesi
   * React state'ini değiştiriyordu (`setDragX`) ve bu, vitrin durumu ne olursa olsun
   * ana sayfa bileşeninin yeniden çalışması demekti (memo yalnızca AĞIR BÖLÜMLERİ
   * kurtarıyor; vitrinin kendi JSX'i ve çevresi her karede yeniden kuruluyordu).
   *
   * YENİ YOL: sürükleme sırasında yalnızca ilgili slaytların `transform/opacity/
   * visibility` değerleri doğrudan DOM'a yazılır. Bu değerler zaten birleştirici
   * (compositor) özellikleri olduğu için tarayıcı bunları GPU'da işler; React'in
   * işi tamamen kalkar. Kare başına EN FAZLA BİR yazma yapılır (rAF ile birleştirme).
   *
   * React ile çakışma olmaz: sürükleme boyunca `dragX` state'i `null` kalır, yani
   * `backdropDragStyle` bu özellikleri React'e yazdırmaz. Bırakınca (settle yolu)
   * React devralır ve sonunda `dragX = null` ile bu özellikleri kaldırır.
   */
  function writeDragStyles(percent: number) {
    const total = heroShows.length;
    if (total < 2) return;
    const prev = (safeIndex - 1 + total) % total;
    const next = (safeIndex + 1) % total;
    /**
     * Referans sitede (sonanime.com bundle) ÖLÇÜLEN birebir aynı mantık:
     *   · katılan slaytlar → opacity 1 · visibility visible · transform translateX ·
     *     **zIndex 2** (sürüklenen slayt komşusunun ALTINDA kalmaz),
     *   · katılmayanlar → opacity 0 · visibility hidden · transform "" · zIndex 0
     *     (görünür kalıp "açılıp kapanan" hayalet slayt oluşturmasınlar),
     *   · hepsine `transition: none` (sürükleme 1:1 takip etsin, animasyon gecikmesi olmasın).
     */
    for (const [index, element] of slideEls.current) {
      if (!element) continue;
      element.style.transition = "none";
      const isActive = index === safeIndex;
      const isPrev = index === prev && percent > 0;
      const isNext = index === next && percent <= 0;
      if (isActive || isPrev || isNext) {
        const offset = isActive ? 0 : isPrev ? -100 : 100;
        element.style.transform = `translateX(${percent + offset}%)`;
        element.style.opacity = "1";
        element.style.visibility = "visible";
        element.style.zIndex = "2";
      } else {
        element.style.transform = "";
        element.style.opacity = "0";
        element.style.visibility = "hidden";
        element.style.zIndex = "0";
      }
    }
  }

  /** Sürükleme sırasında yazılan tüm satır içi stilleri geri alır. */
  function clearDragStyles() {
    for (const element of slideEls.current.values()) {
      if (!element) continue;
      element.style.removeProperty("transition");
      element.style.removeProperty("transform");
      element.style.removeProperty("opacity");
      element.style.removeProperty("visibility");
      element.style.removeProperty("z-index");
    }
    // Sürükleme boyunca gizlenen medya (video/iframe) geri açılır.
    for (const element of heroRef.current?.querySelectorAll<HTMLElement>(".hero-video") ?? []) {
      element.style.removeProperty("transition");
      element.style.removeProperty("opacity");
    }
    dragPercentRef.current = null;
  }

  /**
   * Sürükleme boyunca videoyu/iframe'i GİZLER.
   *
   * NEDEN: (1) gömülü YouTube oynatıcısı, üst öğesi her karede taşınırken ekran
   * dışı bir pencereyi yeniden birleştirmek zorunda kalıyor — sürüklemenin en ağır
   * kalemi; (2) kullanıcı zaten "video ile fotoğraf birbirine girmesin" istedi.
   * Sürükleme bitince stiller geri alınır (`clearDragStyles`), oynatıcı YENİDEN
   * yüklenmez.
   */
  function hideMediaForDrag() {
    for (const element of heroRef.current?.querySelectorAll<HTMLElement>(".hero-video") ?? []) {
      element.style.transition = "none";
      element.style.opacity = "0";
    }
  }

  /** Kare başına en fazla bir DOM yazımı (aynı karede birden çok hareket gelebilir). */
  function scheduleDragWrite(percent: number) {
    dragPercentRef.current = percent;
    if (dragFrame.current !== null) return;
    dragFrame.current = window.requestAnimationFrame(() => {
      dragFrame.current = null;
      const next = dragPercentRef.current;
      if (next !== null) writeDragStyles(next);
    });
  }
  // Eski sitedeki gibi: veri tasarrufu / çok yavaş bağlantı / dokunmatik
  // cihazlarda ve hareket azaltma modunda hero videosu hiç indirilmez.
  const [allowVideo, setAllowVideo] = useState(false);
  /**
   * ZAYIF CİHAZ MODU (kullanıcı isteği, 30.09.2026): "kişinin cihazı neyse otomatik
   * o hızı görsün… özellikle vitrin hiç kastırmasın."
   *
   * Cihazın bildirdiği ÇEKİRDEK ve BELLEK sayısına bakılır; zayıf bir makinede
   * sürekli çalışan vitrin zoom'u (Ken Burns) kapatılır — kare hızını en çok o
   * düşürüyordu. Güçlü cihazlarda hiçbir şey değişmez, görünüm bire bir aynıdır.
   *
   * ÖLÇÜLEN DURUMLAR (tarayıcı API'leri): `hardwareConcurrency` (çekirdek sayısı),
   * `deviceMemory` (GB — yalnızca Chromium), `connection.saveData` (veri tasarrufu).
   * Değer yoksa (Firefox/Safari çoğunu vermez) cihaz GÜÇLÜ sayılır: yanlışlıkla
   * efekt kapatıp görüntüyü boşaltmamak için "şüphede kalırsan açık bırak" kuralı.
   */
  const [weakDevice, setWeakDevice] = useState(false);
  useEffect(() => {
    const nav = navigator as {
      connection?: { saveData?: boolean; effectiveType?: string };
      deviceMemory?: number;
      hardwareConcurrency?: number;
    };
    const conn = nav.connection;
    const cores = nav.hardwareConcurrency ?? 8;
    const memory = nav.deviceMemory ?? 8;
    const weakHardware = cores <= 2 || memory <= 2 || conn?.saveData === true;
    setWeakDevice(weakHardware);
    const skip =
      conn?.saveData === true ||
      conn?.effectiveType === "2g" ||
      weakHardware ||
      window.matchMedia("(hover: none)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!skip) setAllowVideo(true);
  }, []);
  const heroRef = useRef<HTMLElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const safeIndex = heroShows.length > 0 ? heroIndex % heroShows.length : 0;
  // Header görseli ya da videosu olmayan seride 404 isteğiyle uğraşmamak için
  // hata alınan dosya kaydedilir ve kapak görseline düşülür.
  const [brokenBackdrops, setBrokenBackdrops] = useState<Record<string, boolean>>({});
  const [brokenVideos, setBrokenVideos] = useState<Record<string, boolean>>({});
  // Akış: slayt açılır → bir süre FOTOĞRAF görünür → açıklama bilgileri
  // animasyonla kapanır (grid-template-rows 0fr + opacity, 0.6 sn) → tam o anda
  // video medya olarak devreye girer (opacity 0.6 sn); geriye logo + butonlar kalır.
  // Vitrin medya akışı (sonanime.com'da ölçülerek eşlendi):
  //   1. AŞAMA — slayt aktif olur, önce SADECE fotoğraf görünür, yazı açık.
  //   2. AŞAMA — 3 sn sonra video DOM'a girer.
  //   3. AŞAMA — video GERÇEKTEN oynamaya başladığı an yazı animasyonla kapanır
  //               ve video görünür olur (ikisi senkron).
  // Fotoğraf + yazı bu süre boyunca görünür; sonra video girip yazı kapanır.
  const HERO_VIDEO_DELAY = 6000;
  const [videoArmed, setVideoArmed] = useState(false);
  const [videoPhase, setVideoPhase] = useState<"waiting" | "playing">("waiting");
  const [videoVisibleKey, setVideoVisibleKey] = useState<string | null>(null);
  useEffect(() => {
    // Yeni slaytın yazısı hemen açılsın.
    setVideoArmed(false);
    setVideoPhase("waiting");
    let armTimer: number | undefined;
    if (allowVideo) {
      armTimer = window.setTimeout(() => setVideoArmed(true), HERO_VIDEO_DELAY);
    }
    /**
     * ÇIKAN SLAYTIN VİDEOSU GEÇİŞ ANINDA KESİLİR.
     *
     * KULLANICI BİLDİRİMİ (30.09.2026): "videodan sonra fotoya geçerken birbirine
     * giriyor" — eski davranış videoyu 1300 ms daha görünür tutuyordu; o süre
     * boyunca çıkan slaytın videosu, gelen slaytın fotoğrafıyla YARI SAYDAM
     * karışıyordu.
     *
     * YENİ DAVRANIŞ: video geçişin BAŞINDA kaldırılır (`videoVisibleKey` boşalınca
     * `videoActive` de düşer ve medya DOM'dan çıkar). Çıkan slayt artık kendi
     * FOTOĞRAFIYLA solar → iki fotoğraf arasında temiz bir geçiş olur, video ile
     * fotoğraf hiç üst üste binmez.
     *
     * ESKİ GEREKÇE GEÇERSİZ DEĞİL, TERCİH DEĞİŞTİ: önceki not "video hemen
     * kaldırılırsa 'video kapandı, resim geri geldi' görüntüsü oluşur" diyordu.
     * Çıkan slaytın fotoğrafı zaten aynı serinin karesi olduğu için bu fark
     * göze batmıyor; karışma ise batıyordu.
     */
    setVideoVisibleKey(null);
    return () => {
      if (armTimer) window.clearTimeout(armTimer);
    };
  }, [safeIndex, allowVideo]);

  /**
   * ── GÖMÜLÜ VİDEO (YouTube/Vimeo) ────────────────────────────────────────────
   *
   * `onPlaying` olayı YALNIZCA kendi `<video>`muzda gelir; gömülü kaynak dış bir
   * pencere olduğu için olay GELMEZ. Gelmediği sürece yazı kapanmıyor ve video
   * görünmez kalıyordu. Bu yüzden gömülü kaynakta oynatıcı "hazır" kabul edilir.
   *
   * ── KUMANDALARIN GÖRÜNMESİ (kullanıcı bildirimi, 30.09.2026) ──────────────────
   * "Video ilk görüneceği an 1-2 saniye duraklat/ileri-geri düğmeleri görünüyor."
   * Sebep: YouTube oynatıcısı yüklendiği ANDA kumandalarını gösterip birkaç saniye
   * sonra kendiliğinden gizliyor; biz de tam o anda görünür yapıyorduk.
   * ÇÖZÜM: gömülü oynatıcı slayt aktif olur olmaz (henüz gizliyken) yüklenir ve
   * oynamaya başlar; perde VİTRİN BEKLEME SÜRESİ dolduğunda açılır. O ana kadar
   * oynatıcı kendi kumandalarını çoktan gizlemiş olur → kullanıcı hiç görmez.
   * Bu yüzden buradaki "hazır" payı çok kısadır (kumandaların gizlenmesini
   * beklemek gerekmez, o bekleme zaten yükleme sırasında geçmiştir).
   */
  const activeHeroKey = (() => {
    const activeSlide = heroShows[safeIndex];
    return activeSlide ? (activeSlide.slug ?? activeSlide.title) : "";
  })();
  const activeEmbedUrl = useMemo(() => {
    const activeSlide = heroShows[safeIndex];
    if (!activeSlide) return "";
    // `HeroCard` birleşiminde `banner_video` YALNIZCA veritabanından gelen kartta
    // vardır (statik vitrin yedeğinde yok) — bu yüzden `in` ile daraltılıyor.
    const raw = "banner_video" in activeSlide ? activeSlide.banner_video : "";
    const source = heroVideoSource(raw);
    return source.kind === "embed" ? source.embedUrl : "";
  }, [heroShows, safeIndex]);

  useEffect(() => {
    if (!allowVideo || !videoArmed || !activeEmbedUrl || !activeHeroKey) return;
    if (brokenVideos[activeHeroKey]) return;
    /**
     * PERDE AÇILMA PAYI = 2,6 sn.
     *
     * NEDEN BU KADAR: oynatıcı `videoArmed` anında (6. saniye) kurulur ve o an
     * kendi kumandalarını gösterir; YouTube bunları birkaç saniye sonra gizler.
     * Daha erken açarsak kullanıcı duraklat/ileri-geri düğmelerini görür (bildirdiği
     * sorun), daha geç açarsak video gereksiz yere gecikir. 2,6 sn ikisinin arasını
     * tutuyor. Ölçüm yine kullanıcının ekranında yapılmalı; gerekirse bu sayı tek
     * yerde burada değişir.
     */
    const timer = window.setTimeout(() => {
      setVideoVisibleKey(activeHeroKey);
      setVideoPhase("playing");
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [allowVideo, videoArmed, activeEmbedUrl, activeHeroKey, brokenVideos]);

  // Geçiş: sonanime.com'da ölçtüğüm gibi opacity FADE (1.2 sn, CSS'te tanımlı).
  // Kayma yok; sürükleme sırasında slaytlar yine parmağı takip eder.

  // Nokta, ok, parmak ve klavye aynı fade geçişinden geçsin diye tek kapı: goTo.
  const goTo = useCallback(
    (target: number) => {
      if (heroShows.length < 2) return;
      setHeroIndex(((target % heroShows.length) + heroShows.length) % heroShows.length);
    },
    [heroShows.length],
  );
  const goNext = useCallback(() => goTo(safeIndex + 1), [goTo, safeIndex]);
  const goPrev = useCallback(() => goTo(safeIndex - 1), [goTo, safeIndex]);

  // Otomatik dönüş: her slayt ekranda kalır. Sonanime'de video oynarken de
  // dönüş devam ediyor; bu yüzden burada SADECE sürükleme durdurur.
  useEffect(() => {
    if (heroShows.length < 2 || heroDragging) return;
    const timer = window.setTimeout(goNext, HERO_AUTO_MS);
    return () => window.clearTimeout(timer);
  }, [heroShows.length, heroDragging, goNext]);

  // Vitrin ekrandayken ←/→ tuşları slaytı çevirir (metin alanlarında devre dışı).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      const rect = heroRef.current?.getBoundingClientRect();
      if (!rect || rect.bottom < 80 || rect.top > window.innerHeight) return;
      event.preventDefault();
      if (event.key === "ArrowLeft") goPrev();
      else goNext();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, goPrev]);

  /** Sürükleme bırakıldığında slayt değişsin diye gereken eşik (hero genişliğinin %'si). */
  const DRAG_THRESHOLD = 10;

  /**
   * Bırakma sonrası "oturma" süresi (ms). anikoto.cz'deki akıcı his için:
   * parmak/fare bırakılınca slayt ANİDEN zıplamaz, kısa bir yavaşlamayla
   * hedefine kayar. (Animasyon kare kare rAF ile yürütülür; CSS geçişiyle
   * değil, çünkü sürükleme sırasında geçişler bilerek kapatılıyor.)
   */
  const SETTLE_MS = 280;

  /** Fırlatma eşiği: bırakma anındaki hız (yüzde/ms). Hızlı bir savurma, kayma
   *  eşiği geçilmemiş olsa bile slaytı ilerletir. */
  const FLING_VELOCITY = 0.25;

  /** Sürükleme ile tıklamayı ayıran küçük kayma toleransı (px). */
  const CLICK_SLOP = 4;

  /** Bırakma hızını hesaplamak için tutulan son fare örnekleri. */
  const dragSamples = useRef<{ x: number; t: number }[]>([]);
  /** Pointer gerçekten kaydı mı: kaydırma sonrası tıklamayı bastırmak için. */
  const dragMoved = useRef(false);
  /** Oturma animasyonunun rAF tanıtıcısı (yeni sürüklemede iptal edilir). */
  const settleRaf = useRef<number | null>(null);

  /**
   * Sürükleme başlarken BİR KEZ ölçülen vitrin genişliği (px).
   * NEDEN ÖNBELLEK (kullanıcı bildirimi, 30.09.2026 — "mouse ile sağa sola
   * çevirirken aşırı takılmalarla ilerliyor"):
   * `dragPercent` içinde `getBoundingClientRect()` çağırmak, HER fare hareketinde
   * tarayıcıyı ZORUNLU yerleşim hesabına sokar. Üstelik aynı karede slaytlara
   * transform yazdığımız için okuma↔yazma iç içe geçer ve tarayıcı her harekette
   * yeniden yerleşim yapar → sürükleme akıcı değil, TAKILARAK ilerler.
   * Referans sitede de (sonanime.com bundle'ı ölçüldü) genişlik tutuş anında bir kez
   * ölçülüp kullanılıyor: `(clientX - startX) / width * 100`.
   */
  const dragWidth = useRef(0);

  /** Fare/parmağın hero genişliğine göre yatay kayması (yüzde). */
  function dragPercent(clientX: number) {
    const width = dragWidth.current || 1;
    return ((clientX - (dragStart.current?.x ?? clientX)) / width) * 100;
  }

  /** Bekleyen oturma animasyonunu durdurur (yeni sürükleme onu geçersiz kılar). */
  function stopSettle() {
    if (settleRaf.current !== null) {
      window.cancelAnimationFrame(settleRaf.current);
      settleRaf.current = null;
    }
  }

  /**
   * Yumuşak oturma: dragX'i `from`dan `to`ya ease-out ile taşır, bitince `done`.
   * Yalnızca "hareket azaltma" İSTENMEDİĞİNDE çağrılır (bkz. onHeroPointerUp).
   */
  function runSettle(from: number, to: number, done: () => void) {
    stopSettle();
    const startedAt = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / SETTLE_MS);
      // ease-out cubic: hızlı başlar, sona doğru süzülür (momentum hissi).
      const eased = 1 - Math.pow(1 - t, 3);
      setDragX(from + (to - from) * eased);
      if (t < 1) {
        settleRaf.current = window.requestAnimationFrame(step);
      } else {
        settleRaf.current = null;
        done();
      }
    };
    settleRaf.current = window.requestAnimationFrame(step);
  }

  /** Bırakma anındaki hız: son ~80 ms'lik örneklerden yüzde/ms cinsinden. */
  function dragVelocity() {
    const samples = dragSamples.current;
    const last = samples[samples.length - 1];
    const initial = samples[0];
    if (samples.length < 2 || !last || !initial) return 0;
    let first = initial;
    for (let i = samples.length - 2; i >= 0; i -= 1) {
      const sample = samples[i];
      if (!sample) continue;
      if (last.t - sample.t <= 80) first = sample;
      else break;
    }
    const dt = last.t - first.t;
    if (dt <= 0) return 0;
    const width = heroRef.current?.getBoundingClientRect().width ?? 1;
    return (((last.x - first.x) / width) * 100) / dt;
  }

  function onHeroPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (heroShows.length < 2) return;
    // Bağlantı ve butonlar kendi tıklamasını alsın: sürükleme görselin üstünde başlar.
    const target = event.target as HTMLElement | null;
    if (target?.closest("a, button")) return;
    // Sürerken yeni bir tutuş: bekleyen oturma animasyonu iptal edilir ki
    // eski animasyon yeni sürüklemeyle çakışıp slaytı titretmesin.
    stopSettle();
    dragStart.current = { x: event.clientX, y: event.clientY };
    dragSamples.current = [{ x: event.clientX, t: event.timeStamp }];
    dragMoved.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    // Genişlik BURADA, bir kez ölçülür: sürükleme boyunca `getBoundingClientRect()`
    // çağrılmaz (her çağrı zorunlu yerleşim hesabı = takılma — bkz. `dragWidth`).
    dragWidth.current = heroRef.current?.getBoundingClientRect().width ?? 0;
    setHeroDragging(true);
    // `setDragX(0)` YOK: sürükleme artık React state'i kullanmıyor (bkz.
    // `writeDragStyles`). Böylece tutuş anında tam sayfa yeniden çizilmez.
    dragPercentRef.current = 0;
    writeDragStyles(0);
    hideMediaForDrag();
  }

  function onHeroPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const start = dragStart.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // Dokunmatikte dikey hareket sayfa kaydırmadır: sürüklemeyi bırak.
    // Farede böyle bir çakışma yok; dikey titreme sürüklemeyi iptal etmemeli,
    // çünkü iptal edilince el (grabbing) imleci de bir anda kayboluyordu.
    if (event.pointerType !== "mouse" && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 24) {
      dragStart.current = null;
      dragMoved.current = false;
      setHeroDragging(false);
      setDragX(null);
      return;
    }
    // Tolerans aşıldıysa bu artık tıklama değil sürüklemedir (tıklama bastırılır).
    if (!dragMoved.current && Math.hypot(dx, dy) > CLICK_SLOP) dragMoved.current = true;
    const samples = dragSamples.current;
    samples.push({ x: event.clientX, t: event.timeStamp });
    if (samples.length > 8) samples.shift();
    // 1:1 takip: içerik imlecin tam altında kalır (yüzde = hero genişliğine göre).
    // React'e gidilmez; doğrudan DOM'a yazılır (bkz. `writeDragStyles`).
    scheduleDragWrite(Math.max(-100, Math.min(100, dragPercent(event.clientX))));
  }

  function onHeroPointerUp() {
    const start = dragStart.current;
    dragStart.current = null;
    // Bekleyen kare iptal edilir: bırakıştan SONRA eski bir yüzde yazıp oturma
    // animasyonunu bozmasın. En taze değer tampondan okunur (state gecikmiş olabilir).
    if (dragFrame.current !== null) {
      window.cancelAnimationFrame(dragFrame.current);
      dragFrame.current = null;
    }
    // Sürükleme artık React state'i tutmadığı için en taze yüzde ref'ten okunur.
    const shift = dragPercentRef.current ?? 0;
    const velocity = dragVelocity();
    const moved = dragMoved.current;
    // Hareket azaltma istenmişse ya da gerçek bir kayma olmadıysa momentum
    // ATLANIR ve eski davranış aynen korunur: anında otur, eşik geçildiyse
    // slayt değişir. (Azaltılmış hareket tercihi burada da gözetilir.)
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!moved || reduceMotion) {
      // Doğrudan yazılan sürükleme stilleri geri alınır (React bunları hiç bilmiyor).
      clearDragStyles();
      setHeroDragging(false);
      setDragX(null);
      if (!start || Math.abs(shift) < DRAG_THRESHOLD) return;
      if (shift < 0) goNext();
      else goPrev();
      return;
    }
    const direction =
      Math.abs(shift) >= DRAG_THRESHOLD ? (shift < 0 ? -1 : 1) : velocity < 0 ? -1 : 1;
    const advance = Math.abs(shift) >= DRAG_THRESHOLD || Math.abs(velocity) >= FLING_VELOCITY;
    if (advance) {
      // Eşik ya da fırlatma hızı aşıldı: komşu slayt yumuşakça tam ekrana
      // oturur, bitince slayt değişir (goTo kapısı; nokta/ok/klavye ile aynı).
      runSettle(shift, direction * 100, () => {
        /**
         * GEÇİŞ SIRASI — referans sitede ÖLÇÜLEN sıra (sonanime.com bundle):
         *   1) slaytları SNAP et (animasyonsuz, hedef görünürlük + z-index),
         *   2) indeksi değiştir,
         *   3) satır içi stilleri **ÇİFT rAF** sonra temizle.
         *
         * NEDEN ÇİFT rAF: aynı karede temizlersek tarayıcı stil değişimini
         * birleştirir ve CSS geçişini (1,2 sn) ATLAR — kullanıcının bildirdiği
         * "her geçişte bir şey açılıp kapanıyor" görüntüsü tam olarak buydu.
         * Çift rAF, yerleşim oturduktan sonra temizlik yapıp geçişin gerçekten
         * oynamasını sağlar.
         */
        const total = heroShows.length;
        const target = direction < 0 ? (safeIndex + 1) % total : (safeIndex - 1 + total) % total;
        for (const [index, element] of slideEls.current) {
          if (!element) continue;
          element.style.transition = "none";
          element.style.transform = "";
          if (index === target) {
            element.style.opacity = "1";
            element.style.visibility = "visible";
            element.style.zIndex = "1";
          } else {
            element.style.opacity = "0";
            element.style.visibility = "hidden";
            element.style.zIndex = "0";
          }
        }
        setDragX(null);
        setHeroDragging(false);
        if (direction < 0) goNext();
        else goPrev();
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => clearDragStyles());
        });
      });
      return;
    }
    // Eşik altı: slayt bulunduğu yere süzülerek geri döner.
    runSettle(shift, 0, () => {
      setDragX(null);
      clearDragStyles();
      setHeroDragging(false);
    });
  }

  function onHeroPointerCancel() {
    stopSettle();
    dragStart.current = null;
    dragMoved.current = false;
    clearDragStyles();
    setHeroDragging(false);
    setDragX(null);
  }

  /**
   * Kaydırmadan sonra gelen tıklamayı bastırır: fareyle hero'yu sürüklerken
   * altındaki bağlantının yanlışlıkla açılmasını engeller. Yalnızca gerçek
   * kaymada (dragMoved) devreye girer; sade tıklama etkilenmez.
   */
  function onHeroClickCapture(event: ReactMouseEvent<HTMLElement>) {
    if (!dragMoved.current) return;
    dragMoved.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  // Sürükleme sırasında aktif slayt parmağı takip eder, komşu slayt kenardan girer.
  function backdropDragStyle(index: number): CSSProperties | undefined {
    if (dragX === null || heroShows.length < 2) return undefined;
    const total = heroShows.length;
    const prev = (safeIndex - 1 + total) % total;
    const next = (safeIndex + 1) % total;
    // DİKKAT: slaytlar normalde `visibility: hidden` (CSS). Sürükleme sırasında
    // komşu slaytın görünmesi için burada açıkça `visible` yapılmalı; yoksa
    // parmakla kaydırınca aktif slayt çekilir ve yerinde SİYAH kalır.
    if (index === safeIndex) {
      return {
        transform: `translateX(${dragX}%)`,
        opacity: 1,
        visibility: "visible",
        transition: "none",
      };
    }
    if (dragX > 0 && index === prev) {
      return {
        transform: `translateX(${dragX - 100}%)`,
        opacity: 1,
        visibility: "visible",
        transition: "none",
      };
    }
    if (dragX < 0 && index === next) {
      return {
        transform: `translateX(${dragX + 100}%)`,
        opacity: 1,
        visibility: "visible",
        transition: "none",
      };
    }
    // Sürüklenmeyen komşular kendi hâlinde (gizli) kalır.
    return { transition: "none" };
  }

  // Not: içerik artık slaytın İÇİNDE olduğu için ayrı bir sürükleme stiline gerek
  // yok; slaytın kendi `translateX`'i yazıyı da birlikte taşıyor.

  // NOT: `genreOptions` (serilerin kendi `genre` alanından türetilen çip listesi)
  // KULLANICI İSTEĞİYLE SİLİNEN GENRES çip şeridiyle birlikte KALDIRILDI: çipleri
  // tek tüketen yer o şeritti. Tür süzme zinciri (`genre` → `filtered`) korunur;
  // sıralama/büyük-küçük harf yardımcılarına (`localeCompare`) bu yüzden gerek yok.

  // Arama/tür süzmesi: sonuç useMemo ile hatırlanır. Vitrin durumu (slayt,
  // sürükleme, video) değiştiğinde aynı sorgu baştan hesaplanmaz; sonuç ve
  // zamanlama AYNI kalır, sadece gereksiz tekrar önlenir. Harf çipleri (AzList)
  // ayrı devredir, bu değişiklikten etkilenmez.
  const filtered = useMemo(() => {
    const needle = query.toLocaleLowerCase("tr");
    return shows.filter((show) => {
      const matchesQuery = show.title.toLocaleLowerCase("tr").includes(needle);
      const matchesGenre =
        genre === ALL_GENRES ||
        (show.genre ?? "")
          .split(",")
          .map((part) => part.trim())
          .includes(genre);
      return matchesQuery && matchesGenre;
    });
  }, [shows, query, genre]);

  const isFiltering = query.trim().length > 0 || genre !== ALL_GENRES;

  return (
    <div className="min-h-screen bg-background">
      <main id="top">
        <section
          ref={heroRef}
          aria-label={t("home.heroAria")}
          // `hero-lite`: zayıf cihazda sürekli çalışan zoom (Ken Burns) kapanır —
          // CSS'te tek kural var, güçlü cihazı etkilemez (bkz. styles.css).
          className={`hero-section ${heroDragging ? "hero-dragging is-dragging" : ""} ${
            weakDevice ? "hero-lite" : ""
          }`}
          onPointerDown={onHeroPointerDown}
          onPointerMove={onHeroPointerMove}
          onPointerUp={onHeroPointerUp}
          onPointerCancel={onHeroPointerCancel}
          // Kaydırma sonrası tıklamayı bastır (yakalama aşamasında).
          onClickCapture={onHeroClickCapture}
        >
          {/* Sayfanın tek h1'i: vitrindeki seri başlıkları h1 değil, vitrin
              içeriği olduğu için h1 kirliliği yapmaz. */}
          <h1 className="sr-only">{t("home.heroSrTitle")}</h1>
          {heroShows.map((show, index) => {
            const key = show.slug ?? show.title;
            // Dikey kapak hero'da kırpılıyor: önce geniş header, dosya yoksa kapak.
            // Öncelik: admin'den yüklenen vitrin banner'ı → statik header → kapak.
            const backdrop = brokenBackdrops[key]
              ? show.image
              : show.banner_image || heroBackdrop(show.slug, show.image);
            const uploaded =
              "banner_video" in show && show.banner_video ? show.banner_video : undefined;
            const videoUrl = brokenVideos[key] ? undefined : uploaded || heroVideo(show.slug);
            // Dosya mı, gömülü link mi? (YouTube/Vimeo linki `<video src>`e konamaz,
            // `<iframe>` ile gömülür — bkz. `lib/hero-video.ts`.)
            const videoSource = heroVideoSource(videoUrl);
            const active = index === safeIndex;
            const slideHasVideo = Boolean(videoUrl) && allowVideo && !brokenVideos[key];
            // Aktif slayt: 6 sn sonra video girer.
            // Çıkan slayt: fade bitene kadar videosu takılı kalsın (videoVisibleKey
            // ile işaretli); yoksa geçiş anında video kaybolup eski fotoğraf görünür.
            const videoActive =
              slideHasVideo && ((active && videoArmed) || videoVisibleKey === key);
            // Yazı, video GERÇEKTEN oynamaya başlayınca kapanır. Çıkan slaytta ise
            // fade bitene kadar kapalı kalır; yoksa fade sırasında yazı yeniden
            // açılıp görüntü bozuluyor.
            const contentCollapsed =
              slideHasVideo && (active ? videoPhase === "playing" : videoVisibleKey === key);
            return (
              <div
                key={key}
                aria-hidden={!active}
                style={backdropDragStyle(index)}
                // Sürükleme sırasında transform bu düğüme DOĞRUDAN yazılır
                // (React'e uğramadan) — bkz. `writeDragStyles`.
                ref={(element) => {
                  if (element) slideEls.current.set(index, element);
                  else slideEls.current.delete(index);
                }}
                className={`hero-slide ${active ? "active" : ""}`}
              >
                {/* Telefonda DİKEY kapak, masaüstünde geniş banner kullanılır.
                    16:9 banner portre kutuya sığdırılınca görüntünün yalnızca
                    ~%39'u görünüyor ve karakter kadrajın dışında kalıyordu
                    (kullanıcı geri bildirimi: "vitrindeki resmin sadece yarısı
                    görünüyor"). 2:3 dikey kapağın neredeyse tamamı görünür.
                    <picture> sayesinde tarayıcı yalnızca eşleşen kaynağı indirir. */}
                <picture className="hero-picture">
                  <source media="(max-width: 767px)" srcSet={show.image} />
                  <img
                    src={backdrop}
                    alt={active ? t("home.slideScene", { title: show.title }) : ""}
                    width={1536}
                    height={864}
                    loading={index === 0 ? "eager" : "lazy"}
                    fetchPriority={index === 0 ? "high" : "low"}
                    decoding="async"
                    draggable={false}
                    onError={() => setBrokenBackdrops((map) => ({ ...map, [key]: true }))}
                    className="hero-image"
                  />
                </picture>
                {/* Video, görselin üstüne biner; oynamaya başlayınca yumuşakça görünür.
                    Gömülü kaynakta (YouTube/Vimeo) `<iframe>` çizilir: dosya yoktur,
                    ama depolama ve trafik de yoktur (kullanıcı isteği 30.09.2026).

                    `pointerEvents: none` ŞART: iframe fare/parmak olaylarını yutarsa
                    vitrinin sürükleme geçişi ve "Şimdi izle / Seri detayı" düğmeleri
                    çalışmaz. Ölçek/maskeyi `.hero-video` sınıfından alır, bu yüzden
                    CSS'e dokunulmadı; yalnızca zorunlu satır içi stiller verildi. */}
                {/*
                  GÖMÜLÜ KAYNAK, GEÇİŞ BİTTİKTEN SONRA yüklenir (`videoActive`).
                  ÖLÇÜM/NEDEN: oynatıcıyı slayt aktif olur olmaz yükletmek (önceki
                  deneme) geçişle ÇAKIŞIYORDU — YouTube oynatıcısının kurulumu ağır
                  bir iş ve geçişin transform animasyonuyla aynı anda çalışınca
                  "geçişlerde aşırı kasma" oluşuyordu (kullanıcı bildirimi,
                  30.09.2026). Artık kompozisyon sırası şöyle: geçiş (fotoğraf) →
                  6 sn bekleme → oynatıcı gizliyken kurulur → kumandaları gizlenince
                  perde açılır. Böylece hem geçiş akıcı kalır hem kumandalar görünmez.
                */}
                {videoActive && videoSource.kind === "embed" && (
                  <iframe
                    className={`hero-video ${videoVisibleKey === key ? "is-visible" : ""}`}
                    src={videoSource.embedUrl}
                    title={`${show.title} — vitrin videosu`}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    referrerPolicy="origin"
                    tabIndex={-1}
                    aria-hidden="true"
                    /*
                      KAPLAMA (cover) — iframe'de `object-fit` ÇALIŞMAZ.
                      NEDEN: `.hero-video` sınıfı `object-fit: cover` kullanıyor ama o
                      kural yalnızca `<video>/<img>` gibi "yerine geçen" öğeler içindir;
                      `<iframe>` içeriği kendi 16:9 kutusunu korur. Sonuç: 2,8:1'lik
                      vitrin bandında video ortada kalıp YANLARDA SİYAH BANT bırakıyordu
                      (kullanıcı bildirimi, 30.09.2026).

                      ÇÖZÜM: iframe bandın TAM GENİŞLİĞİNDE ve 16:9 yüksekliğinde
                      ölçeklenir (yani kaptan daha uzun olur), ortalanır ve `.hero-slide`
                      taşanı kırpar → video bandı doldurur. Yan fayda: YouTube'un sağ alt
                      köşedeki logosu ve üstteki başlık şeridi, kırpılan alanda kalır —
                      kullanıcının "alta kocaman YouTube yazıyor" şikâyeti bu yüzden
                      kendiliğinden kaybolur. `.hero-video`'nun opacity geçişi korunur
                      (opacity satır içi stilde EZİLMEZ).
                    */
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      right: "auto",
                      bottom: "auto",
                      transform: "translate(-50%, -50%)",
                      width: "100%",
                      height: "auto",
                      aspectRatio: "16 / 9",
                      border: 0,
                      pointerEvents: "none",
                    }}
                    onError={() => setBrokenVideos((map) => ({ ...map, [key]: true }))}
                  />
                )}
                {videoActive && videoSource.kind !== "embed" && (
                  <video
                    className={`hero-video ${videoVisibleKey === key ? "is-visible" : ""}`}
                    src={videoUrl}
                    muted
                    loop
                    playsInline
                    autoPlay
                    preload="metadata"
                    tabIndex={-1}
                    aria-hidden="true"
                    onPlaying={() => {
                      // Görünürlük + yazının kapanması aynı anda tetiklenir.
                      setVideoVisibleKey(key);
                      setVideoPhase("playing");
                    }}
                    onError={() => {
                      setBrokenVideos((map) => ({ ...map, [key]: true }));
                      setVideoVisibleKey((k) => (k === key ? null : k));
                    }}
                  />
                )}
                {/* Karartma: soldan yatay + alttan yumuşak geçiş (sert çizgi yok).
                    Slaytın İÇİNDE: böylece karartma da yazıyla birlikte soluyor. */}
                <div className="hero-gradient pointer-events-none" />
                {/* YAZI SLAYTIN İÇİNDE — kritik nokta bu. Eskiden içerik slaytların
                    kardeşiydi ve slayt değişiminde anında değişiyordu; resim 1.2 sn
                    solarken yeni yazı eski sahnenin üstünde beliriyordu. Artık
                    slaytın parçası olduğu için resimle AYNI anda soluyor. */}
                <div className={`hero-content ${contentCollapsed ? "is-video-playing" : ""}`}>
                  <span className="hero-featured-badge">{t("home.heroBadge")}</span>
                  <ShowLogo slug={show.slug} title={show.title} className="hero-logo" />
                  <div className="hero-details">
                    <div className="hero-details-inner">
                      {/* sonanime'deki "yıl · bölüm sayısı" satırının karşılığı. */}
                      <div className="hero-meta">
                        {show.year && <span>{show.year}</span>}
                        {show.id && show.episode_count > 0 && (
                          <span>
                            {plural(
                              t,
                              show.episode_count,
                              "home.episodeCountOne",
                              "home.episodeCount",
                            )}
                          </span>
                        )}
                      </div>
                      {show.genre && (
                        <div className="hero-genres">
                          {show.genre
                            .split(",")
                            .map((part) => part.trim())
                            .filter(Boolean)
                            .slice(0, 4)
                            .map((genreName) => (
                              <span key={genreName} className="hero-genre-chip">
                                {genreName}
                              </span>
                            ))}
                        </div>
                      )}
                      {/* show.genre ve show.description veritabanı içeriğidir
                          (tür adları, açıklama) — bilerek ÇEVRİLMEZ; içerik
                          çevirisi ayrı bir iş. */}
                      <p className="hero-description">{show.description}</p>
                    </div>
                  </div>
                  {/* VİTRİN ÇAĞRILARI — istemci içi gezinme (`Link`). ÖNDEN ÇEKME
                      (preload) BURADA DA KAPALI: vitrinde her slaytın düğmeleri
                      DOM'da durur (gizli slaytlarınki `visibility: hidden`),
                      dolayısıyla hover'ı tıklama tahmini saymak güvenilir değil.
                      `/anime/$slug` hedefi hover başına 4 tablo okuması yapar
                      (bkz. RankedRow notu), izleme hedefinde ise rota
                      yükleyicisi YOK — yani önden çekmenin kazancı ölçülemez,
                      riski ise gerçek. Tek satır gezinme yine anındadır. */}
                  <div className="flex flex-wrap items-center gap-4">
                    {show.id ? (
                      /* Vitrin kartında sezon/bölüm bilgisi YOK; izleme yolu
                          parametresiz olamadığı için 1/1 verilir. İzleme sayfası bu
                          değerleri bulamazsa KENDİ "ilk oynatılabilir sezon/bölüm"
                          mantığına düşer — yani eskiden parametresiz izleme adresiyle
                          açılan bölümün AYNISI oynar. */
                      <Link
                        to="/anime/$slug/season/$season/episode/$episode"
                        params={{ slug: showSlug(show), season: "1", episode: "1" }}
                        preload={false}
                        className="home-cta-pill"
                      >
                        <Play size={17} fill="currentColor" /> {t("common.watchNow")}
                      </Link>
                    ) : (
                      <a href="#series" className="home-cta-pill">
                        <Play size={17} fill="currentColor" /> {t("common.watchNow")}
                      </a>
                    )}
                    {show.id ? (
                      <Link
                        to="/anime/$slug"
                        params={{ slug: showSlug(show) }}
                        preload={false}
                        className="ui-hover rounded-full border border-border bg-secondary px-5 py-3 text-sm font-bold text-foreground hover:border-accent hover:text-accent"
                      >
                        {t("common.seriesDetails")}
                      </Link>
                    ) : (
                      <a
                        href="#series"
                        className="ui-hover rounded-full border border-border bg-secondary px-5 py-3 text-sm font-bold text-foreground hover:border-accent hover:text-accent"
                      >
                        {t("common.seriesDetails")}
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {heroShows.length > 1 && (
            <>
              <button
                type="button"
                aria-label={t("home.prevSeries")}
                onClick={goPrev}
                className="hero-nav hero-nav-prev"
              >
                <ChevronLeft size={24} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={t("home.nextSeries")}
                onClick={goNext}
                className="hero-nav hero-nav-next"
              >
                <ChevronRight size={24} aria-hidden="true" />
              </button>
            </>
          )}

          {/* Slayt göstergeleri: alt ortada; aktif olan pembe çizgi, diğerleri nokta. */}
          {heroShows.length > 1 && (
            <div
              // Mobilde aralik genis: noktalarin dokunma alanlari (padding ile
              // buyutulmus) 8px aralikta ust uste biniyordu ve yanlis slayta
              // gidiliyordu. Masaustunde aralik eskisi gibi 8px kaliyor.
              className="absolute bottom-[30px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-7 md:gap-2"
              role="tablist"
              aria-label={t("home.slideSelect")}
            >
              {heroShows.map((s, i) => (
                <button
                  key={s.slug}
                  type="button"
                  role="tab"
                  aria-selected={i === safeIndex}
                  aria-label={t("home.goToSlide", { title: s.title })}
                  onClick={() => goTo(i)}
                  className={`hero-dot ${i === safeIndex ? "active" : ""}`}
                />
              ))}
            </div>
          )}
        </section>

        {/* REFERANS 2 (hero altı, blueprint §0/§2): iki kolonlu alan — solda geniş
            ANA KOLON, sağda DAR KENAR ÇUBUĞU. Ana kolonun sırası blueprint'in
            `aside.main` çocuk sırasıdır:
              2.1 duyuru şeridi (VERİ YOK → not), 2.2 sabitlenmiş duyuru (not),
              2.3 PAYLAŞIM SATIRI (KALDIRILDI — kullanıcı isteği),
              2.4 "Kaldığın yerden devam et", 2.5 "Latest Episode",
              2.6 "Upcoming Anime" (AniList verisi), 2.8 "Estimated Schedule"
              (AniList verisi).
            Sağ kenar çubuğu: TOP TRENDING (DOKUNULMADI) + "Discussion" (VERİ YOK
            → not). Bölümler kendi verisine bakar; veri yoksa başlığıyla birlikte
            hiç çizilmez.
            NOT: 2.7 üç kolonlu kompakt bant (`HomeCompactBand`) KULLANICI
            İSTEĞİYLE bu alanın DIŞINA çıkarıldı: ana içeriğin EN SONUNDA,
            footer'ın hemen üstünde ve "Bu sezon" bölümünün hemen altında çizilir
            (bkz. `Index()` sonundaki yerleşim). */}
        <MemoHomeSections
          shows={dbShows ?? EMPTY_SHOWS}
          continueItems={continueItems}
          onContinueRemove={handleContinueRemove}
        />

        {/* ══ REFERANSTA KARŞILIĞI OLMAYAN BÖLÜMLER (biri silindi, biri TAŞINDI) ══
            Aşağıdaki bölümler referansta YOKTUR. Tür çip şeridi KULLANICI
            İSTEĞİYLE SİLİNDİ (bkz. (a) notu); (başlığı yeniden adlandırılan)
            "Bu sezon" ızgarası ise kullanıcı isteğiyle silinmedi, A-Z footer'a
            taşındıktan sonra ana içeriğin sonuna alındı. (Blueprint §4'te A-Z
            `FOOTER > DIV.container > DIV.azlist` olduğu için A-Z artık footer'ın
            içindedir.) KULLANICI İSTEĞİYLE "Bu sezon" bölümü artık en altta, üç
            kolonlu bandın hemen üstünde durur; bant ise footer'ın hemen
            öncesindedir. */}

        {/* (a) GENRES ÇİP ŞERİDİ — KULLANICI İSTEĞİYLE TÜMÜYLE SİLİNDİ.
            Silinen blok: `id="genres"` taşıyan tek satırlık şerit — "TÜRLER"
            etiketi + All/Aksiyon/Başka Dünya/…/Shounen çipleri ve `pickGenre`
            işleyicisi. Şerit, referansta karşılığı olmayan bir bölümdü; ondan
            önce de çipleri İKİNCİ kez çizen büyük "Türlere göre keşfet" paneli
            silinmişti. Onunla birlikte artık hiçbir yerde kullanılmayan
            `genreOptions` listesi, `hasGenreStrip` kapısı ve `pickGenre` de
            kaldırıldı; yalnızca şeride ait `home.genresTag` / `home.genresAria`
            / `common.all` sözlük anahtarları düşürüldü.
            `id="genres"` ARTIK YOK: ona giden üç bağlantı ölü kalmasın diye
            `#series` (seri ızgarası) hedefine yönlendirildi — header'daki
            "Keşfet" düğmesi, footer'daki "Türler" bağlantısı ve
            `src/routes/__root.tsx` içindeki `/#genres` bağlantısı.
            Buraya başka bir blok KONMADI; altında reklam alanı eskisi gibi
            durur. */}

        {adHome.isFetched && adHome.code ? (
          <AdSlot slot="ad_home" className="flex justify-center" />
        ) : (
          <AdsterraLeaderboard />
        )}

        {/* SİLİNEN BLOK: büyük "Türlere göre keşfet" paneli (eyebrow `home.genreTag`,
             başlık `home.genreHeading`, açıklama `home.genreIntro` ve İKİNCİ tür çip
             satırı). KULLANICI GERİ BİLDİRİMİ: aynı çipler sayfada iki kez çiziliyordu
             (yukarıdaki tek satırlık şerit + bu panel) ve bu tekrar gereksizdi; panel
             bu yüzden tümüyle kaldırıldı, ardından KULLANICI İSTEĞİYLE kalan tek
             satırlık GENRES çip şeridi de silindi (bkz. yukarıdaki (a) notu). Buraya
             başka bir blok KONMADI. Panelle birlikte yalnızca ONA ÖZEL üç sözlük
             anahtarı da sözlükten düşürülmüştü. */}

        {/* "Bu sezon" bölümü + #series ızgarası. KULLANICI İSTEĞİ: bölüm, üç
             kolonlu bandın HEMEN ÜSTÜNE taşındı. Başlık DÜZELTİLDİ: bir önceki
             oturumda başlık referansın "Upcoming Anime" ifadesine çevrilmişti,
             fakat o ad artık ANA KOLONDAKİ GERÇEK upcoming bölümüne ait
             (bkz. `UpcomingSection`, blueprint §2.6, AniList verisiyle dolduruldu).
             Sayfada iki aynı başlık kalmasın ve header/footer'daki "Bu sezon"
             bağlantıları (`#season`) hedefledikleri bölümle uyuşsun diye başlık
             kendi adına döndü: `common.thisSeason` → TR "Bu sezon" / EN
             "This season". Başlık, eyebrow ("Yeni seçkiler"), kartlar, `#series`
             ızgarası ve "Tümünü gör" bağlantısı DIŞINDA hiçbir şey DEĞİŞMEDİ;
             veri kaynağı da aynıdır. Kap, başlık ölçeği ve bölüm boşlukları hero
             altındaki bölümlerle AYNI (kap 1800 px / 10 px, başlık 27 px / 600,
             bölümler arası 40 px). */}
        <section id="season" className={`${PAGE_CONTAINER} py-10`}>
          <div className={`flex items-end justify-between ${HEAD_GAP_ROW}`}>
            <div>
              <p className="text-[15px] font-semibold text-primary">{t("home.seasonTag")}</p>
              <h2 className={`mt-1 ${HEAD_ROW}`}>{t("common.thisSeason")}</h2>
            </div>
            <a
              href="#series"
              className="group link-hover ui-hover flex items-center gap-2 text-[15px] font-semibold"
            >
              {t("common.seeAll")}{" "}
              <ArrowRight size={17} className="transition-transform group-hover:translate-x-1" />
            </a>
          </div>
          {/* Kartlar ana keşif ızgarasıyla AYNI KART ÖLÇÜSÜNÜ kullanır (20 px
              boşluk, referans kartı: 1552 px'te 174 px). Bu bölüm kabın TAM
              genişliğinde (1552'de 1532 px) durduğu için sabit 6 sütun kartı
              238.66 px'e çıkarıyordu — referanstan ~%37 büyük poster. Bu yüzden
              burada kart genişliği sınırlı düzen kullanılır; sütun sayısı
              sığdığı kadar artar (1552'de 8 sütun × 174 px). */}
          <div id="series" className={DISCOVERY_GRID_CAPPED}>
            {/* Kart artık ORTAK bileşen (`SeriesCard`): A-Z bölümü de aynı kartı
                çizdiği için işaretlemeyi burada satır içi tutmak zamanla sapmaya
                yol açardı. Süzme davranışı (arama/tür) ve `#series` kimliği
                DEĞİŞMEDİ; önden çekme kapalı (kota/egress gerekçesi: SeriesCard
                notu). */}
            {(isFiltering ? filtered : shows).map((show) => (
              <MemoSeriesCard key={show.slug ?? show.title} show={show} />
            ))}
          </div>
          {isFiltering && filtered.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-muted-foreground">{t("home.noFilterMatch")}</p>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setGenre(ALL_GENRES);
                }}
                className="ui-hover mt-4 rounded-full border border-border px-5 py-2 text-sm font-bold text-foreground hover:border-accent hover:text-accent"
              >
                {t("home.clearFilter")}
              </button>
            </div>
          )}
        </section>

        {/* ── ÜÇ KOLONLU KOMPAKT BANT — ANA İÇERİĞİN EN SONUNDA ────────────────
            KULLANICI İSTEĞİ: bant "en altta" durmalı; bu yüzden ana kolonun
            içinden çıkarılıp ana içeriğin SONUNA, footer'ın hemen üstüne ve
            "Bu sezon" bölümünün hemen altına alındı. Burada tam kap genişliğinde
            (`PAGE_CONTAINER`) durur; içeriği, üç kolonu, veri kaynağı ve
            başlıkları DEĞİŞMEDİ. */}
        <div className={`${PAGE_CONTAINER} py-10`}>
          <MemoHomeCompactBand shows={dbShows ?? EMPTY_SHOWS} />
        </div>
      </main>

      <footer className="border-t border-border bg-secondary text-foreground">
        {/* ── REFERANS 4: A-Z LİSTESİ — FOOTER'IN İLK BLOĞU ────────────────────
            Blueprint §4: referansta A-Z listesi ANA KOLONDA DEĞİL, footer'ın
            içindedir (`FOOTER > DIV.container > DIV.azlist`); başlığı
            "A-Z List", alt açıklaması "Searching anime order by alphabet name A
            to Z." ve altında `All # 0-9 A B C … Z` (toplam 29 çip) harf çip
            satırı bulunur. Bu yüzden bölüm main'in içinden ÇIKARILIP footer'ın
            başına taşındı. Çipler ve istemci içi süzme DAVRANIŞI DEĞİŞMEDİ;
            yeni sorgu yok (liste zaten yüklü `shows`). */}

        <MemoAzList shows={shows} />

        {/* Footer de aynı kabı kullanır: içerikle aynı hizada başlar. */}
        <div className={`${PAGE_CONTAINER} grid gap-10 py-12 md:grid-cols-2`}>
          <div>
            <p className="font-display text-2xl">
              <img
                src={BRAND_LOGO_SRC}
                alt={t("common.logoAlt")}
                width={BRAND_LOGO_WIDTH}
                height={BRAND_LOGO_HEIGHT}
                loading="lazy"
                decoding="async"
                className="h-12 w-auto object-contain"
              />
              <span className="sr-only">shanime</span>
            </p>
            <p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">
              {t("footer.tagline")}
            </p>
          </div>
          <div>
            <p className="text-sm font-extrabold">{t("footer.explore")}</p>
            <div className="mt-4 flex flex-col gap-1 text-sm text-muted-foreground">
              {/* py-2: dokunmatikte en az ~36 px yükseklik (eskiden 20 px idi). */}
              <a href="#season" className="link-hover w-fit py-2">
                {t("common.thisSeason")}
              </a>
              <a href="#series" className="link-hover w-fit py-2">
                {t("footer.allSeries")}
              </a>
              {/* HEDEF YENİDEN YÖNLENDİRİLDİ: GENRES çip şeridi (ve onunla gelen
                  `id="genres"`) KULLANICI İSTEĞİYLE SİLİNDİĞİ için bu bağlantı
                  ölü kalmasın diye `#genres` yerine `#series` (seri ızgarası)
                  hedefine bağlandı. Etiket ("Türler"/"Genres") DEĞİŞMEDİ. */}
              <a href="#series" className="link-hover w-fit py-2">
                {t("footer.genres")}
              </a>
            </div>
          </div>
        </div>
        <div className="border-t border-border px-5 py-5 text-center text-xs text-muted-foreground">
          {t("footer.copyright")}
        </div>
      </footer>
    </div>
  );
}

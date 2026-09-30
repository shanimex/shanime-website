// /anime/<dizi-adı>/season/<n>/episode/<n> — İzleme sayfası: oynatıcı, kaynak kutuları,
// kaldığın yerden devam.
//
// SEZON/BÖLÜM YOL PARAMETRESİDİR (`$season`, `$episode`) — eskiden `?sezon=<n>&b=<n>`
// sorgu parametresiydi. Kaynak seçimi (`?kaynak=`) AYNI BÖLÜMÜN bir varyantı olduğu
// için sorgu parametresi olarak KALIR; yola taşınmaz.
// Eski izleme adresleri, `izle.$slug.tsx` içindeki yönlendirme rotası ile buraya gelir.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Home, Loader2, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AdSlot, useAdCode } from "@/components/site/AdSlot";
import { AdsterraLeaderboard, AdsterraNative } from "@/components/site/AdsterraUnit";
import { EpisodeCover } from "@/components/site/EpisodeCover";
import { FaSolid, type FaSolidName } from "@/components/site/FaSolid";
import { FluidPlayer, type FluidSubtitle } from "@/components/site/FluidPlayer";
import { LanguageToggle } from "@/components/site/LanguageToggle";
import { PrerollGate } from "@/components/site/PrerollGate";
import {
  ACTIVE_EMBED_PROVIDER,
  buildProviderUrl,
  isMegaplayStreamUrl,
  resolveEpisodeEmbed,
  type EmbedProviderRequest,
} from "@/lib/embed-provider";
import { anizmPlayerUrl } from "@/lib/anizm";
import { SOURCE_GROUPS } from "@/lib/embed-sources";
import { fetchSourcesForEpisodes, isDirective, type EpisodeSource } from "@/lib/episode-sources";
import { prerollVastUrls } from "@/lib/mybid";
import {
  localCoverPath,
  showDetailQueryOptions,
  showSlug,
  type Episode,
  type SeasonWithEpisodes,
} from "@/lib/content";
import {
  anizipCover,
  anizipCoverForSeason,
  anizipCoverFromChain,
  resolveSeasonMalId,
  tmdbIdForMal,
} from "@/lib/anizip-covers";
import { fetchSkipTimes, formatSkipTime } from "@/lib/skip-times";
import { ANIZM_PLAYER_RE, puffySlugFor, puffySlugForSeason } from "@/lib/puffy";
import { plural, useDocumentTitle, useLang, t as translate, type I18nKey } from "@/lib/i18n";
import { useTranslatedTexts } from "@/lib/content-translate";
import { cn } from "@/lib/utils";
import { markWatched, captureResumeFrame, savePosition } from "@/lib/watch-progress";

/**
 * İzleyicinin seçtiği kaynak.
 *
 * NEDEN VAR: hiçbir sağlayıcı "Japonca ses" ve "Türkçe altyazı"yı birlikte
 * vermiyor (ölçüm 25.09.2026):
 *   · vidsrc.to → altyazı menüsünde Türkçe VAR, ses İngilizce dublaj
 *   · megaplay  → orijinal Japonca ses, altyazı listesinde Türkçe YOK
 *     (4 dizide 12 bölüm tarandı: JJK'da 9 dil var, Türkçe yok)
 * Bu yüzden seçim izleyiciye bırakılır; varsayılan `ACTIVE_EMBED_PROVIDER`.
 */
type WatchSource = "megaplay" | "vidsrc" | "videasy" | "anizm";

type WatchSearch = {
  kaynak?: WatchSource | undefined;
};

/**
 * Kaldırıldı: "Türkçe altyazı" (vidsrc.to) düğmesi.
 *
 * NEDEN: kullanıcı istemedi — o oynatıcı İngilizce dublaj veriyor ve zinciri
 * agresif pop-up açıyor. Türkçe altyazı artık bizden geldiği için
 * (`SubtitleOverlay` + `scripts/sync-tr-subtitles.mjs`) bu seçeneğe gerek yok.
 * `kaynak` parametresi yalnızca elle zorlama için (ör. `?kaynak=vidsrc`) duruyor;
 * arayüzde düğmesi YOK.
 */
function toWatchSource(value: unknown): WatchSource | undefined {
  return value === "megaplay" || value === "vidsrc" || value === "videasy" || value === "anizm"
    ? value
    : undefined;
}

/** Sorgu parametresini pozitif tam sayıya çevirir; geçersizse undefined döner. */
function toPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

/**
 * SIFIR KABUL EDEN varyant — YALNIZCA bölüm numarası için.
 *
 * NEDEN (kullanıcı isteği, 29.09.2026): bir sezonun "0. bölümü" (özel/ön bölüm,
 * ör. Mushoku Tensei S2 → "Guardian Fitz") olabilir. Sezon numarası hâlâ
 * `toPositiveInt` ile çözülür (0. sezon olmaz); bölüm 0 ise `episode/0` adresi
 * geçerli sayılmalı — aksi hâlde `b` `undefined` olur ve sayfa başka bir bölüme
 * düşerdi ("0. bölüm açılmıyor" hatası).
 */
function toNonNegativeInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string") {
    const parsed = parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

/**
 * Sağlayıcı kimliğinden okunur ad (`megaplay` → "MegaPlay").
 *
 * NEDEN `SOURCE_GROUPS`TAN TÜRETİLİR: panel (`AnizipSyncPanel`) kaynak satırını
 * yazarken `label` alanına kısa adı koyar ("Anizm", "MegaPlay"); bu alan boş
 * kalırsa izleme sayfası sağlayıcı kimliğini ham hâlde ("tauvideo") göstermemeli.
 * Ad listesi ikinci kez yazılırsa biri güncellenip öteki unutulur; tek kaynak
 * `lib/embed-sources.ts` kalır.
 */
function readableProviderName(provider: string): string {
  // `animecix` kaydının gömülü oynatıcısı tau-video.xyz'dir, görünen adı "TauVideo"dur;
  // bu eşleme olmadan `label` alanı boş kalan satırlar izleyiciye "Animecix" yazardı.
  const canonical = provider === "animecix" ? "tauvideo" : provider;
  const known = SOURCE_GROUPS.flatMap((group) => group.items).find((item) => item.id === canonical);
  if (known) return known.label.split(" — ")[0]?.trim() || provider;
  // Listede olmayan kimlik olduğu gibi ama okunur yazılır.
  return canonical.charAt(0).toUpperCase() + canonical.slice(1);
}

/**
 * SON SEÇİLEN KAYNAK — sonraki bölümde de O kaynaktan devam edilir.
 *
 * KULLANICI İSTEĞİ (28.09.2026): "MegaPlay seçip bölümü bitiriyordum, sonraki
 * bölüme geçiyorum, kaynak değişiyor; kullanıcı hangi kaynağı seçerse o kaynaktan
 * devam etsin, değiştirene kadar hep o kaynak kalsın."
 *
 * NEDEN SAĞLAYICI KİMLİĞİ (satır `id`si değil): satır `id`si bölüme özeldir,
 * bölüm değişince değişir; `provider` ise bölümler arasında AYNI kalır. Bu yüzden
 * tercih `provider` ile saklanır ve yeni bölümde o sağlayıcının satırı aranır.
 *
 * Depolama CİHAZA ÖZELDİR (localStorage) — giriş sistemi yok, tercih kullanıcının
 * tarayıcısında kalır. localStorage erişilemezse (gizli sekme, kapalı depolama)
 * sessizce yok sayılır; seçim yalnızca o oturumda geçerli olur, akış bozulmaz.
 */
const PREFERRED_SOURCE_KEY = "shanime.preferredSource";

function readPreferredSource(): string | null {
  try {
    return window.localStorage.getItem(PREFERRED_SOURCE_KEY);
  } catch {
    return null;
  }
}

function writePreferredSource(provider: string): void {
  try {
    window.localStorage.setItem(PREFERRED_SOURCE_KEY, provider);
  } catch {
    // yazamıyorsak tercih kalıcı olmaz; kullanıcıya hata gösterip akışı kesmeyiz
  }
}

/** Çip yazısı: satırın `label`ı varsa o, yoksa okunur sağlayıcı adı. */
function sourceChipLabel(row: EpisodeSource): string {
  return row.label.trim() || readableProviderName(row.provider);
}

/**
 * Kaynak çiplerinin dil grupları.
 *
 * Başlıklar panelin sözcükleriyle aynı (AnizipSyncPanel: "TÜRKÇE KAYNAK" /
 * "YABANCI KAYNAK") ki panelde işaretlenen kutu ile oynatıcı altındaki grup
 * ayrışmasın; `language` alanı `'tr'` / `'en'` (bkz. migration notu).
 */
const SOURCE_LANGUAGE_GROUPS: { id: string; titleKey: I18nKey; icon: FaSolidName }[] = [
  { id: "tr", titleKey: "watch.trBox", icon: "closedCaptioning" },
  { id: "en", titleKey: "watch.foreignBox", icon: "language" },
];

/**
 * Oynatıcı altındaki bir kaynak KUTUSUNDA çizilen tek satır (çip).
 *
 * NEDEN TEK TİP: kutular iki ayrı kod yolundan besleniyordu — (a) sabit
 * Anizm/Megaplay satırları, (b) panelden gelen `episode_sources` grupları. Aynı
 * kaynak iki yolun ikisinde de çizildiği için ekranda DÖRT kutu görünüyordu
 * (kullanıcı şikâyeti 27.09.2026). İki kaynak türü de bu satıra çevrilip TEK
 * listeden çizilince çift çizim yapısal olarak imkânsız hâle gelir.
 */
type SourceBoxEntry = {
  /** React anahtarı: satır kimliği ya da geriye dönük uyumluluk için sentetik kimlik. */
  key: string;
  /** Kutuyu belirleyen dil — panelde işaretlenen `episode_sources.language` alanı. */
  language: "tr" | "en";
  label: string;
  /** Çipin ipucu metni (direktif satırında adresin nasıl üretildiği yazılır). */
  title: string;
  /** Adresi çözülemeyen satır ya da süren arama tıklanamaz. */
  disabled: boolean;
  /** Pasif çipin glifi yerine dönen gösterge (Türkçe kaynak sunucuda aranırken). */
  pending?: boolean;
  /** O ANDA OYNAYAN kaynak mı: aktif çip sarı (accent) dolguyla boyanır. */
  active: boolean;
  select: () => void;
};

export const Route = createFileRoute("/anime/$slug/season/$season/episode/$episode")({
  // Aranan tek sorgu parametresi `kaynak`: sezon/bölüm YOLDAN gelir (bkz. dosya başı).
  validateSearch: (search: Record<string, unknown>): WatchSearch => ({
    kaynak: toWatchSource(search["kaynak"]),
  }),
  head: () => ({
    // Başlık sözlükten: SSR'de varsayılan dil, istemcide `useDocumentTitle` ile aktif dil.
    //
    // DÜZELTME (S1): `title` ile `name`/`content` AYNI nesnedeydi. O şema geçersiz
    // olduğu için motora `<title>` düşüyor ama `robots` meta'sı HİÇ üretilmiyordu.
    // Artık iki AYRI nesne: biri başlık, öteki noindex direktifi.
    meta: [{ title: translate("meta.watchTitle") }, { name: "robots", content: "noindex" }],
  }),
  component: WatchPage,
});

/**
 * Video öncesi reklam (VAST) etiketleri — MyBid **çift spot** (ad-pod).
 *
 * Kapı GERÇEK video reklamı oynatır: etiket çekilir, reklam mp4'ü oynatılır,
 * "Reklamı geç" geri sayımı biter ve ancak ondan sonra bölüm oynatıcısı yüklenir.
 * Reklam gelmezse kapı beklemeden açılır (ziyaretçi asla reklam yüzünden
 * videoyu izleyemez durumda kalmaz).
 *
 * Adreslerin TEK kaynağı `src/lib/mybid.ts`: gömülü varsayılanlar orada ve
 * `.env` içindeki VITE_MYBID_VAST_1 / VITE_MYBID_VAST_2 onları geçersiz kılar.
 */
const PREROLL_VAST_URLS = prerollVastUrls();

function seasonLabel(season: SeasonWithEpisodes): string {
  // `season.title` VERİTABANI içeriğidir, ÇEVRİLMEZ; boşsa arayüz metni modül
  // seviyesi `translate` ile yazılır. Bunu çağıran bileşenler dil değişiminde
  // yeniden çizildiği için görünen metin her zaman güncel dilde olur.
  return season.title.trim() || translate("series.seasonFallback", { number: season.number });
}

/**
 * Bölümün DOĞRUDAN oynatma adresi (mp4 / m3u8).
 *
 * Fluid Player bir iframe oynatamaz; yalnızca kendi oynatabildiği bir dosya ya
 * da HLS akışıyla çalışır. Bölüm kaydında böyle bir alan yoksa (bugünkü durum)
 * boş döner ve aşağıdaki oynatıcı sağlayıcının embed'ine düşer — yani bu yol
 * eklenmeden hiçbir şey bozulmaz.
 *
 * Devreye almak için `episodes` tablosuna `play_url` (text) kolonu eklenip
 * kendi barındırdığın dosyanın/ HLS adresinin yazılması gerekir.
 */
function directSourceOf(episode: Episode | null): string {
  if (!episode) return "";
  const value = (episode as unknown as { play_url?: unknown }).play_url;
  return typeof value === "string" && /^https?:\/\//i.test(value) ? value : "";
}

/**
 * Bölümün altyazı listesi.
 *
 * `episodes.subtitles` alanı şu biçimde bir JSON dizisi olmalıdır:
 *   [{ "src": "https://.../bolum-1.vtt", "label": "Türkçe", "srclang": "tr" }]
 *
 * DİKKAT: Fluid Player altyazıyı HTML5 <track> ile okur ve <track> yalnızca
 * .vtt destekler; .srt tarayıcıda çalışmaz. .srt dosyaları önce .vtt'ye
 * çevrilmelidir.
 */
function subtitlesOf(episode: Episode | null): FluidSubtitle[] {
  if (!episode) return [];
  const value = (episode as unknown as { subtitles?: unknown }).subtitles;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as { src?: unknown; label?: unknown; srclang?: unknown };
    // Göreli yol da kabul edilir ("/subs/bolum-1.vtt"): dosyayı `public/subs/`
    // altına koymak yeterli olur — kendi alan adımızdan servis edildiği için
    // CORS engeli de çıkmaz. (Sağlayıcıya enjekte edilirken tam adrese çevrilir.)
    const src = typeof entry.src === "string" ? entry.src.trim() : "";
    if (!/^(?:https?:\/\/|\/)/i.test(src)) return [];
    return [
      {
        src,
        label:
          typeof entry.label === "string" && entry.label
            ? entry.label
            : translate("watch.subtitleDefault"),
        srclang: typeof entry.srclang === "string" && entry.srclang ? entry.srclang : "tr",
        isDefault: index === 0,
      },
    ];
  });
}

/**
 * Masaüstü yerleşimi mi? (≥ 1024 px)
 *
 * NEDEN JS İLE ÖLÇÜLÜYOR: bölüm paneli masaüstünde oynatıcının SAĞINA mutlak
 * konumlanmalı, dar ekranda ise akışın SONUNDA (şerit + bilgi satırından sonra)
 * durmalı. Bunun için panelin iki kopyası + Tailwind'in `hidden lg:flex` /
 * `lg:hidden` kalıbı kullanılmıştı; sonuç: dar ekranda kopyalardan biri görünür
 * kaldı, panel oynatıcı ile şeridin ARASINA girip şeridi aşağı itti ve bölüm
 * listesi iki kez çizildi. Artık TEK kopya çizilir, yerini tek bir ölçüm
 * (matchMedia) belirler — sınıf sırasına bağlı kalınmaz.
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const apply = () => setIsDesktop(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return isDesktop;
}

function WatchPage() {
  // Sezon ve bölüm artık YOL parametresidir (`/anime/<slug>/season/<n>/episode/<n>`).
  // Rota parametreleri her zaman DİZGE geldiği için sayıya çevirme burada yapılır;
  // dönüştürülen değerler aşağıda eskisi gibi `sezon`/`b` adlarıyla kullanılır ki
  // sayfanın geri kalanı (karşılaştırmalar, ilerleme kaydı, kaynak seçimi) DEĞİŞMESİN.
  const { slug, season: seasonParam, episode: episodeParam } = Route.useParams();
  const sezon = toPositiveInt(seasonParam);
  // BÖLÜM 0 KABUL EDİLİR (özel/ön bölüm — bkz. `toNonNegativeInt`); sezon > 0 kalır.
  const b = toNonNegativeInt(episodeParam);
  const { kaynak } = Route.useSearch();
  const navigate = useNavigate();
  const { t } = useLang();
  const {
    data: detail,
    isLoading,
    isError,
  } = useQuery({
    // ORTAK önbellek anahtarı (bkz. lib/content.ts → showDetailQueryOptions).
    // NEDEN: burada 60 sn'lik AYRI bir tazelik yazılıydı; detay sayfasının rota
    // yükleyicisi ve ana sayfadaki önden çekme farklı anahtar/tazelik kullandığı
    // için AYNI seri oturum içinde iki-üç kez okunuyordu (her okuma: shows +
    // show_episodes + show_seasons + site_settings + Storage imzalama).
    ...showDetailQueryOptions(slug),
  });

  /**
   * Bölümlerin ÇOKLU kaynakları (`episode_sources`) — panelde işaretlenenler.
   *
   * NEDEN SEZONUN TAMAMI TEK SORGUDA: bölüm başına istek atmak N+1 olurdu; ayrıca
   * bölüm değiştirildiğinde çipler ek istek beklemeden hazır olur. Sorgu ancak
   * seri verisi geldikten sonra çalışır.
   *
   * ⚠️ GERİYE DÖNÜK UYUMLULUK: tablo henüz oluşturulmadıysa (migration
   * çalıştırılmadıysa) Supabase hata döndürür. Hata YUTULUR ve boş eşleme dönülür:
   * sayfa hata/boş ekrana düşmez, çipler hiç çizilmez ve oynatıcı bugünkü
   * `watch_url` yolundan devam eder.
   */
  const sourceEpisodeIds = (detail?.seasons ?? []).flatMap((season) =>
    season.episodes.map((episode) => episode.id),
  );
  const { data: episodeSources } = useQuery({
    queryKey: ["episode-sources", slug, sourceEpisodeIds.join(",")],
    enabled: sourceEpisodeIds.length > 0,
    // Tazelik istemci varsayılanından gelir (bkz. lib/query-client.ts → 5 dk).
    // 60 sn'lik dar pencere, bölüm değiştirip geri dönen izleyicide aynı sezon
    // kaynaklarını tekrar tekrar okutuyordu.
    queryFn: async () => {
      try {
        return await fetchSourcesForEpisodes(sourceEpisodeIds);
      } catch {
        return new Map<string, EpisodeSource[]>();
      }
    },
  });

  // Oynatıcının üstü/altı: panelde kod varsa PANEL kazanır, yoksa koddaki
  // Adsterra birimi devreye girer. Böylece panelden kod değiştirmek yayın
  // gerektirmez, kod boşken de reklam alanı boş kalmaz.
  const watchTop = useAdCode("ad_watch_top");
  const watchBottom = useAdCode("ad_watch_bottom");

  // Video öncesi reklam kapısı: gerçek VAST reklamları oynadıktan sonra açılır.
  const [gateDone, setGateDone] = useState(false);

  // Oynatıcı altı kontrol şeridi (referans: anikoto/hianime oynatıcı altı şeridi).
  //   · genişlet          → oynatıcı tam genişlik olur, bölüm paneli alta iner
  //   · otomatik oynatma  → kapalıyken adrese `autostart=false` eklenir
  //   · otomatik geçiş    → video bitince sonraki bölüme geçer
  //   · ışık              → sayfanın geri kalanı karartılır
  //   · otomatik atlama    → açılış/kapanış atlama (referansta varsayılan kapalı)
  const [wide, setWide] = useState(false);
  const [autoPlay, setAutoPlay] = useState(true);
  const [autoNext, setAutoNext] = useState(true);
  const [autoSkip, setAutoSkip] = useState(false);
  const [dim, setDim] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  /**
   * Oynatıcı altındaki kaynak çiplerinden ELLE seçilen satırın kimliği.
   *
   * NEDEN AYRI DURUM: bugünkü seçim adres parametresiyle (`?kaynak=`) ve sabit iki
   * kaynakla çalışıyor; `episode_sources` satırları ise kullanıcının panelde
   * işaretlediği, sayısı ve kimliği önceden bilinmeyen kaynaklar — adres
   * parametresine sığmaz (`kaynak` tipi dört sabit değerle sınırlı).
   */
  const [pickedSourceId, setPickedSourceId] = useState<string | null>(null);

  /**
   * KULLANICININ TERCİH ETTİĞİ SAĞLAYICI (sonraki bölümde de aynı kaynak kalsın).
   *
   * Yalnızca TARAYICIDA okunabilir (`localStorage`), bu yüzden ilk render'da
   * `null` ve mount sonrası effect ile doldurulur — sunucu render'ında okumaya
   * çalışmak hydration uyuşmazlığı üretirdi.
   *
   * DİKKAT: bu hook ERKEN `return`LERİN ÜSTÜNDE durmak zorunda; ilk denemede
   * aşağıya (kullanım yerinin yanına) koymuştum ve lint
   * `react-hooks/rules-of-hooks` ile yakaladı — hook sırası render'lar arasında
   * değişemez.
   */
  const [preferredProvider, setPreferredProvider] = useState<string | null>(null);
  useEffect(() => setPreferredProvider(readPreferredSource()), []);

  // Bölüm panelinin yeri bu ölçüme göre seçilir (bkz. `useIsDesktop`).
  const isDesktop = useIsDesktop();
  // Sezonu bölümü olan sezonlar üzerinden çöz: boş bir sezon seçilirse
  // izleyici "bölüm yok" ekranında kalmaz, ilk dolu sezona düşer.
  const playableSeasons: SeasonWithEpisodes[] = (detail?.seasons ?? []).filter(
    (season) => season.episodes.length > 0,
  );
  const ordered = playableSeasons.flatMap((season) =>
    season.episodes.map((episode) => ({ season: season.number, episode })),
  );
  const activeSeason =
    playableSeasons.find((season) => season.number === sezon) ??
    playableSeasons.find((season) => season.episodes.some((episode) => episode.number === b)) ??
    playableSeasons[0] ??
    null;
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * 0. (ÖZEL) BÖLÜM — "DB SATIRI + KAYNAK" VARSA LİSTEDE (kullanıcı, 30.09.2026).
   *
   * ── DEĞİŞEN KURAL ───────────────────────────────────────────────────────────
   * İlk sürüm (29.09.2026) `0. Bölüm`ü KATALOGDAN sentetik üretiyordu; veritabanı
   * satırı olmasa bile gösteriliyordu. Kullanıcı şikâyeti (30.09.2026): "Re:Zero
   * eklerken hiçbir 0. bölümü seçmedim ama oynatıcı sayfasında bir sürü çıkıyor,
   * kaynakları da yok." Artık özel bölüm VERİTABANINDAN gelir: `0` numaralı satır,
   * kaynağı (`episode_sources`) varsa `activeSeason.episodes` İÇİNDEDİR (bkz.
   * lib/content.ts → loadShowDetail) ve normal bölüm gibi listelenir/oynatılır.
   * Katalogdan SENTETİK satır ÜRETİLMEZ.
   *
   * ── ep 1'e DÜŞME YOK ────────────────────────────────────────────────────────
   * `b === 0` ve listede KAYNAKLI bir `0` satırı YOKSA ep 1 içeriğine DÜŞÜLMEZ;
   * oynatıcı yerine açıkça "bu bölüm için kaynak yok" durumu gösterilir
   * (`isSpecial`). Yedek `episodes[0]` dalı yalnızca 0 DIŞINDAKİ numaralar için.
   */
  const currentEpisode: Episode | null =
    activeSeason?.episodes.find((episode) => episode.number === b) ??
    // 0 = özel bölüm: yedek YAPILMAZ (ep 1'e düşmesin). Özel bölümün DB satırı
    // (veya kaynağı) yoksa `currentEpisode` null kalır → "kaynak yok" ekranı.
    (b === 0 ? null : (activeSeason?.episodes[0] ?? null));
  /** Özel bölüm isteği (0) ama listelenecek/oynatılacak KAYNAKLI satır YOK. */
  const isSpecial = b === 0 && currentEpisode === null;

  /**
   * BÖLÜM ADI — içerik çevirisi (kullanıcı, 28.09.2026: "bütün her şeyi TR
   * çevirsin"). Oynatıcının altındaki bilgi satırında görünen ad, TR seçiliyken
   * DeepL karşılığıdır; İngilizce'de orijinal kalır (`useTranslatedTexts` o
   * durumda hiç istek yapmaz).
   *
   * ⚠️ KANCA YERİ: bu bileşende erken `return` YOKTUR (ilk `return` 692. satırda),
   * bu yüzden buraya konması güvenli. Yukarıdaki `previous/upcoming` hesapları
   * `currentEpisode`e bağlı olduğu için kanca onların ÜSTÜNE alındı.
   */
  const [translatedEpisodeTitle] = useTranslatedTexts([currentEpisode?.title?.trim() ?? ""]);
  const currentIndex = currentEpisode
    ? ordered.findIndex((item) => item.episode.id === currentEpisode.id)
    : -1;
  const previous = currentIndex > 0 ? (ordered[currentIndex - 1] ?? null) : null;
  const upcoming =
    currentIndex >= 0 && currentIndex < ordered.length - 1
      ? (ordered[currentIndex + 1] ?? null)
      : // ÖZEL BÖLÜM (0. Bölüm) `ordered` içinde YOKTUR (veritabanı satırı yok)
        // → indeks -1 olur. Bu durumda "Sonraki" hedefi sezonun İLK bölümüdür;
        // aksi hâlde 0. bölümde takılıp kalınırdı.
        isSpecial
        ? (ordered[0] ?? null)
        : null;
  const multipleSeasons = playableSeasons.length > 1;

  /**
   * "Otomatik geçiş" için sonraki bölüm — **SEZON SINIRINI AŞAR**.
   *
   * Eskiden yalnızca AKTİF SEZONUN listesinde ilerliyordu: 1. sezonun son bölümü
   * bitince otomatik geçiş duruyor, izleyici 2. sezona elle geçmek zorunda
   * kalıyordu. Artık tüm oynatılabilir sezonların düzleştirilmiş listesi
   * (`ordered`) kullanılıyor → S1'in son bölümü bitince S2'nin ilk bölümü açılır.
   * `upcoming` ile aynı hedeftir; adlar okunabilirlik için ayrı duruyor
   * (biri "otomatik geçiş"in hedefi, öbürü şeritteki "Sonraki" düğmesinin hedefi).
   */
  const nextEpisode = upcoming;

  /** Bölüm değişince dinleyiciyi tazelemek için kullanılan anahtar. */
  const episodeKey = `${currentEpisode?.season ?? "x"}-${currentEpisode?.number ?? "x"}`;

  /**
   * MEGAPLAY DOĞRULAMASI (sunucu tarafı).
   *
   * NEDEN: `@megaplay` direktifi şablonla bir adres ÜRETİR ama üretilen adresin
   * oynatıcıyı getireceği GARANTİ DEĞİLDİR. Ölçüm (29.09.2026, mushoku-tensei
   * S1B15): `megaplay.buzz/stream/mal/39535/15/sub` gömülü iframe'de 404 hata
   * sayfası döndürüyordu — üstelik HTTP durumu 200 olduğu için istemci bunu
   * ANLAYAMAZ (çapraz-kaynak iframe içeriği okunamaz). Karar bu yüzden sunucu
   * rotasında verilir (`/api/embed`): önce `mal/`, oynatmıyorsa AniList kimliğiyle
   * `ani/` denenir; ikisi de oynatmıyorsa `null` döner ve satır listede GÖRÜNMEZ.
   *
   * NEDEN `useQuery` (senkron değil): doğrulama ağ isteğidir. Kanca, erken
   * `return`lerin ÜSTÜNDE durmak zorundadır (React kuralı) ve yalnızca gerekli
   * olduğunda (`enabled`) çalışır — her bölüm açılışına ek istek binmez.
   */
  const megaplayRows = currentEpisode
    ? (episodeSources?.get(currentEpisode.id) ?? []).filter(
        (row) => isDirective(row.url) && row.url.slice(1).trim() === "megaplay",
      )
    : [];
  const megaplayLanguage = megaplayRows.some((row) => row.language === "dub") ? "dub" : "sub";
  /**
   * O anki sezonun PART kayıtları (`show_seasons.parts`).
   *
   * NEDEN SUNUCUYA TAŞINIR: bir sezon kaydı birden çok MAL kaydına yayılabilir
   * (Mushoku Tensei S1: 1–11 = MAL 39535 "Part 1", 12–23 = MAL 45576 "Part 2").
   * MegaPlay bölümü part'ın KENDİ kimliği + part içi göreli numarayla verir; mutlak
   * numarayla sorgulanırsa 2. part `Error` döndürür ve kaynak listeden düşer. Eşleme
   * `/api/embed`'e `parts` olarak geçirilir (rota boşsa AniList'ten türetir).
   */
  const seasonParts = Array.isArray(activeSeason?.parts) ? (activeSeason?.parts ?? []) : [];
  /**
   * MegaPlay'e ihtiyaç var mı: ya direktif satırı var ya da bölümün adresi yok.
   *
   * ⚠️ ÖZEL BÖLÜM (`0. Bölüm`) HARİÇ: özel bölümün ADRESİ YOKTUR ve bu yüzden
   * "adres boş → şablonla üret" dalına düşerdi; üretilen adres (MAL 39535 /
   * bölüm 0) yanlış bir kaynağa götürebilirdi. Özel bölümde sağlayıcı hiç
   * denenmez — oynatılabilir kaynak yoksa açıkça "kaynak yok" denir.
   */
  const needsMegaplay =
    !isSpecial &&
    (megaplayRows.length > 0 ||
      kaynak === "megaplay" ||
      Boolean(currentEpisode && !(currentEpisode.watch_url ?? "").trim()));
  const megaplayEmbedQuery = useQuery({
    queryKey: [
      "megaplay-embed",
      // Etkin MAL kimliği (sezon yoksa seri): kimlik değişince (panelde sezon
      // kimliği düzeltilince) eski URL önbellekten gelmesin.
      (activeSeason?.mal_id ?? detail?.show.mal_id) || null,
      currentEpisode?.season ?? null,
      currentEpisode?.number ?? null,
      megaplayLanguage,
      // Part kaydı değişince (panelden yeniden senkron) aynı bölüm YENİDEN çözülür.
      JSON.stringify(seasonParts),
    ],
    // Sunucu rotası göreli adrestir; SSR'de çalıştırmak anlamsız (veri zaten yok).
    enabled:
      needsMegaplay &&
      typeof window !== "undefined" &&
      Boolean(detail?.show.mal_id && currentEpisode),
    queryFn: async () => {
      const query = new URLSearchParams({
        provider: "megaplay",
        mal: String(activeSeason?.mal_id ?? detail?.show.mal_id ?? ""),
        episode: String(currentEpisode?.number ?? ""),
        lang: megaplayLanguage,
      });
      // Part eşlemesi varsa sunucuya geçir (yoksa sunucu AniList'ten türetir).
      if (seasonParts.length > 0) query.set("parts", JSON.stringify(seasonParts));
      const response = await fetch(`/api/embed?${query.toString()}`);
      if (!response.ok) return null;
      const payload = (await response.json()) as { url?: string | null };
      return typeof payload.url === "string" ? payload.url : null;
    },
  });
  /**
   * DOĞRULANMIŞ adres. `null` = henüz çözülmedi YA DA oynatıcı getirmiyor.
   * İkisinde de kaynak gösterilmez: yanlış bir 404 ekranı göstermektense
   * (ve istemci bunu iframe içinden göremediği için) kaynağı hiç göstermemek.
   */
  const verifiedMegaplayUrl = megaplayEmbedQuery.data ?? null;

  /**
   * Oynatıcı mesajları için "canlı" değerler.
   *
   * NEDEN ref: mesaj akışı saniyede ~4 kez geliyor; dinleyicinin bölüm başına BİR
   * kez kurulması yeterli. Sık değişen değerleri ref'te tutunca dinleyici her
   * render'da sökülüp yeniden bağlanmıyor (ve kapanışlar eski değeri görmüyor).
   */
  const autoNextRef = useRef(autoNext);
  const autoSkipRef = useRef(autoSkip);
  const nextEpisodeRef = useRef(nextEpisode);
  const edStartRef = useRef<number | null>(null);
  const malIdRef = useRef<number | null>(detail?.show.mal_id ?? null);
  const episodeNumberRef = useRef<number>(currentEpisode?.number ?? 0);
  /** Oynatıcının bildirdiği son dosya süresi (AniSkip sorgusu bunu ister). */
  const durationRef = useRef(0);
  /** Hangi (MAL, bölüm, süre) için jenerik verisi çekildi — tekrarı önler. */
  const skipKeyRef = useRef<string | null>(null);
  /** \"Sonraki bölüme geçiliyor…\" bilgisi (şeritte gösterilir). */
  const [advancing, setAdvancing] = useState<string | null>(null);
  /**
   * O AN oynayan bölüm (sezon/bölüm) — `postMessage` dinleyicisi bölüm başına
   * BİR kez kurulduğu için kapanışın taze değeri görmesi ref'ten sağlanır.
   */
  const currentEpisodeRef = useRef<{ season: number; episode: number } | null>(null);
  /** Gömülü oynatıcıdan konumun SON kaydedildiği an (ms) — 5 sn'lik kelepçe. */
  const savedAtRef = useRef(0);
  /** \"Kaldığın yer\" karesi: son yakalamanın anahtarı ve konumu (seyrek yakalama). */
  const frameTickRef = useRef<{ key: string; position: number }>({ key: "", position: -1 });
  /** Otomatik atlama verisi bulunduysa kısa bilgi (şeritte gösterilir). */
  const [skipHint, setSkipHint] = useState<string | null>(null);
  /**
   * Oynatıcının SAĞ ALT köşesindeki geri sayım (saniye).
   *
   * Kullanıcı isteği: "video bitimine kaç saniye varsa 'şu kadar süre sonra diğer
   * bölüme geçilecek' uyarısı yaz; mümkünse 20 saniye kala mesajı ver, süre
   * geçtikçe saysın". Hedef an, geçişin GERÇEKLEŞECEĞİ an: "Otomatik atlama"
   * açıksa kapanış jeneriğinin başlangıcı, değilse dosyanın sonu.
   */
  const [remaining, setRemaining] = useState<number | null>(null);
  /**
   * Sunucudan ("/api/anizm") bulunan Türkçe adres ve arama durumu.
   * Kancalar bilinçli olarak burada: erken `return`lerden SONRA tanımlanırsa
   * React "koşullu kanca" hatası verir.
   */
  const [lookupUrl, setLookupUrl] = useState<string | null>(null);
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "missing">("idle");
  useEffect(() => {
    autoNextRef.current = autoNext;
    autoSkipRef.current = autoSkip;
    nextEpisodeRef.current = nextEpisode;
    malIdRef.current = detail?.show.mal_id ?? null;
    episodeNumberRef.current = currentEpisode?.number ?? 0;
    currentEpisodeRef.current = currentEpisode
      ? { season: currentEpisode.season, episode: currentEpisode.number }
      : null;
  }, [autoNext, autoSkip, nextEpisode, detail, currentEpisode]);

  /**
   * Jenerik zamanlarını (AniSkip) gerektiğinde çeker.
   *
   * ⚠️ DÜZELTME (26.09.2026): ilk sürümde bu istek "ilk `time` mesajında bir kez"
   * yapılıyordu ve `Otomatik atlama` AÇIK değilse o hak kullanılmış sayılıyordu.
   * Gerçek oynatıcı sayfa açılır açılmaz mesaj yağdırdığı ve "Otomatik atlama"
   * varsayılan KAPALI olduğu için istek HİÇ atılmıyor, kullanıcı düğmeyi sonradan
   * açtığında da (effect yeniden kurulmadığı için) devreye girmiyordu. Artık:
   *   · süre bilgisi her `time` mesajında tazelenir,
   *   · istek hem mesaj akışında hem de "Otomatik atlama" AÇILDIĞINDA denenir,
   *   · aynı (MAL, bölüm, süre) için yalnızca bir kez gider (`skipKeyRef`).
   */
  const loadSkipTimes = useCallback(() => {
    if (!autoSkipRef.current) return;
    // Atlanacak bir sonraki bölüm yoksa jenerik atlamanın anlamı yok.
    if (!nextEpisodeRef.current) return;
    const malId = malIdRef.current;
    const duration = durationRef.current;
    if (!malId || duration <= 0) return;
    const key = `${malId}-${episodeNumberRef.current}-${Math.round(duration)}`;
    if (skipKeyRef.current === key) return;
    skipKeyRef.current = key;
    void fetchSkipTimes(malId, episodeNumberRef.current, duration).then((data) => {
      edStartRef.current = data?.ed?.start ?? null;
      setSkipHint(data?.ed ? t("watch.skipHint", { time: formatSkipTime(data.ed.start) }) : null);
    });
  }, [t]);

  /**
   * "Otomatik atlama" açılır kapanır: açıldığında veriyi getir, kapanınca
   * kalıntı bilgiyi temizle (kapalıyken "…atlanır" yazısı yanıltıcıydı).
   */
  useEffect(() => {
    if (autoSkip) {
      loadSkipTimes();
      return;
    }
    edStartRef.current = null;
    setSkipHint(null);
  }, [autoSkip, loadSkipTimes]);

  /**
   * İZLEYİCİ KONTROLÜ — oynatıcıdan gelen mesajlar.
   *
   * ÖLÇÜM (26.09.2026, gerçek yakalama; origin `https://megaplay.buzz`):
   *   · saniyede ~4 kez: {"channel":"megacloud","event":"time","time":X,"duration":Y,"percent":Z}
   *   · bölüm sonunda bir kez: {"channel":"megacloud","event":"complete","percent":100}
   *   · ayrıca: {"type":"watching-log",…}, {"cmd":"iframe-ready"}, {"event":"PLAYER_READY"}
   * Mesajlar DİZGE (JSON string) gelir → `JSON.parse` şarttır. `event` alanı birebir
   * karşılaştırılır ki başka bir mesajda "complete" kelimesi geçse yanlış tetiklenmesin.
   *
   * İKİ İŞ YAPAR:
   *  1) OTOMATİK GEÇİŞ — bölüm bitince sonraki bölüme geçer (sezon sınırını aşar).
   *     `complete` mesajına ek olarak "son 2 saniye" emniyeti vardır: sinyal
   *     kaçarsa süre akışından yakalanır.
   *  2) OTOMATİK ATLAMA — kapanış jeneriği BAŞLADIĞI anda sonraki bölüme geçer
   *     (AniSkip zamanları). Kullanıcının şikâyeti buydu: jenerik ~90 sn sürdüğü
   *     için `complete` gelene kadar ~1,5 dakika boşa bekleniyordu.
   *
   * Kanca, erken `return`lerden ÖNCE tanımlanmak zorundadır (React kuralı).
   */
  useEffect(() => {
    let fired = false;
    let timer: number | null = null;

    const advance = (reason: string) => {
      const target = nextEpisodeRef.current;
      if (!target || fired) return;
      fired = true;
      setAdvancing(t("watch.advancing", { number: target.episode.number, reason }));
      // Kısa gecikme: geçiş kendiliğinden olmuş gibi görünmesin, sebebi okunsun.
      timer = window.setTimeout(() => {
        void navigate({
          to: "/anime/$slug/season/$season/episode/$episode",
          params: {
            slug,
            season: String(target.season),
            episode: String(target.episode.number),
          },
          search: {
            ...(kaynak ? { kaynak } : {}),
          },
        });
      }, 900);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== "https://megaplay.buzz" || fired) return;
      const raw = typeof event.data === "string" ? event.data : "";
      if (!raw) return;
      // Saniyede ~4 mesajın tamamını ayrıştırmamak için önce ucuz ön süzgeç.
      if (!raw.includes('"event":"complete"') && !raw.includes('"event":"time"')) return;

      let parsed: { event?: string; time?: number; duration?: number };
      try {
        parsed = JSON.parse(raw) as { event?: string; time?: number; duration?: number };
      } catch {
        return;
      }

      if (parsed.event === "complete") {
        if (nextEpisodeRef.current) advance(t("watch.reasonEnded"));
        return;
      }
      if (parsed.event !== "time") return;

      const time = Number(parsed.time);
      const duration = Number(parsed.duration);
      if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return;

      // Süre bilgisini tazele ve (gerekiyorsa) jenerik zamanlarını getir.
      // `loadSkipTimes` içindeki anahtar sayesinde tekrar tekrar istek gitmez.
      durationRef.current = duration;
      loadSkipTimes();

      // CİHAZA ÖZEL KONUM (gömülü oynatıcı): saniye sağlayıcının KENDİ
      // bildirdiği değerdir — uydurma değil. Kare burada YAKALANMAZ: oynatıcı
      // cross-origin bir iframe'dir ve tarayıcı iframe içindeki videodan kare
      // okumaya izin vermez (bkz. lib/watch-progress.ts notu). Kare yalnızca
      // kendi <video>'muzda (doğrudan mp4/HLS) yakalanır.
      const watchedEpisode = currentEpisodeRef.current;
      if (watchedEpisode && time > 0) {
        const now = Date.now();
        // Mesaj akışı saniyede ~4 kez geliyor: yazma 5 saniyede bir kelepçelenir.
        if (now - savedAtRef.current >= 5000) {
          savedAtRef.current = now;
          savePosition(slug, watchedEpisode.season, watchedEpisode.episode, time, duration);
        }
      }

      // Geri sayım: geçiş anına en fazla 20 saniye kala gösterilir, her saniye iner.
      // Geçiş olmayacaksa (son bölüm) ya da iki anahtar da kapalıysa gizlenir.
      const skipTarget = autoSkipRef.current ? edStartRef.current : null;
      const target = skipTarget ?? (autoNextRef.current ? duration : null);
      if (target === null || !nextEpisodeRef.current) {
        setRemaining(null);
      } else {
        const left = Math.ceil(target - time);
        setRemaining(left > 0 && left <= 20 ? left : null);
      }

      // 1) Kapanış jeneriği başladı → sonraki bölüme geç ("Otomatik atlama").
      if (autoSkipRef.current && edStartRef.current !== null && time >= edStartRef.current) {
        advance(t("watch.reasonSkipped"));
        return;
      }
      // 2) Emniyet kemeri: `complete` kaçarsa son 2 saniyede yakala ("Otomatik geçiş").
      if (autoNextRef.current && duration - time <= 2) advance(t("watch.reasonEnded"));
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [navigate, slug, kaynak, episodeKey, loadSkipTimes, t]);

  // Oynatıcı kaynağı: doğrudan adres varsa Fluid Player, yoksa sağlayıcı embed'i.
  const directSrc = directSourceOf(currentEpisode);
  const episodeSubtitles = subtitlesOf(currentEpisode);

  // Bölüm değişince (istemci içi geçişte de) reklam kapısı yeniden kurulur.
  const currentKey = currentEpisode ? `${currentEpisode.season}-${currentEpisode.number}` : "yok";
  useEffect(() => {
    setGateDone(false);
    // Bölüm değişince jenerik verisi de sıfırlanır: bir sonraki bölüm için yeniden çekilir.
    edStartRef.current = null;
    durationRef.current = 0;
    skipKeyRef.current = null;
    setSkipHint(null);
    setAdvancing(null);
    setRemaining(null);
    // Bölüm değişince sunucudan bulunan Türkçe adres de sıfırlanır.
    setLookupUrl(null);
    setLookupState("idle");
    // Elle seçilen çip de sıfırlanır: önceki bölümün satır kimliği yeni bölümde
    // yoktur, kalsaydı seçim "kayıp" görünür ve başlangıç seçimi çalışmazdı.
    setPickedSourceId(null);
  }, [currentKey]);

  // Sekme başlığı: rota başlığı sunucuda bir kez üretilir ve dili İZLEYEMEZ.
  // `useDocumentTitle` ile istemcide aktif dile bağlanır: veri gelene kadar rota
  // başlığı, veri gelince seri + bölüm bilgisi yazılır.
  const pageTitle = detail
    ? currentEpisode
      ? `${detail.show.title} ${t("watch.srEpisodeWatch", { number: currentEpisode.number })} | shanime`
      : `${detail.show.title} ${t("watch.srWatch")} | shanime`
    : translate("meta.watchTitle");
  useDocumentTitle(pageTitle);

  /**
   * CİHAZA ÖZEL İLERLEME (ekleme): izleme sayfası bir bölüm bağlantısıyla
   * DOĞRUDAN açıldığında da (detay sayfasından geçmeden) bölüm izlendi sayılsın.
   * Mevcut akışa dokunmaz; yalnızca localStorage'a yazar (bkz. lib/watch-progress).
   */
  useEffect(() => {
    if (!detail || !currentEpisode) return;
    markWatched(showSlug(detail.show), currentEpisode.season, currentEpisode.number);
  }, [detail, currentEpisode]);

  if (isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  if (isError || !detail) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-5 text-center">
        <div>
          <h1 className="font-display text-2xl text-foreground">{t("watch.episodeNotFound")}</h1>
          <Button className="mt-5 rounded-full" onClick={() => void navigate({ to: "/" })}>
            {t("common.backHome")}
          </Button>
        </div>
      </div>
    );
  }

  const { show } = detail;

  // Bölümün oynatılacak adresi: ÖNCE kayıttaki `watch_url`, BOŞSA aktif embed
  // sağlayıcısından (megaplay) MAL kimliğiyle üretilir.
  //
  // `watch_url` dolu olduğu sürece `resolveEpisodeEmbed` birebir aynı değeri
  // döndürür → mevcut yayın davranışı değişmez. Sağlayıcı yalnızca watch_url'i
  // boş olan bölümlerde devreye girer (ör. yalnızca MAL kimliğiyle eklenen yeni
  // bölümler).
  // ⚠️ ÖZEL BÖLÜMDE SAĞLAYICI İSTEĞİ ÜRETİLMEZ: `0. Bölüm`ün oynatıcı adresi
  // yoktur (veritabanında satırı yok); şablonla adres üretmek yanlış bölüme
  // götürebilirdi. Kaynak yoksa sayfa bunu açıkça söyler (uydurma YOK).
  const episodeRequest =
    currentEpisode && !isSpecial
      ? {
          // SEZONUN kimliği ÖNCE: megaplay'de sezon parametresi YOKTUR, kimliğin
          // kendisi sezonu kodlar (ölçüm: S2E1'e seri kimliğiyle gidilince S1E1
          // açılıyordu). Sezon kimliği yoksa seri kimliğine düşülür (tek
          // kayıtlı sezonlarda aynı şeydir).
          malId: activeSeason?.mal_id ?? show.mal_id ?? null,
          // TMDB kimliği: vidsrc.to şablonu bunu ister (MAL kimliği işe yaramaz).
          // Eşleme `src/data/mal-tmdb.json` içinde derleme zamanında gömülü.
          tmdbId: tmdbIdForMal(show.mal_id),
          season: currentEpisode.season,
          episode: currentEpisode.number,
          // Panelden girilen altyazılar (aynı `episodes.subtitles` alanı) sağlayıcıya
          // da geçirilir: vidsrc.to `?sub.info=` ile KENDİ dosyamızı kabul ediyor.
          // Böylece Türkçe altyazı menüde hazır olur — sağlayıcının yerleşik
          // listesinden Türkçe'yi varsayılan yapmanın başka yolu yok.
          subtitles: episodeSubtitles.map((track) => ({ file: track.src, label: track.label })),
        }
      : null;

  // Bu bölüm için anizm/puffy kaynağı var mı? Türkçe altyazı videoya GÖMÜLÜ,
  // 1080p, pre-roll'süz, pop-up'suz (ölçüm: docs/SAGLAYICI-VE-KAPAK-ARASTIRMASI.md §23).
  //
  // Adres derleme zamanında gömülü tablodan gelir (`src/data/anizm-hashes.json`,
  // `scripts/resolve-anizm-hashes.mjs` ile üretilir); kaydı olmayan bölümde null
  // döner ve aşağıdaki kaynak düğmesi hiç görünmez — varsayılan davranış değişmez.
  const anizmUrl = currentEpisode
    ? (anizmPlayerUrl(show.mal_id ?? null, currentEpisode.season, currentEpisode.number) ??
      // Panelden Türkçe kaynak yazılan bölümlerde adres doğrudan anizmplayer'dır;
      // derleme zamanındaki tabloda kaydı olmasa bile Türkçe kaynak çalışır.
      (ANIZM_PLAYER_RE.test(currentEpisode.watch_url ?? "") ? currentEpisode.watch_url : null))
    : null;

  /**
   * "Türkçe kaynağı ara" ile sunucudan getirilen adres.
   *
   * NEDEN: tabloda kaydı olmayan bölümlerde Türkçe kaynak "yok" sayılıyordu.
   * Anizm adresi referer korumalı olduğu için tarayıcıda çözülemez; sunucu rotası
   * (`/api/anizm`) çözer. Böylece izleyici isterse kaynağı kendisi bulabilir.
   */
  // (`lookupUrl` / `lookupState` kancaları, kural gereği erken `return`lerden
  // ÖNCE tanımlıdır — bkz. yukarıdaki durum bloğu.)
  const turkishUrl = anizmUrl ?? lookupUrl;

  /**
   * TauVideo kaynağı (animecix'in kullandığı oynatıcı).
   *
   * NEDEN: panelden Türkçe kaynak olarak TauVideo adresi yazıldığında bu bölümün
   * `watch_url`'i tau-video.xyz olur. İzleyici tarafında "Türkçe" satırında
   * kaynak olarak görünmesi gerekir (kullanıcı isteği: seçtiğimiz kaynaklar
   * oynatıcının altında kaynak olarak çıksın — anikoto düzeni).
   */
  const tauUrl = /tau-video\.xyz/i.test(currentEpisode?.watch_url ?? "")
    ? currentEpisode?.watch_url
    : null;

  /**
   * PANELDEN SEÇİLEN ÇOKLU KAYNAKLAR (`episode_sources`) → oynatıcı altındaki çipler.
   *
   * Kullanıcı isteği (27.09.2026): "panelde hangi kaynakları seçersem oynatıcının
   * ALTINDA çıksın, aynı Anizm gibi; birden fazla seçebileyim." Satırlar sezonun
   * tamamı için tek sorguda geldi (yukarıdaki sorgu); burada yalnızca OYNATILAN
   * bölümün satırları süzülür.
   */
  const sourceRows: EpisodeSource[] = currentEpisode
    ? (episodeSources?.get(currentEpisode.id) ?? [])
    : [];

  /**
   * Çipin tıklanınca oynatacağı adres.
   *
   * `url` direktifse (`@megaplay`) BUGÜNKÜ sağlayıcı-direktifi yolu kullanılır:
   * `resolveEpisodeEmbed`, bu değeri `watch_url` içinde gördüğünde ne yapıyorsa
   * aynısını yapar (yeni bir çözümleme yazılmadı, `isDirective` de aynı denetimi
   * yapar). Düz adres ise doğrudan oynatılır. Adres çözülemezse `null` kalır.
   */
  const sourceChips = sourceRows.map((row) => {
    /**
     * `@megaplay` direktifi: adres SUNUCUDA çözülüp doğrulanır — bu yüzden burada
     * şablonla adres ÜRETİLMEZ (bkz. yukarıdaki `megaplayEmbedQuery` notu). Çözüm
     * gelmediyse/başarısızsa `url` null kalır → satır listeden düşer
     * (`visibleChips`), izleyici 404 ekranına düşemez.
     */
    if (isDirective(row.url) && row.url.slice(1).trim() === "megaplay") {
      return { row, url: verifiedMegaplayUrl };
    }
    /**
     * ⚠️ ANIZM SATIRI — DERLEME ZAMANI TABLOSU OTORİTEDİR.
     *
     * NEDEN: Anizm/puffy bölümü HER COUR İÇİNDE 1'den numaralandırır (Mushoku S1:
     * Part 1 sayfası 1–11, Part 2 sayfası `…-2nd-season` 1–12). Veritabanındaki
     * `episode_sources.url` bir kez YANLIŞ cour sayfasına çözülmüş olabilir
     * (regresyon 29.09.2026: mutlak 12–22, 1. cour'un 1–11. bölümlerine düşmüştü →
     * "12'den sonra 1. sezona sarıyor" belirtisi). `anizmPlayerUrl` (derleme
     * zamanında doğrulanmış tablo, `src/data/anizm-hashes.json`) doğru bölümü
     * veriyorsa satır bununla ezilir; tabloda kayıt yoksa eski davranış korunur.
     */
    if (ANIZM_PLAYER_RE.test(row.url)) {
      return {
        row,
        url: anizmUrl ?? (episodeRequest ? resolveEpisodeEmbed(row.url, episodeRequest) : null),
      };
    }
    return { row, url: episodeRequest ? resolveEpisodeEmbed(row.url, episodeRequest) : null };
  });

  /**
   * AÇILIŞTA OTOMATİK SEÇİLEBİLECEK satırlar — yalnızca GERÇEK adresi olanlar.
   *
   * NEDEN sağlayıcı DİREKTİFLERİ (`@megaplay`) buradan DIŞLANIR: direktif şablonla
   * bir adres ÜRETİR, ama üretilen adresin oynatıcıyı getireceği GARANTİ DEĞİLDİR.
   * Ölçüm (29.09.2026, mushoku-tensei S1B15): `@megaplay` → `megaplay.buzz/stream/
   * mal/39535/15/sub` gömülü iframe'de 404 hata sayfası döndürüyor; satır varsayılan
   * seçildiği için sayfa açılışta 404 ekranına düşüyordu. Bu yüzden açılış seçimi
   * yalnızca bölüme özel, doğrulanmış adresi olan satırlardan (Anizm/TauVideo gibi)
   * yapılır. Direktifler listede KALIR — izleyici isterse tıklayıp seçer.
   */
  const autoSelectableChips = sourceChips.filter(
    (chip) => Boolean(chip.url) && !isDirective(chip.row.url),
  );

  /** Bugünkü (satırlar eklenmeden önceki) oynatma adresi — karşılaştırma tabanı. */
  const todayFallbackEmbed =
    currentEpisode && episodeRequest
      ? resolveEpisodeEmbed(currentEpisode.watch_url, episodeRequest)
      : null;
  /**
   * Doğrulama kapısı: `watch_url` BOŞSA bugünkü çözümleme megaplay ŞABLONUNDAN
   * üretilir (`.../stream/mal/...`) — yani "çözülen adres". Böyle bir adres
   * oynatıcıyı getirmiyorsa (bkz. `megaplayEmbedQuery`) gösterilmez; sıradaki
   * kaynak/satır oynar. Veritabanına ELLE yazılmış adresler (Anizm/TauVideo)
   * doğrulanmaz — dokunulmaz.
   */
  const fallbackEmbed = isMegaplayStreamUrl(todayFallbackEmbed)
    ? verifiedMegaplayUrl
    : todayFallbackEmbed;

  /**
   * `?kaynak=` ile ELLE zorlanan sağlayıcı — bugünkü davranış, aynen korunur.
   *
   * ⚠️ BURADA DOKUNULMADI: adres parametresiyle zorlama (ör. `?kaynak=vidsrc`)
   * mevcut yayın davranışıdır; çipler eklenirken bu yol bozulmamalı.
   */
  const forcedEmbed =
    kaynak === "anizm"
      ? (turkishUrl ?? null)
      : // `?kaynak=megaplay`: şablonla adres üretilmez, DOĞRULANMIŞ adres kullanılır
        // (üretilen adres 404 veriyorsa null → geçerli kaynağa düşülür).
        kaynak === "megaplay"
        ? verifiedMegaplayUrl
        : kaynak && episodeRequest
          ? buildProviderUrl(kaynak, episodeRequest)
          : null;

  /**
   * Elle seçilen çip.
   *
   * Adresi ÇÖZÜLEMEYEN satır (ör. bilinmeyen direktif) seçim sayılmaz: oynatıcıyı
   * boş adrese çevirip "video henüz eklenmedi" ekranına düşürmektense bugünkü adres
   * oynamaya devam etsin.
   */
  const pickedChip = sourceChips.find((chip) => chip.row.id === pickedSourceId && chip.url) ?? null;

  const todayEmbed = forcedEmbed ?? fallbackEmbed;

  /**
   * Başlangıç seçimi (satırlar var ama hiçbirine tıklanmadıysa):
   *   · bugün oynayan kaynak satırlarda VARSA varsayılan DEĞİŞMEZ (kullanıcı isteği),
   *   · yoksa ilk Türkçe satır oynatılır.
   * Eşleşmeye hem ham `url` hem çözülmüş adres üzerinden bakılır: panel `@megaplay`
   * direktifi yazarken bölümün `watch_url`'i düz bir adres olabilir (veya tersi).
   *
   * ⚠️ Yalnızca `autoSelectableChips` denenir: DİREKTİF satırı (`@megaplay`) adres
   * üretse bile oynatıcıyı getireceği garanti olmadığı için başlangıçta SEÇİLMEZ
   * (bkz. yukarıdaki `autoSelectableChips` notu). Aksi hâlde `watch_url` boşken
   * üretilen megaplay adresi bu satırla eşleşiyor ve sayfa açılışta 404'e düşüyordu.
   */
  const matchedChip =
    autoSelectableChips.find(
      (chip) =>
        Boolean(chip.url) &&
        (chip.row.url === (currentEpisode?.watch_url ?? "") || chip.url === todayEmbed),
    ) ?? null;
  /**
   * KULLANICININ SON SEÇTİĞİ KAYNAK (varsa) her şeyin ÖNÜNE geçer: bölüm
   * değişince kaynak sıfırlanmasın (kullanıcı isteği, 28.09.2026).
   * Sıra: son seçilen sağlayıcı → bugün oynayan kaynak → ilk Türkçe → ilk satır.
   *
   * ⚠️ Bu tercih BİLİNÇLİ bir kullanıcı seçimidir (yalnızca çipe tıklanınca
   * yazılır), bu yüzden direktif de olabilir — "değiştirene kadar aynı kaynak"
   * kuralı gereği elle seçilen MegaPlay korunur. Otomatik seçim (aşağıdaki
   * `initialChip` kuyruğu) ise yalnızca `autoSelectableChips` üzerinden yapılır.
   */
  const preferredChip =
    preferredProvider === null
      ? null
      : (sourceChips.find((chip) => chip.row.provider === preferredProvider && Boolean(chip.url)) ??
        null);
  const initialChip =
    preferredChip ??
    matchedChip ??
    autoSelectableChips.find((chip) => chip.row.language === "tr") ??
    autoSelectableChips[0] ??
    null;

  // Kaynak seçimi SIRASI:
  //  1) çipe tıklandıysa o satır,
  //  2) `?kaynak=` ile elle zorlanan sağlayıcı,
  //  3) satırlarda bugünkü kaynak bulunamadıysa ilk Türkçe satır,
  //  4) satır YOKSA bugünkü çözümleme (`watch_url` / varsayılan sağlayıcı) — AYNEN.
  const episodeEmbed =
    currentEpisode && episodeRequest
      ? (pickedChip?.url ?? forcedEmbed ?? initialChip?.url ?? fallbackEmbed)
      : null;

  /**
   * Hangi çip AKTİF boyanır: oynayan adresin satırı. Oynayan adres satırlardan
   * birine karşılık gelmiyorsa hiçbiri aktif görünmez — yanlış çip işaretlenmesin.
   */
  const activeChipId =
    (pickedChip ?? sourceChips.find((chip) => chip.url && chip.url === episodeEmbed))?.row.id ??
    null;

  /**
   * Panelden gelen satırlar → kutu satırları.
   *
   * Hangi kutuya gireceğini satırın KENDİ `language` alanı belirler; sağlayıcı
   * kimliğine bakan "bu Türkçe midir" listesi YOK (kullanıcı isteği: "Türkçe
   * olanları bir yerde, yabancıları bir yerde topla" — sağlayıcı-adı listesi ikinci
   * kez yazılsaydı panelde yeni bir kaynak açıldığında yanlış kutuya düşerdi).
   * Yalnızca açıkça `"tr"` yazan satır Türkçe kutusuna girer, kalan her değer
   * YABANCI kutusuna düşer: tanınmayan bir dil kodu satırı görünmez kılmaz
   * (görünmeyen satır, izleyicinin bulamadığı kaynak demektir).
   *
   * ⚠️ SÜZGEÇ: DİREKTİFİ ÇÖZÜLEMEYEN (adres üretilemeyen) satır listeye HİÇ GİRMEZ.
   * NEDEN: böyle bir satır seçilirse oynatıcı boş adrese düşüyordu; kullanıcının
   * tıklayıp 404/"video yok" ekranına düşebildiği bir düğme hiç gösterilmesin.
   * Adresi ÇÖZÜLEBİLEN direktifler (ör. `@megaplay`) listede KALIR — yalnızca
   * otomatik seçilmez (bkz. `autoSelectableChips`).
   */
  const visibleChips = sourceChips.filter(
    (chip) => !isDirective(chip.row.url) || Boolean(chip.url),
  );

  const rowEntries: SourceBoxEntry[] = visibleChips.map((chip) => ({
    key: chip.row.id,
    language: chip.row.language === "tr" ? "tr" : "en",
    label: sourceChipLabel(chip.row),
    title: isDirective(chip.row.url)
      ? t("watch.directiveTitle", { provider: readableProviderName(chip.row.provider) })
      : chip.row.url,
    // Adresi çözülemeyen DİREKTİF satırı zaten `visibleChips` ile listeden
    // çıkarıldı; buradaki `disabled` emniyet kemeridir (beklenmedik bir durumda
    // oynatıcıyı boş adrese çevirmektense çip pasif kalsın — bkz. `pickedChip`).
    disabled: !chip.url,
    active: activeChipId === chip.row.id,
    select: () => selectEpisodeSource(chip.row),
  }));

  /** Satırsız bölümdeki Türkçe kutu: Anizm → TauVideo → sunucudan arama (bugünkü sıra). */
  const fallbackTurkish: SourceBoxEntry = turkishUrl
    ? {
        key: "fallback-anizm",
        language: "tr",
        label: readableProviderName("anizm"),
        title: t("watch.sourceAnizmTitle"),
        disabled: false,
        active: kaynak === "anizm",
        select: () => switchSource("anizm"),
      }
    : tauUrl
      ? {
          key: "fallback-tauvideo",
          language: "tr",
          label: readableProviderName("tauvideo"),
          title: t("watch.sourceTauTitle"),
          disabled: false,
          active: !kaynak,
          select: () => switchSource(""),
        }
      : {
          key: "fallback-anizm-lookup",
          language: "tr",
          label:
            lookupState === "loading"
              ? t("watch.turkishSearching")
              : lookupState === "missing"
                ? t("watch.turkishNotFound")
                : t("watch.turkishSearch"),
          title: t("watch.turkishSearchHint"),
          disabled: lookupState === "loading",
          pending: lookupState === "loading",
          active: false,
          select: () => void findTurkishSource(),
        };

  /**
   * GERİYE DÖNÜK UYUMLULUK — bölümün `episode_sources` satırı YOKSA (panel kaynak
   * işaretlememiş ya da tablo/migration henüz kurulmamış) bugünkü tek kaynak
   * davranışı AYNEN sürer: oynayan kaynak (kayıttaki `watch_url`, boşsa varsayılan
   * sağlayıcı) ve varsa Türkçe alternatifi çizilir. Silinen eski satırların içeriği
   * kaybolmadı, kendi kutusuna taşındı: izleyici satırsız bölümde de kaynak
   * arayüzünü görür, sayfa asla kaynaksız kalmaz.
   */
  /** Varsayılan (yabancı) kaynak satırı — yalnızca oynayacak adres varsa çizilir. */
  const fallbackDefaultEntry: SourceBoxEntry = {
    key: "fallback-default",
    language: "en",
    label: readableProviderName(ACTIVE_EMBED_PROVIDER),
    title: t("watch.defaultSourceTitle"),
    disabled: false,
    // Bugünkü kural AYNEN: `?kaynak=anizm` yoksa varsayılan kaynak oynar.
    active: kaynak !== "anizm",
    select: () => switchSource(""),
  };

  /**
   * ⚠️ GÜVENLİK SÜZGECİ (29.09.2026): `fallbackEmbed` null ise — yani `watch_url`
   * yok VE sağlayıcı adresi doğrulamayı geçemedi (ör. `@megaplay` 404 veriyor) —
   * varsayılan kaynak düğmesi ÇİZİLMEZ ve `'en'` kutusu tamamen düşer. Aksi hâlde
   * izleyici tıklayınca "video henüz eklenmedi" ekranına (eskiden 404 iframe'ine)
   * giden bir düğme görürdü. Türkçe kutu her durumda kalır → sayfa kaynaksız kalmaz.
   */
  const fallbackEntries: SourceBoxEntry[] =
    sourceRows.length > 0
      ? []
      : fallbackEmbed
        ? [fallbackTurkish, fallbackDefaultEntry]
        : [fallbackTurkish];

  /**
   * Çizilecek satırlar: panel satırı VARSA yalnızca onlar (izleyiciye oynamayan bir
   * kaynak gösterilmesin), YOKSA geriye dönük uyumluluk girdileri. İkisi ASLA
   * birlikte çizilmez — ekrandaki DÖRT kutu tam olarak buradan doğmuştu.
   */
  // ⚠️ ÖZEL BÖLÜM (`0. Bölüm`) İÇİN KAYNAK KUTUSU ÇİZİLMEZ: bölümün
  // `episode_sources` satırı ve oynatıcı adresi yoktur; "Türkçe kaynağı ara" gibi
  // bir düğme göstermek, var olmayan bir bölüm için kaynak varmış izlenimi
  // verirdi. Bunun yerine aşağıda NET bir "bu bölüm için kaynak yok" durumu
  // gösterilir ve diğer bölümler sağdaki listede kalır.
  const sourceBoxEntries: SourceBoxEntry[] = isSpecial
    ? []
    : rowEntries.length > 0
      ? rowEntries
      : fallbackEntries;

  /**
   * Kutular: kaynağı olmayan dil için kutu çizilmez (boş kutu oynatıcının altını
   * kalabalıklaştırır); geriye dönük uyumluluk girdileri sayesinde en az bir kutu
   * her zaman çizilir.
   */
  const sourceBoxes = SOURCE_LANGUAGE_GROUPS.map((group) => ({
    group,
    entries: sourceBoxEntries.filter((entry) => entry.language === group.id),
  })).filter((box) => box.entries.length > 0);

  const watching = Boolean(episodeEmbed) && gateDone;

  /**
   * "Otomatik oynatma" KAPALIYKEN oynatıcı adresine `autostart=false` eklenir.
   * Parametre adı ölçümle doğrulandı: anikoto'nun megaplay adresi
   * `https://megaplay.buzz/stream/s-2/4814/sub?autostart=true` kullanıyor
   * (26.09.2026). Oynatıcı bu bayrağı yok sayarsa otomatik oynatmayı biz
   * engelleyemeyiz — iframe'in içini yönetemiyoruz.
   */
  const effectiveEmbed =
    !autoPlay && episodeEmbed
      ? `${episodeEmbed}${episodeEmbed.includes("?") ? "&" : "?"}autostart=false`
      : (episodeEmbed ?? "");

  /**
   * KENDİ OYNATICI İLERLEMESİ — "kaldığın yer" kaydı + kare yakalama.
   *
   * Yalnızca doğrudan (mp4/HLS) adres olduğunda, yani video BİZİM `<video>`
   * öğemizde oynadığında çağrılır. Embed/iframe durumunda bu yol hiç çalışmaz:
   * cross-origin iframe'in içinden kare okunamaz (tarayıcıda böyle bir API yok,
   * bkz. lib/watch-progress.ts) — orada yalnızca sağlayıcının bildirdiği konum
   * kaydedilir.
   *
   * Yakalama SEYREKTİR: aynı bölümde konum ~10 saniye ilerlemedikçe tekrar
   * yakalanmaz (her `timeupdate`te canvas çizmek gereksiz yük olurdu).
   * Hiçbir hata dışarı sızmaz; oynatma asla bekletilmez.
   */
  function handleVideoProgress(info: {
    video: HTMLVideoElement;
    position: number;
    duration: number;
  }) {
    if (!currentEpisode) return;
    const currentSlug = showSlug(show);
    savePosition(
      currentSlug,
      currentEpisode.season,
      currentEpisode.number,
      info.position,
      info.duration,
    );
    const key = `${currentSlug}:${currentEpisode.season}:${currentEpisode.number}`;
    const last = frameTickRef.current;
    if (last.key === key && Math.abs(info.position - last.position) < 10) return;
    frameTickRef.current = { key, position: info.position };
    // `captureResumeFrame` hata fırlatmaz: başarısızsa kare kaydı değişmez ve
    // arayüz posterde kalır (kırık görsel gösterilmez).
    captureResumeFrame(info.video, currentSlug, currentEpisode.season, currentEpisode.number);
  }

  /** "Bildir" — bölüm bilgisini panoya kopyalar (iletmek isteyen kullanıcı için). */
  async function copyReport() {
    const text = `${t("watch.reportPrefix")}: ${show.title}${
      currentEpisode
        ? ` · ${t("series.seasonEpisodeLabel", {
            season: currentEpisode.season,
            number: currentEpisode.number,
          })}`
        : ""
    }${kaynak === "anizm" ? t("watch.reportAnizmSource") : ""}\n${
      typeof window === "undefined" ? "" : window.location.href
    }`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* pano izni yoksa sessizce geç — buton yine de geri bildirim verir */
    }
    setReportCopied(true);
    /**
     * GÖRÜNÜR GERİ BİLDİRİM SÜRESİ — 1600 ms ÇOK KISAYDI.
     *
     * Denetim (28.09.2026): "Bildir düğmesine basıldı → hiçbir şey olmuyor."
     * Düğme aslında çalışıyordu (bilgi panoya kopyalanıyor) ama (a) kopyalama
     * görünmez bir işlem, (b) yazı 1,6 sn sonra eski hâline dönüyordu; kullanıcı
     * da denetim de "tepki yok" sanıyordu. Süre 4 sn'ye çıkarıldı ve aşağıda
     * düğme YEŞİL + onay ikonuyla vurgulanıyor.
     */
    window.setTimeout(() => setReportCopied(false), 4000);
  }

  /**
   * Türkçe kaynağı SUNUCUDA arar (`/api/anizm`) ve bulursa oynatıcıyı ona çevirir.
   * Bulunamazsa durum düğmenin yazısına yansır — sessizce yutulmaz.
   */
  async function findTurkishSource() {
    if (!currentEpisode) return;
    setLookupState("loading");
    try {
      // `base` + `season` sunucuya verilir: sezon eki tutmazsa aday adresler denenir
      // (bkz. lib/puffy.ts). `puffy` olarak SEZON EKLİ adres gönderilir; düz adres
      // 1. sezonun sayfası olduğu için 2. sezon için yanlış bölümü verirdi.
      const puffyBase = puffySlugFor(showSlug(show));
      const params = new URLSearchParams({
        puffy: puffySlugForSeason(puffyBase, currentEpisode.season),
        base: puffyBase,
        season: String(currentEpisode.season),
        number: String(currentEpisode.number),
        // `min` = SEZONUN en küçük bölüm numarası. NEDEN: katalog bazen bölümleri
        // SERİ GENELİ numaralandırır (Re:Zero 2. sezon: 12…23) ama Türkçe kaynak her
        // sezonu 1'den sayar. Bu parametre olmadan sunucu "13. bölüm"ü isteyip
        // bulamıyordu — panelde düzeltilen hatanın AYNISI burada da vardı (ölçüm
        // 27.09.2026: `/api/anizm?...&min=12` doğru bölümü veriyor, `min` olmadan
        // "puffytr'da 13. bölüm yok" dönüyordu).
        min: String(
          activeSeason && activeSeason.episodes.length > 0
            ? Math.min(...activeSeason.episodes.map((item) => item.number))
            : 1,
        ),
        // KALICI ÇÖZÜM İPUÇLARI (bkz. `routes/api.anizm.ts` → "AĞ DİZİNİ"): kalıp
        // adres tutmazsa sunucu ağın kendi dizininden bulur — bizim slug'ımızla
        // (adres ailesi), başlığımızla (ad eşleşmesi) ve MAL → AniList romaji adıyla.
        show: showSlug(show),
        title: show.title,
        mal: show.mal_id ? String(show.mal_id) : "",
      });
      const res = await fetch(`/api/anizm?${params.toString()}`);
      const json = (await res.json()) as { ok?: boolean; url?: string };
      if (json.ok && json.url) {
        setLookupUrl(json.url);
        setLookupState("idle");
        switchSource("anizm");
        return;
      }
      setLookupState("missing");
    } catch {
      setLookupState("missing");
    }
  }

  /** Kaynak değiştir (URL'ye `kaynak` yazar / kaldırır). */
  function switchSource(key: "" | "anizm") {
    // Sabit kaynaklar (Anizm / Megaplay) seçildiğinde çip seçimi BIRAKILIR: yoksa
    // bırakılan satır `episodeEmbed` önceliğini alıp Megaplay düğmesini işlevsiz
    // bırakırdı (kullanıcı "tıklıyorum ama değişmiyor" derdi).
    setPickedSourceId(null);
    void navigate({
      to: "/anime/$slug/season/$season/episode/$episode",
      // Aynı bölümde kalınır: mevcut YOL parametreleri aynen geri yazılır (değişen
      // yalnızca `kaynak` seçimidir — bölüm aynı bölümdür).
      params: { slug, season: seasonParam, episode: episodeParam },
      search: {
        ...(key ? { kaynak: key } : {}),
      },
    });
  }

  /**
   * Oynatıcı altındaki kaynak çipine tıklandı → oynatıcı o satıra çevrilir.
   *
   * Seçim `pickedSourceId` durumunda tutulur; adresi çözme işi yukarıdaki
   * `sourceChips` hesabında (direktif → bugünkü sağlayıcı yolu, düz adres →
   * doğrudan). `?kaynak=` varsa kaldırılır, çünkü o parametre oynatıcıyı zorlar ve
   * çip seçimi ekranda karşılık bulmaz.
   */
  function selectEpisodeSource(row: EpisodeSource) {
    setPickedSourceId(row.id);
    /**
     * TERCİHİ KAYDET: sonraki bölüm açıldığında aynı sağlayıcı bulunup
     * oynatılır (kullanıcı isteği, 28.09.2026). Kullanıcı başka bir kaynağa
     * tıklarsa tercih ONA döner — yani "değiştirene kadar" hep aynı kaynak kalır.
     */
    writePreferredSource(row.provider);
    setPreferredProvider(row.provider);
    if (!kaynak) return;
    void navigate({
      to: "/anime/$slug/season/$season/episode/$episode",
      params: { slug, season: seasonParam, episode: episodeParam },
    });
  }

  /**
   * Şerit öğesi sınıfı — referansın ÖLÇÜSÜYLE birebir: düz yazı + ikon, yuvarlak
   * kutu/kenarlık/arka plan YOK.
   *
   * Ölçüler referansın MASÜSTÜ ölçümünden (anikototv.to · 26.09.2026, 1536px):
   *   şerit yüksekliği 38px · öğe yazısı 12.825px · öğe iç boşluğu 0 5px ·
   *   ikon 11.2×12.8px (yazının 1em'i, Font Awesome solid)
   * Referansın CSS karşılığı: `#controls{line-height:2.8rem;padding:0 10px}` +
   * `#controls .ctrl{padding:0 5px;font-size:.95rem}` ve kök yazı 13.5px
   * → 2.8rem = 37.8px ≈ 38px, .95rem = 12.825px.
   *
   * ⚠️ İlk denemede ölçüm 1440px'te alınmıştı: referans orada kök yazıyı 12px'e
   * düşürdüğü için öğeler 11.4px çıkıyor. O değerlerle eşitleyince bizim şerit
   * referanstan ~%11 küçük kaldı ve "soluk/ince" göründü. Doğru hedef masaüstü
   * değerleridir; telefonda referans da küçültüyor (kök 12px → 11.4px), bu yüzden
   * dar ekranda alt değer korunuyor.
   * Aradaki boşluk referanstaki düz boşluğun karşılığı (~0.3em).
   * Renkler referansın mavi-grisi yerine BİZİM temadan (kullanıcı isteği).
   */
  const stripItem =
    "inline-flex items-center gap-[0.3em] px-1.5 text-[11.4px] font-normal text-muted-foreground transition-colors hover:text-foreground sm:text-[12.825px]";

  /**
   * Sunucu çipi — ölçü referanstan CANLI ölçümle (`padding:5px 10px`,
   * `border-radius:.25rem` → kök 13.5px ile 3.375px, yükseklik 30px, yazı 13.5px,
   * `margin:3px 0; transition:all .2s`), renkler bizim temadan:
   *   seçili  → accent dolgu (referansta `#26a3d6` dolgu)
   *   diğerleri → koyu dolgu + soluk yazı (referansta `#111b29` + `#8097b2`)
   * Yalnızca SEÇİLİ olan renkli; ötekiler sönük kalır.
   */
  function serverChip(active: boolean) {
    return active
      ? "inline-flex items-center gap-1.5 rounded-[3.375px] bg-accent px-2.5 py-[5px] text-[13.5px] font-semibold text-accent-foreground"
      : "inline-flex items-center gap-1.5 rounded-[3.375px] bg-foreground/[0.07] px-2.5 py-[5px] text-[13.5px] text-muted-foreground transition-colors hover:bg-foreground/[0.12] hover:text-foreground";
  }

  /**
   * Bölüm paneli oynatıcının sağına MUTLAK konumlanacak mı?
   *
   * Evet: masaüstü (≥1024px) ve "Genişlet" kapalıyken — panel oynatıcının
   * yüksekliğine oturur, alt kenarlar denk gelir.
   * Hayır: telefon/tablet ya da genişlet açıkken — panel akışın SONUNDA,
   * bilgi + sunucu satırından sonra tam genişlikte durur. Böylece şerit her
   * boyutta oynatıcının hemen altında kalır (mobildeki şikâyet buydu).
   */
  const floatingSidebar = isDesktop && !wide;

  /**
   * Oynatıcının sağ alt köşesindeki geri sayım metni.
   *
   * Kullanıcı isteği: "video bitimine kaç saniye varsa 'şu kadar süre sonra diğer
   * bölüme geçilecek' uyarısı yaz, 20 saniye kala mesajı ver, süre geçtikçe saysın".
   * Hedef an `remaining` içinde: atlama açıksa jenerik başlangıcı, değilse dosya sonu.
   */
  const countdownNotice =
    remaining !== null && upcoming
      ? t("watch.countdown", { seconds: remaining, number: upcoming.episode.number })
      : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background">
        <div className="mx-auto flex h-[72px] w-full max-w-[1440px] items-center gap-4 px-4 lg:px-8">
          {/* Yatay dolgu YOK: logonun sol kenarı oynatıcının sol kenarıyla tam
              hizalansın (px-1 iken 3-4 px sağda kalıyordu). */}
          <Link to="/" className="flex items-center gap-2 rounded-full py-1">
            <img
              src="/shanime-logo.png?v=6"
              alt={t("common.logoAlt")}
              width={1060}
              height={856}
              loading="eager"
              decoding="async"
              className="h-11 w-auto object-contain sm:h-12"
            />
            <span className="sr-only">{t("common.homeAria")}</span>
          </Link>
          {/* Seri adı detay sayfasına götürür. Sağdaki ayrı "Detay" bağlantısı
              kaldırıldı: aynı işi görüyordu ve üst şeridi kalabalıklaştırıyordu. */}
          <Link
            to="/anime/$slug"
            params={{ slug: showSlug(show) }}
            // flex-1 YOK: bu bağlantı eskiden satırın ortasına kadar uzanan boş
            // alanı da tıklanabilir yapıyordu — metnin çok sağında bile imleç
            // "tıklanabilir" görünüyordu. Artık tıklama alanı metnin kendisi.
            className="min-w-0 max-w-[60%] truncate text-sm font-bold text-muted-foreground transition-colors hover:text-accent"
          >
            {show.title}
            {activeSeason && multipleSeasons ? ` · ${seasonLabel(activeSeason)}` : ""}
          </Link>
          {/* Dil değiştirici: her sayfada görünür (bu şerit sayfanın başlığıdır). */}
          <LanguageToggle className="ml-auto" />
          <Link
            to="/"
            className="flex shrink-0 items-center gap-1.5 text-sm font-bold text-muted-foreground transition-colors hover:text-accent"
          >
            <Home size={16} /> {t("common.home")}
          </Link>
        </div>
      </header>

      {/* Genişlik, üst şeritle AYNI kapsayıcıyı kullanır: oynatıcının sol kenarı
          logoyla, panelin sağ kenarı "Anasayfa" ile aynı hizada durur. */}
      <main className="mx-auto w-full max-w-[1440px] px-4 py-6 lg:px-8">
        <h1 className="sr-only">
          {show.title}
          {currentEpisode
            ? ` ${t("watch.srEpisodeWatch", { number: currentEpisode.number })}`
            : ` ${t("watch.srWatch")}`}
        </h1>
        {watchTop.isFetched && watchTop.code ? (
          <AdSlot slot="ad_watch_top" className="mb-5 flex justify-center" />
        ) : (
          <AdsterraLeaderboard className="mb-5" />
        )}

        {/* Kapak alanı: oynatıcı normal akışta durur ve YÜKSEKLİĞİ O BELİRLER;
            panel masaüstünde sağa mutlak konumlanır ve `inset-y-0` ile tam
            oynatıcının yüksekliğine oturur — ikisinin alt kenarı birebir denk
            gelir. (Izgara/flex ile "uzatma" denendi: panel içeriği uzun olduğu
            için satırı kendisi büyütüyor ve videonun altında ~890 px boş siyah
            alan kalıyordu.) Sağdaki 340 px dolgu, panelin (320 px) + 20 px
            boşluğun yerini ayırır. */}
        <div className={cn("relative", floatingSidebar && "pr-[340px]")}>
          <PlayerBox
            watching={watching}
            showTitle={show.title}
            epNumber={currentEpisode?.number ?? 0}
            epUrl={effectiveEmbed}
            directSrc={directSrc}
            subtitles={episodeSubtitles}
            vastUrls={PREROLL_VAST_URLS}
            notice={countdownNotice}
            emptyMessage={isSpecial ? t("watch.specialNoSource") : undefined}
            onGateFinish={() => setGateDone(true)}
            // Kendi `<video>`muzun ilerlemesi → konum kaydı + kare yakalama.
            onVideoProgress={handleVideoProgress}
          />

          {/* Yalnızca masaüstünde: panel oynatıcının sağına mutlak konumlanır. */}
          {floatingSidebar && activeSeason && currentEpisode && (
            <EpisodeSidebar
              floating
              slug={showSlug(show)}
              seasons={playableSeasons}
              activeSeason={activeSeason}
              currentEpisodeId={currentEpisode.id}
              multipleSeasons={multipleSeasons}
              seriesPoster={show.image}
              malId={show.mal_id ?? null}
              dim={dim}
              autoNext={autoNext}
              showTitle={show.title}
              episodeNumber={currentEpisode.number}
              onToggleAutoNext={() => setAutoNext((value) => !value)}
              onToggleDim={() => setDim((value) => !value)}
            />
          )}
        </div>

        {/* OYNATICI KONTROL ŞERİDİ + ARDINDAN GELEN BİLGİ/SUNUCU SATIRI.
            Yapı referanstan (anikoto/hianime) CANLI ÖLÇÜMLE alındı:
              · şerit yüksekliği 38px · yazı 13.5px/400 · öğe 12.825px/400 ·
                öğe iç boşluğu 0 5px
              · öğeler DÜZ yazı + ikon (yuvarlak kutu, kenarlık, arka plan YOK)
              · açık/kapalı SADECE ikonla belli olur (boş kare ↔ onaylı kare)
              · şerit ile altındaki satır arasında BOŞLUK YOK; yuvarlaklık yalnızca
                bloğun EN ALTINDA — böylece ikisi tek parça gibi durur
            Bizdeki bilinçli farklar (kullanıcı isteği):
              · sağda yalnızca "Bildir" (Add to list / Watch Together istenmedi)
              · renkler referansın mavi-grisi yerine BİZİM tema (accent + muted) */}
        <div
          className={cn(
            // Yükseklik referanstan: satır yüksekliği 2.8rem = 37.8px ≈ 38px (kök 13.5px).
            // Telefonda öğeler alt satıra indiği için yükseklik orada sabit değil.
            "flex items-center justify-between gap-x-2 rounded-b-2xl border-x border-b border-border bg-card px-2.5 py-1.5 text-[11.4px] font-normal text-muted-foreground sm:h-[38px] sm:py-0 sm:text-[12.825px]",
            floatingSidebar && "mr-[340px]",
          )}
        >
          {/* Dar ekranda öğeler TAŞMAZ: alt satıra iner (referansın telefonda
              şeridi satırlara sarması gibi); geniş ekranda tek satır kalır. */}
          <div className="flex min-w-0 flex-wrap items-center whitespace-nowrap sm:flex-nowrap">
            {/* "Genişlet" yalnızca masaüstünde anlamlı: panel orada oynatıcının
                sağına konumlanıyor. Telefon/tablette panel zaten videonun altında
                olduğu için düğme hiçbir şey değiştirmiyordu — referans da bu
                düğmeyi dar ekranda gizliyor. */}
            {isDesktop && (
              <button
                type="button"
                aria-pressed={wide}
                onClick={() => setWide((value) => !value)}
                className={stripItem}
              >
                <FaSolid name="expand" /> {t("watch.expand")}
              </button>
            )}
            {(
              [
                {
                  on: autoPlay,
                  toggle: () => setAutoPlay((value) => !value),
                  label: t("watch.autoPlay"),
                },
                // "Otomatik geçiş" (Oto. Sonraki Bölüm) buradan KALDIRILDI:
                // kullanıcı isteğiyle bölüm listesinin üstündeki panele taşındı
                // (bkz. EpisodeSidebar → SidebarSwitch).
                {
                  on: autoSkip,
                  toggle: () => setAutoSkip((value) => !value),
                  label: t("watch.autoSkip"),
                  accent: true,
                },
              ] satisfies { on: boolean; toggle: () => void; label: string; accent?: boolean }[]
            ).map((item) => (
              <button
                key={item.label}
                type="button"
                aria-pressed={item.on}
                onClick={item.toggle}
                // Renk çakışması `cn` ile çözülür: `stripItem` içindeki
                // `text-muted-foreground` ile `text-accent` AYNI özelliği yazar;
                // eskiden ikisi birlikte yazıldığı için kazananı CSS sırası
                // belirliyordu ve "Otomatik atlama" gri kalıyordu.
                className={cn(stripItem, item.accent && "text-accent")}
              >
                {/* Referansın (anikoto) ikon mantığı — canlı HTML'den birebir:
                      data-off='<i class="fa-solid fa-square"></i> ...'
                      data-on='<i class="fa-solid fa-check"></i> ...'
                    Yani KAPALI = dolu kare, AÇIK = kalın tik. İkonlar Font Awesome
                    SOLID ve yazıyla aynı ölçekte (1em); önceki 12px ince çizgili
                    ikonlar referansın yanında "boş/soluk" kalıyordu. */}
                <FaSolid name={item.on ? "check" : "square"} />
                {item.label}
              </button>
            ))}

            {/* "Işık" da şeritten kaldırıldı: "Sahne Işıkları" adıyla bölüm
                listesinin üstündeki panele taşındı (animecix düzeni). */}

            {/* Önceki / Sonraki bölüm de bu şeritte (referanstaki gibi). */}
            {activeSeason && currentEpisode && (
              <EpisodeNav
                slug={showSlug(show)}
                multipleSeasons={multipleSeasons}
                previous={previous}
                upcoming={upcoming}
              />
            )}
          </div>

          {/* Sağ grup tek kapta: kapsayıcı `justify-between` olduğu için iki çocuk
              kalması düzeni korur (sol grup solda, bu grup sağda). */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* Geçiş/jenerik bilgisi — "Bildir"in solunda.
                NEDEN: kullanıcı "süreyi geçti, geçmedi" diyordu; otomatik geçişin
                NEDEN ve NE ZAMAN olduğunu görebilmesi için kısa bir bilgi. */}
            {advancing && (
              <span className="inline-flex animate-pulse items-center gap-1.5 px-1.5 text-[11.4px] font-bold text-accent sm:text-[12.825px]">
                <FaSolid name="forwardStep" /> {advancing}
              </span>
            )}
            {!advancing && skipHint && (
              <span className="hidden items-center gap-1.5 px-1.5 text-[11.4px] text-muted-foreground/80 sm:inline-flex sm:text-[12.825px]">
                {skipHint}
              </span>
            )}

            <button
              type="button"
              onClick={() => void copyReport()}
              className={cn(
                stripItem,
                // KOPYALANDIĞI GÖRÜNSÜN: kopyalama görünmez bir işlem olduğu için
                // düğme yeşile dönüp onay ikonu gösteriyor (denetim: "hiçbir şey
                // olmuyor" sanılıyordu).
                reportCopied && "font-bold text-emerald-600 hover:text-emerald-600",
              )}
              title={t("watch.reportTitle")}
            >
              <FaSolid name={reportCopied ? "check" : "triangleExclamation"} />{" "}
              {reportCopied ? t("watch.reportCopied") : t("watch.report")}
            </button>
          </div>
        </div>

        {/* BİLGİ + SUNUCU BLOĞU — referansın `#w-servers` düzeni, oynatıcıdan AYRI:
              · referans: `#w-servers{margin-top:10px;border-radius:5px;overflow:hidden}`
                yani şeritten 10px boşlukla ayrılan, kendi çerçeveli kutusu
              · solda bilgi paneli (kendi dolgusu + sağ kenarında ayraç çizgisi)
              · sağda satırlar; satırlar arasında KESİK çizgi
                (referans: `.type+.type{border-top:1px dashed #142030}`)
              · her satırın başında DOLU ikon + etiket (referansta SUB/DUB/DL),
                her çipte dolu daire-oynat glifi; yalnızca SEÇİLİ çip renkli
            Referansta SUB/HSUB/DUB/DL satırları var; bizde ise TAM İKİ kutu:
            kaynaklar panelin işaretlediği `episode_sources` satırlarından gelir ve
            satırın `language` alanına göre TÜRKÇE / YABANCI kutusuna dağılır
            (kullanıcı isteği 27.09.2026: "4 kutu görüyorum, 2 kutu olmalı"). */}
        <div
          className={cn(
            "mt-2.5 flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-opacity sm:flex-row",
            floatingSidebar && "mr-[340px]",
            dim && "opacity-40",
          )}
        >
          {/* Sol panel — referansta metin ORTALANMIŞ durur; aynı düzeni kurduk.
              Ton: `bg-secondary/30` şeritle BİREBİR aynı piksele düşüyordu (ikisi de
              #040507), panel ayırt edilemiyordu; bu yüzden ön plandan hafif bir açık
              katman (%7) kullanılıyor. Panelin sağ kenarındaki çizgi, referanstaki
              `#w-servers` içindeki dikey ayracın karşılığı. */}
          <p className="flex items-center justify-center bg-foreground/[0.07] px-[15px] py-3.5 text-center text-[13.5px] leading-relaxed text-muted-foreground sm:w-[300px] sm:shrink-0 sm:border-r sm:border-border">
            <span>
              {/* Cümle İKİ anahtara bölünür: kalın kısım diller arasında aynı rolü
                  korur ("3. bölümü" ↔ "Episode 3"), kuyruk ayrı çevrilir. Böylece
                  İngilizce kelime sırası bozulmadan kalın kapsamı korunur. */}
              <b className="text-foreground">
                {t("watch.nowWatchingStrong", { number: currentEpisode?.number ?? "-" })}
              </b>{" "}
              {t("watch.nowWatchingTail")}
              <br />
              {t("watch.tryOtherSource")}
            </span>
          </p>

          {/* Sağ alan — İKİ kutu: TÜRKÇE ve YABANCI.
              Kullanıcı isteği (27.09.2026): "4 kutu görüyorum, 2 kutu olmalı; Türkçe
              olanları bir yerde, yabancıları bir yerde topla." Burada eskiden İKİ kod
              yolu vardı: (a) sabit Anizm/Megaplay satırları, (b) panelden gelen
              `episode_sources` grupları. Aynı kaynak iki kez çizildiği için ekranda
              DÖRT kutu görünüyordu; artık TEK liste (`sourceBoxes`) çizilir, yani
              çift çizim yapısal olarak imkânsız.
              Satır ölçüleri referanstan (`#w-servers .servers .type`): satır iç
              boşluğu `10px 15px`, satırlar arası KESİK çizgi, etiket `min-width:70px`.
              Kutu başlığı yalnızca o dilde kaynak VARSA çizilir: boş kutu oynatıcının
              altını kalabalıklaştırırdı. Satırsız bölümde geriye dönük uyumluluk
              girdileri devreye girer (`fallbackEntries`) — sayfa kaynak arayüzünü
              hiçbir durumda kaybetmez. */}
          <div className="flex flex-1 flex-col justify-center border-t border-dashed border-border sm:border-t-0">
            {/*
              ÖZEL BÖLÜM (`0. Bölüm`) — KAYNAK YOK DURUMU.
              Kullanıcı isteği (29.09.2026, ikinci tur): "oynatılabilir kaynak yoksa
              404 YERİNE net bir 'Bu bölüm için kaynak yok' durumu (ve varsa diğer
              bölümler listesi) gösterilsin." Metin BİREBİR budur; kaynak
              uydurulmaz ve ep 1'e düşülmez.
            */}
            {isSpecial ? (
              <div className="flex flex-wrap items-center gap-2 px-[15px] py-[10px]">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-[12px] font-bold text-amber-500">
                  <FaSolid name="triangleExclamation" />
                  {t("watch.specialNoSource")}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  {t("watch.specialNoSourceHint")}
                </span>
              </div>
            ) : null}
            {sourceBoxes.map((box, index) => (
              <div
                key={box.group.id}
                className={cn(
                  "flex flex-wrap items-center px-[15px] py-[10px]",
                  // İlk kutunun üstündeki ayraç kapsayıcının `border-t` değerinden gelir;
                  // sonrakiler referanstaki `.type+.type` gibi kesik çizgiyle ayrılır.
                  index > 0 && "border-t border-dashed border-border",
                )}
              >
                <span className="mr-2.5 inline-flex w-[86px] shrink-0 items-center gap-1.5 text-[13.5px] text-muted-foreground">
                  <FaSolid name={box.group.icon} /> {t(box.group.titleKey)}
                </span>
                <div
                  className={cn(
                    "gap-1.5",
                    /*
                      DİĞER ÇEVİRİLER ALT ALTA (kullanıcı isteği, 28.09.2026):
                      "diğer çeviriler alt alta görünsün bide ya." Bu grupta kaynak
                      sayısı arttıkça yan yana dizmek satırı taşırıyor ve hangi
                      kaynağın hangisi olduğu zor okunuyordu; artık dikey liste
                      (her satır tam genişlik). ALTYAZI grubu yan yana kalır —
                      2-3 çip orada sorunsuz sığıyor ve üstteki kompakt görünümü
                      koruyor.
                    */
                    box.group.id === "en"
                      ? "flex flex-col items-stretch"
                      : "flex flex-wrap items-center",
                  )}
                >
                  {box.entries.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      disabled={entry.disabled}
                      onClick={entry.select}
                      // O AN OYNAYAN kaynak, ekran görüntüsündeki `Türkçe → Anizm`
                      // satırıyla AYNI sarı (accent) dolguyla boyanır: yeni bir aktif
                      // stil açılmadı, mevcut `serverChip` kullanılıyor.
                      className={cn(
                        serverChip(entry.active),
                        entry.disabled && "cursor-not-allowed opacity-50",
                      )}
                      title={entry.title}
                    >
                      {entry.pending ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <FaSolid name="circlePlay" className="text-[0.8em]" />
                      )}
                      {entry.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* TELEFON / TABLET BÖLÜM PANELİ (ve masaüstünde "Genişlet" açıkken).
            Yeri bilinçle EN SONDA: şerit ile bilgi/sunucu satırı her boyutta
            oynatıcının hemen altında kalır, panel onların altına iner. Panelin
            tek kopyası vardır — yukarıdaki masaüstü kopyasıyla birlikte
            çizilseydi liste iki kez görünür ve şerit oynatıcıdan koparılırdı. */}
        {!floatingSidebar && activeSeason && currentEpisode && (
          <EpisodeSidebar
            floating={false}
            slug={showSlug(show)}
            seasons={playableSeasons}
            activeSeason={activeSeason}
            currentEpisodeId={currentEpisode.id}
            multipleSeasons={multipleSeasons}
            seriesPoster={show.image}
            malId={show.mal_id ?? null}
            dim={dim}
            autoNext={autoNext}
            showTitle={show.title}
            episodeNumber={currentEpisode.number}
            onToggleAutoNext={() => setAutoNext((value) => !value)}
            onToggleDim={() => setDim((value) => !value)}
          />
        )}

        {/* Bilgi satırı + reklam: oynatıcının altında, oynatıcı genişliğinde. */}
        <div
          className={cn(
            "mt-4 space-y-4 transition-opacity",
            floatingSidebar && "pr-[340px]",
            dim && "opacity-40",
          )}
        >
          {/* NOT: Kaynak seçimi artık yukarıdaki "sunucu" bölümünde (referans düzeni):
              Türkçe → Anizm (altyazı videoya gömülü), İngilizce → Megaplay (oynatıcının
              kendi CC menüsü). Eski "Altyazı: Kapalı/Türkçe" menüsü ve yerel .vtt
              katmanı tamamen kaldırılmıştı. */}

          {/* Oynatıcının altındaki bilgi satırı (animecix düzeni). */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-foreground sm:text-base">
                {currentEpisode
                  ? `${t("series.seasonEpisodeLabel", {
                      // `sezon` rota parametresinden gelir ve bozuk adreste
                      // `undefined` olabilir; o durumda bölümün kendi sezonu yazılır.
                      season: sezon ?? currentEpisode.season,
                      number: currentEpisode.number,
                    })}${
                      translatedEpisodeTitle || currentEpisode.title
                        ? ` · ${translatedEpisodeTitle || currentEpisode.title}`
                        : ""
                    }`
                  : t("watch.noEpisode")}
              </p>
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="truncate">
                  {show.title}
                  {activeSeason && multipleSeasons ? ` · ${seasonLabel(activeSeason)}` : ""}
                </span>
                {/* AKTİF KAYNAK rozeti (animecix'teki "Tempest Fansub" çizgisi):
                    izleyici hangi kaynağın oynadığını bir bakışta görsün. */}
                <span className="shrink-0 rounded-full border border-border/60 bg-secondary/20 px-2 py-0.5 text-[10px] font-bold">
                  {episodeEmbed?.includes("anizmplayer.com")
                    ? t("watch.badgeAnizm")
                    : t("watch.badgeMegaplay")}
                </span>
              </p>
            </div>
          </div>

          {watchBottom.isFetched && watchBottom.code ? (
            <AdSlot slot="ad_watch_bottom" className="flex justify-center" />
          ) : (
            <AdsterraNative className="flex justify-center" />
          )}
        </div>
      </main>
    </div>
  );
}

/** Oynatıcı + video öncesi reklam kapısı. */
function PlayerBox({
  watching,
  showTitle,
  epNumber,
  epUrl,
  directSrc,
  subtitles,
  vastUrls,
  notice,
  emptyMessage,
  onGateFinish,
  onVideoProgress,
}: {
  watching: boolean;
  showTitle: string;
  epNumber: number;
  epUrl: string;
  /**
   * Oynatılacak adres YOKKEN gösterilecek metin. `undefined` ise genel
   * "video henüz eklenmedi" yazılır; özel bölümde "bu bölüm için kaynak yok"
   * geçilir (bölüm var, kaynağı yok — ikisi farklı durum).
   */
  emptyMessage?: string | undefined;
  /** Doğrudan oynatılabilir adres (mp4/HLS). Varsa Fluid Player kullanılır. */
  directSrc: string;
  /** Fluid Player için VTT altyazı listesi (boş olabilir). */
  subtitles: FluidSubtitle[];
  /** Video öncesi reklam (VAST) etiketleri. */
  vastUrls: string[];
  /**
   * Oynatıcının SAĞ ALT köşesinde gösterilen küçük bilgi metni
   * (otomatik geçiş geri sayımı). `null` ise hiç çizilmez.
   */
  notice: string | null;
  /** Reklamlar bitince çağrılır; bölüm oynatıcısı o zaman yüklenir. */
  onGateFinish: () => void;
  /**
   * Kendi `<video>`muzun ilerlemesi (iframe dalında hiç çağrılmaz).
   * Ayrıntı: `FluidPlayer` → `onVideoProgress`.
   */
  onVideoProgress?:
    ((info: { video: HTMLVideoElement; position: number; duration: number }) => void) | undefined;
}) {
  const { t } = useLang();
  // Sağlayıcı iframe'inin ref'i: own altyazı katmanı köprüye bununla komut gönderir.
  const iframeRef = useRef<HTMLIFrameElement>(null);

  return (
    // Alt köşeler DÜZ ve alt kenarlık YOK: hemen altında kontrol şeridi + bilgi
    // satırı tek blok hâlinde devam ediyor. Videoyu alttan yuvarlatınca/blok
    // sınırı çizince arada basamak gibi bir çentik görünüyordu.
    <div className="relative overflow-hidden rounded-t-2xl border-x border-t border-border bg-black">
      {watching ? (
        directSrc ? (
          // Kendi oynatıcımız. YALNIZCA bölümün doğrudan (mp4/HLS) adresi
          // varsa kullanılır: Fluid Player bir iframe oynatamaz, bu yüzden
          // sağlayıcı embed'leri aşağıdaki dala düşer.
          <FluidPlayer
            src={directSrc}
            title={t("watch.playerTitle", { title: showTitle, number: epNumber })}
            subtitles={subtitles}
            // Kare yakalama YALNIZCA burada mümkündür: video bizim <video>
            // öğemizde oynuyor. Aşağıdaki iframe dalında bu yetenek YOKTUR.
            onVideoProgress={onVideoProgress}
          />
        ) : (
          // NOT: sağlayıcının üst şeridini ("S01 E01" yazan) KAPATMAK için kendi
          // şeridimizi çizme denemesi yapıldı (25.09.2026) — kullanıcı istemedi,
          // kaldırıldı. Sağlayıcının yazısı cross-origin iframe'in içinde; bizim
          // katmanımız onu boyuyor ve çirkin duruyor. Metin değiştirilemez.
          //
          // ⚠️ "KALDIĞIN YER" KARESİ BURADA ÜRETİLEMEZ (dürüst sınır): bu iframe
          // cross-origin bir belgedir; tarayıcı güvenlik kuralı gereği içindeki
          // videonun karesi canvas'a çizilemez (`SecurityError`, kirli tuval) ve
          // tarayıcıda "iframe içindeki videodan kare al" API'si YOKTUR. Bu yüzden
          // iframe dalı kare yakalamayı hiç DENEMEZ; ana sayfadaki devam satırı
          // sessizce seri posterine düşer (kırık görsel ya da uydurma kare yok).
          // Burada yalnızca sağlayıcının `postMessage` ile bildirdiği KONUM
          // kaydedilir (bkz. yukarıdaki `event:"time"` işleyicisi).
          // `relative` sarmalayıcı: kendi altyazı katmanımız iframe'in üstüne
          // konumlanıyor (bkz. SubtitleOverlay). Üst şerit denemesi gibi bir
          // kaplama DEĞİL — yalnızca altyazı satırı ve küçük bir aç/kapa düğmesi.
          <div className="relative">
            <iframe
              ref={iframeRef}
              src={epUrl}
              title={t("watch.playerTitle", { title: showTitle, number: epNumber })}
              loading="lazy"
              // `sandbox` YOK — popunder'ı engellemek için DENENDİ ve BAŞARISIZ OLDU.
              //
              // Ölçüm (25.09.2026 · aynı URL + aynı sayfa + aynı referrer,
              // TEK değişken `sandbox`):
              //   sandbox="allow-scripts allow-same-origin allow-forms
              //            allow-presentation allow-orientation-lock"
              //   → Streamtape: "Client blocked! / Your browser or the embed you are
              //     viewing are doing nasty things!"  (sandbox'ı ALGILIYOR)
              //   → VidMoly:    "The embed could not be loaded."
              //   → sandbox'SIZ aynı iframe: VidMoly gerçek oynatıcıyı yüklüyor
              //     (poster + play), Streamtape CAPTCHA kapısına geliyor.
              //
              // Yani sağlayıcılar sandbox'lı embed'i reddediyor → "popup engelle +
              // video oynat" birlikte MÜMKÜN DEĞİL. Embed'in kendi belgesi içindeki
              // davranış dışarıdan kontrol edilemiyor. Kanıt: OYNATICI-FLUIDPLAYER.md §6.
              //
              // vidsrc.to için de DENENDİ (25.09.2026) — İKİ AYRI ENGEL var:
              //  1) Zincirin ikinci halkası `vsembed.ru`, `/assets/sbx.js` adlı bir
              //     "Sandbox-embed blocker" yüklüyor (kendi yorumu birebir:
              //     "If that page is loaded inside an <iframe sandbox> ... this frame
              //      is redirected to /sandbox.php?ref=<embedding host>").
              //  2) A/B ölçümü (aynı sayfa, 3 hücre: sandbox'suz · allow-same-origin'li
              //     sandbox · allow-same-origin'siz sandbox): HER İKİ sandbox
              //     varyantında en içteki oynatıcı şunu yazdı —
              //     "This content can't be embedded in a sandboxed frame /
              //      The player was loaded inside an <iframe sandbox>, which isn't
              //      permitted."
              //     (sandbox'suz aynı adres gerçek oynatıcıyı getirdi.)
              // Sonuç: vidsrc'te pop-up'ı sandbox ile engellemek MÜMKÜN DEĞİL.
              // Pop, sağlayıcının kendi belgesi içinde oluşturuluyor (window.open
              // hook'u + gizli iframe + localStorage 60 sn soğuma).
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
              // bg-black: iframe kendi belgesini boyayana kadar geçen sürede
              // tarayıcının varsayılan BEYAZ zeminini görmemek için (iOS'ta beyaz
              // kenar/çerçeve gibi görünüyordu). Sarmalayıcı da siyah.
              className="aspect-video w-full bg-black"
            />
          </div>
        )
      ) : epUrl ? (
        <PrerollGate
          vastUrls={vastUrls}
          title={t("watch.playerTitle", { title: showTitle, number: epNumber })}
          onFinish={onGateFinish}
        />
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 bg-black/90 px-6 text-center">
          {/* Özel bölümde metin "kaynak yok"tur (genel "video eklenmedi" değil):
              bölüm GERÇEKTEN var (katalogda), yalnızca oynatılabilir kaynağı yok. */}
          <p className="text-sm text-muted-foreground">{emptyMessage ?? t("watch.noVideo")}</p>
        </div>
      )}

      {/* GEÇİŞ BİLGİSİ — oynatıcının SAĞ ALT köşesi, kontrol çubuğunun ÜSTÜNDE
          (`bottom-14`): oynatıcının kendi düğmelerini (10 sn, CC, ayarlar, tam
          ekran) kapatmasın. `pointer-events-none` olduğu için tıklamayı engellemez.
          Kullanıcı isteği: "20 saniye kala mesajı ver, süre geçtikçe saysın". */}
      {notice && (
        <span className="pointer-events-none absolute bottom-14 right-3 z-20 rounded-lg bg-black/90 px-2.5 py-1.5 text-[11.5px] font-bold text-white/90">
          {notice}
        </span>
      )}
    </div>
  );
}

/**
 * Panel anahtarı (animecix'teki yuvarlak anahtarın karşılığı).
 *
 * NEDEN ayrı bileşen: iki anahtar aynı görünmeli; kopyala-yapıştır ile iki farklı
 * stil oluşmasın. Etiket anahtarın SAĞINDA (referans düzeni).
 */
function SidebarSwitch({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      title={hint}
      className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left transition-colors hover:bg-secondary/50"
    >
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
          on ? "border-primary bg-primary" : "border-border bg-secondary",
        )}
      >
        <span
          className={cn(
            "absolute top-[1px] size-4 rounded-full transition-all",
            on ? "left-[18px] bg-accent-foreground" : "left-[1px] bg-muted-foreground",
          )}
        />
      </span>
      <span
        className={cn("text-[12.5px] font-bold", on ? "text-foreground" : "text-muted-foreground")}
      >
        {label}
      </span>
    </button>
  );
}

/** Sağdaki bölüm paneli: sezon seçimi + kaydırılabilir bölüm listesi. */
function EpisodeSidebar({
  slug,
  seasons,
  activeSeason,
  currentEpisodeId,
  multipleSeasons,
  seriesPoster,
  malId,
  dim,
  autoNext,
  showTitle,
  episodeNumber,
  onToggleAutoNext,
  onToggleDim,
  floating,
}: {
  slug: string;
  seasons: SeasonWithEpisodes[];
  activeSeason: SeasonWithEpisodes;
  currentEpisodeId: string;
  multipleSeasons: boolean;
  /** Seri posteri: kapağı üretilemeyen bölümler için son çare (bkz. EpisodeCard). */
  seriesPoster?: string | undefined;
  /** MAL kimliği: bölüme ait gerçek görseli (ani.zip) kullanmak için (bkz. EpisodeCard). */
  malId?: number | null | undefined;
  /** "Sahne Işıkları" açıkken panel karartılır (dikkat videoda kalsın). */
  dim: boolean;
  /**
   * "Oto. Sonraki Bölüm" anahtarının durumu.
   *
   * Kullanıcı isteğiyle şeritten buraya (bölüm listesinin ÜSTÜNE) taşındı —
   * animecix'in "İLİŞKİLİ VİDEOLAR" panelindeki iki anahtarla aynı düzen.
   */
  autoNext: boolean;
  /** Panel başlığında gösterilen seri adı ve bölüm numarası. */
  showTitle: string;
  episodeNumber: number;
  onToggleAutoNext: () => void;
  onToggleDim: () => void;
  /**
   * true → panel oynatıcının sağına MUTLAK konumlanır (`inset-y-0` ile
   * oynatıcının yüksekliğine oturur; alt kenarlar denk gelir).
   * false → panel akışın sonunda, tam genişlikte durur (telefon/tablet ya da
   * "Genişlet" açık). Kararı üst bileşen verir: `floatingSidebar`.
   */
  floating: boolean;
}) {
  // Ref doğrudan <li> üzerinde tutulur: `Link` bileşeninin ref'i DOM düğümüne
  // iletilmediği için kaydırma çalışmıyordu.
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const navigate = useNavigate();
  const { t } = useLang();

  /**
   * BÖLÜM ADLARI (yan panel) — içerik çevirisi.
   *
   * NEDEN TEK ÇAĞRIDA TÜM LİSTE: kancalar `map` içinde çağrılamaz (React kuralı).
   * Bu yüzden aktif sezonun adları TEK dizide çeviriye verilir, sonuç indeksle
   * eşlenir. İstemci gönderimi 50'lik parçalara böler (bkz.
   * `lib/content-translate.ts` `BATCH`), sunucu isteği başına sınır da var.
   *
   * İlk açılışta birkaç istek olabilir; sonrasında `localStorage` önbelleğinden
   * gelir, ağa HİÇ çıkılmaz. Dil İngilizce iken hiç istek yapılmaz.
   */
  const sidebarEpisodes = activeSeason.episodes;
  /**
   * ⚠️ DESTRUCTURING YAPMA! `useTranslatedTexts` GİRDİYLE AYNI UZUNLUKTA BİR DİZİ
   * döndürür (her girdi metni için bir çeviri) — tuple DEĞİL.
   *
   * YAPILAN HATA (28.09.2026, canlı ölçümle yakalandı): burada
   * `const [translatedSidebarTitles] = useTranslatedTexts([...24 ad...])`
   * yazılmıştı. Köşeli parantez dizinin YALNIZCA İLK elemanını alır → elimizde
   * tek bir metin ("Ryomen Sukuna") kalır. Sonra `[index]` ile indekslenince
   * harfler çıkar: 1. bölüm "R", 2. bölüm "y", 3. bölüm "o", 4. "m", 5. "e",
   * 6. "n" — yani "Ryomen" kelimesi bölümlere DAĞILMIŞ gibi görünüyordu.
   * (Ölçüm: 1-6. satırların textContent'i sırayla R, y, o, m, e, n; 7. satır
   * boşluk, 8-13 "Sukuna"; 14'ten sonrası `[index]` undefined olduğu için
   * ORİJİNAL ada düşüyordu.)
   *
   * Çözüm: dizinin TAMAMINI al. `?.[index]` güvenliği aşağıda zaten var.
   */
  const translatedSidebarTitles = useTranslatedTexts(
    sidebarEpisodes.map((item) => item.title?.trim() ?? ""),
  );

  // Liste açılırken mevcut bölüm görünür olsun (1000 bölümlük seride şart).
  //
  // `scrollIntoView` BURADA ÇALIŞMIYOR: effect, yerleşim oturmadan çalışıyor ve
  // hiç kaydırma yapmıyor. Bu yüzden kaydırma iki adımda elle yapılır — önce
  // çizimin tamamlanması beklenir, sonra kapsayıcının scrollTop'u hesaplanır.
  //
  // İKİNCİ DENEME (kapak resimleri geç yüklenip satır boylarını değiştirince
  // ilk hesap şaşıyordu; liste tepede kalıyordu). Aynı değere yazmak görsel
  // sıçrama yapmaz — zaten doğruysa no-op'tur.
  useEffect(() => {
    const scrollToActive = () => {
      const list = listRef.current;
      const row = activeRef.current;
      if (!list || !row) return;
      // Mutlak konum yerine fark kullanılır: offsetTop, konumlanmış bir üst
      // öğeye göreli olabilir.
      const offset =
        row.getBoundingClientRect().top -
        list.getBoundingClientRect().top +
        list.scrollTop -
        (list.clientHeight - row.clientHeight) / 2;
      list.scrollTop = Math.max(0, offset);
    };
    const frame = window.requestAnimationFrame(scrollToActive);
    const late = window.setTimeout(scrollToActive, 600);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(late);
    };
  }, [currentEpisodeId]);

  return (
    // Panel, ızgaranın 1. satırında durur; yüksekliğini oynatıcı belirler ve
    // panel ona uzar (alt kenarlar denk gelir). İçerideki liste kalan alanı
    // doldurup kendi içinde kaydırılır — bu yüzden `min-h-0` şart, yoksa liste
    // taşar ve paneli uzatır.
    <aside
      className={cn(
        "mt-5 flex max-h-[60vh] flex-col transition-opacity",
        floating && "absolute inset-y-0 right-0 mt-0 w-[320px] max-h-none",
        dim && "opacity-40",
      )}
    >
      {/* ANIMECIX DÜZENİ — bölüm listesinin ÜSTÜNDE oynatıcı tercihleri.
          Kullanıcı isteği: "oto sonraki bölümü sağ tarafa, bölümlerin üstüne koy".
          Kapak + seri/bölüm adı + iki anahtar (Oto. Sonraki Bölüm · Sahne Işıkları). */}
      <div className="shrink-0 border-b border-border p-3">
        <div className="flex items-center gap-2.5">
          {seriesPoster ? (
            <img
              src={seriesPoster}
              alt=""
              loading="lazy"
              className="h-14 w-10 shrink-0 rounded-lg border border-border object-cover"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold text-foreground">{showTitle}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {/* SAĞ PANEL BAŞLIĞINDA SEZON YAZILMAZ — kullanıcı düzeltmesi
                  (28.09.2026): "sağ taraftaki yerlerde sezona gerek yok, '1. Bölüm'
                  yazsan yeter." Hemen üstündeki panelde "1. Sezon" seçicisi var;
                  burada tekrarlamak gereksizdi. */}
              {t("series.episodeLabel", { number: episodeNumber })}
            </p>
          </div>
        </div>
        <div className="mt-2.5 space-y-1">
          <SidebarSwitch
            label={t("watch.autoNextLabel")}
            hint={t("watch.autoNextHint")}
            on={autoNext}
            onToggle={onToggleAutoNext}
          />
          <SidebarSwitch
            label={t("watch.dimLabel")}
            hint={t("watch.dimHint")}
            on={dim}
            onToggle={onToggleDim}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-extrabold text-foreground">{t("series.episodesHeading")}</h2>
          {multipleSeasons ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="sr-only">{t("series.seasonSelectSr")}</span>
              <select
                value={activeSeason.number}
                onChange={(event) => {
                  // Sezon değişince o sezonun ilk bölümüne gidilir.
                  const target = seasons.find(
                    (season) => season.number === Number(event.target.value),
                  );
                  const first = target?.episodes[0];
                  if (!first || !target) return;
                  void navigate({
                    to: "/anime/$slug/season/$season/episode/$episode",
                    params: { slug, season: String(target.number), episode: String(first.number) },
                  });
                }}
                className="h-8 rounded-lg border border-border bg-background px-2 text-xs font-bold text-foreground outline-none focus:border-accent"
              >
                {seasons.map((season) => (
                  <option key={season.id} value={season.number}>
                    {seasonLabel(season)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="text-xs font-bold text-muted-foreground">
              {/* DÜZELTME (S2): doğrudan `home.episodeCount` kullanılıyordu; İngilizcede
                  tek bölümde "1 episodes" yazıyordu. `plural` 1 için `…One` anahtarını seçer
                  (Türkçede iki anahtarın değeri aynıdır; bkz. i18n.ts). */}
              {plural(t, activeSeason.episodes.length, "home.episodeCountOne", "home.episodeCount")}
            </span>
          )}
        </div>

        <div
          ref={listRef}
          // Mobilde liste ekranın %60'ıyla sınırlı; masaüstünde panel zaten
          // oynatıcı yüksekliğinde olduğu için ayrıca sınır gerekmez.
          className={cn(
            "ince-kaydirma max-h-[60vh] min-h-0 flex-1 overflow-y-auto p-1.5",
            floating && "max-h-none",
          )}
        >
          <ul className="space-y-0.5">
            {/*
              ═══════════════════════════════════════════════════════════════════
              ÖZEL BÖLÜMLER (0. Bölüm) ARTIK AŞAĞIDAKİ BÖLÜM LİSTESİNİN İÇİNDE.

              İlk sürüm (29.09.2026) burada KATALOGDAN sentetik "0. Bölüm"
              satırları çiziyordu; veritabanı satırı olmasa bile. Kullanıcı
              bildirimi (30.09.2026): "Re:Zero eklerken hiçbir 0. bölümü
              seçmedim ama oynatıcı sayfasında bir sürü var, kaynakları da yok."

              YENİ KURAL: bir "0. Bölüm" YALNIZCA (a) veritabanında o sezona ait
              `number = 0` satırı VARSA ve (b) o satırın en az bir kaynağı VARSA
              görünür. Bu satır `activeSeason.episodes` içinde gelir (bkz.
              lib/content.ts → loadShowDetail), numarası `0`dır ve en başta
              sıralanır → aşağıdaki liste onu "0. Bölüm" etiketiyle gösterir.
              Kaynağı olmayan/katalogdan gelen sentetik satır ÜRETİLMEZ.
              ═══════════════════════════════════════════════════════════════════
            */}
            {activeSeason.episodes.map((episode, index) => {
              const active = episode.id === currentEpisodeId;
              // Çeviri gelmezse (ya da dil İngilizce ise) ORİJİNAL ad gösterilir.
              // `?? ""` gerekli: `noUncheckedIndexedAccess` açık olduğu için indeks
              // erişimi `string | undefined` döner (aynı sebeple destructuring de).
              const episodeTitle = (translatedSidebarTitles?.[index] ?? "") || episode.title;
              return (
                <li key={episode.id} ref={active ? activeRef : undefined}>
                  <Link
                    to="/anime/$slug/season/$season/episode/$episode"
                    params={{
                      slug,
                      season: String(activeSeason.number),
                      episode: String(episode.number),
                    }}
                    // Yoğun bölüm rayı: fareyle üzerinden geçmek tıklama demek
                    // değildir (kota/egress). Bu rotanın yükleyicisi yoktur, yani
                    // önden çekme bugün okuma yapmaz; yine de KAPALI tutulur —
                    // ileride bir yükleyici eklendiğinde hover başına boşa okuma
                    // doğmasın ve davranış ana sayfa ızgarasıyla aynı kalsın.
                    preload={false}
                    aria-current={active ? "page" : undefined}
                    // Aktif satır yalnızca dolgu ile belirtilir; çerçeve (ring)
                    // kaldırıldı — çok kalın duruyordu. Renk altın (accent)
                    // kalıyor: sayfadaki KIRMIZI aksiyonlara (oynat, sonraki
                    // bölüm) ayrılmış durumda, seçili durumun onlarla
                    // yarışmaması için altın kullanılıyor.
                    className={`flex items-center gap-2.5 rounded-lg p-1.5 transition-colors ${
                      active ? "bg-accent/15" : "hover:bg-secondary focus-visible:bg-secondary"
                    }`}
                  >
                    <SidebarCover slug={slug} episode={episode} malId={malId} />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-xs font-bold ${active ? "text-accent" : "text-foreground"}`}
                      >
                        {/* SAĞ PANELDEKİ BÖLÜM LİSTESİ: sezon YAZILMAZ — kullanıcı
                            düzeltmesi (28.09.2026): "sağ taraftaki yerlerde sezona
                            gerek yok, '1. Bölüm' yazsan yeter." Listenin başındaki
                            "1. Sezon" seçicisi sezonu zaten söylüyor. */}
                        {t("series.episodeLabel", { number: episode.number })}
                      </span>
                      {episodeTitle ? (
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {episodeTitle}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </aside>
  );
}

/**
 * Paneldeki küçük kapak. Kapak YALNIZCA TVDB'den gelir; hiçbiri yoksa düz
 * zemin + numara gösterilir. `onLoad`'a güvenilmez; görsel önbellekten gelirse
 * durum `complete` ile doğrulanır.
 */
function SidebarCover({
  slug,
  episode,
  malId,
}: {
  slug: string;
  episode: Episode;
  /** Bölüme ait gerçek görsel (ani.zip/TVDB) — bkz. `src/lib/anizip-covers.ts`. */
  malId?: number | null | undefined;
}) {
  return (
    <span className="relative grid aspect-video w-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary">
      <EpisodeCover
        number={episode.number}
        numberClassName="text-[11px] font-bold text-muted-foreground"
        // ── TVDB-TEK KAYNAK: (a) panelden yüklenen kapak → (b) SEZONUN kendi MAL
        // kaydı → (c) SERİ MAL kaydı → (d) zincirdeki kardeş kayıt → (e) TVDB'den
        // üretilmiş yerel dosya. Sağlayıcı kareleri/animecix/katalog kapağı/seri
        // posteri KULLANILMAZ.
        candidates={[
          episode.thumbnail ?? "",
          // Sezonun KENDİ MAL kaydı (MAL'de her sezon ayrı bir animedir).
          anizipCoverForSeason(
            resolveSeasonMalId(malId, episode.season, null),
            episode.season,
            episode.number,
          ),
          // Bölüme ait GERÇEK görsel (ani.zip/TVDB, derleme zamanında gömülü).
          anizipCover(malId, episode.season, episode.number),
          // Bölünmüş sezonlar (ör. re-zero S2 = 39587 + 42203) için kardeş kayıt.
          anizipCoverFromChain(
            malId,
            episode.season,
            episode.number,
            resolveSeasonMalId(malId, episode.season, null),
          ),
          // TVDB görselinden üretilmiş yerel dosya (manifest'te varsa).
          localCoverPath(slug, episode.season, episode.number),
        ]}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100"
      >
        <span className="grid size-6 place-items-center rounded-full bg-primary/90 text-primary-foreground">
          <Play size={11} fill="currentColor" />
        </span>
      </span>
    </span>
  );
}

/** Önceki / sonraki bölüm düğmeleri. */
function EpisodeNav({
  slug,
  multipleSeasons,
  previous,
  upcoming,
}: {
  slug: string;
  multipleSeasons: boolean;
  previous: { season: number; episode: Episode } | null;
  upcoming: { season: number; episode: Episode } | null;
}) {
  const { t } = useLang();
  const label = (target: { season: number; episode: Episode }) =>
    multipleSeasons
      ? t("watch.seasonEpisodeShort", { season: target.season, number: target.episode.number })
      : t("watch.episodeShort", { number: target.episode.number });

  /**
   * Referans düzeni: düz yazı + ikon, yuvarlak kutu/kenarlık YOK.
   * (Ölçüm: rgb(128,151,178) · 12.825px · 400 · padding 0 5px.)
   *
   * SABİT GÖRÜNÜRLÜK (kullanıcı isteği): önceki/sonraki düğmeleri referansta
   * (anikoto) 1. bölümde de son bölümde de HEP durur — yalnızca tıklanabilirlik
   * değişir. Bizde ilk/son bölümde tamamen kayboluyordu; artık pasif hâlde
   * soluk (%40) gösteriliyor ve tıklanamıyor.
   */
  const base =
    "inline-flex items-center gap-1.5 px-1.5 text-[11.4px] font-normal transition-colors sm:text-[12.825px]";
  const active = `${base} text-[#8097b2] hover:text-[#a0b1c5]`;
  const passive = `${base} cursor-not-allowed text-[#8097b2]/40`;

  return (
    <div className="flex shrink-0 items-center">
      {previous ? (
        <Link
          to="/anime/$slug/season/$season/episode/$episode"
          params={{
            slug,
            season: String(previous.season),
            episode: String(previous.episode.number),
          }}
          className={active}
          title={label(previous)}
        >
          <FaSolid name="backwardStep" /> {t("watch.previous")}
        </Link>
      ) : (
        // Pasif hâl: bağlantı DEĞİL, düz yazı — tıklama hiçbir şey yapmaz.
        <span className={passive} aria-disabled="true" title={t("watch.firstEpisodeTitle")}>
          <FaSolid name="backwardStep" /> {t("watch.previous")}
        </span>
      )}
      {upcoming ? (
        <Link
          to="/anime/$slug/season/$season/episode/$episode"
          params={{
            slug,
            season: String(upcoming.season),
            episode: String(upcoming.episode.number),
          }}
          className={active}
          title={label(upcoming)}
        >
          {t("watch.next")} <FaSolid name="forwardStep" />
        </Link>
      ) : (
        <span className={passive} aria-disabled="true" title={t("watch.lastEpisodeTitle")}>
          {t("watch.next")} <FaSolid name="forwardStep" />
        </span>
      )}
    </div>
  );
}

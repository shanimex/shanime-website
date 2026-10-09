// /anime/<dizi-adı>/season/<n>/episode/<n> — İzleme sayfası: oynatıcı, kaynak kutuları,
// kaldığın yerden devam.
//
// SEZON/BÖLÜM YOL PARAMETRESİDİR (`$season`, `$episode`) — eskiden `?sezon=<n>&b=<n>`
// sorgu parametresiydi. Kaynak seçimi (`?kaynak=`) AYNI BÖLÜMÜN bir varyantı olduğu
// için sorgu parametresi olarak KALIR; yola taşınmaz.
// Eski izleme adresleri, `izle.$slug.tsx` içindeki yönlendirme rotası ile buraya gelir.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
// İkonlar: referans (lunarx) alt şeridindeki ikon şeridiyle aynı sıra ve anlam.
import { Loader2, MessageSquare, Play, Tv } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AdPlacement } from "@/components/site/AdPlacement";
import { EpisodeCover } from "@/components/site/EpisodeCover";
import { Comments } from "@/components/site/Comments";
import { FaSolid, type FaSolidName } from "@/components/site/FaSolid";
import { FluidPlayer, type FluidSubtitle } from "@/components/site/FluidPlayer";
import { PrerollGate } from "@/components/site/PrerollGate";
import { ControlSelect } from "@/components/site/ControlSelect";
import {
  ACTIVE_EMBED_PROVIDER,
  buildProviderUrl,
  isMegaplayStreamUrl,
  resolveEpisodeEmbed,
  type EmbedProviderRequest,
} from "@/lib/embed-provider";
import { SOURCE_GROUPS } from "@/lib/embed-sources";
import { fetchSourcesForEpisodes, isDirective, type EpisodeSource } from "@/lib/episode-sources";
import { prerollVastUrls } from "@/lib/mybid";
import {
  episodeCoverUrl,
  showDetailQueryOptions,
  showSlug,
  displayEpisodeTitle,
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
import {
  ANIZM_PLAYER_RE,
  puffySlugFor,
  puffySlugForSeason,
  sourceEpisodeMinimum,
} from "@/lib/puffy";
import { anizmPlayerUrl } from "@/lib/anizm";
import { anizmProxyEmbed, isAnizmPageUrl } from "@/lib/anizm-proxy";
import { plural, useDocumentTitle, useLang, t as translate, type I18nKey } from "@/lib/i18n";
import { useTranslatedTexts } from "@/lib/content-translate";
import { cn } from "@/lib/utils";
import {
  markWatched,
  captureResumeFrame,
  savePosition,
  getWatched,
  getShowProgress,
  episodeKey,
} from "@/lib/watch-progress";
import { hasPassedPreroll, markPrerollPassed } from "@/lib/preroll-session";

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
 * Adres oynatıcıya GÖMÜLEBİLİR mi?
 *
 * Sağlayıcının SAYFA adresleri (`anizm.net/...`, `puffytr.com/...`) gömülemez:
 * gömüldüğünde oynatıcının içinde sayfanın kendi katmanları açılıyor ("Google ile
 * giriş" penceresi + reklam şeritleri). Kullanıcı bildirimi (08.10.2026): "anizm
 * kaynağı seçiliyken video embedi yerine tarayıcı sayfasını açıyor". Bu yüzden
 * böyle bir adres taşıyan satır, adresi ÇÖZÜLEMEMİŞ sayılır ve listeden düşer
 * (`visibleChips`) — yanlış/bozuk ekran göstermektense kaynak gizlenir.
 */
function isEmbeddableAddress(url: string | null | undefined): boolean {
  return Boolean(url) && !isAnizmPageUrl(url);
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
  /**
   * VİDEONUN GERÇEK SESİ — kaynak seçiminden BAĞIMSIZ eksen.
   *
   * `sub` = orijinal ses (altyazıyla), `dub` = dublaj. Panelde bir satırın dili
   * `dub` değilse ( `tr`, `en`, `sub`, boş ...) satır ORİJİNAL ses taşır. Eskiden
   * ses kaynağın DİL GRUBUNDAN (`tr`/`en`) türetiliyordu ve yabancı bir sağlayıcıya
   * geçmek etiketi yanlışlıkla DUB yapıyordu — bkz. `activeAudio` (05.10.2026).
   */
  audio: "sub" | "dub";
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
  head: ({ params }) => {
    // Bölüm rotasında loader verisi bileşen içinde sorgulandığı için head burada
    // URL parametrelerinden üretilir; böylece SSR'de genel "Watch" başlığı kalmaz.
    const animeTitle = params.slug
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
    const title = `${animeTitle} — Season ${params.season}, Episode ${params.episode} | shanime`;
    const canonical = `/anime/${params.slug}/season/${params.season}/episode/${params.episode}`;
    return {
      meta: [
        { title },
        { property: "og:title", content: title },
        { name: "robots", content: "noindex" },
      ],
      links: [{ rel: "canonical", href: canonical }],
    };
  },
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
  const title = season.title.trim();
  if (!title || /\bseason\s*\d+/i.test(title)) {
    return translate("series.seasonFallback", { number: season.number });
  }
  return title;
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

  // Video öncesi reklam kapısı: gerçek VAST reklamları oynadıktan sonra açılır.
  /**
   * ⚠️ ÖN REKLAM KAPISI DURUMU — yalnızca `useState` DEĞİLDİR.
   *
   * KULLANICI GERİ BİLDİRİMİ (09.10.2026): "en ufak sayfa değişiminde video
   * sıfırlanıyor ... bazen baştan başlıyor, reklam bile geliyor." Telefonda
   * tarayıcı sayfayı bellekten düşürüp yeniden yüklediğinde React durumu
   * sıfırlanıyor, kapı yeniden kuruluyor ve reklam BAŞTAN oynuyordu. Artık
   * geçildi bilgisi OTURUM boyunca saklanır (`lib/preroll-session.ts`); aynı
   * sekmede aynı bölüme dönmek reklamı tekrar oynatmaz. Yeni sekme/ziyaret ve
   * BAŞKA bölüm reklamı normal şekilde alır (gösterim kaybı yok).
   */
  const [gateDone, setGateDone] = useState(false);

  // Oynatıcı altı kontrol şeridi (referans: anikoto/hianime oynatıcı altı şeridi).
  //   · genişlet          → oynatıcı tam genişlik olur, bölüm paneli alta iner
  //   · otomatik oynatma  → kapalıyken adrese `autostart=false` eklenir
  //   · otomatik geçiş    → video bitince sonraki bölüme geçer
  //   · ışık              → sayfanın geri kalanı karartılır
  //   · otomatik atlama    → açılış/kapanış atlama (referansta varsayılan kapalı)
  // NOT: "Sinema modu" durumu KALDIRILDI (04.10.2026). Kullanıcı: "tam ekranı
  // kaldır, sadece report kalsın". Düğme silinince durum da gereksizleşti.
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

  /**
   * ALT PANEL SEKMESİ — "Yorumlar" / "Bölümler".
   *
   * KULLANICI İSTEĞİ (05.10.2026): "yorumlara basınca yorumlar ekranı,
   * bölümlere basınca bölümler ekranı olacak." Oynatıcının altında TEK alan
   * vardır; üstündeki iki sekmeden hangisine basılırsa o panel görünür
   * (animecix düzeni). PC ve mobilde AYNI davranış.
   */
  const [panelTab, setPanelTab] = useState<"comments" | "episodes">("comments");

  /**
   * GENİŞ EKRAN (lg ve üstü) Mİ? (05.10.2026)
   *
   * KULLANICI: "pc'de bölümleri aşağı alma, bölümler oynatıcının SAĞINDA
   * duracak." Bu yüzden gövde yerleşimi artık PC ile mobilde AYRIŞIR:
   *  - PC: oynatıcı solda, bölüm listesi sağda; altta yalnızca yorumlar.
   *  - Mobil: tek kolon; yorumlar/bölümler SEKMELİ alan.
   * Sekme durumu yalnızca mobilde anlam taşır.
   */
  const isDesktop = useIsDesktop();

  /**
   * SAHNE IŞIKLARI — SAYFA DÜZEYİNDE karartma.
   *
   * Kullanıcı: "oynatıcı dışında her şey siyah ... tamamen de siyah olmasın,
   * %5 ya da %10 yap". Üst şerit (logo/menü), başlık (seri adı), reklamlar —
   * bu bileşenin İÇİNDE olmayanlar da kararmalı. Bu yüzden `body`e sınıf eklenir;
   * CSS zemini saf siyaha çevirir (styles.css) ve aşağıdaki %90 siyah perde
   * sayfanın üzerine biner. Oynatıcı + anahtar `z-[60]` ile perdenin üstünde.
   */
  useEffect(() => {
    document.body.classList.toggle("stage-lights", dim);
    return () => document.body.classList.remove("stage-lights");
  }, [dim]);

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
   * çevirsin"). Üstteki seri başlığının altındaki satırda görünen ad, TR
   * seçiliyken DeepL karşılığıdır; İngilizce'de orijinal kalır
   * (`useTranslatedTexts` o durumda hiç istek yapmaz).
   *
   * ⚠️ KANCA YERİ: bu bileşende erken `return` YOKTUR (ilk `return` 692. satırda),
   * bu yüzden buraya konması güvenli. Yukarıdaki `previous/upcoming` hesapları
   * `currentEpisode`e bağlı olduğu için kanca onların ÜSTÜNE alındı.
   */
  const cleanEpisodeTitle = displayEpisodeTitle(currentEpisode?.title);
  const [translatedEpisodeTitle] = useTranslatedTexts([cleanEpisodeTitle]);
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
  /**
   * O anki sezonun PART kayıtları (`show_seasons.parts`).
   *
   * NEDEN SUNUCUYA TAŞINIR: bir sezon kaydı birden çok MAL kaydına yayılabilir
   * (Mushoku Tensei S1: 1–11 = MAL 39535 "Part 1", 12–23 = MAL 45576 "Part 2").
   * MegaPlay bölümü part'ın KENDİ kimliği + part içi göreli numarayla verir; mutlak
   * numarayla sorgulanırsa 2. part `Error` döndürür ve kaynak listeden düşer. Eşleme
   * `/api/embed`'e `parts` olarak geçirilir (rota boşsa AniList'ten türetir).
   *
   * ⚠️ Bu blok ARTIK DAHA YUKARIDA: PART farkındalıklı kaynak çözümlemesi (`sourceMin`)
   * ve anizm/tauvideo çalışma-anı sorguları bu değere bağlı; hepsi erken `return`lerin
   * ÜSTÜNDE (React kanca kuralı) durmak zorunda.
   */
  const seasonParts = Array.isArray(activeSeason?.parts) ? (activeSeason?.parts ?? []) : [];

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * KAYNAK KATALOĞU ÇÖZÜMLEMESİ (01.10.2026) — "yanlış bölüm" hatasını bitirir.
   *
   * SORUN (kullanıcı, 01.10.2026): `/anime/re-zero/season/4/episode/19` → Anizm ESKİ
   * bir bölüm oynatıyor, TauVideo hiç çıkmıyor. Ölçüm (salt-okuma, canlı veritabanı):
   *   · re-zero S4B19 `watch_url` = `anizmplayer.com/video/a26c9661…` ama bu hash
   *     KATALOGDA S1B19'a ait (`31240-s1b19`) → yani ESKİ bölüm.
   *   · re-zero S2B14–B25 adresleri S1B1–B12'ye işaret ediyor (PART kayması).
   *   · S4B17–B19 için `episode_sources` satırı ya eksik ya yok; oysa animecix
   *     kataloğunda S4B19 VAR (canlı ölçüm, `episode=19` → kayıt döndü).
   *
   * KURAL (proje kuralı: "uydurma yok" + "yanlış bölüm oynatmak, hiç oynatmamaktan
   * kötüdür"): bir kaynak adresi, kaynağın KENDİ kataloğundan çözülen adresle
   * doğrulanmadan GÖSTERİLMEZ.
   *
   * Anizm adresi bölüme özel bir hash taşır; iki güvenilir kaynak var:
   *   1) derleme zamanı tablosu (`src/data/anizm-hashes.json`) — doğrulanmış kayıtlar,
   *   2) sunucu rotası `/api/anizm` — kataloğun KENDİ numaralandırmasını kullanır ve
   *      PART farkındalıklıdır (`sourceMin`, bkz. `lib/puffy.ts`).
   * İkisi de yoksa Anizm satırı hiç gösterilmez. Kayıttaki eski/yanlış Anizm adresi
   * (`watch_url`) ASLA doğrudan oynatılmaz.
   */
  const episodeSourceRows: EpisodeSource[] = currentEpisode
    ? (episodeSources?.get(currentEpisode.id) ?? [])
    : [];
  /**
   * ⚠️ FİLM Mİ? — FİLMLERDE NUMARALI ÇÖZÜMLEME YAPILMAZ (09.10.2026 düzeltmesi).
   *
   * KULLANICI GERİ BİLDİRİMİ: "Attack on Titan filminde megaplay 1,5 saatlik filmi
   * gösteriyor (doğru) ama Anizm ve TauVideo 25 dakikalık BÖLÜM gösteriyor."
   * Kök neden: filmlerin bölüm numarası YOKTUR (`1. Sezon 1. Bölüm` tek satırdır) ama
   * çözücü `sezon/bölüm` numarasıyla soruyordu. Ağda filmin kendi sayfası
   * bulunamayınca başlık eşleştirmesi ANA DİZİYE düşüyor ve dizinin 1. bölümünü
   * (25 dk) döndürüyordu — yani film yerine dizi bölümü oynuyordu.
   *
   * KURAL: filmde numaralı (sezon/bölüm) Anizm/TauVideo çözümlemesi hiç denenmez.
   * Kaynak yalnızca panelin "Film kaynağı" olarak ELLE yazdığı satırdan gelir
   * (aşağıdaki çip eşlemesi). Yanlış içerik oynatmak, kaynağı hiç göstermemekten
   * kötüdür (proje kuralı) — bu yüzden otomatik/uydurma adres üretilmez.
   */
  const isMovieShow = detail?.show.kind === "movie";
  /**
   * Derleme zamanı tablosundan (`src/data/anizm-hashes.json`) doğrudan oynatıcı
   * adresi. Sunucu rotası (puffytr, canlı katalog) BİRİNCİLdir; bu tablo YALNIZCA
   * sunucu adresi bulamazsa devreye giren YEDEKTİR (kullanıcı isteği: "puffytr'de
   * adres yoksa anizm'den embed çek"). Doğrudan adres 403 vermez; istemci onu ters
   * proxy'ye çevirir (`anizmProxyEmbed`), Referer'ı sunucu koyar.
   */
  // Derleme tablosu `{malId}-s{sezon}b{bölüm}` ile anahtarlanır → FİLMDE film satırı
  // değil, aynı MAL kimliğine ait DİZİ bölümü bulunur (yukarıdaki `isMovieShow`
  // notu). Bu yüzden filmde hiç okunmaz.
  const bakedAnizmUrl =
    !isMovieShow && currentEpisode
      ? anizmPlayerUrl(detail?.show.mal_id ?? null, currentEpisode.season, currentEpisode.number)
      : null;
  const seasonNumbers = (activeSeason?.episodes ?? []).map((item) => item.number);
  const seasonMin = seasonNumbers.length > 0 ? Math.min(...seasonNumbers) : 1;
  /** Kaynağa sorulacak numaranın tabanı — bölüm bir PART'a düşüyorsa part'ın start'ı. */
  const sourceMin = currentEpisode
    ? sourceEpisodeMinimum(currentEpisode.number, seasonMin, seasonParts)
    : seasonMin;
  const anizmRowPresent = episodeSourceRows.some(
    (row) => row.provider === "anizm" || ANIZM_PLAYER_RE.test(row.url),
  );
  const storedAnizmUrl = ANIZM_PLAYER_RE.test(currentEpisode?.watch_url ?? "")
    ? (currentEpisode?.watch_url ?? "")
    : "";
  // Sunucu rotası (puffytr) BİRİNCİL: derleme tablosunda kayıt olsa bile canlı
  // katalogdan adres denemesi yapılır (`bakedAnizmUrl` yalnızca YEDEK).
  const needsAnizmLookup =
    !isMovieShow &&
    !isSpecial &&
    Boolean(currentEpisode) &&
    (anizmRowPresent || Boolean(storedAnizmUrl));
  /**
   * Sunucu rotasından Anizm adresi — yalnızca KATALOĞUN kendi numaralandırmasıyla
   * (ve part farkındalıklı `min` ile) çözülen adres kabul edilir.
   */
  const anizmLookupQuery = useQuery({
    queryKey: [
      "anizm-source",
      detail?.show.slug ?? null,
      currentEpisode?.season ?? null,
      currentEpisode?.number ?? null,
      sourceMin,
    ],
    enabled: needsAnizmLookup && typeof window !== "undefined",
    queryFn: async () => {
      if (!detail) return null;
      const base = puffySlugFor(showSlug(detail.show));
      const params = new URLSearchParams({
        puffy: puffySlugForSeason(base, currentEpisode?.season ?? 1),
        base,
        season: String(currentEpisode?.season ?? 1),
        number: String(currentEpisode?.number ?? 0),
        min: String(sourceMin),
        show: detail?.show.slug ?? "",
        title: detail?.show.title ?? "",
        mal: detail?.show.mal_id ? String(detail.show.mal_id) : "",
      });
      const response = await fetch(`/api/anizm?${params.toString()}`);
      if (!response.ok) return null;
      const payload = (await response.json()) as { ok?: boolean; url?: string; slug?: string };
      /**
       * ⚠️ YALNIZCA OYNATILABİLİR adres kabul edilir (`anizmplayer.com/video/<hash>`).
       *
       * Sağlayıcının SAYFA adresi (`anizm.net/...`, `puffytr.com/...`) BURADAN
       * GEÇEMEZ (ölçüm 08.10.2026): sayfa iframe'e gömülünce oynatıcıda sağlayıcının
       * "Google ile giriş" penceresi ve reklam katmanları görünüyor — yani gömer gömmez
       * BOZULUYOR. Doğru oynatıcı adresi ters proxy'den (`/api/anizm-player?hash=…`)
       * sunulur; sayfa adresi dönerse kaynak uydurulmaz, yok sayılır.
       */
      if (typeof payload.url !== "string" || !ANIZM_PLAYER_RE.test(payload.url)) {
        return null;
      }
      /**
       * API kendi başlık/katalog eşleşmesini yapar. Burada tekrar yalnızca
       * `base` slug'ını kabul etmek hatalıydı: Attack on Titan'ın gerçek Puffy
       * slug'ı `shingeki-no-kyojin`; bu yüzden admin kaydı doğru olsa da Anizm
       * oynatıcıdan düşüyordu. Rota `ok + url + slug` döndürdüğünde eşleşmeyi
       * ona bırakıyoruz; eksik/uydurma yanıtlar yine kabul edilmiyor.
       */
      if (payload.ok !== true || typeof payload.slug !== "string" || !payload.slug.trim()) {
        return null;
      }
      return payload.url;
    },
  });

  /**
   * ANİZM — YALNIZCA kaynağın kendi kataloğundan doğrulanmış adres. `null` = bu bölüm
   * için güvenilir Anizm adresi YOK (eski/yanlış adres gösterilmez).
   */
  const verifiedAnizmUrl = anizmLookupQuery.data ?? bakedAnizmUrl ?? null;

  /**
   * Güvenilir DOĞRUDAN adres. `watch_url` bir Anizm adresiyse yalnızca katalog
   * çözümüyle AYNI olduğunda kabul edilir; aksi hâlde boş sayılır ve oynatıcı
   * varsayılan sağlayıcıya (MegaPlay) düşer — eski bölüm asla oynatılmaz.
   */
  const rawWatchUrl = (currentEpisode?.watch_url ?? "").trim();
  // FİLM İSTİSNASI: filmde numaralı doğrulama YAPILAMAZ (film → dizi bölümü
  // eşleşmesi hatasının kaynağı; bkz. `isMovieShow` notu). Panel filmin oynatıcı
  // adresini "Film kaynağı" olarak zaten açıkça yazmıştır; o adres AYNEN kullanılır.
  const trustedWatchUrl = ANIZM_PLAYER_RE.test(rawWatchUrl)
    ? isMovieShow
      ? rawWatchUrl
      : verifiedAnizmUrl && rawWatchUrl === verifiedAnizmUrl
        ? rawWatchUrl
        : ""
    : rawWatchUrl;

  /** `watch_url` doğrudan TauVideo oynatıcısı mı (panel satırı olmasa da geçerli). */
  const tauUrl = /tau-video\.xyz/i.test(currentEpisode?.watch_url ?? "")
    ? (currentEpisode?.watch_url ?? null)
    : null;

  /**
   * TauVideo (animecix) — panelin yazdığı satır YOKSA kaynağın kendi kataloğundan
   * ÇALIŞMA ANINDA çözülür.
   *
   * NEDEN: `episode_sources` satırı eksik bırakılmış bölümlerde (ölçüm 01.10.2026:
   * re-zero S4B17–B19) kaynak listede hiç görünmüyordu; oysa animecix kataloğunda
   * bölüm VAR (`/api/animecix?titleId=7325&season=4&episode=19` → kayıt döndü).
   * Sorgu, kaynağın KENDİ (sezon, bölüm) numaralandırmasıyla yapılır — panelin
   * yazarken kullandığı değerlerin AYNISI (bkz. AnizipSyncPanel → animecixParams).
   */
  const animecixTitleId = detail?.show.animecix_id ?? null;
  const tauRowPresent = episodeSourceRows.some(
    (row) => row.provider === "animecix" || /tau-video\.xyz/i.test(row.url),
  );
  // Filmlerde numaralı TauVideo çözümlemesi de yapılmaz (yukarıdaki `isMovieShow`
  // notunun aynısı: film → sezon/bölüm numarası yok).
  const needsTauLookup =
    !isMovieShow &&
    !isSpecial &&
    Boolean(currentEpisode) &&
    Boolean(animecixTitleId) &&
    !tauRowPresent &&
    !tauUrl;
  const tauLookupQuery = useQuery({
    queryKey: [
      "tauvideo-source",
      animecixTitleId ?? null,
      currentEpisode?.season ?? null,
      currentEpisode?.number ?? null,
    ],
    enabled: needsTauLookup && typeof window !== "undefined",
    queryFn: async () => {
      const params = new URLSearchParams({
        titleId: String(animecixTitleId),
        season: String(currentEpisode?.season ?? 1),
        episode: String(currentEpisode?.number ?? 0),
      });
      const response = await fetch(`/api/animecix?${params.toString()}`);
      if (!response.ok) return null;
      const payload = (await response.json()) as { ok?: boolean; best?: string };
      return typeof payload.best === "string" &&
        /^https:\/\/tau-video\.xyz\/embed\/[0-9a-f]{16,}(?:\?vid=\d+)?$/i.test(payload.best)
        ? payload.best
        : null;
    },
  });
  const autoTauUrl = needsTauLookup ? (tauLookupQuery.data ?? null) : null;

  /**
   * ÇALIŞMA ANINDA çözülen kaynaklar SENTETİK satır olarak listeye katılır; böylece
   * panelde satırı olmayan ya da eksik bırakılmış bölümde kaynak yine görünür ve
   * seçim/aktiflik mekanizması (çipler) TEK kod yolundan çalışır.
   *
   * ⚠️ KAPSAM SINIRI (panel kararına saygı): Anizm ve MegaPlay satırları YALNIZCA
   * panelde HİÇ satır yoksa sentezlenir; panel bir kaynağı bilinçli olarak yazmadıysa
   * o kaynak geri getirilmez. TauVideo ise yalnızca hiçbir satır ona işaret etmiyorsa
   * eklenir (eksik kaynağı tamamlamak için — hiçbir seçimi geçersiz kılmaz).
   */
  const syntheticRows: EpisodeSource[] =
    currentEpisode && !isSpecial
      ? [
          // Sıra ÖNEMLİ: Türkçe kutuda ilk satır otomatik seçilir; panelin
          // PICK_ORDER'ıyla aynı olsun diye Anizm önce, TauVideo sonra gelir.
          ...(episodeSourceRows.length === 0 && verifiedAnizmUrl
            ? [
                {
                  id: `auto-anizm-${currentEpisode.id}`,
                  episode_id: currentEpisode.id,
                  provider: "anizm",
                  language: "tr",
                  label: readableProviderName("anizm"),
                  url: verifiedAnizmUrl,
                  sort_order: 90,
                },
              ]
            : []),
          ...(autoTauUrl
            ? [
                {
                  id: `auto-tauvideo-${currentEpisode.id}`,
                  episode_id: currentEpisode.id,
                  provider: "animecix",
                  language: "tr",
                  label: readableProviderName("tauvideo"),
                  url: autoTauUrl,
                  sort_order: 91,
                },
              ]
            : []),
          ...(episodeSourceRows.length === 0
            ? [
                {
                  id: `auto-megaplay-${currentEpisode.id}`,
                  episode_id: currentEpisode.id,
                  provider: "megaplay",
                  language: "en",
                  label: readableProviderName("megaplay"),
                  url: "@megaplay",
                  sort_order: 92,
                },
              ]
            : []),
        ]
      : [];

  /** Panel satırları + çalışma anında çözülen sentetik satırlar (TEK liste). */
  const episodeRows: EpisodeSource[] = [...episodeSourceRows, ...syntheticRows];

  const megaplayRows = episodeRows.filter(
    (row) => isDirective(row.url) && row.url.slice(1).trim() === "megaplay",
  );
  const megaplayLanguage = megaplayRows.some((row) => row.language === "dub") ? "dub" : "sub";
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
      Boolean(currentEpisode && !(currentEpisode.watch_url ?? "").trim()) ||
      Boolean(currentEpisode && ANIZM_PLAYER_RE.test(currentEpisode.watch_url ?? "")));
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
  /** Bu bölüm için gerçek oynatma başlayınca tek seferlik izlenme işareti. */
  const markedEpisodeRef = useRef("");
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
        const watchedKey = `${slug}:${watchedEpisode.season}:${watchedEpisode.episode}`;
        if (markedEpisodeRef.current !== watchedKey) {
          markedEpisodeRef.current = watchedKey;
          markWatched(slug, watchedEpisode.season, watchedEpisode.episode);
        }
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
  /** Kapı kaydının oturum anahtarı — seri + sezon/bölüm (bkz. `lib/preroll-session.ts`). */
  const gateStorageKey = `${detail?.show.slug ?? ""}:${currentKey}`;
  useEffect(() => {
    // Bölüm değişince kapı YENİDEN kurulur; ama bu bölümün kapısı bu oturumda
    // zaten geçildiyse reklam tekrar oynatılmaz (yukarıdaki nota bakın).
    setGateDone(hasPassedPreroll(gateStorageKey));
    // Bölüm değişince jenerik verisi de sıfırlanır: bir sonraki bölüm için yeniden çekilir.
    edStartRef.current = null;
    durationRef.current = 0;
    markedEpisodeRef.current = "";
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
    // `gateStorageKey` de listede: seri kimliği (slug) veri geldiğinde dolar ve
    // o an kapı kaydı yeniden okunmalıdır.
  }, [currentKey, gateStorageKey]);

  // Sekme başlığı: rota başlığı sunucuda bir kez üretilir ve dili İZLEYEMEZ.
  // `useDocumentTitle` ile istemcide aktif dile bağlanır: veri gelene kadar rota
  // başlığı, veri gelince seri + bölüm bilgisi yazılır.
  const pageTitle = detail
    ? currentEpisode
      ? `${detail.show.title} ${t("watch.srEpisodeWatch", { number: currentEpisode.number })} | shanime`
      : `${detail.show.title} ${t("watch.srWatch")} | shanime`
    : translate("meta.watchTitle");
  useDocumentTitle(pageTitle);

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

  /**
   * SEZONLAR şeridi için komşu sezonlar (referans: izleme sayfasındaki `SEASONS`).
   *
   * KULLANICI İSTEĞİ (01.10.2026): "sezon şeyleri de var onu da ekleyelim".
   * Kaynak: `detail.seasons` — panelde bölümü olan sezonlar. Komşu YOKSA
   * (ilk sezonun öncesi / son sezonun sonrası) o kart HİÇ çizilmez.
   */
  const activeSeasonIndex = playableSeasons.findIndex(
    (season) => season.number === (activeSeason?.number ?? 0),
  );
  const previousSeason =
    activeSeasonIndex > 0 ? (playableSeasons[activeSeasonIndex - 1] ?? null) : null;
  const upcomingSeason =
    activeSeasonIndex >= 0 && activeSeasonIndex < playableSeasons.length - 1
      ? (playableSeasons[activeSeasonIndex + 1] ?? null)
      : null;

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
  // ⚠️ `anizmUrl` ARTIK `verifiedAnizmUrl`tir: derleme zamanı tablosu VEYA sunucu
  // rotasından (`/api/anizm`) doğrulanmış adres. Kayıttaki eski/yanlış Anizm adresi
  // (`watch_url`) buraya ASLA girmez — bkz. yukarıdaki "KAYNAK KATALOĞU ÇÖZÜMLEMESİ".
  const anizmUrl = verifiedAnizmUrl;

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
   * PANELDEN SEÇİLEN ÇOKLU KAYNAKLAR (`episode_sources`) + ÇALIŞMA ANINDA çözülen
   * sentetik satırlar (auto TauVideo / auto Anizm / auto MegaPlay) → oynatıcı
   * altındaki çipler. Yalnızca OYNATILAN bölümün satırları süzülür; sentetik satırlar
   * yukarıda (erken `return`lerin üstünde) hazırlanmıştır.
   */
  const sourceRows: EpisodeSource[] = episodeRows;

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
     * ⚠️ ANIZM SATIRI — ADRES YALNIZCA KATALOG ÇÖZÜMÜYLE DOĞRULANMIŞSA GÖSTERİLİR.
     *
     * NEDEN: Anizm adresi bölüme özel bir hash taşır ve kayıttaki adres bir kez
     * YANLIŞ çözülmüş olabilir (canlı ölçüm 01.10.2026: re-zero S2B14 → S1B1,
     * S4B19 → S1B19). Eski davranış `row.url`e (yanlış olabilir) düşüyordu; artık
     * `anizmUrl` (= `verifiedAnizmUrl`, derleme tablosu VEYA sunucu rotasının katalog
     * çözümü) kullanılır. Kayıt yoksa/çözülemezse `url` null kalır ve satır listeden
     * DÜŞER (`visibleChips`) — eski bölüm oynatılmaz.
     */
    if (ANIZM_PLAYER_RE.test(row.url)) {
      // FİLM: numaralı doğrulama yapılamadığı için (`isMovieShow` notu) panelin
      // yazdığı film adresi kullanılır; dizi davranışı DEĞİŞMEZ.
      return { row, url: isMovieShow ? row.url : anizmUrl };
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
  // ⚠️ ANİZM İSTİSNASI KALDIRILDI (08.10.2026): eskiden buradan ÇIKARILIYORDU çünkü
  // satırın adresi sağlayıcının reklamlı SAYFASI oluyordu ("Anizm wrapper'ı tam site
  // sayfasıdır"). Artık Anizm adresi ters proxy'den gelen GERÇEK oynatıcı
  // (`/api/anizm-player?hash=…`, Türkçe altyazı videoda, reklamsız) → yukarıdaki
  // kuralın kendi örneği olan "doğrulanmış adresi olan satırlar (Anizm/TauVideo
  // gibi)" kümesine girer. Adresi DOĞRULANMAMIŞSA yine seçilmez.
  const autoSelectableChips = sourceChips.filter(
    (chip) => isEmbeddableAddress(chip.url) && !isDirective(chip.row.url),
  );

  /**
   * Bugünkü (satırlar eklenmeden önceki) oynatma adresi — karşılaştırma tabanı.
   *
   * ⚠️ `currentEpisode.watch_url` DEĞİL `trustedWatchUrl`: kayıttaki Anizm adresi
   * katalog çözümüyle doğrulanmamışsa (eski/yanlış bölüm) boş sayılır ve oynatıcı
   * varsayılan sağlayıcıya düşer — yanlış bölüm asla oynatılmaz.
   */
  const todayFallbackEmbed =
    currentEpisode && episodeRequest ? resolveEpisodeEmbed(trustedWatchUrl, episodeRequest) : null;
  /**
   * Doğrulama kapısı: `watch_url` BOŞSA bugünkü çözümleme megaplay ŞABLONUNDAN
   * üretilir (`.../stream/mal/...`) — yani "çözülen adres". Böyle bir adres
   * oynatıcıyı getirmiyorsa (bkz. `megaplayEmbedQuery`) gösterilmez; sıradaki
   * kaynak/satır oynar. Doğrulanmış bölüm adresleri (Anizm/TauVideo) dokunulmaz.
   */
  const fallbackEmbed =
    isMegaplayStreamUrl(todayFallbackEmbed) ||
    (Boolean(verifiedMegaplayUrl) && ANIZM_PLAYER_RE.test(todayFallbackEmbed ?? ""))
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
   *
   * ⚠️ ÇIP ADRESİ GÜVENLİK SÜZGECİNDEN GEÇER (08.10.2026): sağlayıcının SAYFA
   * adresi (`anizm.net/...`, `puffytr.com/...`) oynatıcıya ASLA gömülmez —
   * gömüldüğünde içinde "Google ile giriş" ve reklam katmanı açılıyordu.
   * Sayfa adresi taşıyan satır, adres çözülememiş sayılır.
   */
  const pickedChip =
    sourceChips.find((chip) => chip.row.id === pickedSourceId && isEmbeddableAddress(chip.url)) ??
    null;

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
   *
   * ⚠️ ANİZM İSTİSNASI KALDIRILDI (08.10.2026): eskiden `anizm` tercihi YOK
   * SAYILIYORDU çünkü satırın adresi sağlayıcının reklamlı SAYFASI oluyordu.
   * Artık Anizm adresi ters proxy'den (`/api/anizm-player?hash=…`) gelen gerçek
   * oynatıcı olduğu için diğer sağlayıcılar gibi korunur: Anizm'i seçen izleyici
   * sonraki bölümde de Anizm'de kalır. Adres DOĞRULANMAMIŞSA (`chip.url` boş)
   * yine seçilmez → uydurma/eski adres oynatılmaz.
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
  const episodeEmbedRaw =
    currentEpisode && episodeRequest
      ? (pickedChip?.url ?? forcedEmbed ?? initialChip?.url ?? fallbackEmbed)
      : null;
  /**
   * Anizm doğrudan oynatıcı adresi (`anizmplayer.com/video/<hash>`) ters proxy'ye
   * çevrilir → temiz oynatıcı iframe'in İÇİNDE gömülür (sağlayıcı Referer kilidi
   * sunucuda çözülür). Diğer tüm adresler (megaplay/tauvideo/watch_url) DEĞİŞMEDEN
   * geçer.
   */
  const episodeEmbed = anizmProxyEmbed(episodeEmbedRaw);

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
   * ⚠️ SÜZGEÇ: ADRESİ ÇÖZÜLEMEYEN HİÇBİR satır listeye GİRMEZ (direktif olsun ya da
   * olmasın). NEDEN: (a) çözülemeyen direktif seçilirse oynatıcı boş adrese düşer,
   * (b) doğrulanmamış Anizm adresi (eski/yanlış bölüm) gösterilmemelidir. Kullanıcının
   * tıklayıp 404/"video yok" ekranına düşebildiği ya da YANLIŞ bölüm oynatan bir
   * düğme hiç gösterilmesin. Adresi ÇÖZÜLEBİLEN direktifler (ör. `@megaplay`) listede
   * KALIR — yalnızca otomatik seçilmez (bkz. `autoSelectableChips`).
   */
  const visibleChips = sourceChips.filter((chip) => isEmbeddableAddress(chip.url));

  const rowEntries: SourceBoxEntry[] = visibleChips.map((chip) => ({
    key: chip.row.id,
    language: chip.row.language === "tr" ? "tr" : "en",
    audio: chip.row.language === "dub" ? "dub" : "sub",
    label: sourceChipLabel(chip.row),
    title: isDirective(chip.row.url)
      ? t("watch.directiveTitle", { provider: readableProviderName(chip.row.provider) })
      : // ÇÖZÜLEN adres gösterilir — kayıttaki (`row.url`) değil. Kayıt BAYAT
        // olabilir (S4 B19'da S1 B19'un adresi duruyordu) ve zaten oynatmada da
        // kullanılmıyor. Kullanıcı geri bildirimi (01.10.2026): "Anizm çipinin
        // ipucu eski bölümün adresini gösteriyor."
        // `?? ""` yalnızca tip daralması içindir: `visibleChips` adresi olmayan
        // satırları zaten eler, yani burada her zaman doğrulanmış adres durur.
        (chip.url ?? ""),
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
        audio: "sub",
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
          audio: "sub",
          label: readableProviderName("tauvideo"),
          title: t("watch.sourceTauTitle"),
          disabled: false,
          active: !kaynak,
          select: () => switchSource(""),
        }
      : {
          key: "fallback-anizm-lookup",
          language: "tr",
          audio: "sub",
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
    audio: "sub",
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

  /**
   * TEK KAYNAK LİSTESİ — kullanıcı isteği (01.10.2026):
   * "kaynak olarak 3 kaynağı da ekle sourcenin içine".
   *
   * Eskiden kaynaklar DİL GRUPLARINA bölünmüş ayrı kutularda çiziliyordu
   * (Türkçe / Altyazı). Artık tek bir "Kaynak" satırı var ve bütün kaynaklar
   * (Anizm · TauVideo · MegaPlay) onun İÇİNDE listelenir — referans izleme
   * sayfasındaki tek `Source` kontrolüyle aynı düzen.
   *
   * Sıra korunur: `sourceBoxes` grupları hangi sırayla üretiyorsa düzleştirme
   * de o sırayı verir, yani "seçili/varsayılan" kaynak yine en başta durur.
   */
  const allSourceEntries = sourceBoxes.flatMap((box) => box.entries);

  /**
   * SES (SUB/DUB) — referans şeridindeki `Audio SUB ▾` karşılığı.
   *
   * ⚠️ KULLANICI GERİ BİLDİRİMİ (05.10.2026): "SUB aslında orijinal ses demek;
   * kaynak değişince DUB oluyor, ben değiştirmedikçe değişmemeli." Eski kod sesi
   * satırın DİL GRUBUNDAN türetiyordu (`tr` → Altyazı, `en` → Dublaj) — bu yüzden
   * yabancı sağlayıcıya (MegaPlay) geçmek etiketi yanlışlıkla DUB yapıyordu. Oysa
   * ses ve dil AYRI eksendir: satırın kendi `audio` alanı sesi belirler
   * (`dub` → DUB; diğer her şey → orijinal ses / SUB). Kaynak değiştirmek etiketi
   * kendiliğinden değiştirmez; etiket oynayan kaynağın gerçek sesini yansıtır.
   *
   * Menü yalnızca GERÇEKTEN VAR OLAN ses satırlarını listeler. Tek seçenek
   * olduğunda da kontrol `ControlSelect` olarak çizilir (basılabilir kalır).
   */
  const activeAudio =
    (allSourceEntries.find((entry) => entry.active) ?? allSourceEntries[0])?.audio ?? "sub";
  const audioOptions = (["sub", "dub"] as const)
    .map((audio) => ({ audio, entry: allSourceEntries.find((entry) => entry.audio === audio) }))
    .filter((option): option is { audio: "sub" | "dub"; entry: SourceBoxEntry } =>
      Boolean(option.entry),
    );

  /**
   * BİLDİR — bölüm bilgisini panoya kopyalar.
   *
   * ESKİ ŞERİTTE VARDI ve şerit yenilenirken BENİM silmemle kaybolmuştu; geri
   * getirildi. Metin gerçek verilerden kurulur (başlık + sezon/bölüm + adres).
   */
  // NOT: bu satırlar bir `early return`in ALTINDA — bu yüzden DÜZ fonksiyon.
  // `useCallback`/`useState` kullanılsaydı hook sırası değişir ve React kuralları
  // kırılırdı.
  /**
   * BİLDİR — referans (lunarx) gibi bir PENCERE açar.
   *
   * KULLANICI GERİ BİLDİRİMİ (01.10.2026): ekran kaydında Bildir düğmesi
   * "Report Anime Issue" diyaloğunu açıyor. Bizde yalnızca panoya kopyalıyordu.
   *
   * Yerel `<dialog>` kullanılır: Escape ile kapanır, arka planı karartır, odak
   * tuzağı hazır gelir — React durumu gerekmez (bu yüzden hook sırası bozulmaz).
   */
  const handleReport = () => {
    const dialog = document.getElementById("watch-report-dialog");
    if (!(dialog instanceof HTMLDialogElement)) return;
    dialog.showModal();
    // MOBİL KLAVYE (kullanıcı, 05.10.2026): "mobilde report'a basınca klavye
    // açılmasın." `<dialog>` ilk odaklanabilir öğeye (metin alanına) odak
    // verince dokunmatik klavye açılıyordu. Odağı klavye açmayan İPTAL
    // düğmesine taşıyoruz.
    dialog.querySelector<HTMLButtonElement>('button[value="cancel"]')?.focus();
  };

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
    if (info.position > 0) {
      const watchedKey = `${currentSlug}:${currentEpisode.season}:${currentEpisode.number}`;
      if (markedEpisodeRef.current !== watchedKey) {
        markedEpisodeRef.current = watchedKey;
        markWatched(currentSlug, currentEpisode.season, currentEpisode.number);
      }
    }
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
      // Sayfa adresi dönerse KAYNAK SAYILMAZ (bkz. `isEmbeddableAddress`):
      // gömülseydi oynatıcıda sayfanın reklam/giriş katmanı açılırdı.
      if (json.ok && json.url && isEmbeddableAddress(json.url)) {
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
  /**
   * BÖLÜMLER PANELİ (05.10.2026) — kullanıcı isteği: "bölümler solda olacak,
   * sağda yorumlar olacak ... bölümler videonun hemen altında olmalı".
   *
   * Artık sağda yapışkan bir RAY YOK. Oynatıcı TAM GENİŞLİK; ALTINDA iki
   * kolon: solda bölüm listesi, sağda yorumlar. Böylece bölümler videonun
   * hemen altına iner ve sayfa animecix'teki ayrık düzeni andırır.
   *
   * Neden değişken: panel TEK kez üretilir; iki düzen de aynı düğümü kullanır
   * (çeviri kancası iki kez çalışmasın diye).
   */
  const episodePanel =
    activeSeason && currentEpisode ? (
      <EpisodeSidebar
        slug={showSlug(show)}
        seasons={playableSeasons}
        activeSeason={activeSeason}
        currentEpisodeId={currentEpisode.id}
        multipleSeasons={multipleSeasons}
        malId={show.mal_id ?? null}
        autoNext={autoNext}
        onToggleAutoNext={() => setAutoNext((value) => !value)}
      />
    ) : null;

  /**
   * SEZON KISAYOLU KALDIRILDI (kullanıcı, 05.10.2026): "buna gerek yok ki, sil
   * bunu, yok et." Bölüm listesinin başlığındaki sezon seçici zaten sezon
   * değiştirmeyi sağlıyor; altta ikinci bir sezon kısayolu tekrar yaratıyordu.
   */

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
    <div className={cn("relative min-h-screen bg-background", dim && "bg-black")}>
      {/* SAHNE IŞIKLARI PERDESİ — sayfanın TAMAMININ üzerine binen %90 siyah
          katman. İçeriği gizlemez, %10'luk soluk bir hayalet bırakır. Oynatıcı
          ve açma/kapama düğmesi `z-[60]` ile bunun ÜSTÜNDE kalır. `z-[55]`:
          site üst şeridi (`#sh-header`, z-50) ve alt sekme çubuğu (z-40) dahil
          her şeyi örter. `pointer-events-none`: arkadaki bağlantılar tıklanabilir
          kalsın. */}
      {dim ? (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[55] bg-black/90" />
      ) : null}
      {/* ESKI SAYFA-ICI BASLIK SERIDI KALDIRILDI (01.10.2026): "header her yerde ayni olsun". */}
      {/* Serit artik TEK yerde: `SiteHeader` -> `__root.tsx`. */}

      {/* Genişlik, üst şeritle AYNI kapsayıcıyı kullanır: oynatıcının sol kenarı
          logoyla, panelin sağ kenarı "Anasayfa" ile aynı hizada durur. */}
      <main className="mx-auto w-full max-w-[1440px] px-4 py-6 lg:px-8">
        <h1 className="sr-only">
          {show.title}
          {currentEpisode
            ? ` ${t("watch.srEpisodeWatch", { number: currentEpisode.number })}`
            : ` ${t("watch.srWatch")}`}
        </h1>

        {/* SERİ ÜST BİLGİSİ — referans izleme sayfasının (lunarx) düzeni.
            KULLANICI İSTEĞİ (01.10.2026): "oynatıcı üstüne bu sitedeki gibi
            bölüm kapağı ... olsun".

            Kapak solda; sağında geri bağlantısı, seri adı, sezon/bölüm satırı ve
            künye çipleri. TÜM VERİ GERÇEKTİR (`fetchShowDetail` `select("*")`
            yapar) — elimizde OLMAYAN alan (puan/yıldız vb.) HİÇ ÇİZİLMEZ.
            Bağlantılar `Link`: gezinme sayfa yenilemeden olur. */}
        <header className="mb-3 flex items-start gap-3 sm:gap-4">
          <Link
            to="/anime/$slug"
            params={{ slug: showSlug(show) }}
            tabIndex={-1}
            aria-hidden="true"
            className="shrink-0"
          >
            <img
              src={show.image}
              alt=""
              width={72}
              height={102}
              loading="eager"
              decoding="async"
              // MOBİLDA DİKEY + DAR (kullanıcı düzeltmesi, 05.10.2026): yatık
              // (86×64) deneme YANLIŞ bulundu — "kapak yatay olmuş, tam
              // görünmüyor, genişliğini kıs, dikey olsun, sağdaki yazıların
              // yüksekliği kadar olsun." Telefonda 44×64 (dikey oran), sağdaki
              // başlık bloğunun (3 satır) yüksekliğine TAM oturur. `sm` ve
              // üstünde eskisi gibi 72×102 (dikey) — masaüstü DEĞİŞMEZ.
              className="h-16 w-11 rounded-lg object-cover sm:h-[102px] sm:w-[72px]"
            />
          </Link>
          <div className="min-w-0 flex-1">
            {/* show.title VERİTABANI içeriğidir → bilerek ÇEVRİLMEZ. */}
            <h2 className="truncate font-display text-[16px] font-bold leading-tight text-foreground sm:text-2xl">
              {show.title}
            </h2>
            {/* Sezon/bölüm satırı YALNIZCA bölüm varsa çizilir; aksi hâlde
                "0. Sezon 0. Bölüm" gibi anlamsız bir metin doğardı. */}
            {currentEpisode ? (
              // TEK SATIR (`truncate`): sezon/bölüm + bölüm adı uzun olunca
              // alt satıra kayıp geri bağlantısını aşağı itiyor, header uzuyordu
              // (kullanıcı: "yazılar logoyu geçmemeli, iPhone 13'te aşağı eğiyor").
              <p className="mt-0.5 truncate text-[12px] text-muted-foreground sm:text-sm">
                <span className="text-foreground/90">
                  {t("common.seasonEpisode", {
                    season: currentEpisode.season,
                    n: currentEpisode.number,
                  })}
                </span>
                {/* Bölüm adı ÇEVRİLİR (kural: yalnızca ANİME adları sabittir).
                    Aşağıdaki bilgi satırı kaldırıldı; ad tek yerde burada. */}
                {translatedEpisodeTitle || cleanEpisodeTitle ? (
                  <span> · {translatedEpisodeTitle || cleanEpisodeTitle}</span>
                ) : null}
              </p>
            ) : null}
            {/* GERİ BAĞLANTISI — kullanıcı isteği (05.10.2026): "back to series'i
                sezon/bölüm satırının ALTINA getir". Üstten buraya indi. Kategori
                çipleri (tür/yıl/bölüm sayısı/etiketler) TAMAMEN kaldırıldı. */}
            <Link
              to="/anime/$slug"
              params={{ slug: showSlug(show) }}
              // KUTU/STROKE YOK (kullanıcı, 05.10.2026): "arkaya kutu mu ekledin,
              // stroke ekleme, kutu çirkin duruyor". Kenarlık ve zemin kaldırıldı —
              // düz bağlantı; basılabilirliği VURGU RENGİ + alt çizgi veriyor.
              className="mt-1.5 inline-flex items-center gap-1 font-ui text-[11.5px] font-semibold text-muted-foreground underline-offset-4 transition-colors hover:text-accent hover:underline"
            >
              <span aria-hidden="true">‹</span>
              {t("watch.backToSeries")}
            </Link>
          </div>
        </header>
        {/* ── GÖVDE (05.10.2026, SEKMELİ ALT PANEL) ──────────────────────
            KULLANICI İSTEĞİ: "yorumlara basınca yorumlar ekranı, bölümlere
            basınca bölümler ekranı olacak."

            Oynatıcı üstte; altında şerit + reklam; en altta TEK alan ve onun
            üstünde iki SEKME ("Yorumlar" · "Bölümler"). Sekmeye basılınca o
            panel görünür, diğeri gizlenir. PC ve mobilde AYNI. */}
        <AdPlacement slot="ad_watch_top" />
        <div className="space-y-3 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-x-4 lg:gap-y-3 lg:space-y-0">
          <div className="min-w-0 space-y-3 lg:col-start-1 lg:row-start-1">
            <div className={cn("overflow-hidden rounded-2xl bg-black", dim && "relative z-[60]")}>
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
                // PLAY ÖNCESİ ARKA PLAN: filmlerde güncel yatay banner önceliklidir; dizilerde
                // bölüm kapağı korunur. Poster son fallback'tir. Sağlayıcı kareleri KULLANILMAZ.
                poster={
                  show.kind === "movie"
                    ? show.banner_image || currentEpisode?.thumbnail || show.image
                    : currentEpisode?.thumbnail || show.banner_image || show.image
                }
                onGateFinish={() => setGateDone(true)}
                // Kapı kaydı YALNIZCA gerçekten bir reklam başladığında tutulur:
                // dolgu yokken kapı beklemeden açılır ve o an "geçildi" yazılırsa
                // aynı oturumda sonradan gelecek gösterim kaçardı.
                onAdStarted={() => markPrerollPassed(gateStorageKey)}
                // Kendi `<video>`muzun ilerlemesi → konum kaydı + kare yakalama.
                onVideoProgress={handleVideoProgress}
              />
            </div>

            {/* OYNATICI DIŞINDAKİ BLOK. Sahne Işıkları açıkken şerit ve altı %5
                opaklığa iner, sayfa zemini de saf siyaha döner (kök `bg-black`)
                → AMOLED. "Işıkları kapatınca sadece ekran açık" mantığı.
                İSTİSNA: Sahne Işıkları düğmesi görünür kalır (aşağıda), yoksa
                karanlıkta geri kapatılamazdı. */}
            <div className="space-y-3">
              {/* OYNATICI ALT ŞERİDİ — referans (lunarx) düzeni.
            KULLANICI İSTEĞİ (01.10.2026): "oynatıcının altındaki şeyleri tamamen
            kaldır, onunki ile aynı yap ... oynatıcının altına koyacaksın, birleşik
            olmayacak".

            ESKİDEN İKİ AYRI BLOK VARDI:
              (1) `Genişlet · Otomatik oynatma · Otomatik atlama · Önceki ·
                  Sonraki · Bildir` şeridi
              (2) ayrı bir "BİLGİ + SUNUCU" kutusu (dil gruplarına bölünmüş
                  kaynak kutuları)
            İKİSİ DE KALDIRILDI. Yerine TEK satır geldi: solda Kaynak menüsü,
            sağda ikon aksiyonları — ayrı kutu değil, oynatıcının altında tek
            şerit.

            KAYNAK MENÜSÜ NEDEN `<details>`: açma/kapama için ek React durumu
            gerekmez, tarayıcı yerel olarak yönetir, klavyeyle de çalışır ve
            dışarı tıklama sorunu doğmaz. İçinde ÜÇ kaynağın TAMAMI listelenir
            (Anizm · TauVideo · MegaPlay); hiçbiri kaldırılmadı.
            Oynatıcı mantığı AYNEN korunur: `entry.select` / `entry.active` /
            `entry.disabled` / `entry.pending`. */}
              {/* OYNATICI ALT ŞERİDİ — referans düzeni.
            KULLANICI GERİ BİLDİRİMİ (01.10.2026): "sadece şunun aynısını
            yapacaksın ... videoya yapıştırmışsın".

            ÖNEMLİ: şerit videoya YAPIŞIK DEĞİLDİR. Referansta oynatıcının
            ALTINDA, ayrı ve YUVARLAK KÖŞELİ bir çubuktur — oynatıcı ile arasında
            boşluk vardır ve kendi çerçevesi/zemini vardır. (Daha önce "yapışık
            olmalı" diye düşünüp boşluğu ve köşeleri kaldırmıştım; bu YANLIŞTI,
            geri alındı.)

            GENİŞLİK: çubuk ana içerik kolonunun genişliğindedir; SAĞA TAŞMAZ
            (kullanıcı: "hâlâ bizim o yer sağa kadar uzuyor"). */}
              <div
                // İNCE KUMANDA ÇUBUĞU (04.10.2026): eskiden `py-2.5` + kenarlık +
                // h-9 hap düğmeler vardı; mobilde çubuk kalınlaşıp alta doğru
                // uzuyordu. Referans (lunarx) çubuğu İNCE, düz metin tabanlı ve
                // kenarlıksızdır — ona yaklaştık: düğmeler `bare`/ikon.
                // SATIR ASLA ALT SATIRA DÜŞMEZ (kullanıcı, 05.10.2026): mobilde
                // "önceki/sonraki hâlâ aşağıda" şikâyeti üzerine `flex-nowrap`.
                // Yer yetmezse ÖNCE kaynak/ses etiketi kırpılır (bkz. `min-w-0`),
                // şerit yüksekliği sabit kalır.
                className="flex flex-nowrap items-center justify-between gap-x-1.5 rounded-xl bg-card/40 px-1 py-1 sm:px-3"
              >
                <div className="flex min-w-0 items-center gap-x-2.5">
                  {/* KAYNAK + SES — Sahne Işıkları açıkken KARARAN grup.
                ARALIK (kullanıcı, 05.10.2026): "iPhone 13'te kaynak ile
                altyazı çok dip dibe." Grup içi boşluk `gap-x-1` (4px) idi;
                10px'e çıkarıldı ki iki kontrol birbirine yapışık görünmesin.
                DIŞ boşluk (bu grup ile ampul düğmesi arası) da 10px'e çıkarıldı:
                kullanıcı "sub'ın oku ampul ikonuna girmiş" dedi.
                `sm:gap-x-4` — KULLANICI DÜZELTMESİ (05.10.2026): "buradaki
                sadece PC'de değişecekti, mobil aynı kalacaktı; mobil için geri
                al." Mobilde (etiketin gizlendiği < 640 px) boşluk ESKİ hâline
                (10 px) döner; 16 px YALNIZCA ön etiketin göründüğü genişlikte
                uygulanır. */}
                  <div className="flex min-w-0 items-center gap-x-2.5 sm:gap-x-4">
                    {/* KAYNAK — ortak seçici (bkz. `components/site/ControlSelect.tsx`).
                TR İŞARETİ: yalnızca TÜRKÇE altyazılı kaynaklarda, etiketin
                yanında temanın kırmızısıyla (`--primary`) yazılır. */}
                    <ControlSelect
                      label={t("watch.sourceLabel")}
                      ariaLabel={t("watch.sourceLabel")}
                      variant="bare"
                      above
                      options={allSourceEntries.map((entry) => ({
                        key: entry.key,
                        label: entry.label,
                        active: entry.active,
                        disabled: entry.disabled,
                        pending: entry.pending,
                        marker: entry.language === "tr" ? "TR" : undefined,
                      }))}
                      onSelect={(key) =>
                        allSourceEntries.find((entry) => entry.key === key)?.select()
                      }
                    />

                    {/* SES (SUB/DUB) — ortak seçici.
                KULLANICI DÜZELTMESİ (05.10.2026): tek ses seçeneği olduğunda
                düz `<span>` çiziliyordu ve "SUB artık basılmıyor" — etiket
                TIKLANAMAZ hâle gelmişti. Artık seçenek sayısından BAĞIMSIZ
                olarak HER ZAMAN `ControlSelect` çizilir; menüde tek satır olsa
                bile kontrol basılabilir kalır. Etiket kaynağın gerçek sesini
                yansıtır (bkz. `activeAudio`). */}
                    <ControlSelect
                      label={t("watch.audioLabel")}
                      ariaLabel={t("watch.audioLabel")}
                      variant="bare"
                      above
                      options={audioOptions.map(({ audio, entry }) => ({
                        key: audio,
                        label: t(audio === "dub" ? "watch.audioDub" : "watch.audioSub"),
                        active: audio === activeAudio,
                        disabled: entry.disabled,
                        pending: entry.pending,
                      }))}
                      onSelect={(key) =>
                        audioOptions.find((option) => option.audio === key)?.entry.select()
                      }
                    />
                  </div>

                  {/* SAHNE IŞIKLARI — AÇMA/KAPAMA IŞIĞI. Kullanıcı isteği: "audio/
                sub'un yanına al". Mod açıkken sayfadaki her şey siyaha gömüldüğü
                için bu düğme `data-stage-switch` ile TEK GÖRÜNÜR öğe olarak
                kalır; yoksa mod bir daha kapatılamazdı. */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={dim}
                    aria-label={t("watch.dimLabel")}
                    title={t("watch.dimHint")}
                    onClick={() => setDim((value) => !value)}
                    className={cn(
                      "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1 font-ui text-[12px] font-semibold transition-colors",
                      // `z-[60]`: perdenin ÜSTÜNDE kalır — yoksa %10'da geri
                      // açılamazdı.
                      dim && "relative z-[60]",
                      dim
                        ? "bg-primary/20 text-primary"
                        : "bg-secondary/40 text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
                    )}
                  >
                    <FaSolid name="lightbulb" size={13} />
                    <span className="hidden sm:inline">{t("watch.dimLabel")}</span>
                  </button>
                </div>

                {/* SAĞ: ikon aksiyonları. Yalnızca GERÇEKTEN gidecek yeri olanlar
              çizilir — tıklanınca hiçbir şey yapmayan düğme konmaz. */}
                {/* SAĞ: yalnızca SİNEMA MODU ve BİLDİR.
              KULLANICI İSTEĞİ (01.10.2026): "sağ tarafta bildir ve tam ekran
              düğmesi dışındakileri sil". Bu yüzden Detaylar, TV, MAL, işaretle,
              yorumlar ve ayarlar düğmeleri KALDIRILDI. */}
                {/* SAĞ: SİNEMA MODU + BİLDİR. `ml-auto`: dar ekranda sola sığmayıp
              ALT SATIRA düştüğünde ikonlar satırın SAĞ ucunda durur (solda öksüz
              kalmıyordu). Masaüstünde zaten `justify-between` ile sağa yaslıdır. */}
                {/* SAĞ — YALNIZCA BİLDİR (04.10.2026). Kullanıcı: "şu düğmelerden tam
              ekranı kaldır, sadece report kalsın o kadar". Sinema modu düğmesi
              silindi. İkon `size={16}` ile TAM PİKSEL çizilir — eskiden `1em`
              (12.5 px) ölçekleniyordu ve bulanık görünüyordu. */}
                <div className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">
                  {/* ÖNCEKİ / SONRAKİ — kullanıcı isteği (05.10.2026): "prev/next'i
                sağ tarafa, report olan yere taşıyalım". Şeridin SAĞINDA, bildir
                düğmesinin yanında; hedefler `ordered`den gelir ve SEZON SINIRINI
                AŞAR. Bileşen (`EpisodeNav`) dosyada zaten vardı. */}
                  <EpisodeNav
                    slug={showSlug(show)}
                    multipleSeasons={multipleSeasons}
                    previous={previous}
                    upcoming={upcoming}
                  />
                  <button
                    type="button"
                    onClick={handleReport}
                    title={t("watch.reportAction")}
                    aria-label={t("watch.reportAction")}
                    className="grid size-7 place-items-center rounded-md transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <FaSolid name="triangleExclamation" size={16} />
                  </button>
                  {/* TAM EKRAN DÜĞMESİ KALDIRILDI (kullanıcı isteği,
                05.10.2026): "bu butonu yok etmiştik, neden geri ekledin?
                Kaldır şunu." Şeritte YALNIZCA oynatıcı altı BİLDİR düğmesi
                kalır. Oynatıcının kendi tam ekran denetimi zaten vardır
                (iframe `allow="... fullscreen"`). */}
                </div>
              </div>

              {/* ŞERİDİN ALTINDAKİ HER ŞEY — reklamlar + yorumlar. Sahne
                  Işıkları açıkken tamamen siyaha gömülür (bkz. styles.css). */}
              <div className="space-y-3">
                {/* REKLAM — ŞERİDİN ALTINDA (taşındı, 04.10.2026).

            NEDEN TAŞINDI: blok eskiden OYNATICININ ÜSTÜNDEYDİ. Mobilde 300×250
            birim ~250 px yer kaplıyor; üstteki başlık + reklamla birlikte ilk
            ekranda VİDEO HİÇ GÖRÜNMÜYORDU (kullanıcı şikâyeti: "mobil ilk ekran").
            Ayrıca "tek tutarlı tasarım dili" isteği kapsamında okuma akışı
            artık her ekranda aynı: BAŞLIK → OYNATICI → KUMANDA ŞERİDİ → REKLAM.
            Birim/slot AYNI (gelir tarafı değişmedi), yalnızca sıra değişti. */}
                {/* BİLDİR PENCERESİ — referans (lunarx) "Report Anime Issue" diyaloğunun
            karşılığı. Yerel `<dialog>`: Escape ile kapanır, arka planı karartır,
            odak tuzağı hazır gelir; ek React durumu GEREKMEZ.
            Pencere, şeridin KARDEŞİDİR (içine gömülü değil), bu yüzden şeridin
            yerleşimini etkilemez. */}
                <dialog
                  id="watch-report-dialog"
                  aria-labelledby="watch-report-title"
                  className="m-auto w-[min(92vw,420px)] rounded-xl border border-border bg-popover p-0 text-foreground backdrop:bg-black/70 motion-safe:animate-pop-in motion-reduce:animate-none"
                  onClick={(event) => {
                    // Yalnızca ARKA PLANA tıklanınca kapanır; içerideki tıklamalar kapatmaz.
                    if (event.target === event.currentTarget) event.currentTarget.close();
                  }}
                >
                  <form method="dialog" className="flex flex-col gap-3 p-5">
                    <h2 id="watch-report-title" className="text-base font-bold">
                      {t("watch.reportTitle")}
                    </h2>
                    <p className="text-[13px] text-muted-foreground">{t("watch.reportIntro")}</p>
                    <p className="rounded-lg border border-border bg-card px-3 py-2 text-[12.5px]">
                      {t("watch.reportCurrent")}:{" "}
                      <strong>
                        {currentEpisode
                          ? t("common.seasonEpisode", {
                              season: currentEpisode.season,
                              n: currentEpisode.number,
                            })
                          : "—"}
                      </strong>
                    </p>
                    <textarea
                      name="detail"
                      rows={3}
                      placeholder={t("watch.reportPlaceholder")}
                      className="w-full resize-y rounded-lg border border-border bg-card px-3 py-2 text-[13px] outline-none focus:border-primary"
                    />
                    <div className="mt-1 flex items-center justify-end gap-2">
                      <button
                        type="submit"
                        value="cancel"
                        className="rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      >
                        {t("watch.reportCancel")}
                      </button>
                      <button
                        type="submit"
                        value="send"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                      >
                        <FaSolid name="triangleExclamation" aria-hidden="true" />
                        {t("watch.reportAction")}
                      </button>
                    </div>
                  </form>
                </dialog>
                {/* ── BÖLÜM BİLGİSİ KALDIRILDI (05.10.2026) ───────────────────
                Kullanıcı: "aynı bölüm açıklaması 2 yerde". Bölüm numarası + adı
                artık YALNIZCA üstteki seri başlığının altındaki satırda
                yazılır; aktif kaynak da şeritteki "Kaynak" menüsünde görünür.
                Burada ikinci kez yazmak tekrar yaratıyordu. */}
                <AdPlacement slot="ad_watch_bottom" nativeOnDesktop desktopOnly />{" "}
              </div>
            </div>
          </div>

          {/* PC SAĞ KOLON — BÖLÜM LİSTESİ (05.10.2026). Kullanıcı: "pc'de
              bölümleri aşağı alma, oynatıcının sağında duracak." Yalnızca
              geniş ekranda çizilir; mobilde aşağıdaki sekmeli alana düşer. */}
          {isDesktop ? (
            <div className="space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
              {episodePanel}
            </div>
          ) : null}

          {/* ── SEKMELİ ALT ALAN — "Yorumlar" / "Bölümler" ─────────────── */}
          <section className="mt-1 lg:col-start-1 lg:row-start-2 lg:mt-0">
            <div
              role="tablist"
              aria-label={t("watch.commentsHeading")}
              // SEKMELER EŞİT BÖLÜŞÜR ve ORTALANIR (kullanıcı, 05.10.2026):
              // "ekran tamamen comments/episodes ortadan hizalanmalı". `flex-1`
              // her sekmeye yarım genişlik verir, metin kendi içinde ortalanır.
              className="flex items-stretch border-b border-border lg:hidden"
            >
              <button
                type="button"
                role="tab"
                aria-selected={panelTab === "comments"}
                onClick={() => setPanelTab("comments")}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-2 border-b-2 px-4 py-2.5 font-ui text-[13px] font-bold transition-colors",
                  panelTab === "comments"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <MessageSquare size={15} aria-hidden="true" />
                {t("watch.commentsHeading")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={panelTab === "episodes"}
                onClick={() => setPanelTab("episodes")}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-2 border-b-2 px-4 py-2.5 font-ui text-[13px] font-bold transition-colors",
                  panelTab === "episodes"
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Tv size={15} aria-hidden="true" />
                {t("series.episodesHeading")}
                {activeSeason ? (
                  <span className="font-semibold text-muted-foreground">
                    {activeSeason.episodes.length}
                  </span>
                ) : null}
              </button>
            </div>

            {/* AKTİF PANEL — seçilen sekmenin içeriği.
                PC'de (lg ve üstü) bölüm listesi oynatıcının SAĞINDA durur;
                burada yalnızca yorumlar kalır, sekme çubuğu gizlenir. */}
            <div className="pt-4 lg:pt-0">
              {isDesktop ? (
                currentEpisode ? (
                  <Comments episodeKey={currentEpisode.id} />
                ) : null
              ) : panelTab === "comments" ? (
                currentEpisode ? (
                  <Comments episodeKey={currentEpisode.id} />
                ) : null
              ) : (
                <div className="space-y-4">{episodePanel}</div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

/**
 * GENİŞ EKRAN TAKİBİ (05.10.2026).
 *
 * NEDEN GERİ GELDİ: gövde yerleşimi artık PC'de farklıdır — bölüm listesi
 * oynatıcının SAĞINDA durur, mobilde ise sekmeli alana iner. Bu ayrım için
 * eşleşme medya sorgusu gerekir. Sunucuda `matchMedia` yok → ilk değer `false`
 * (mobil düzeni); istemci hidrasyondan sonra gerçek değeri alır.
 */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isDesktop;
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
  poster,
  onGateFinish,
  onAdStarted,
  onVideoProgress,
}: {
  watching: boolean;
  showTitle: string;
  epNumber: number;
  epUrl: string;
  /**
   * "OYNAT" ÖNCESİ ARKA PLAN (04.10.2026).
   *
   * NEDEN EKLENDİ: reklam kapısı (`PrerollGate`) `poster` prop'unu zaten
   * destekliyordu ama çağrı YERİ hiç vermiyordu → play öncesi ekran düz SİYAH
   * bir kutu + ortada "Oynat" düğmesiydi (kullanıcı geri bildirimi: "orası
   * eksik"). Bölümün kendi kapak görseli varsa o, yoksa serinin arka planı
   * geçilir; uydurma kare üretilmez.
   */
  poster?: string | undefined;
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
   * Gerçekten bir reklam oynatılmaya başlandığında çağrılır (gösterim sayacıyla
   * aynı anda) → çağıran "bu bölümün kapısı geçildi" diye oturum kaydı tutar.
   * Dolgu yokken çağrılmaz (o an kapı beklemeden açılır).
   */
  onAdStarted?: (() => void) | undefined;
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
    // KÖŞELER: eskiden `rounded-t-2xl` + `border-x border-t` idi — yalnızca ÜST
    // köşeler yuvarlak, alt köşeler DÜZ ve alt kenarlık yoktu. O tasarım,
    // oynatıcının altına YAPIŞIK bir şerit varsayımından kalmaydı; şerit artık
    // AYRI bir çubuk (aşağıdaki `mt-3 … rounded-xl`). Kullanıcı isteği
    // (01.10.2026): "video sadece üstü kavisli, altı da kavisli olsun"
    // → DÖRT köşe yuvarlak + tam çerçeve.
    <div className="relative overflow-hidden rounded-2xl border border-border bg-black">
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
          poster={poster}
          onFinish={onGateFinish}
          onAdStarted={onAdStarted}
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
      className="inline-flex items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-secondary/50"
    >
      <span
        className={cn(
          "relative h-4 w-7 shrink-0 rounded-full border transition-colors",
          on ? "border-primary bg-primary" : "border-border bg-secondary",
        )}
      >
        <span
          className={cn(
            "absolute top-[1px] size-3 rounded-full transition-all",
            on ? "left-[14px] bg-accent-foreground" : "left-[1px] bg-muted-foreground",
          )}
        />
      </span>
      <span
        className={cn(
          "font-ui text-[11.5px] font-bold",
          on ? "text-foreground" : "text-muted-foreground",
        )}
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
  malId,
  autoNext,
  onToggleAutoNext,
}: {
  slug: string;
  seasons: SeasonWithEpisodes[];
  activeSeason: SeasonWithEpisodes;
  currentEpisodeId: string;
  multipleSeasons: boolean;
  /** MAL kimliği: bölüme ait gerçek görseli (ani.zip) kullanmak için (bkz. EpisodeCard). */
  malId?: number | null | undefined;
  /**
   * "Oto. Sonraki Bölüm" anahtarının durumu.
   *
   * Kullanıcı isteğiyle şeritten buraya (bölüm listesinin ÜSTÜNE) taşındı —
   * animecix'in "İLİŞKİLİ VİDEOLAR" panelindeki iki anahtarla aynı düzen.
   */
  autoNext: boolean;
  onToggleAutoNext: () => void;
}) {
  // Ref doğrudan <li> üzerinde tutulur: `Link` bileşeninin ref'i DOM düğümüne
  // iletilmediği için kaydırma çalışmıyordu.
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const navigate = useNavigate();
  const { t } = useLang();

  /**
   * İZLENEN BÖLÜMLER (kullanıcı isteği, 05.10.2026): "oynatıcı sayfasına da
   * izlenen bölümler detay sayfasındaki gibi izlenmiş görüntüsü olsun —
   * görüntüsü oradaki gibi."
   *
   * Detay sayfasında izlenen satırın TAMAMI soluklaşır (`opacity-55`); aynı
   * dil burada da uygulanır. Kaynak tek: `lib/watch-progress` (localStorage).
   *
   * NEDEN `useEffect` + state, doğrudan `getWatched` DEĞİL: depolama yalnızca
   * tarayıcıda vardır (sayfa sunucuda da çizilir) ve işaretleme başka bir
   * effect'te yapılır. `currentEpisodeId` değiştiğinde yeniden okunur; gezinme
   * aynı bileşen örneğini koruduğu için (rota parametresi değişir, rota
   * değişmez) state kendiliğinden bayatlamaz.
   */
  const [watchedKeys, setWatchedKeys] = useState<ReadonlySet<string>>(() => new Set());
  /**
   * Kayıtlı süreler (`{ "s1b5": { position, duration } }`) — kapak üzerindeki
   * HOVER süre damgasını besler. `getShowProgress` depoyu BİR KEZ okur; satır
   * başına `getProgress` çağırmak 1000 bölümlük seride her satırda tam
   * `JSON.parse` demek olurdu.
   */
  const [progressMap, setProgressMap] = useState<
    Record<string, { position: number; duration: number }>
  >({});
  useEffect(() => {
    setWatchedKeys(getWatched(slug));
    setProgressMap(getShowProgress(slug));
  }, [slug, currentEpisodeId]);

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
    // PANEL — tek kart. Eskiden panelin üstünde AYRI bir kapak/"Episodes" bloğu
    // + iki tam genişlik anahtar satırı, altında da ayrı bir liste kartı vardı;
    // kullanıcı "darmadağınık, yer kaplıyor" dedi. Artık tek başlık (Bölümler +
    // sezon seçimi) ve tek satır anahtar şeridi var.
    // KUTU KALDIRILDI (kullanıcı, 05.10.2026): "bölümlerdeki arkadaki büyük
    // kutuyu kaldıralım; böylece bölüm adları ve kapak görselleri kenarlara
    // yaklaşsın, hem büyür hem bölüm adları tam görünür." Kenarlık, zemin ve
    // yuvarlak köşeler silindi — liste artık düz bir sütun.
    <aside className="flex flex-col transition-opacity">
      {/* HİZALAMA (kullanıcı, 05.10.2026): "comments yazısı daha üstte duruyor,
          bu biraz aşağıda; onunla aynı hizada açılsın." Başlık satırı
          `items-center` iken yüksek sezon seçicisi (h-9) satırı uzatıyor ve
          başlığı 8px aşağı itiyordu. `items-start` ile başlık, yorumlar
          başlığıyla aynı hizaya gelir. */}
      <div className="flex flex-wrap items-start justify-between gap-2 px-1 pb-3">
        {/* BAŞLIK — detay sayfasındaki bölüm başlığıyla AYNI dil (kırmızı
              şerit + `font-display`). Eskiden burada düz `font-extrabold`
              vardı; iki sayfa aynı listeyi iki farklı ağızla sunuyordu. */}
        <h2 className="flex items-center gap-2.5 font-display text-sm font-bold text-foreground">
          <span className="h-4 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
          {t("series.episodesHeading")}
        </h2>
        {multipleSeasons ? (
          // SEZON — native `<select>` DEĞİL, ortak seçici. Aynı sayfada bir
          // yerde tarayıcı paneli, öbüründe bizim panelimiz açılıyordu.
          <ControlSelect
            ariaLabel={t("series.seasonSelectAria")}
            align="right"
            options={seasons.map((season) => ({
              key: String(season.number),
              label: seasonLabel(season),
              active: season.number === activeSeason.number,
            }))}
            onSelect={(key) => {
              // Sezon değişince o sezonun ilk bölümüne gidilir.
              const target = seasons.find((season) => season.number === Number(key));
              const first = target?.episodes[0];
              if (!first || !target) return;
              void navigate({
                to: "/anime/$slug/season/$season/episode/$episode",
                params: { slug, season: String(target.number), episode: String(first.number) },
              });
            }}
          />
        ) : (
          <span className="text-xs font-bold text-muted-foreground">
            {/* DÜZELTME (S2): doğrudan `home.episodeCount` kullanılıyordu; İngilizcede
                  tek bölümde "1 episodes" yazıyordu. `plural` 1 için `…One` anahtarını seçer
                  (Türkçede iki anahtarın değeri aynıdır; bkz. i18n.ts). */}
            {plural(t, activeSeason.episodes.length, "home.episodeCountOne", "home.episodeCount")}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 px-1 pb-2">
        {/* YALNIZCA OTOMATİK GEÇİŞ — "Sahne Işıkları" 05.10.2026'da kullanıcı
            isteğiyle şeride, AUDIO/SUB menüsünün yanına taşındı. */}
        <SidebarSwitch
          label={t("watch.autoNextLabel")}
          hint={t("watch.autoNextHint")}
          on={autoNext}
          onToggle={onToggleAutoNext}
        />
      </div>

      <div
        ref={listRef}
        // Mobilde liste ekranın %60'ıyla sınırlı; masaüstünde panel zaten
        // oynatıcı yüksekliğinde olduğu için ayrıca sınır gerekmez.
        className="ince-kaydirma max-h-[60vh] overflow-y-auto p-0"
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
            /**
             * İZLENDİ GÖRÜNTÜSÜ: satırın tamamı soluklaşır — detay sayfasının
             * birebir aynı dili (`opacity-55`). AKTIF BÖLÜM HARİÇ: şu an
             * oynatılan satır altın vurgusunu (`bg-accent/15` + `text-accent`)
             * korur; onu da soldurmak "seçili" bilgisini bozardı.
             */
            const watchedRow =
              !active && watchedKeys.has(episodeKey(episode.season, episode.number));
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
                  // `group`: satıra fareyle gelince kapağın üzerindeki oynat
                  // rozeti görünür.
                  className={`group flex items-center gap-2.5 rounded-lg p-1.5 transition-colors ${
                    active ? "bg-accent/15" : "hover:bg-secondary focus-visible:bg-secondary"
                  } ${watchedRow ? "opacity-55" : ""}`}
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
                      <span className="block text-[11px] leading-snug text-muted-foreground">
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
    <span className="relative grid aspect-video w-24 shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary">
      <EpisodeCover
        number={episode.number}
        numberClassName="text-[11px] font-bold text-muted-foreground"
        // ── TVDB-TEK KAYNAK: (a) panelden yüklenen kapak → (b) SEZONUN kendi MAL
        // kaydı → (c) SERİ MAL kaydı → (d) zincirdeki kardeş kayıt → (e) TVDB'den
        // R2'deki bölüm kapağı. Sağlayıcı kareleri/animecix/katalog kapağı/seri
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
          // R2'ye taşınmış TVDB görseli (manifest'te varsa).
          episodeCoverUrl(slug, episode.season, episode.number),
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
  // ŞERİDİN PARÇASI (05.10.2026): kullanıcı "kutu içinde durmasın, çok büyük
  // olmuş, stroke'u var, sonradan eklenmiş gibi" dedi. Dış kutu, kenarlık ve
  // düğme zeminleri KALDIRILDI — şeridin geri kalanı gibi düz metin + ikon.
  // Etiketler her ekranda görünür ve tek satıra sığar.
  // ÖNCEKİ/SONRAKİ — ikon geri geldi (05.10.2026).
  //
  // KULLANICI: "önceki/sonraki düğmesinin yanında ikon vardı, onu geri koy;
  // gelmiyorsa ikon olsun, altında ufak yazı kalsın." Mobilde ikon + yazı YAN
  // YANA durunca şerit iPhone 13'te ikinci satıra düşüyordu; bu yüzden mobilde
  // dikey yığın: ikon ÜSTTE, minik etiket ALTTA (`flex-col`). `sm` ve üstünde
  // eski düzen — ikon ve yazı yan yana (`sm:flex-row`).
  const item =
    "inline-flex flex-col items-center justify-center gap-0 rounded-md bg-secondary/30 px-1 py-0.5 font-ui font-semibold text-muted-foreground transition-colors sm:h-6 sm:flex-row sm:gap-1 sm:py-0";
  const itemLabel = "text-[8px] leading-none sm:text-[10.5px]";
  const activeC = `${item} hover:bg-secondary/60 hover:text-foreground`;
  const passive = `${item} cursor-not-allowed text-muted-foreground/40`;

  return (
    <div className="flex shrink-0 items-center gap-1">
      {previous ? (
        <Link
          to="/anime/$slug/season/$season/episode/$episode"
          params={{
            slug,
            season: String(previous.season),
            episode: String(previous.episode.number),
          }}
          className={activeC}
          title={label(previous)}
        >
          <FaSolid name="backwardStep" size={11} />
          <span className={itemLabel}>{t("watch.previous")}</span>
        </Link>
      ) : (
        // Pasif hâl: bağlantı DEĞİL, düz yazı — tıklama hiçbir şey yapmaz.
        <span className={passive} aria-disabled="true" title={t("watch.firstEpisodeTitle")}>
          <FaSolid name="backwardStep" size={11} />
          <span className={itemLabel}>{t("watch.previous")}</span>
        </span>
      )}
      <span aria-hidden="true" className="h-4 w-px bg-border" />
      {upcoming ? (
        <Link
          to="/anime/$slug/season/$season/episode/$episode"
          params={{
            slug,
            season: String(upcoming.season),
            episode: String(upcoming.episode.number),
          }}
          className={activeC}
          title={label(upcoming)}
        >
          <span className={itemLabel}>{t("watch.next")}</span>
          <FaSolid name="forwardStep" size={11} className="order-first sm:order-none" />
        </Link>
      ) : (
        <span className={passive} aria-disabled="true" title={t("watch.lastEpisodeTitle")}>
          <span className={itemLabel}>{t("watch.next")}</span>
          <FaSolid name="forwardStep" size={11} className="order-first sm:order-none" />
        </span>
      )}
    </div>
  );
}

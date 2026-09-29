import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CloudDownload,
  Globe,
  Languages,
  ListPlus,
  Loader2,
  Minus,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  db,
  extractEmbedUrl,
  inputCls,
  moveAndPersist,
  nextSortOrder,
  pasteEmbed,
  watchUrlError,
} from "@/lib/admin";
import { AnizipSyncPanel, type PanelActivity } from "@/components/admin/AnizipSyncPanel";
import { toast } from "@/lib/admin-toast";
import { confirmAction } from "@/lib/admin-confirm";
import type { Episode, Season } from "@/lib/content";
import { devMark } from "@/lib/dev-log";
import { SOURCE_GROUPS } from "@/lib/embed-sources";
import { isPartContinuation, puffySlugFor, puffySlugForSeason } from "@/lib/puffy";
import {
  fetchNumberedSeasonChain,
  findPrequelMalId,
  resolveCatalogTarget,
} from "@/lib/admin-anizip";
import {
  fetchSourcesForEpisodes,
  replaceEpisodeSources,
  type EpisodeSource,
  type EpisodeSourceInput,
} from "@/lib/episode-sources";

/** Bir sayfada gösterilen bölüm sayısı. 1000+ bölümlü seriler için sayfalama şart. */
const PAGE_SIZE = 50;

/**
 * Bölüm satırının KAYNAK SEÇİCİSİNDEKİ satırlar.
 *
 * Liste `lib/embed-sources.ts`ten TÜRETİLİR (kopyalanmaz) ki yeni sağlayıcı
 * eklendiğinde panelde kendiliğinden görünsün. `anizm` ve `animecix` Türkçe
 * taraftadır ama adresleri FARKLI yerde çözülür: anizm hash'i puffytr adresinden,
 * animecix oynatıcısı eşlenmiş kayıttan gelir. `tauvideo` dışarıda çünkü o bir
 * sağlayıcı DİREKTİFİ DEĞİL (adresi bölüme özel, animecix sayfasından gelir).
 */
type PickKind = "anizm" | "animecix" | "foreign";
type PickItem = {
  id: string;
  short: string;
  language: "tr" | "en";
  kind: PickKind;
  order: number;
};

const FOREIGN_SOURCES = SOURCE_GROUPS.flatMap((group) => group.items).filter(
  (item) => item.id !== "anizm" && item.id !== "tauvideo",
);

/** Yazılış sırası (`order` → `episode_sources.sort_order`): Türkçe önce. */
const PICK_ORDER: PickItem[] = [
  { id: "anizm", short: "Anizm / Puffy", language: "tr", kind: "anizm", order: 0 },
  // Görünen ad "TauVideo": animecix kaydının gömülü oynatıcısı tau-video.xyz; kaynak
  // id'si `animecix` ve `@animecix` direktifi DEĞİŞMEZ (kayıtlı satırlar çözülmeye devam eder).
  { id: "animecix", short: "TauVideo", language: "tr", kind: "animecix", order: 1 },
  ...FOREIGN_SOURCES.map((item, index) => ({
    id: item.id,
    short: item.label.split(" — ")[0] ?? item.label,
    language: "en" as const,
    kind: "foreign" as const,
    order: 2 + index,
  })),
];

/**
 * MANUEL EMBED kaynağının kimliği.
 *
 * NEDEN AYRI KİMLİK: kullanıcı (27.09.2026) "kaynağı elle ekleyebilme için olan yer
 * olsa yeter … manuel nasıl gireceğimi, embed çekmeyi bilmiyorum" dedi. Bölüme
 * yapıştırılan adres bu kimlikle yazılır; `PICK_ORDER`da YER ALMAZ çünkü bir
 * sağlayıcı değil, izleyicinin kendi verdiği adrestir. İzleme sayfası `@` ile
 * başlamayan her adresi doğrudan oynatır (bkz. `lib/embed-provider.ts` →
 * `resolveEpisodeEmbed`: `if (direct) return direct`), yani bu satır çalışır.
 */
const MANUAL_SOURCE_ID = "manual";

/** Kaynağı çekilmemiş bölümler için sabit boş liste (her render'da yeni dizi üretmesin). */
const EMPTY_SOURCES: EpisodeSource[] = [];

/** Bir kaynağın rozetinde görünen kısa ad (`Anizm / Puffy` → `Anizm`). */
function badgeName(short: string): string {
  return short.split(" / ")[0]?.trim() || short;
}

/** Bölümde yazılı olan kaynak kimlikleri. */
function sourceIdsOf(stored: EpisodeSource[]): Set<string> {
  return new Set(stored.map((row) => row.provider));
}

/** Bölümde EKSİK olan kaynaklar (yazılı olmayanlar), `PICK_ORDER` sırasında. */
function missingOf(stored: EpisodeSource[]): PickItem[] {
  const have = sourceIdsOf(stored);
  return PICK_ORDER.filter((item) => !have.has(item.id));
}

/**
 * KAYNAK DURUMU ROZETLERİ — "bu bölüm HANGİ kaynaktan yüklü, neyi eksik?"
 *
 * ── NEDEN GEREKLİ (kullanıcı isteği, 27.09.2026) ──────────────────────────────
 * Satırda yalnızca `Kaynaklar (2)` yazıyordu: kaç kaynak olduğu görünüyordu ama
 * HANGİLERİ olduğu ve neyin EKSİK kaldığı görünmüyordu. Kullanıcının cümlesi:
 * "3 kaynak var ya hangi kaynaktan yüklendiği de belli olsun … eksik olup
 * olmadığını nasıl alacağım". Artık her kaynak için bir rozet var:
 *   · DOLU + YEŞİL ve ✓  → bu bölümde yazılı,
 *   · soluk, KESİK çerçeve → bu bölümde eksik,
 *   · hiçbiri yoksa kırmızı `kaynak yok` rozeti (bölüm oynatıcıda kaynaksız kalır).
 *
 * Kaynaklar HENÜZ çekilmediyse (`loaded = false`) yeşil/kırmızı iddia edilmez —
 * yalnızca `…` gösterilir; "yükleniyor" ile "gerçekten eksik" karıştırılmaz.
 */
function SourceBadges({ stored, loaded }: { stored: EpisodeSource[]; loaded: boolean }) {
  if (!loaded) {
    return (
      <span
        className="shrink-0 text-[11px] font-bold text-muted-foreground"
        title="Kaynaklar yükleniyor…"
      >
        …
      </span>
    );
  }
  const have = sourceIdsOf(stored);
  const missing = missingOf(stored);
  /**
   * `PICK_ORDER`da OLMAYAN yazılı kaynaklar (ör. `manuel`): elle yapıştırılan adres
   * de "yüklü kaynak"tır — rozette görünmezse kullanıcı yazdığını kaybettiğini sanır.
   */
  const extras = [...have].filter((id) => !PICK_ORDER.some((item) => item.id === id));
  return (
    <span className="flex shrink-0 items-center gap-1">
      {PICK_ORDER.map((item) => {
        const ok = have.has(item.id);
        return (
          <span
            key={item.id}
            title={
              ok
                ? `${item.short}: bu bölümde yazılı (oynatıcı altında çıkar)`
                : `${item.short}: bu bölümde EKSİK`
            }
            className={
              ok
                ? "rounded-full border border-emerald-500/50 bg-emerald-500/15 px-2 py-px text-[10.5px] font-bold text-emerald-400"
                : "rounded-full border border-dashed border-border px-2 py-px text-[10.5px] font-bold text-muted-foreground/60"
            }
          >
            {ok ? "✓ " : ""}
            {badgeName(item.short)}
          </span>
        );
      })}
      {extras.map((id) => (
        <span
          key={id}
          title="Elle eklenen kaynak (manuel embed)"
          className="rounded-full border border-emerald-500/50 bg-emerald-500/15 px-2 py-px text-[10.5px] font-bold text-emerald-400"
        >
          ✓ {id === MANUAL_SOURCE_ID ? "Manuel" : id}
        </span>
      ))}
      {/* "kaynak yok" YALNIZCA hiçbir satır yokken gösterilir: elle eklenen adres varken
          bölüm kaynaksız DEĞİLDİR (eski koşul `PICK_ORDER` tamamlanmadığı için elle
          eklenen bölümü de "kaynak yok" sayıyordu). */}
      {stored.length === 0 && (
        <span className="rounded-full border border-red-500/50 bg-red-500/15 px-2 py-px text-[10.5px] font-bold text-red-400">
          kaynak yok
        </span>
      )}
    </span>
  );
}

/** Toplu eklemede tek istekte gönderilecek bölüm sayısı. */
const BULK_CHUNK = 100;

/**
 * Toplu ekleme satırını çözer. Kabul edilen biçimler:
 *   https://host/embed-abc.html
 *   42 - https://host/embed-abc.html
 *   https://host/embed-abc.html | 42. Bölüm adı
 */
function parseBulkLine(raw: string): {
  number: number | null;
  url: string;
  title: string;
} {
  const pipe = raw.indexOf("|");
  const urlPart = pipe >= 0 ? raw.slice(0, pipe) : raw;
  const title = pipe >= 0 ? raw.slice(pipe + 1).trim() : "";
  const match = urlPart.match(/^\s*(\d+)\s*[-.)\]]?\s+/);
  const parsedNumber = match?.[1] ? parseInt(match[1], 10) : Number.NaN;
  const withoutNumber = match ? urlPart.slice(match[0].length) : urlPart;
  return {
    number: Number.isFinite(parsedNumber) ? parsedNumber : null,
    url: extractEmbedUrl(withoutNumber),
    title,
  };
}

/** `show_seasons` kaydı olmayan ama bölümü olan sezonlar için üretilen geçici satır. */
const VIRTUAL_PREFIX = "sanal-sezon-";
type SeasonRow = Season & { virtual: boolean };

function virtualSeason(showId: string, number: number): SeasonRow {
  return {
    id: `${VIRTUAL_PREFIX}${showId}-${number}`,
    show_id: showId,
    number,
    title: "",
    sort_order: number,
    virtual: true,
  };
}

/** Sezon kayıtları ile bölümleri birleştirip gösterilecek sezon listesini üretir. */
function buildSeasonRows(seasonRows: Season[], episodes: Episode[], showId: string): SeasonRow[] {
  const map = new Map<number, SeasonRow>();
  for (const row of seasonRows) map.set(row.number, { ...row, virtual: false });
  for (const episode of episodes) {
    if (!map.has(episode.season)) map.set(episode.season, virtualSeason(showId, episode.season));
  }
  return [...map.values()].sort((a, b) => a.sort_order - b.sort_order || a.number - b.number);
}

/**
 * "KAYNAKTA YOK" ile "HATA" AYRIMI.
 *
 * ── NEDEN GEREKLİ (ölçülen olay, 28.09.2026) ────────────────────────────────
 * Kullanıcı Jujutsu Kaisen **0 (film)** için kaynak kaydetti; TauVideo seçiliydi
 * ve şu "sorun" bildirildi: "TauVideo: bu bölüm için TauVideo kaydı yok".
 * Kırmızı uyarı çıktı, kayıt "sorunlu" sayıldı ve hata izleyicisi de bunu
 * HATA olarak bildirdi.
 *
 * Gerçek durum: **Animecix o filmi hiç yayınlamıyor** (`/api/animecix` boş liste
 * döndürüyor). Yani ortada bir arıza yok — kaynak o bölümü vermiyor, o kadar.
 *
 * ── NEDEN ÖNEMLİ ───────────────────────────────────────────────────────────
 * İkisi aynı kovaya konunca:
 *   · Kullanıcı her kayıtta gereksiz kırmızı uyarı görüyor ("bir şey bozuldu" hissi),
 *   · GERÇEK hatalar (ağ, 5xx, geçersiz adres) bu gürültünün içinde kayboluyor,
 *   · hata izleyicisi yanlış alarm üretiyor — güvenilirliğini yitiriyor.
 *
 * Bu yüzden "bulunamadı" cevapları **bilgi** olarak yazılır (not), gerçek
 * başarısızlıklar **sorun** olarak kalır.
 */
function notFound(reason: string): boolean {
  return /kaydı yok|bulunamadı|not ?found|yayınlamıyor|mevcut değil|erişilemedi 404|\b404\b/i.test(
    reason,
  );
}

export function SeasonsPanel({
  showId,
  slug,
  malId,
  seriesMalId = null,
  singlePart = false,
  catalogOpenRequest = null,
  onCatalogOpenHandled,
  schemaReady,
  onNotice,
}: {
  showId: string;
  /**
   * Serinin kendi slug'ı. Türkçe (Anizm/puffytr) kaynağını çözerken puffytr
   * adresine çevrilir (`puffySlugFor`).
   */
  slug: string;
  /**
   * Serinin MAL kimliği. Bölüm kaynağı seçicisinin "bu bölüm Anizm'de var mı"
   * denetimi için gerekli (`anizmPlayerUrl`) — yoksa seçici yalnızca genel bilgi
   * gösterir, yanlış bir şey iddia etmez.
   */
  malId?: number | null | undefined;
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * SERİNİN KENDİ (VERİTABANINDAKİ) MAL KİMLİĞİ — `shows.mal_id`.
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * ── NEDEN `malId`DEN AYRI (ölçülen hata, 29.09.2026) ─────────────────────────
   * `malId` bilerek "kutudaki kaydedilmemiş değer" olabilir (kullanıcı kimliği
   * yazıp kaydetmeden katalog çekebilsin diye). Ama sezon/part zinciri ve
   * "bu kimlik serinin kendi kimliği mi?" kararı SERİNİN KÖK kimliğinden
   * kurulmalıdır. Aksi hâlde kullanıcı "MAL'de ara" ile 45576'yı seçince kutu
   * `45576` oluyor, zincir 45576'dan başlıyor ve 45576 KENDİSİ "1. sezon, part
   * yok" sanılıyordu → "S1'in 2. part'ı" uyarısı hiç çıkmıyordu.
   *
   * `null` ise (henüz kaydı olmayan seri) zincir `malId`den kurulur — ilk sezon
   * için doğru davranış zaten budur.
   */
  seriesMalId?: number | null;
  /**
   * TEK PARÇA (FİLM) MODU.
   *
   * Kullanıcı isteği (28.09.2026): filmlerde "Sezonlar ve bölümler" başlığı
   * anlamsız duruyordu — film tek parçadır. Bu mod açıkken **"Yeni sezon ekle"**
   * düğmesi GİZLENİR: kullanıcı yanlışlıkla 2. 3. sezon açıp paneli dağıtmasın.
   *
   * NEDEN TAMAMEN KALDIRILMADI: filmin kaynağı (embed adresi) yine bir bölüm
   * satırına yazılır — yani bu panel film için HÂLÂ GEREKLİ. Filmde tek kayıt
   * ("1. sezon · 1. bölüm") yeterlidir; kaldırmak kaynak eklemeyi imkânsız kılardı.
   */
  singlePart?: boolean;
  /**
   * KATALOG POPUP'INI AÇMA İSTEĞİ — TEK SEFERLİK.
   *
   * Seri formunda **MAL'de ara** başarılı olup eşleşme onaylandığında `true` olur;
   * panel o sezonun katalog popup'ını açar ve `onCatalogOpenHandled` ile isteği
   * tüketir. Böylece kullanıcı ayrıca "Katalog" düğmesine basmak zorunda kalmaz
   * (düğme bu yüzden kaldırıldı — kullanıcı isteği, 28.09.2026).
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * NEDEN SAYAÇ DEĞİL (ölçülen kusur, 28.09.2026)
   *
   * Eski model bir SAYAÇ (+ panel içinde `catalogSignalSeen`) kullanıyordu. "Görüldü"
   * işareti panelin KENDİ durumuydu → panel her kapanıp açıldığında sıfırlanıyor,
   * sayaç ise üst bileşende kalıyordu. Sonuç: `signal !== seen` ve **"Bölüm
   * Yöneticisi"ne her basışta katalog popup'ı kendiliğinden açılıyordu** — kullanıcı
   * "basıyorum bir şey açılmıyor, bir daha basıyorum açılmıyor" diye bildirdi.
   *
   * Yeni modelde isteği ÜST bileşen tüketir; panel kapanıp açılsa da istek yeniden
   * doğmaz. Bu yüzden bayrak (sayaç değil) + tüketim geri çağrısı kullanılır.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  catalogOpenRequest?: {
    /** Açılacak sezonun MAL kimliği; `null` = "sadece paneli aç". */
    malId: number | null;
    /** `true` = bu kimlik serinin kimliğinden FARKLI → SIRADAKİ sezon. */
    newSeason: boolean;
    /**
     * `true` = bu kayıt AYNI SEZONUN DEVAMI (MAL'de "Part N"). Yeni sezon
     * AÇILMAZ; son sezon hedeflenir ve numaralar kaldığı yerden sürer.
     */
    part: boolean;
    /**
     * Girilen kaydın adı (AniList romaji/İngilizce). Part/yeni-sezon ayrımı ve
     * "45576 → S1'in partı, S2 değil" uyarısı bununla üretilir.
     */
    title: string;
  } | null;
  /** İstek karşılandıktan sonra çağrılır; üst bileşen isteği tüketir (tek seferlik). */
  onCatalogOpenHandled?: () => void;
  schemaReady: boolean;
  onNotice: (message: string) => void;
}) {
  const [seasons, setSeasons] = useState<Season[] | null>(null);
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Animecix eşlemesi: kaynak çözümü için `shows.animecix_id` gerekir. Kolon
  // migration'la gelir; YOKSA sorgu hata verir ve panel ÇÖKMEZ — kimlik `null`
  // kalır, Animecix kutusu işaretlenince anlaşılır bir uyarı çıkar.
  const [animecixId, setAnimecixId] = useState<number | null>(null);
  // Aynı anda tek sezon açık kalır ve bölümler sayfalanır: 1000+ bölümlü
  // serilerde (ör. One Piece) liste ve DOM şişmesin.
  const [openSeason, setOpenSeason] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  // Katalogdan (ani.zip) bölüm çekme paneli HANGİ sezonda açık. Sezon başına tek
  // basışla tüm bölümleri eklemek için: sezon kartındaki "Katalogdan çek".
  const [catalogSeason, setCatalogSeason] = useState<number | null>(null);
  /**
   * KATALOG MİNİ HÂLİ — sağ altta hap, yazma sürerken panel kapalı.
   *
   * Kullanıcı isteği: "yükleme yaparken minimize alayım, hapta süre/ilerleme
   * görünsün." Modal `hidden` ile gizlenir (BİLEŞEN DURUR — yazma/sayım devam
   * eder, durum kaybolmaz); hap `catalogActivity` ile canlı ilerlemeyi gösterir.
   * Büyütme hapın kendisine tıklayınca olur.
   */
  const [catalogMin, setCatalogMin] = useState(false);
  /** Hapın çizdiği canlı durum (`AnizipSyncPanel.onActivity` besler). */
  const [catalogActivity, setCatalogActivity] = useState<PanelActivity | null>(null);
  /**
   * KATALOG KAPANIŞ ANİMASYONU — "pat diye kapanmasın".
   *
   * Kapatma isteği önce `catalogClosing` bayrağını kaldırır (160 ms çıkış
   * animasyonu oynar), süre dolunca gerçek kapatma olur. Yeniden açılış
   * (sezon değiştirme) bekleyen zamanlayıcıyı iptal eder.
   */
  const [catalogClosing, setCatalogClosing] = useState(false);
  const catalogCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Kapatma niyeti — animasyonlu, sonra unmount. */
  function requestCatalogClose() {
    if (catalogClosing) return;
    if (catalogCloseTimer.current) clearTimeout(catalogCloseTimer.current);
    setCatalogClosing(true);
    catalogCloseTimer.current = setTimeout(() => {
      catalogCloseTimer.current = null;
      setCatalogSeason(null);
      setCatalogMin(false);
      setCatalogActivity(null);
      setCatalogClosing(false);
    }, 170);
  }
  /**
   * ⚠️ BU ETKİ ERKEN `return`DEN (yükleme durumu) ÖNCE OLMAK ZORUNDA.
   *
   * Bu yüzden hedef sezon `rows`tan değil, doğrudan `seasons` durumundan
   * hesaplanır: `rows` 446. satırda, yükleme kontrolünden SONRA türetiliyor ve
   * oraya kanca koymak React'in "daha fazla kanca çizildi" hatasını verirdi.
   *
   * KANCALAR YALNIZCA `seasons` / `episodes` durumlarına bağlıdır; ikisi de
   * 322-323. satırlarda, yani erken dönüşten önce tanımlıdır.
   */
  /**
   * YENİ AÇILAN (henüz kaydı OLMAYAN) sezonun MAL kimliği.
   *
   * `catalogOpenRequest.newSeason` true geldiğinde buraya yazılır ve panel o
   * sezon numarası için katalogu BU kimlikten çeker. Sezon kaydı ilk yazımda
   * oluşur (`AnizipSyncPanel.ensureSeasonRow`), yani boş sezon açılmaz.
   */
  const [pendingSeasonMalId, setPendingSeasonMalId] = useState<number | null>(null);
  /**
   * PART (KISIM) KAYDI — bu sezonun DEVAMI olan MAL kaydının kimliği.
   * `catalogMalId` hesabında EN ÖNE geçer: panel katalogu bu kimlikten çeker
   * (ör. S1 için 39535 yerine 45576) ama sezonun KENDİ kimliği değişmez.
   */
  const [partSeasonMalId, setPartSeasonMalId] = useState<number | null>(null);
  /**
   * HEDEF SEZONUN KENDİ MAL KİMLİĞİ (zincirden çözülür) — PART numaralandırma
   * çıpası için. `show_seasons`'ta o sezonun satırı OLMAYABİLİR (ör. Mushoku'da
   * S1 satırı yok); çıpa yalnızca DB satırından okunursa part kaydırma hesabı
   * boş kalır. Zincir bu kimliği zaten veriyor (S1 → 39535) → panel onu iletir.
   */
  const [targetSeasonMalId, setTargetSeasonMalId] = useState<number | null>(null);
  /**
   * HEDEF SEZON UYARISI — "bu sezon zaten var (S1)" / "45576 → S1'in partı, S2
   * değil" gibi NET bilgi; panelin üstünde amber kutuda gösterilir.
   *
   * NEDEN GEREKLİ (kullanıcı bildirimi, 29.09.2026): kullanıcı var olan bir
   * sezonun kimliğini tekrar girince panel sessizce YENİ SEZON açıyordu; kullanıcı
   * ne olduğunu anlamıyordu ("sistem algılıyor sanmıştım"). Uyarı, kararın neden
   * öyle verildiğini satır satır söyler.
   */
  const [catalogNotice, setCatalogNotice] = useState<string | null>(null);
  /**
   * BELİRSİZ GİRİŞ SEÇİMİ — "bu giriş yeni sezon mu, aynı sezonun devamı mı?"
   *
   * ── NEDEN (kullanıcı isteği, 29.09.2026, ikinci tur) ────────────────────────
   * Başlıkta ne "Season N" ne "Part/Cour" ibaresi yoksa (ör. devam sezonu
   * yalnızca farklı bir ARK adı taşıyorsa) sınıflandırma KESİN değildir. Böyle
   * bir girişte panel sessizce karar verirse yanlış sezona yazma riski doğar.
   * Bu yüzden panelde KÜÇÜK bir seçim gösterilir; heuristiğin önerisi
   * ("yeni sezon") varsayılan seçili gelir ve kullanıcı tek tıkla
   * "bu sezonun devamı"na çevirebilir.
   *
   * `null` = belirsiz giriş YOK (seçim çizilmez).
   */
  const [ambiguousTarget, setAmbiguousTarget] = useState<{
    malId: number;
    /** "Devamı" seçilirse hedeflenecek sezon (bir önceki sezon). */
    partSeason: number;
    /** "Yeni sezon" seçilirse hedeflenecek sezon. */
    seasonNumber: number;
    /** O an uygulanmış seçim (seçicide işaretli olan). */
    choice: "part" | "season";
  } | null>(null);

  /**
   * Hedefi yazar ve isteği TÜKETİR. Hem otomatik çözümleme hem de BELİRSİZ
   * girişteki elle seçim bunu çağırır (tek çıkış noktası → durumlar tutarlı).
   */
  const applyCatalogTarget = useCallback(
    (
      number: number,
      opts: {
        part?: number | null;
        pending?: number | null;
        notice?: string | null;
        seasonMalId?: number | null;
      } = {},
    ) => {
      setPartSeasonMalId(opts.part ?? null);
      setPendingSeasonMalId(opts.pending ?? null);
      setTargetSeasonMalId(opts.seasonMalId ?? null);
      setCatalogNotice(opts.notice ?? null);
      if (catalogCloseTimer.current) clearTimeout(catalogCloseTimer.current);
      setCatalogClosing(false);
      setCatalogMin(false);
      setCatalogActivity(null);
      setCatalogSeason(number);
      onCatalogOpenHandled?.();
    },
    [onCatalogOpenHandled],
  );

  /**
   * BELİRSİZ GİRİŞ SEÇİMİ — iki dala da buradan geçilir.
   *   · "part"   → giriş, bir ÖNCEKİ sezonun devamı sayılır (yeni sezon AÇILMAZ)
   *   · "season" → giriş, YENİ bir sezon sayılır (sıradaki numara)
   */
  const chooseAmbiguous = useCallback(
    (choice: "part" | "season") => {
      const target = ambiguousTarget;
      if (!target) return;
      if (choice === "part") {
        applyCatalogTarget(target.partSeason, {
          part: target.malId,
          seasonMalId:
            (seasons ?? []).find((season) => season.number === target.partSeason)?.mal_id ?? null,
          notice:
            `MAL ${target.malId} → S${target.partSeason}'in DEVAMI (part), S${target.seasonNumber} DEĞİL — ` +
            `numaralar ${target.partSeason}. sezonun ardından sürer.`,
        });
      } else {
        applyCatalogTarget(target.seasonNumber, {
          pending: target.malId,
          notice: `MAL ${target.malId} → yeni sezon S${target.seasonNumber} (başlıkta sezon/part ibaresi yok).`,
        });
      }
      setAmbiguousTarget({ ...target, choice });
    },
    [ambiguousTarget, applyCatalogTarget, seasons],
  );

  useEffect(() => {
    if (!catalogOpenRequest) return;
    /**
     * VERİ HENÜZ YÜKLENMEDİYSE BEKLE.
     *
     * `seasons === null` iken liste boş görünür; buradan "sezon yok" kararı vermek
     * yanlış olurdu (sezonlar birazdan gelebilir) ve istek boşa tüketilirdi.
     * `seasons` bağımlılıkta olduğu için yükleme bitince etki yeniden çalışır.
     */
    if (seasons === null) return;
    // ── İSTEĞİN TÜRÜ NE? (sezon başına MAL kimliği — 29.09.2026) ───────────
    const pendingMalId = catalogOpenRequest.malId;
    const requestedTitle = catalogOpenRequest.title ?? "";
    const isNewSeason = catalogOpenRequest.newSeason && pendingMalId !== null;
    /**
     * ═══════════════════════════════════════════════════════════════════════════
     * ZİNCİRİN KÖKÜ — SERİNİN KENDİ KİMLİĞİ (`shows.mal_id`), GİRİLEN KİMLİK DEĞİL.
     * ═══════════════════════════════════════════════════════════════════════════
     *
     * ── KÖK NEDEN (ölçülen hata, 29.09.2026) ────────────────────────────────────
     * Burada eskiden `malId` (prop) kullanılıyordu. O prop bilerek "kutudaki
     * kaydedilmemiş değer" olabilir (`ShowEditor` → `unsavedMalId ?? show.mal_id`).
     * Kullanıcı "MAL'de ara" ile 45576'yı seçince kutu 45576 oluyor → `malId` = 45576
     * oluyor → `fetchNumberedSeasonChain(45576, 12, 45576)` çağrısı `rootMalId ===
     * stopMalId` olduğu için ANINDA tek halka dönüyordu: `{malId:45576, season:1,
     * part:null, kind:"season"}`. Yani 45576 part olarak DEĞİL, "1. sezonun kendisi"
     * olarak sınıflanıyordu → `resolveCatalogTarget` "serinin kendi kimliği — 1.
     * sezon hedeflendi." diyordu (modül testindeki `1:39535 > 1.p2:45576` ile
     * ÇELİŞEN davranış). Bu yüzden part bilgisi kayboluyordu.
     *
     * ÇÖZÜM: kök, serinin VERİTABANINDAKİ kimliğidir (`seriesMalId` = `shows.mal_id`).
     * Kaydı olmayan seride (`seriesMalId` null) girilen kimliğe düşülür — o durumda
     * girilen kimlik zaten kurulacak serinin köküdür.
     */
    const chainRoot = seriesMalId ?? malId ?? null;
    let cancelled = false;

    /** Hedefi yazar ve isteği TÜKETİR (her dalın tek çıkışı burasıdır). */
    const finish = (
      number: number,
      opts: {
        part?: number | null;
        pending?: number | null;
        notice?: string | null;
        seasonMalId?: number | null;
      } = {},
    ) => {
      if (cancelled) return;
      applyCatalogTarget(number, opts);
    };

    /**
     * ═══════════════════════════════════════════════════════════════════════════
     * HEDEF SEZONU KİMLİKTEN ÇÖZ — "SIRADAKİ SEZON" VARSAYIMI YAPMA (UNIVERSAL).
     *
     * ── NEDEN (ölçülen hata, 29.09.2026) ────────────────────────────────────────
     * Eski akış `newSeason` ipucunu doğrudan "sıradaki sezon"a çeviriyordu; girilen
     * MAL kimliğinin MEVCUT SEZONLARDAN birine ait olup olmadığını HİÇ kontrol
     * etmiyordu. Kullanıcı: "S1'i işleyip sonra S1'i tekrar ekleyince 2. sezon
     * olarak atıyor." Doğru karar için üç durum ayırt edilir:
     *
     *   (a) girilen kimlik MEVCUT bir sezonun KENDİ kimliği → o sezon hedeflenir,
     *       YENİ SEZON AÇILMAZ ve kullanıcıya "bu sezon zaten var (S1)" denir,
     *   (b) girilen kimlik MEVCUT bir sezonun DEVAMI (AniList PREQUEL zinciri) →
     *       yeni sezon açılmaz; part ise O sezonun part'ı olarak eklenir,
     *   (c) girilen kimlik GERÇEKTEN yeni bir sezon → sıradaki numara (eskisi gibi).
     *
     * Zincir tespiti AniList ilişkileriyle yapılır (`findPrequelMalId`) — YENİ DIŞ
     * SERVİS YOK, projede zaten kullanılan sorgu deseni kullanılır.
     * ═══════════════════════════════════════════════════════════════════════════
     */
    void (async () => {
      // Yeni istek geldi: önceki belirsiz girişin seçimi ekranda kalmasın.
      setAmbiguousTarget(null);
      if (pendingMalId !== null) {
        // (a) MEVCUT BİR SEZONUN KENDİ KİMLİĞİ Mİ?
        const owner = seasons.find((season) => season.mal_id === pendingMalId);
        if (owner) {
          finish(owner.number, {
            // Sezonun kendi kimliği biliniyor → part/special numaralandırma çıpası.
            seasonMalId: owner.mal_id ?? null,
            notice:
              `MAL ${pendingMalId} zaten S${owner.number} sezonunun kimliği — ` +
              `YENİ SEZON AÇILMADI, mevcut sezon hedeflendi.`,
          });
          return;
        }
        /**
         * ═══════════════════════════════════════════════════════════════════════
         * (a2) ZİNCİRDEN ÇÖZ — DB SATIRLARINDAN BAĞIMSIZ (UNIVERSAL).
         *
         * ── NEDEN (ölçülen hata, 29.09.2026, ikinci tur) ────────────────────────
         * Önceki tur uyarı/hedef mantığı YALNIZCA **veritabanında satırı olan**
         * sezonların `mal_id`siyle eşleşiyordu. Mushoku'da DB'de TEK satır var
         * (`{number:2, mal_id:51179}`) — **S1 satırı YOK**. Bu yüzden 45576
         * (S1'in Part 2'si) hiçbir sezonla eşleşmedi ve kod "son sezonun part'ı"
         * dalına düşüp hedefi **S2** yaptı (uyarı da ÇIKMADI): S1'in 2. part'ı
         * S2'ye yazılacaktı.
         *
         * DOĞRU KURAL: serinin KENDİ kimliğinden (`shows.mal_id` = 39535) başlayıp
         * AniList SEQUEL zinciri yürünür; girilen kimlik zincirde hangi halkaya
         * düşüyorsa "kaçıncı sezonun kaçıncı part'ı" Oradan okunur. Zincir DB
         * satırlarından BAĞIMSIZ olduğu için S1 satırı olmasa da hedef S1 çıkar.
         *
         *   · part ise  → hedef = O sezon (yeni sezon AÇILMAZ), katalog part'ın
         *                 kendi kimliğinden çekilir
         *   · "Season N"/Romen rakamı → hedef = zincirdeki N. sezon
         *   · belirsiz (ibare yok) → panelde KÜÇÜK SEÇİM (heuristik önerisiyle)
         *
         * Tüm animeler için geçerlidir; seriye/adına ÖZEL kod YOKTUR.
         * ═══════════════════════════════════════════════════════════════════════
         */
        /**
         * ── KARARI SAF FONKSİYON VERİR ─────────────────────────────────────────
         * Hedef/part/uyarı hesabı `resolveCatalogTarget`te (lib/admin-anizip.ts)
         * durur; burada yalnızca ZİNCİR (canlı AniList) + mevcut sezon listesi
         * toplanır. Böylece kural tek yerde ve gerçek veriyle sınanabilir kalır.
         */
        const chain =
          chainRoot != null ? await fetchNumberedSeasonChain(chainRoot, 12, pendingMalId) : null;
        if (cancelled) return;
        const resolved = resolveCatalogTarget({
          pendingMalId,
          // KÖK = serinin kendi kimliği (bkz. `chainRoot` notu) — girilen kimlik DEĞİL.
          rootMalId: chainRoot,
          seasons,
          chainEntries: chain?.entries ?? [],
          chainAmbiguous: chain?.ambiguous ?? false,
        });
        if (resolved) {
          if (resolved.ambiguous) {
            setAmbiguousTarget({ ...resolved.ambiguous, choice: "season" });
          }
          /**
           * HEDEF SEZONUN KENDİ KİMLİĞİ — zincirden okunur (part DEĞİL, sezonun
           * kendisi olan halka). `show_seasons` satırı olmasa bile doğru verilir;
           * part numaralandırma çıpası (`seasonOwnMalId`) buna dayanır.
           */
          const chainSeasonMalId =
            chain?.entries.find((entry) => entry.season === resolved.season && entry.part === null)
              ?.malId ?? null;
          finish(resolved.season, {
            part: resolved.part,
            pending: resolved.pending,
            notice: resolved.notice,
            seasonMalId: chainSeasonMalId,
          });
          return;
        }
        // (b) MEVCUT BİR SEZONUN DEVAMI MI? (AniList PREQUEL zinciri — YEDEK YOL)
        const prequel = await findPrequelMalId(pendingMalId);
        if (cancelled) return;
        const parent =
          prequel === null ? undefined : seasons.find((season) => season.mal_id === prequel);
        if (parent) {
          const isPart = isPartContinuation(requestedTitle);
          if (isPart) {
            finish(parent.number, {
              part: pendingMalId,
              seasonMalId: parent.mal_id ?? null,
              notice:
                `MAL ${pendingMalId} → S${parent.number}'in DEVAMI (part), S${parent.number + 1} DEĞİL — ` +
                `numaralar ${parent.number}. sezonun ardından sürer.`,
            });
          } else {
            const next = seasons.reduce((max, season) => Math.max(max, season.number), 0) + 1;
            finish(next, {
              pending: pendingMalId,
              notice: `MAL ${pendingMalId} → S${parent.number}'in devamı: yeni sezon S${next}.`,
            });
          }
          return;
        }
        /**
         * (b2) PART/Cour İŞARETİ VAR AMA ZİNCİR YOK (ör. sezonun kendi kimliği henüz
         * yazılmamış): başlıktaki "Part/Cour" işaretiyle SON SEZONUN devamı sayılır.
         * Numaralar kaldığı yerden sürer (Mushoku S1: 11 yazılı → Part 2 = 12–23).
         */
        if (catalogOpenRequest.part || isPartContinuation(requestedTitle)) {
          const last = seasons.reduce((max, season) => Math.max(max, season.number), 0);
          const lastRow = seasons.find((season) => season.number === last);
          finish(last > 0 ? last : 1, {
            part: pendingMalId,
            seasonMalId: lastRow?.mal_id ?? null,
          });
          return;
        }
        /**
         * (c) SERİNİN KENDİ KİMLİĞİ → 1. SEZON.
         *
         * ── ÖLÇÜLEN HATA (kullanıcı bildirimi, 29.09.2026) ──────────────────────
         * "S1'i işleyip sonra S1'i tekrar ekleyince 2. sezon olarak atıyor."
         * Seri kimliği (Mushoku 39535 = S1) `show.mal_id` ile birebir aynıysa
         * `newSeason` ipucu FALSE gelir ve eski kod "aynı kimlik" dalında
         * `Math.min(seasons)`e düşüyordu — S1 sezon kaydı YOKSA bu S2'yi hedefler
         * (kullanıcının gördüğü tam buydu). Doğrusu: serinin kendi kimliği HER
         * ZAMAN 1. sezonun kimliğidir.
         */
        if (chainRoot != null && pendingMalId === chainRoot) {
          finish(1, {
            pending: pendingMalId,
            seasonMalId: chainRoot,
            notice: `MAL ${pendingMalId} serinin kendi kimliği — 1. sezon hedeflendi.`,
          });
          return;
        }
        // (d) GERÇEKTEN YENİ SEZON → sıradaki numara (mevcut davranış korunur).
        if (isNewSeason) {
          const next = seasons.reduce((max, season) => Math.max(max, season.number), 0) + 1;
          finish(next, { pending: pendingMalId });
          return;
        }
      }

      // İlk (en küçük numaralı) sezon açılır; filmde zaten tek sezon vardır.
      const numbers = seasons.map((season) => season.number);
      /**
       * ⚠️ "SEZON YOKSA PANELİ AÇMA" KORUMASI GERİ ALINDI (29.09.2026).
       *
       * Geçen tur, "sezonu sildim ama panel silinen sezonun 25 bölümünü gösteriyor,
       * ne alaka?" şikâyeti üzerine şu korumayı eklemiştim: hiç sezon yoksa katalog
       * paneli açılmasın. BU YANLIŞTI ve ASIL AKIŞI TIKADI.
       *
       * Kullanıcının akışı (29.09.2026): "MAL kimliğini yazıp 'MAL'de ara' yapıyorum,
       * hiçbir şey çıkmıyor … kaynakları yükleyince otomatik ilk sezonu o kuracak."
       *
       * CANLI GÜNLÜK KANITI — arama ÇALIŞIYORDU, sonuç satırı geliyordu ve
       * kullanıcı tıklıyordu; ama koruma yüzünden panel HİÇ açılmıyordu:
       *   21:31:11  tıklandı: MAL'de ara
       *   21:31:31  tıklandı: 31240 · Re:ZERO -Starting Life in Another W
       *   21:31:35  tıklandı: Bölüm Yöneticisi   ← boş panel
       *
       * DOĞRU DAVRANIŞ: sezon kaydı OLMAYAN bir seride de panel açılır; çünkü sezon
       * kaydını artık YAZMA işi kendisi açar (`AnizipSyncPanel.ensureSeasonRow`).
       * Yani boş sezona katalog çekmek "hayalet sezon" değil, akışın TA KENDİSİDİR.
       *
       * HİÇ SEZON YOKSA `1` AÇILIR: `Math.min(...[])` `Infinity` dönerdi. 1 sayısı
       * ayrıca yazımın açacağı sezonun TA KENDİSİDİR (ilk kayıt her zaman 1. sezon).
       */
      // İSTEĞİ TÜKET — `finish` içinde. Aksi hâlde panel her kapanıp açıldığında
      // popup yeniden fırlar (eski sayaç modelinin ölçülen kusuru).
      finish(numbers.length > 0 ? Math.min(...numbers) : 1);
    })();

    return () => {
      cancelled = true;
    };
    // `seriesMalId` (SERİNİN kök kimliği) artık zincirin KÖKÜ: part tespiti buna
    // dayanır. `malId` de bağımlılıkta (kaydı olmayan seride kök yedeği).
    // `applyCatalogTarget` de bağımlılık: hedefi yazan tek çıkış noktası odur
    // (lint kuralı).
  }, [catalogOpenRequest, onCatalogOpenHandled, seasons, malId, seriesMalId, applyCatalogTarget]);
  /**
   * Katalog bu sezon için bulunamadığında (upstream 404 / ağ hatası) ELLE bölüm
   * ekleme formunu ÖNE ÇIKARMAK için işaretlenen sezon.
   *
   * NEDEN: kullanıcı şikâyeti "yeni sezon/bölüm ekleyemiyorum" — katalog 404
   * verince form gömülü kalıyordu. `AnizipSyncPanel.onManualAdd` bunu tetikler;
   * form açılır, kaydırılır ve odaklanır.
   */
  const [manualFocusSeason, setManualFocusSeason] = useState<number | null>(null);

  const reload = useCallback(async () => {
    const [seasonRes, episodeRes] = await Promise.all([
      db
        .from("show_seasons")
        .select("*")
        .eq("show_id", showId)
        .order("sort_order", { ascending: true }),
      db
        .from("show_episodes")
        .select("*")
        .eq("show_id", showId)
        .order("number", { ascending: true }),
    ]);
    setSeasons((seasonRes.data ?? []) as Season[]);
    setEpisodes((episodeRes.data ?? []) as Episode[]);
  }, [showId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Animecix kimliğini bir kez okur (kaynak çözümü ve kaynak ipucu için).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data, error } = await db
        .from("shows")
        .select("animecix_id")
        .eq("id", showId)
        .single();
      if (!alive) return;
      const raw = Number((data as { animecix_id?: number | null } | null)?.animecix_id ?? 0);
      setAnimecixId(!error && Number.isFinite(raw) && raw > 0 ? raw : null);
    })();
    return () => {
      alive = false;
    };
  }, [showId]);

  /**
   * VERİ BEKLENİRKEN EKRANA HİÇBİR ŞEY ÇİZİLMEZ — "Bölümler yükleniyor…" gitti.
   *
   * ── KULLANICI BİLDİRİMİ (28.09.2026, ekran kaydı) ───────────────────────────
   * "Bölümler yükleniyor diyor kanka, bak o sorun; videoda görebiliyor musun?
   *  Çok hızlı geçiyor, aşağıdaki açıklamanın sol tarafında."
   *
   * ── ÖLÇÜM ───────────────────────────────────────────────────────────────────
   * Kayıttan tek karelik (≈33 ms) bir parlaklık sıçraması ölçüldü ve panelin
   * göründüğü an t≈1,5 s olarak bulundu. Sebep: bu satır her panel açılışında
   * çiziliyor, `seasons`/`episodes` sorgusu ~100-300 ms'de dönünce KAYBOLUYORDU —
   * yani yalnızca bir kırpma olarak görünüyordu. `mt-3` yüzünden ayrıca
   * açıklamanın altında bir an boşluk açıp sayfayı oynatıyordu.
   *
   * ── NEDEN KALDIRILDI, NEDEN GÜVENLİ ─────────────────────────────────────────
   * Panelin satır içi gövdesi artık KASITLI OLARAK BOŞ: bölüm yönetiminin tamamı
   * katalog popup'ında ve orada kendi yükleme durumu var ("MAL kimliği
   * çözülüyor…" + çözümleme satırları). Boş bir gövde için ikinci bir "yükleniyor"
   * yazısı hem gereksiz hem yanıltıcıydı.
   *
   * `null` dönmek akışı bozmaz: katalog isteğini karşılayan etki zaten bu erken
   * `return`ten ÖNCE çalışır (aşağıdaki uyarıya bakınız) ve popup, veriler
   * geldiğinde `createPortal` ile çizilir.
   */
  if (seasons === null || episodes === null) {
    return null;
  }

  const rows = buildSeasonRows(seasons, episodes, showId);

  /**
   * KATALOG PANELİNE VERİLECEK MAL KİMLİĞİ — öncelik sırası:
   *   1. `pendingSeasonMalId` — yeni girilen, henüz kaydı olmayan sezonun kimliği,
   *   2. hedef sezonun KENDİ kimliği (`show_seasons.mal_id`) — varsa zincir tahmini
   *      tamamen devre dışı kalır, yanlış sezon gelme riski olmaz,
   *   3. serinin kimliği (`shows.mal_id`) — bugüne kadarki davranış.
   */
  const catalogMalId =
    partSeasonMalId ??
    pendingSeasonMalId ??
    (seasons ?? []).find((season) => season.number === catalogSeason)?.mal_id ??
    malId;
  const toggle = (number: number) => {
    setOpenSeason((current) => (current === number ? null : number));
    setPage(1);
  };

  /*
   * ═══════════════════════════════════════════════════════════════════════════════
   * BURADAN ÜÇ İŞLEV KALDIRILDI: `createFirstRow` · `addSeason` · `addSinglePart`.
   *
   * Kullanıcı isteği (29.09.2026): "lan 'sezon oluştur' diye bir şey yapmam — sil o
   * şeyi tamamen yok et. Bölüm yöneticisine girmek için MAL kimliğiyle yapacağız,
   * unuttun mu? Biz onu yok etmiştik; MAL id girip artık o panelden yapacağız ya
   * her şeyi."
   *
   * ÜÇÜ DE AYNI İŞİN PARÇASIYDI (sezon/bölüm kaydını ELLE açmak) ve düğmeleri
   * kaldırıldığı için artık çağrılmıyorlardı.
   *
   * YERİNE GEÇEN: yazma yolu. `AnizipSyncPanel.writeSelected` çalışmadan önce
   * `ensureSeasonRow()` ile `show_seasons` satırını KENDİSİ açar. Yani kullanıcı
   * MAL kimliğini yazıp katalog panelinden "N bölüme yaz" dediğinde sezon kaydı da
   * bölümlerle birlikte doğar — elle sezon açma adımı hiç kalmaz.
   * ═══════════════════════════════════════════════════════════════════════════════
   */

  /** Bölümü olan ama sezon kaydı olmayan (migration öncesi) sezonu kalıcı hâle getirir. */
  async function materializeSeason(season: SeasonRow) {
    const { error } = await db
      .from("show_seasons")
      .insert({ show_id: showId, number: season.number, title: "", sort_order: season.number });
    if (error) {
      toast.error("Sezon oluşturulamadı: " + error.message);
      return;
    }
    onNotice(`${season.number}. sezon kaydı oluşturuldu.`);
    await reload();
  }

  /**
   * KATALOG PANELİNDEN "SEZONU TAMAMEN SİL" — kullanıcı isteği (28.09.2026):
   * "direkt sezonu silemiyorum kanka ya."
   *
   * Panelin sezon seçicisinin gösterdiği sezonu `show_id` + `number` üzerinden
   * siler; onayı siteye özel pencereden alır, sonra popup'ı kapatıp listeyi
   * yeniler.
   *
   * TEMİZLİK (29.09.2026): bu işi devraldığı `removeSeason()` işlevi ve onu
   * çağıran ama HİÇ ÇİZİLMEYEN `SeasonCard` bileşeni tamamen SİLİNDİ (~474 satır
   * ölü kod). Burası artık tek silme yolu.
   */
  async function deleteCatalogSeason(target?: number) {
    // Numarayla da çağrılabilir (paneldeki sezon seçicisinin çöp kutusu) —
    // kullanıcı isteği, 29.09.2026: "sezonlardan birine ... silebileyim".
    const number = target ?? catalogSeason;
    if (number === null || busy) return;
    const count = (episodes ?? []).filter((episode) => episode.season === number).length;
    // SİTEYE ÖZEL ONAY PENCERESİ (native tarayıcı kutusu DEĞİL) —
    // kullanıcı isteği, 29.09.2026: "asla üstten tarayıcı mesajı çıkmasın."
    const ok = await confirmAction({
      title: `${number}. sezon silinsin mi?`,
      description:
        (count > 0 ? `İçindeki ${count} bölüm de silinir. ` : "") +
        "Sezon kaydı ve bölümleri kalıcı olarak silinir; bu işlem geri alınamaz.",
      confirmLabel: "Sezonu sil",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    try {
      // SIRA: önce KAYNAKLAR, sonra bölümler, en son sezon kaydı (bkz.
      // `routes/admin.tsx` — seri silerken de aynı sıra kullanılıyor).
      //
      // KAYNAKLAR AÇIKÇA TEMİZLENİR (kullanıcı isteği, 29.09.2026: "tamamen
      // kalıntısız şekilde"): `episode_sources` satırları bölüm KİMLİĞİNE bağlıdır;
      // bölümler silindiğinde yetim kalma ihtimaline karşı burada kimlikler
      // üzerinden silinir. (Cascade olsa bile zararsız, tekrar silme yok.)
      if (count > 0) {
        const seasonEpisodeIds = (episodes ?? [])
          .filter((episode) => episode.season === number)
          .map((episode) => episode.id);
        if (seasonEpisodeIds.length > 0) {
          const { error: sourceError } = await db
            .from("episode_sources")
            .delete()
            .in("episode_id", seasonEpisodeIds);
          if (sourceError) throw new Error(sourceError.message);
        }
        const { error } = await db
          .from("show_episodes")
          .delete()
          .eq("show_id", showId)
          .eq("season", number);
        if (error) throw new Error(error.message);
      }
      const { error } = await db
        .from("show_seasons")
        .delete()
        .eq("show_id", showId)
        .eq("number", number);
      if (error) throw new Error(error.message);
      devMark("sezon silindi", { sezon: number, bolum: count });
      onNotice(`${number}. sezon silindi.`);
      // Panel o sezonu gösteriyorsa hedefi bırak; başka bir sezon silindiyse
      // görünüm olduğu yerde kalsın (kullanıcı silmek istediği sezonu seçmişti).
      if (catalogSeason === number) requestCatalogClose();
      await reload();
    } catch (error) {
      toast.error("Sezon silinemedi: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  }

  async function moveSeason(index: number, dir: -1 | 1) {
    // Kalıcı olmayan sezon varken sıralama yazılırsa veritabanı ile liste
    // birbirinden kopar; bu yüzden taşımadan önce engelliyoruz.
    if (rows.some((season) => season.virtual)) {
      toast.error(
        'Sezon kaydı olmayan bir sezon var. Önce "Sezon kaydını oluştur" ile onu kalıcı hâle getir, sonra sırala.',
      );
      return;
    }
    const moved = await moveAndPersist("show_seasons", rows, index, dir);
    if (!moved) return;
    onNotice("Sezon sırası güncellendi.");
    await reload();
  }

  return (
    /* ═══════════════════════════════════════════════════════════════════════════
       SARMALAYICI ARTIK PARÇA (fragment) — ESKİDEN BOŞ BİR KUTU KALIYORDU.

       Kullanıcı bildirimi (28.09.2026): "hâlâ eksik kalıntılar var, bug oluyor;
       hem aşağı inip yukarı kalkıyor hem de aşağıya çöp bırakıyor."

       ÖLÇÜLEN SEBEP: burada her zaman bir `<div className="space-y-4">` çiziliyordu.
       Sezon listesi kaldırıldıktan sonra bu kutunun içi ÇOĞU ZAMAN BOŞ kalıyor —
       ve `ShowEditor` içindeki sarmalayıcı (`mt-4 border-t pt-4`) yüzünden sayfada
       AYIRICI ÇİZGİ + BOŞLUK olarak görünüyordu. Panel açılıp kapanırken de
       sayfa aşağı/yukarı oynuyordu.

       ÇÖZÜM: kök eleman fragment. Görünür içerik yoksa DOM'a HİÇBİR ŞEY eklenmez
       (katalog paneli zaten `createPortal` ile `document.body`ye çizilir, akışta
       yer kaplamaz). Her görünür bloğa kendi `mt-4`'ü verilir — böylece
       `space-y-4`'ün işini görürüz ama boş hâlde hiç yer kaplamayız.
       ═══════════════════════════════════════════════════════════════════════════ */
    <>
      {/*
        ═══════════════════════════════════════════════════════════════════════
        "SEZONLAR VE BÖLÜMLER" BÖLÜMÜ KALDIRILDI
        (kullanıcı isteği, 28.09.2026: "burası hâlâ duruyor, sil kaldırsana şurayı
        tamamen; kalıntısız şekilde, çöp bırakmasın.")

        Sezon listesi ve sezon kartları görünümden çıktı; bölüm yönetimi artık
        TAMAMEN katalog panelinden yapılıyor. Katalog popup'ı bu yüzden sezon
        kartının İÇİNDEN buraya (panel seviyesine) taşındı — kart olmadan da
        açılabilsin diye.

        Bu bölümün yerini alan şeyler: "Kaydı oluştur" satırı (kayıt yoksa) ve
        katalog/bölüm paneli. "Bölümleri elle ekle" formu da duruyor.

        ("Gelişmiş" satırı ayrıca kaldırıldı; gerekçe aşağıdaki nota bakınız.)
        ═══════════════════════════════════════════════════════════════════════
      */}

      {/*
        ═══════════════════════════════════════════════════════════════════════════
        "1. SEZONU OLUŞTUR" / "FİLM KAYDINI OLUŞTUR" DÜĞMESİ TAMAMEN KALDIRILDI.
        (kullanıcı, 29.09.2026: "lan 'sezon oluştur' diye bir şey yapmam — sil o şeyi
         tamamen yok et. Bölüm yöneticisine girmek için MAL kimliğiyle yapacağız,
         unuttun mu? Biz onu yok etmiştik; MAL id girip artık o panelden yapacağız
         ya her şeyi.")

        YENİ AKIŞ (tek yol):  MAL kimliğini yaz → "MAL'de ara" → sonuç satırına tıkla
        → "Bölüm Yöneticisi" → katalog panelinde kaynakları seç → "N bölüme yaz".
        Sezon kaydı ARTIK YAZIMIN KENDİSİ tarafından açılır (bkz. `AnizipSyncPanel`
        → `ensureSeasonRow`); kullanıcının sezon açmasına gerek yok.

        CANLI GÜNLÜK KANITI: bu düğmeye kullanıcı 4 kez basmıştı (21:20:59 · 21:26:36
        · 21:26:48 · 21:26:52) ve sonra "bunu yok etmiştik" dedi.
        ═══════════════════════════════════════════════════════════════════════════
      */}

      {/* KAYIT YOKSA: yalnızca YOL GÖSTERİLİR — düğme yok, yazma yok. */}
      {rows.length === 0 && (
        <p className="mt-4 rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          Henüz kayıt yok. Yukarıdan <b className="text-foreground">MAL kimliğini</b> yazıp{" "}
          <b className="text-foreground">MAL'de ara</b>&apos;ya bas, çıkan satıra tıkla —{" "}
          {singlePart ? "film" : "sezon ve bölümler"} katalog panelinden yazılır.
        </p>
      )}

      {/* KATALOG PANELİ — panel seviyesinde popup. */}
      {catalogSeason !== null &&
        createPortal(
          <>
            <div
              className={`${
                catalogClosing ? "animate-modal-fade-out" : "animate-modal-fade"
              } fixed inset-0 z-[70] overflow-y-auto overscroll-contain bg-black/70 p-3 [scrollbar-gutter:stable] sm:p-6${catalogMin ? " hidden" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label="Katalog paneli"
              onClick={() => requestCatalogClose()}
              onKeyDown={(event) => {
                if (event.key === "Escape") requestCatalogClose();
              }}
            >
              <div
                className={`${
                  catalogClosing ? "animate-modal-panel-out" : "animate-modal-panel"
                } mx-auto w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-background shadow-2xl`}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
                  <h3 className="font-display text-base text-foreground">Katalogdan bölüm çek</h3>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (!catalogClosing) setCatalogMin(true);
                      }}
                      title="Küçült — yazma sürerken hapta ilerleme görünür"
                      aria-label="Küçült"
                      className="grid size-7 place-items-center rounded-full border border-border text-muted-foreground transition-all hover:scale-105 hover:text-foreground active:scale-95"
                    >
                      <Minus size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => requestCatalogClose()}
                      title="Kapat"
                      aria-label="Kapat"
                      className="grid size-7 place-items-center rounded-full border border-border text-muted-foreground transition-all hover:scale-105 hover:text-foreground active:scale-95"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
                {/*
                `min-h` = POPUP AÇILIŞTA SON ÖLÇÜSÜNDE DURSUN (kullanıcı bildirimi,
                29.09.2026: "popup'la açılıyor sonra aşağı doğru katlanıyor").

                Katalog listesi ~350 ms sonra geldiği için gövde bir an kısa kalıyor,
                sonra uzuyordu. 22rem = yükleme iskeletinin ölçüsü (12 + 20 + 8 +
                18rem + 12 dolgu = 352 px) — yani liste gelince gövde BÜYÜMEZ; kısa
                listelerde (film/tek bölüm) de KÜÇÜLMEZ. Popup hep aynı ölçüde durur.
              */}
                {/* Yükseklik daraltıldı (kullanıcı bildirimi): liste + yazma satırı
                  birlikte görünsün, modal gövdesi ekranda derli toplu dursun. */}
                <div className="max-h-[62vh] min-h-[20rem] overflow-y-auto overscroll-contain p-3">
                  <AnizipSyncPanel
                    showId={showId}
                    /*
                    ⚠️ BURADA `malId` GEÇİRİLMİYORDU — ÖLÇÜLEN HATA (28.09.2026).

                    Seri formu (ShowEditor) "kaydedilmemiş kimlik de geçerli" diye
                    `malId` prop'unu gönderiyordu, `SeasonsPanel` da onu alıyordu;
                    ama bu satırda panele AKTARILMIYORDU. Panel de kimliği yalnızca
                    veritabanından (`readShowMeta`) okuduğu için YENİ eklenen seride
                    `show.mal_id` boş olduğundan şu hatayı veriyordu:

                      "Bu serinin MAL kimliği yok — seri ayarlarından MAL kimliğini
                       doldur."

                    Kullanıcı akışı (canlı günlük, 28.09.2026):
                      20:21:09 "Oluştur"            → Death Note kaydı açıldı
                      20:22:54 yazdı [ör. 48561]: 1535
                      20:22:57 "MAL'de ara"
                      20:22:59 1535 · Death Note · TV · 2006 satırına TIKLADI
                      → kutu doldu, panel açıldı, ama katalog HİÇ denenmedi ve
                        elle ekleme formu öne çıktı.
                     Şikâyet: "ben her animeyi elle ekleyeceksem ne anlamı var".
                  */
                    malId={catalogMalId}
                    notice={catalogNotice}
                    /*
                    BELİRSİZ GİRİŞ SEÇİMİ — yalnızca başlıkta "Season N" /
                    "Part-Cour" ibaresi OLMAYAN bir girişte dolar; panel
                    "Hedef: S{n}" etiketinin hemen yanında küçük bir seçim çizer.
                  */
                    ambiguousChoice={
                      ambiguousTarget
                        ? { value: ambiguousTarget.choice, onChange: chooseAmbiguous }
                        : null
                    }
                    partContinuation={partSeasonMalId !== null}
                    /**
                     * PART numaralandırma çıpası — ÖNCE ZİNCİRDEN çözülen sezon
                     * kimliği, sonra DB satırı. Sıra önemli: Mushoku'da **S1 satırı
                     * YOK**, o yüzden DB'ye bakmak çıpayı boş bırakırdı; zincir
                     * (39535) doğru uzunluğu (11) verir.
                     */
                    seasonOwnMalId={
                      targetSeasonMalId ??
                      (seasons ?? []).find((season) => season.number === catalogSeason)?.mal_id ??
                      null
                    }
                    // "Sezonu tamamen sil" düğmesi — panelin "Gelişmiş" bölümünde.
                    // GÖRÜNÜR SİLME: hem Gelişmiş içindeki düğme hem panelin sezon seçicisinin
                    // yanındaki çöp kutusu aynı akışı kullanır (onay penceresi + kalıntısız temizlik).
                    onDeleteSeason={() => void deleteCatalogSeason()}
                    onDeleteSeasonNumber={(number) => void deleteCatalogSeason(number)}
                    puffySlug={puffySlugFor(slug)}
                    seasonNumber={catalogSeason}
                    singlePart={singlePart}
                    seasons={(seasons ?? []).map((item) => ({ number: item.number }))}
                    onSelectSeason={(number) => {
                      if (catalogCloseTimer.current) clearTimeout(catalogCloseTimer.current);
                      setCatalogClosing(false);
                      setCatalogMin(false);
                      setCatalogActivity(null);
                      setCatalogSeason(number);
                    }}
                    onActivity={(activity) =>
                      setCatalogActivity((previous) =>
                        previous &&
                        previous.busy === activity.busy &&
                        previous.done === activity.done &&
                        previous.total === activity.total &&
                        previous.fail === activity.fail
                          ? previous
                          : activity,
                      )
                    }
                    existing={(episodes ?? [])
                      .filter((episode) => episode.season === catalogSeason)
                      .map((episode) => ({
                        id: episode.id,
                        season: episode.season,
                        number: episode.number,
                        title: episode.title,
                      }))}
                    onDone={async (message) => {
                      onNotice(message);
                      await reload();
                    }}
                    onManualAdd={() => setManualFocusSeason(catalogSeason)}
                  />
                </div>
              </div>
            </div>
          </>,
          document.body,
        )}
      {/*
        KÜÇÜLTÜLMÜŞ HAP — sağ altta, yazma sürerken canlı ilerleme.

        Modal `hidden` ile gizlenir ama BİLEŞEN DURUR (yazma/sayım devam eder,
        durum kaybolmaz). Hapa tıklayınca panel geri açılır. Boştayken "hazır"
        yazar; yazarken "5/12" sayacı + hata sayısı görünür.
      */}
      {catalogSeason !== null && catalogMin
        ? createPortal(
            <button
              type="button"
              onClick={() => setCatalogMin(false)}
              title="Katalog paneline dön"
              className="fixed bottom-4 right-4 z-[75] flex animate-rise-in items-center gap-2 rounded-full border border-border bg-background/95 py-2 pl-3 pr-2 text-xs font-bold text-foreground shadow-2xl backdrop-blur transition-transform hover:scale-[1.04] active:scale-95"
            >
              {catalogActivity?.busy ? (
                <Loader2 size={13} className="animate-spin text-emerald-400" />
              ) : (
                <CloudDownload size={13} className="text-emerald-400" />
              )}
              <span>Katalog · S{catalogSeason}</span>
              {catalogActivity && catalogActivity.total > 0 ? (
                <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 tabular-nums">
                  {catalogActivity.done}/{catalogActivity.total}
                  {catalogActivity.fail > 0 ? ` · ${catalogActivity.fail} hata` : ""}
                </span>
              ) : (
                <span className="font-normal text-muted-foreground">hazır</span>
              )}
              <ChevronUp size={13} className="text-muted-foreground" />
            </button>,
            document.body,
          )
        : null}

      {/* "BÖLÜMLERİ ELLE EKLE" — katalogda bulunmayan bölümler için.
          Kapatma düğmesi EKLENDİ: form artık koşullu çiziliyor, bu yüzden odak
          temizleme ile kendiliğinden kapanmıyor. */}
      {manualFocusSeason !== null && (
        <div className="mt-4 rounded-2xl border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">
              {manualFocusSeason}. sezona elle bölüm ekle
            </h3>
            <button
              type="button"
              onClick={() => setManualFocusSeason(null)}
              title="Kapat"
              aria-label="Kapat"
              className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-muted-foreground transition-all hover:scale-105 hover:text-foreground active:scale-95"
            >
              <X size={13} />
            </button>
          </div>
          <AddEpisodeForm
            showId={showId}
            seasonNumber={manualFocusSeason}
            nextNumber={
              episodes
                .filter((episode) => episode.season === manualFocusSeason)
                .reduce((max, episode) => Math.max(max, episode.number), 0) + 1
            }
            disabled={busy || !schemaReady}
            autoFocus
            onAdded={async (message) => {
              await reload();
              onNotice(message);
            }}
          />
        </div>
      )}

      {/* "GELİŞMİŞ" BÖLÜMÜ VE BAĞLI ARAÇLARI TAMAMEN KALDIRILDI.
          Kullanıcı isteği (28.09.2026): "gelişmiş niye açılıyor ardından? silsene
          gelişmişi tamamen yok et."

          Kaldırılanlar: "Kapakları güncelle" (elle kapak tazeleme) ve "Voe'dan çek"
          (Voe içe aktarma) düğmeleri + `VoeSyncPanel` bağlantısı.

          KAYIP DEĞERLENDİRMESİ (dürüst kayıt):
          · Kapak senkronu KAYBOLMADI — bölüm kaydedildiğinde arka planda yine
            kendiliğinden çalışır (bkz. `lib/episode-covers.ts`); giden yalnızca
            ELLE tetiklenen düğmedir.
          · Voe dönemi tamamen kapandı: `VoeSyncPanel` bileşeni ve `lib/voe.ts`
            projeden silindi; kapak/oynatıcı zincirindeki Voe dalları da
            temizlendi. Veritabanında Voe linkli bölüm kalmadı (doğrulandı). */}

      {rows.length === 0 && (
        <p className="mt-4 rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          {/* METİN GÜNCELLENDİ (29.09.2026): eskiden "Film kaydını oluştur" ve
              "Yeni sezon ekle" düğmelerini işaret ediyordu — İKİSİ DE ARTIK YOK.
              Tek yol: MAL kimliği → MAL'de ara → sonuç satırı → katalog paneli. */}
          {singlePart
            ? 'Film kaydı yok. Yukarıdan MAL kimliğini yazıp "MAL\'de ara"ya bas, çıkan satıra tıkla — film katalog panelinden yazılır.'
            : 'Henüz sezon yok. Yukarıdan MAL kimliğini yazıp "MAL\'de ara"ya bas, çıkan satıra tıkla — sezon ve bölümler katalog panelinden yazılır.'}
        </p>
      )}
    </>
  );
}

function BulkAddForm({
  showId,
  seasonNumber,
  startNumber,
  takenNumbers,
  disabled,
  onAdded,
}: {
  showId: string;
  seasonNumber: number;
  startNumber: number;
  takenNumbers: number[];
  disabled: boolean;
  onAdded: (message: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [start, setStart] = useState(String(startNumber));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStart(String(startNumber));
  }, [startNumber]);

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  async function submit() {
    if (lines.length === 0) {
      toast.error("En az bir video linki yapıştır.");
      return;
    }
    const parsed = lines.map(parseBulkLine);
    const invalid = parsed.filter((entry) => !entry.url || watchUrlError(entry.url));
    if (invalid.length > 0) {
      toast.error(
        `${invalid.length} satır geçersiz (bozuk veya eksik link).\n\n` +
          "Her link https:// ile başlamalı ve bir alan adı içermeli. Geçerli örnek:\n" +
          "https://filemoon.org/xxxxxx/embed\n" +
          "42 - https://vidmoly.org/embed-abc.html | 42. Bölüm",
      );
      return;
    }

    const taken = new Set(takenNumbers);
    let cursor = parseInt(start, 10);
    if (!Number.isFinite(cursor) || cursor < 1) cursor = startNumber;
    const rows: {
      show_id: string;
      season: number;
      number: number;
      title: string;
      watch_url: string;
    }[] = [];
    let skipped = 0;
    for (const entry of parsed) {
      if (entry.number !== null) {
        // Numarası elle verilmiş satır: doluysa atlanır.
        if (taken.has(entry.number)) {
          skipped += 1;
          continue;
        }
        rows.push({
          show_id: showId,
          season: seasonNumber,
          number: entry.number,
          title: entry.title,
          watch_url: entry.url,
        });
        taken.add(entry.number);
        continue;
      }
      while (taken.has(cursor)) cursor += 1;
      rows.push({
        show_id: showId,
        season: seasonNumber,
        number: cursor,
        title: entry.title,
        watch_url: entry.url,
      });
      taken.add(cursor);
      cursor += 1;
    }

    if (rows.length === 0) {
      toast.error("Eklenecek yeni bölüm yok: bu numaraların hepsi dolu.");
      return;
    }

    setBusy(true);
    try {
      for (let i = 0; i < rows.length; i += BULK_CHUNK) {
        const { error } = await db.from("show_episodes").insert(rows.slice(i, i + BULK_CHUNK));
        if (error) throw error;
      }
      setText("");
      await onAdded(
        `${rows.length} bölüm eklendi${skipped > 0 ? ` (${skipped} satır zaten vardı, atlandı)` : ""}.`,
      );
    } catch (error) {
      toast.error(
        "Toplu ekleme yarıda kaldı: " +
          (error instanceof Error ? error.message : String(error)) +
          "\n\nO ana kadar eklenenler veritabanında kaldı; listeyi kontrol edip tekrar deneyebilirsin.",
      );
      await onAdded("Toplu ekleme yarıda kaldı.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="mt-2 rounded-full"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        <ListPlus size={14} /> Toplu bölüm ekle (link listesi)
      </Button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-dashed border-border p-3">
      <p className="text-sm font-bold text-foreground">Toplu bölüm ekleme</p>
      <p className="text-[11px] leading-5 text-muted-foreground">
        Her satıra bir video linki yaz. Numaralar sırayla atanır. İstersen satırın başına numara (
        <code>42 - link</code>) ya da sonuna <code>| Başlık</code> ekleyebilirsin.
      </p>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">İlk bölüm no</span>
        <input
          className={`${inputCls} w-20`}
          inputMode="numeric"
          value={start}
          onChange={(event) => setStart(event.target.value.replace(/[^0-9]/g, ""))}
          aria-label="İlk bölüm numarası"
        />
      </div>
      <textarea
        className="min-h-40 w-full rounded-xl border border-border bg-card p-3 font-mono text-xs leading-6 text-foreground outline-none focus:border-primary"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={
          "https://vidmoly.to/embed-abc.html\nhttps://earnvids.com/e/xyz\n42 - https://dood.to/e/abc | 42. Bölüm"
        }
        aria-label="Video linkleri"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="rounded-full"
          onClick={() => void submit()}
          disabled={busy || disabled}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ListPlus size={14} />}{" "}
          {lines.length > 0 ? `${lines.length} satırı ekle` : "Ekle"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full"
          onClick={() => {
            setText("");
            setOpen(false);
          }}
          disabled={busy}
        >
          Kapat
        </Button>
      </div>
    </div>
  );
}

/** Uzun bölüm listeleri için sayfa gezinme çubuğu + "bölüm no ile git" kutusu. */
function EpisodePager({
  episodes,
  page,
  onPageChange,
}: {
  episodes: Episode[];
  page: number;
  onPageChange: (page: number) => void;
}) {
  const [jump, setJump] = useState("");
  const pageCount = Math.max(1, Math.ceil(episodes.length / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(episodes.length, page * PAGE_SIZE);

  function jumpToEpisode() {
    const target = parseInt(jump, 10);
    if (!Number.isFinite(target)) return;
    const index = episodes.findIndex((episode) => episode.number === target);
    if (index < 0) {
      toast.error(`${target}. bölüm bu sezonda yok.`);
      return;
    }
    onPageChange(Math.floor(index / PAGE_SIZE) + 1);
    setJump("");
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-secondary/60 px-3 py-2">
      <Button
        size="sm"
        variant="outline"
        className="rounded-full"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
      >
        <ChevronLeft size={14} /> Önceki
      </Button>
      <span className="text-xs font-bold text-muted-foreground">
        {start}–{end} / {episodes.length} bölüm · sayfa {page}/{pageCount}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="rounded-full"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pageCount}
      >
        Sonraki <ChevronRight size={14} />
      </Button>
      <span className="ml-auto flex items-center gap-2">
        <input
          className="h-8 w-20 rounded-lg border border-border bg-card px-2 text-xs text-foreground outline-none focus:border-primary"
          inputMode="numeric"
          value={jump}
          onChange={(event) => setJump(event.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(event) => {
            if (event.key === "Enter") jumpToEpisode();
          }}
          placeholder="Bölüm no"
          aria-label="Bölüm numarasına git"
        />
        <Button size="sm" variant="ghost" className="rounded-full" onClick={jumpToEpisode}>
          Git
        </Button>
      </span>
    </div>
  );
}

function AddEpisodeForm({
  showId,
  seasonNumber,
  nextNumber,
  disabled,
  autoFocus,
  onAutoFocused,
  onAdded,
}: {
  showId: string;
  seasonNumber: number;
  nextNumber: number;
  disabled: boolean;
  /**
   * Katalog bu sezonu bulamadığında `true` olur: form kaydırılır ve ad alanı
   * odaklanır (kullanıcı şikâyeti: "yeni sezon/bölüm ekleyemiyorum").
   */
  autoFocus?: boolean;
  /** Odak uygulandıktan sonra üst paneldeki işareti temizler (tekrar tetiklenmesin). */
  onAutoFocused?: () => void;
  onAdded: (message: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [watchUrl, setWatchUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  // Katalogdan bölüm gelmediğinde form görünür alana getirilir ve odaklanır.
  // `onAutoFocused` ile üst işaret temizlenir; işaret bir sonraki başarısızlıkta
  // yeniden konur (tek setState ile döngü oluşmaz).
  useEffect(() => {
    if (!autoFocus) return;
    rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    titleRef.current?.focus();
    onAutoFocused?.();
  }, [autoFocus, onAutoFocused]);

  async function add() {
    // Numara her zaman otomatik gelir; elle girilmez.
    const num = nextNumber;
    const error = watchUrlError(watchUrl);
    if (error) {
      toast.error(error);
      return;
    }
    setBusy(true);
    const { error: insertError } = await db.from("show_episodes").insert({
      show_id: showId,
      season: seasonNumber,
      number: num,
      title: title.trim(),
      watch_url: extractEmbedUrl(watchUrl),
    });
    setBusy(false);
    if (insertError) {
      toast.error(
        insertError.message.includes("duplicate") || insertError.message.includes("unique")
          ? `${seasonNumber}. sezonun ${num}. bölümü zaten var.`
          : "Bölüm eklenemedi: " + insertError.message,
      );
      return;
    }
    setTitle("");
    setWatchUrl("");
    await onAdded(`${seasonNumber}. sezonun ${num}. bölümü eklendi.`);
  }

  return (
    // Ekleme formu da TEK SATIR: eskiden üç blok alt alta duruyordu (ölçüm: 180px).
    <div
      ref={rootRef}
      className={`mt-2 rounded-xl border border-dashed p-2 ${
        autoFocus ? "border-primary bg-primary/5" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Numara satırlardaki rozetle aynı yerde (solda) ama daha koyu/soluk ton:
            elle girilmediğini, otomatik atandığını belli eder. */}
        <span
          className="grid size-7 shrink-0 place-items-center rounded-full bg-card text-xs font-extrabold text-muted-foreground"
          title="Numara otomatik atanır"
        >
          {nextNumber}
        </span>
        <input
          ref={titleRef}
          className={`${inputCls} h-8 min-w-28 flex-1 text-xs`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Bölüm adı (opsiyonel)"
          aria-label="Bölüm adı"
        />
        {/* Kaynak seçimi artık bölüm satırındaki TİK LİSTESİNDE (episode_sources):
            burada yalnızca serinin eski "video linki" alanı kalır — boş bırakılabilir. */}
        <input
          className={`${inputCls} h-8 min-w-40 flex-1 text-xs`}
          value={watchUrl}
          onChange={(event) => setWatchUrl(event.target.value)}
          onPaste={pasteEmbed(setWatchUrl)}
          placeholder="Video linki (opsiyonel)"
          aria-label="Video linki"
        />
        {/* Kırmızı dolu buton "Sil" ile karışıyordu; sakin bir buton yeterli.
            Yazı kısaltıldı: sezon numarası kartın başlığında zaten yazıyor. */}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7 shrink-0 rounded-full px-3 text-xs"
          onClick={() => void add()}
          disabled={busy || disabled}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Ekle
        </Button>
      </div>
    </div>
  );
}

// Kaldırıldı — TEK SEÇİMLİ kaynak menüsü (`sourceOptions`), TOPLU kaynak çubuğu
// (`BulkSourceBar`) ve özel açılır liste (`SourceSelect`). Kullanıcı kararı: panel
// fazla kalabalık; bölüm satırlarında ÇOKLU SEÇİM kutusu yok, kaynak seçimi ise
// birden çok işaretlenebilen SADE bir tik listesi (bkz. `EpisodeRow`).

/**
 * BÖLÜM SATIRI — TEK SATIR; kaynak listesi yalnızca AÇILINCA altına gelir.
 *
 * Kullanıcı isteği: "o bölüm listesi daha da kolay, daha az yer kaplayacak şekilde
 * olsun" (ölçüm: satır ~160px). Bu yüzden satır: numara · başlık · Kaynaklar düğmesi ·
 * Kaydet/Sil. Kaynak kutusu varsayılan KAPALI olduğu için 1000 bölümlü listede bile
 * satır ~36px kalır; yalnızca açılan satır uzar.
 *
 * Kaynak seçimi BİRDEN ÇOK işaretlenebilen bir tik listesidir: işaretlenen her kaynak
 * `episode_sources`a ayrı satır olarak yazılır ve oynatıcının altında çıkar (bkz.
 * `replaceEpisodeSources`). Eskiden tek seçimli bir menüydü; tek kolon sınırını
 * `episode_sources` tablosu kaldırdı.
 */
function EpisodeRow({
  episode,
  seasonNumber,
  seasonMin,
  puffySlug,
  puffyBase,
  animecixId,
  malId,
  busy,
  stored,
  sourcesLoaded,
  onSaved,
}: {
  episode: Episode;
  seasonNumber: number;
  /**
   * Sezonun EN KÜÇÜK bölüm numarası (bizim verimizden). Sunucuya `min` olarak
   * gider; numara kayması (ör. 12…23 ↔ kaynakta 1…12) böylece sessizce çözümü
   * bozamaz. 1 tabanlı sezonda 1'dir ve davranış değişmez.
   */
  seasonMin: number;
  /** Bu sezonun puffytr dizi adresi; boşsa Anizm kaynağı çözülemez. */
  puffySlug: string;
  /**
   * SEZONSUZ puffytr slug'ı. Sunucu, sezon eki tutmadığında aday adresleri bunun
   * üzerinden dener (`lib/puffy.ts` → `puffySlugCandidates`); ölçüm: Re:Zero'da
   * `…-2nd-season` adresi puffytr'da YOK (302 → /notfound), bu yüzden Anizm
   * sessizce yazılamıyordu.
   */
  puffyBase: string;
  /** Serinin animecix kimliği; yoksa Animecix kutusu uyarı verir. */
  animecixId: number | null;
  /** Kaynak ipucunun Anizm/TMDB denetimi için. */
  malId?: number | null | undefined;
  busy: boolean;
  /** Sunucudan gelen KAYITLI kaynaklar — tiklerin başlangıç durumu. */
  stored: EpisodeSource[];
  /** Kaynaklar çekildi mi (çekilmeden tik kurulmaz; kaydetmede üzerine yazılmaz). */
  sourcesLoaded: boolean;
  onSaved: (message: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(episode.title);
  const [localBusy, setLocalBusy] = useState(false);
  const [open, setOpen] = useState(false);
  // `null` = tikler henüz kurulmadı. Kaynaklar geldiğinde YALNIZCA BİR KEZ kurulur:
  // arka plan yenilemesi kullanıcının işaretlediklerini ezmesin diye.
  const [ticked, setTicked] = useState<Set<string> | null>(null);
  /**
   * KÜÇÜK POPOVER — ekranın ortasına DEĞİL, basılan "Kaynaklar" düğmesinin dibine.
   *
   * Kullanıcı (27.09.2026): "kocaman popup açılıyor ve ekrana fırlıyor, öyle değil;
   * ufak şekilde bastığım yerin üstüne açılacak dedim."
   *
   * NEDEN `getBoundingClientRect` + `fixed` + portal: liste kaydırılan bir kap içinde;
   * düz `absolute` bir kutu `overflow` ile KESİLİRDİ. Bu yüzden panel yine
   * `document.body`ye çizilir, ama konumu DÜĞMENİN ÖLÇÜSÜNDEN hesaplanır → düğmenin
   * hemen altında, sağ kenarı düğmeyle hizalı, 19rem'lik küçük bir kutu. Ekranın
   * altında yer yoksa kutuyu düğmenin ÜSTÜNE çevirir.
   */
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number; above: boolean } | null>(null);

  /**
   * Düğme ölçüsünden popover konumunu hesaplar; ekran kenarından taşırmaz.
   * Hem açılışta hem kutu açıkken her karede (aşağıdaki `track`) kullanılır.
   */
  const positionFor = useCallback((rect: DOMRect) => {
    const WIDTH = 304; // w-[19rem]
    /**
     * Yükseklik: önce GERÇEK ölçü (`panelRef`), henüz çizilmediyse tahmin.
     *
     * ── NEDEN TRANSFORM KULLANILMIYOR (ölçüm, 27.09.2026) ────────────────────────
     * `animate-pop-in` animasyonu `animation: pop-in 220ms … both` ile bitiyor.
     * `both` = `animation-fill-mode: both` → animasyon bitince `to` karesindeki
     * `transform: translateY(0) scale(1)` KALICI oluyor ve elemanın satır içi
     * (`style`) transform değerini **EZİYOR**.
     * Ölçülen sonuç: kutu "yukarı" konumlanması gerektiğinde `translateY(-100%)`
     * hiç uygulanmadı; kutu satırın ÜSTÜNE bindi ve ekranın altından taştı
     * (popover.top − düğme.bottom = −30 px, popover.bottom 917 > ekran 866).
     * Bu yüzden konum transform'suz, doğrudan `top` ile hesaplanır.
     */
    const height = panelRef.current?.offsetHeight ?? 200;
    const below = rect.bottom + 6;
    const above = below + height > window.innerHeight - 8;
    const top = Math.max(8, above ? rect.top - height - 6 : below);
    const left = Math.min(
      Math.max(8, rect.right - WIDTH),
      Math.max(8, window.innerWidth - WIDTH - 8),
    );
    // 0,1 px'e yuvarlanır: her karede gereksiz state güncellemesi olmasın.
    return {
      top: Math.round(top * 10) / 10,
      left: Math.round(left * 10) / 10,
      above,
    };
  }, []);

  const openPopover = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setAnchor(positionFor(rect));
    setOpen(true);
  }, [positionFor]);
  /**
   * MANUEL EMBED adresi — veritabanındaki `manuel` satırından ÖN DOLDURULUR.
   *
   * NEDEN ÖN DOLDURMA ŞART: `replaceEpisodeSources` kaynak setini kutu/tik durumuyla
   * BİREBİR eşitler ve dışarıda kalan sağlayıcının satırını SİLER. Kutu boş
   * başlasaydı, kullanıcı yalnızca başlığı düzeltip Kaydet'e bassa elle eklediği
   * adres sessizce silinirdi.
   */
  const [manualUrl, setManualUrl] = useState("");

  useEffect(() => {
    if (!sourcesLoaded || ticked !== null) return;
    setTicked(new Set(stored.map((row) => row.provider)));
    setManualUrl(stored.find((row) => row.provider === MANUAL_SOURCE_ID)?.url ?? "");
  }, [sourcesLoaded, stored, ticked]);

  /**
   * Kapanma yolları: Esc, dışına tıklama.
   *
   * Karartma (backdrop) YOK — kutu küçük bir popover olduğu için ekranı kaplamaz;
   * bu yüzden "dışına tıklayınca kapan" davranışı burada elle kurulur. Düğmenin
   * kendisine basmak kapatma sayılmaz (o zaten aç/kapa yapıyor).
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    /**
     * KAYDIRINCA KAPAN.
     *
     * Kullanıcı (27.09.2026): "mouse scroll'u aşağı kaydırdım, bu hâlâ bana geliyor."
     * Popover `fixed` konumda ve konumu AÇILMA ANINDA hesaplanıyor; sayfa kayınca
     * liste kaysa da kutu ekranda aynı yerde kalıyor, düğmeden kopmuş gibi
     * görünüyordu. `capture: true` sayesinde hem pencere hem de İÇ kaydırma kapları
     * (`overflow-y-auto` liste) yakalanır → popover kapanır.
     */
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  /**
   * POPOVER DÜĞMEYE YAPIŞIK KALSIN.
   *
   * ── 27.09.2026 ÖLÇÜMÜ: `scroll` dinleyicisi İŞE YARAMADI ─────────────────────
   * Kutu açıkken sayfa kaydırıldı; kapanmadı ve konumu değişmedi (`fixed` olduğu
   * için ekranda sabit kaldı) — kullanıcının şikâyeti aynen bu: "mouse scroll'u
   * aşağı kaydırdım, bu hâlâ bana geliyor."
   *
   * Bu yüzden olay dinlemeye GÜVENMEYEN bir yol kuruldu: kutu açıkken her karede
   * düğmenin ekran ölçüsü okunur ve konum YALNIZCA gerçekten değiştiğinde state
   * güncellenir (gereksiz render yok). Böylece hem pencere kaydırması hem İÇ
   * kaydırma kapları (`overflow-y-auto` liste) aynı şekilde çalışır: kutu, bastığın
   * düğmeyle birlikte hareket eder — düğmeden kopmaz.
   */
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const track = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) {
        const next = positionFor(rect);
        setAnchor((prev) =>
          prev && prev.top === next.top && prev.left === next.left && prev.above === next.above
            ? prev
            : next,
        );
      }
      raf = window.requestAnimationFrame(track);
    };
    raf = window.requestAnimationFrame(track);
    return () => window.cancelAnimationFrame(raf);
  }, [open, positionFor]);

  const isTicked = (id: string) => ticked?.has(id) === true;

  function toggle(id: string) {
    setTicked((current) => {
      const next = new Set(current ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const tickedCount = PICK_ORDER.filter((item) => isTicked(item.id)).length;

  /**
   * İşaretli kaynakların TEK SATIRLIK durum ipucu.
   *
   * NEDEN TEK SATIR: eskiden her kaynak için ayrı blok vardı ve panel kalabalık
   * görünüyordu (kullanıcı isteği). Eksik olan varsa yalnızca uyarılar gösterilir.
   */
  const hint = (() => {
    if (!sourcesLoaded) return { tone: "info" as const, text: "Kaynaklar yükleniyor…" };
    const problems: string[] = [];
    for (const item of PICK_ORDER) {
      if (!isTicked(item.id)) continue;
      if (item.kind === "anizm") {
        /**
         * YALNIZCA GERÇEK ENGEL yazılır.
         *
         * Kaldırılan not: "Anizm kaydı hazır" ve "yerel kayıt yok, sunucudan
         * çözülecek" (kullanıcı, 28.09.2026: "Anizm kaydı hazır diyor, ne alaka …
         * gereksizse onu da kaldır").
         *
         * NEDEN GEREKSİZDİ: bu iki cümle `anizmPlayerUrl` (yerel oynatıcı adresi
         * tablosu) bakılabildi mi diye bakıyordu — yani bir İÇ UYGULAMA detayı.
         * Sonuç kullanıcı için fark etmiyor: kayıt varsa yerelden, yoksa sunucudan
         * çözülür; ikisinde de kaynak oynatıcının altında ÇIKAR.
         *
         * NEDEN SADECE ANIZM DİYORDU: bu satır yalnızca Anizm dalında vardı;
         * TauVideo/MegaPlay yalnızca ENGEL olduğunda (eşleme ya da MAL kimliği yok)
         * mesaj üretiyordu. Bu asimetri de kafa karıştırıyordu — artık üçü de aynı
         * kuralda: sessiz kal ya da gerçek engeli söyle.
         */
        if (!puffySlug)
          problems.push(
            "Anizm: bu sezonun puffytr adresi üretilemedi (seri slug'ı boş) — Seri ayarlarından slug'ı doldur",
          );
      } else if (item.kind === "animecix") {
        if (!animecixId) problems.push("TauVideo: serinin kaydı eşlenmemiş");
      } else if (item.id === "megaplay" && !malId) {
        problems.push("MegaPlay: MAL kimliği yok");
      }
    }
    if (problems.length > 0) return { tone: "warn" as const, text: problems.join(" · ") };
    if (tickedCount === 0)
      return { tone: "info" as const, text: "İşaretlediğin kaynaklar oynatıcının altında çıkar." };
    // Engel yoksa TEK cümle — kaynak başına "hazır/çözülecek" gibi iç detaylar yok.
    return {
      tone: "ok" as const,
      text: "İşaretlenenler oynatıcının altında çıkar.",
    };
  })();

  /**
   * İPUCU RENGİ — "başarılı" mesaj KIRMIZI çıkıyordu.
   *
   * `text-primary` bu temada KIRMIZI (birincil renk); bu yüzden olumlu bir satır
   * (eskiden "Anizm kaydı hazır") kırmızı görünüyor ve panel "hata var" izlenimi veriyordu
   * (kullanıcı, 27.09.2026: "bu kırmızılık ne ya, sadece yeşil tik çıksın yeter").
   * Artık tek mantık: YEŞİL = hazır/olumlu, AMBER = eksik/uyarı, NÖTR = bilgi.
   * Kırmızı yalnızca SİLME eylemine ayrıldı.
   */
  const hintCls =
    hint.tone === "warn"
      ? "text-amber-500"
      : hint.tone === "ok"
        ? "text-emerald-400"
        : "text-muted-foreground";

  /**
   * KAYDET — tikler `episode_sources`a yazılır, tik KALDIRILAN sağlayıcı SİLİNİR.
   *
   * Türkçe kaynakların adresi referer/CORS yüzünden tarayıcıda çözülemez, sunucu
   * rotalarından alınır (bkz. routes/api.anizm.ts, routes/api.animecix.ts); yabancılar
   * ise `@sağlayıcı` DİREKTİFİ olarak yazılır. `watch_url` GERİYE DÖNÜK UYUM için
   * güncellenir: izleme sayfası hâlâ onu okuyor.
   */
  async function save() {
    const wanted = PICK_ORDER.filter((item) => isTicked(item.id));

    /**
     * ═══════════════════════════════════════════════════════════════════════════
     * HER KAYIT DENEMESİ İZLENİR — erken çıkışlar DAHİL.
     *
     * ── NEDEN (ölçülen olay, 28.09.2026) ───────────────────────────────────────
     * Kullanıcı bilerek hatayı tekrarladı ama canlı günlükte HİÇBİR ŞEY görünmedi;
     * "sistem çalışmıyor" dedi ve haklıydı. Sebep: bu fonksiyonun **erken çıkışları
     * günlüğe yazmıyordu**. Kullanıcının yaptığı işlem aşağıdaki `return`lerden
     * birine takılıyor, `devMark` ise yalnızca fonksiyonun SONUNDA çağrılıyordu —
     * yani başarısız deneme tamamen görünmez kalıyordu.
     *
     * ARTIK: en başta "denendi" kaydı düşer, her erken çıkışta sebebi yazılır.
     * Böylece "tıkladım, hiçbir şey olmadı" durumu ASLA sessiz kalmaz; denemenin
     * nerede durduğu tek bakışta görülür.
     * ═══════════════════════════════════════════════════════════════════════════
     */
    devMark("kaynak kaydı denendi", {
      bolum: episode.number,
      secilen: wanted.length,
      secilenler: wanted.map((item) => item.id).join(",") || "(hiçbiri)",
    });

    // Gerekli değer yoksa SESSİZCE hiçbir şey yazılmaz — kısa ve anlaşılır uyarı çıkar.
    if (wanted.some((item) => item.kind === "anizm") && !puffySlug) {
      devMark("kaynak kaydı DURDURULDU", { sebep: "Anizm: sezonun puffytr adresi yok" });
      // NOT: mesaj eskiden "Gelişmiş bölümünden puffytr adresini elle yaz" diyordu;
      // o bölüm kaldırıldığı için mesaj artık OLMAYAN bir yeri göstermez — kullanıcı
      // tek yapması gerekeni okur.
      toast.error(
        "Anizm: bu sezonun puffytr adresi üretilemedi. Seri ayarlarından seri adresini " +
          "(slug) doldur, sonra tekrar dene.",
      );
      return;
    }
    if (wanted.some((item) => item.kind === "animecix") && !animecixId) {
      devMark("kaynak kaydı DURDURULDU", {
        sebep: "TauVideo kaydı eşlenmemiş (serinin animecix_id alanı boş)",
      });
      toast.error("TauVideo kaydı eşlenmemiş — katalog panelinden eşle ya da kutuyu kaldır.");
      return;
    }
    // Hiç kaynak seçilmemişse: eskiden bu da sessizce geçiyordu.
    if (wanted.length === 0) {
      devMark("kaynak kaydı DURDURULDU", { sebep: "hiç kaynak seçili değil" });
    }

    setLocalBusy(true);
    try {
      const rows: EpisodeSourceInput[] = [];
      const problems: string[] = [];
      /** Hata olmayan bilgiler (ör. otomatik seçilen puffytr adresi). */
      const notes: string[] = [];

      // 1) TÜRKÇE: gerçek adres SUNUCUDA çözülür (bkz. yukarıdaki not).
      for (const item of wanted) {
        if (item.kind === "anizm") {
          // `base` + `season` gönderilir: sunucu sezon ekini tutmadığında aday
          // adresleri dener (bkz. lib/puffy.ts) ve kullandığı adresi `slug` ile
          // döndürür — sebep ASLA yutulmaz, `problems` listesine yazılır.
          const params = new URLSearchParams({
            puffy: puffySlug,
            base: puffyBase,
            season: String(seasonNumber),
            number: String(episode.number),
            // `min` (sezonun ilk bölüm numarası): numaralandırma kaydığında sunucu
            // sezon-relative adayı önce dener (bkz. lib/puffy.ts).
            min: String(seasonMin),
            /**
             * `mal`: ağ dizinindeki "ad eşleşmesi" yolunu AÇAR.
             *
             * ÖLÇÜM (27.09.2026): bizim slug'ımız ağdakiyle tutmadığında (ör.
             * `erased` ↔ ağdaki `boku-dake-ga-inai-machi`) bu parametre OLMADAN
             * çözümleme `dizi sayfası 302` ile başarısız oluyordu; `mal` verilince
             * doğru adres bulunuyor. Panel bu değeri elinde tutuyordu (`malId`)
             * ama sunucuya HİÇ göndermiyordu — yani ad eşleşmesi yolu panelden
             * hiç çalışmıyordu. (`base`/`puffy` adres kalıbı + ağ adres ailesi
             * yollarını zaten besliyor; eksik olan yalnızca buydu.)
             */
            ...(malId ? { mal: String(malId) } : {}),
          });
          const res = await fetch(`/api/anizm?${params.toString()}`);
          const json = (await res.json()) as {
            ok?: boolean;
            url?: string;
            slug?: string;
            reason?: string;
            tried?: string[];
          };
          if (json.ok && json.url) {
            rows.push({
              provider: item.id,
              language: item.language,
              label: item.short,
              url: json.url,
              sort_order: item.order,
            });
            if (json.slug && json.slug !== puffySlug) {
              notes.push(`${item.short} adresi kullanıldı: ${json.slug}`);
            }
          } else {
            const reason = json.reason ?? "çözülemedi";
            const tried = json.tried?.length ? ` [denenen: ${json.tried.join(", ")}]` : "";
            // "Kaynakta yok" ile "ulaşılamadı" AYRI şeylerdir (bkz. `notFound`).
            if (notFound(reason)) notes.push(`${item.short}: ${reason}${tried}`);
            else problems.push(`${item.short}: ${reason}${tried}`);
          }
        } else if (item.kind === "animecix" && animecixId) {
          const res = await fetch(
            `/api/animecix?titleId=${animecixId}&season=${seasonNumber}&episode=${encodeURIComponent(String(episode.number))}`,
          );
          const json = (await res.json()) as { ok?: boolean; best?: string; reason?: string };
          if (json.ok && json.best) {
            rows.push({
              provider: item.id,
              language: item.language,
              label: item.short,
              url: json.best,
              sort_order: item.order,
            });
          } else {
            const reason = json.reason ?? "çözülemedi";
            // ÖLÇÜLEN ÖRNEK (kullanıcının bildirdiği): "bu bölüm için TauVideo kaydı
            // yok" — Jujutsu Kaisen **0 filmi** Animecix'te hiç yok, API boş liste
            // dönüyor. Bu bir arıza DEĞİL; panelin kırmızı hata vermesi yanlıştı.
            if (notFound(reason)) notes.push(`TauVideo: ${reason}`);
            else problems.push(`TauVideo: ${reason}`);
          }
        }
      }

      // 2) YABANCI: sunucuya istek YOK; `@sağlayıcı` direktifi yazılır.
      for (const item of wanted) {
        if (item.kind !== "foreign") continue;
        rows.push({
          provider: item.id,
          language: item.language,
          label: item.short,
          url: `@${item.id}`,
          sort_order: item.order,
        });
      }

      // 3) MANUEL EMBED: kutuya adres ya da iframe kodu yazıldıysa oynatıcı adresi
      //    olarak yazılır. `extractEmbedUrl` yapıştırılan `<iframe src="…">` kodundan
      //    adresi kendisi ayıklar, `watchUrlError` ise yalnızca gerçek bir https
      //    adresini kabul eder (host listesi yok — kendi sunucun da olabilir).
      if (manualUrl.trim()) {
        const manual = extractEmbedUrl(manualUrl);
        const manualError = watchUrlError(manual);
        if (manualError) problems.push(`Manuel: ${manualError}`);
        else if (manual) {
          rows.push({
            provider: MANUAL_SOURCE_ID,
            language: "tr",
            label: "Manuel",
            url: manual,
            sort_order: 90,
          });
        }
      }

      // Çözülemeyen Türkçe kaynağın DAHA ÖNCE kaydedilmiş satırı varsa KORUNUR; yoksa
      // çözümleme hatası kullanıcının kaydını sessizce silerdi.
      for (const item of wanted) {
        if (item.kind === "foreign") continue;
        if (rows.some((row) => row.provider === item.id)) continue;
        const previous = stored.find((row) => row.provider === item.id);
        if (previous) {
          rows.push({
            provider: previous.provider,
            language: previous.language,
            label: previous.label,
            url: previous.url,
            sort_order: previous.sort_order,
          });
        }
      }

      rows.sort((a, b) => a.sort_order - b.sort_order);
      // Geriye dönük uyum: sıralamada Türkçe önce olduğu için ilk satır tercih edilir.
      const watchUrl = rows[0]?.url ?? "";

      const { error: updateError } = await db
        .from("show_episodes")
        .update({ title: title.trim(), watch_url: watchUrl })
        .eq("id", episode.id);
      if (updateError) throw updateError;

      // Kaynak seti tiklerle BİREBİR eşitlenir: tik kaldırılan sağlayıcının satırı silinir.
      await replaceEpisodeSources(episode.id, rows);

      if (problems.length > 0) {
        // Sebep + denenen adresler AYNEN yazılır: "neden yazılmadı" sorusu cevapsız kalmasın.
        toast.error(`Bazı kaynaklar yazılamadı: ${problems.join("; ")}`);
      }
      /**
       * CANLI KONSOLA İŞARET — kullanıcının panelde yaptığı en kritik işlem.
       * Hangi bölüm, kaç kaynak, hangi kaynaklar yazıldı; sorun varsa sebebi.
       */
      devMark(`${episode.number}. bölüm kaynakları kaydedildi`, {
        kaynakSayisi: rows.length,
        saglayicilar: rows.map((row) => row.provider).join(","),
        /**
         * `notlar` DA YAZILIR — sadece `sorun` değil.
         *
         * ── NEDEN (ölçülen olay, 28.09.2026) ────────────────────────────────────
         * "Kaynakta yok" durumunu `sorun`dan `notlar`a taşıdıktan sonra bu alan
         * günlüğe yazılmıyordu; sonuç: kullanıcı 3 kaynak seçti, 2'si yazıldı ve
         * SEBEBİ HİÇBİR YERDE görünmedi (`sorun: ""`). Arıza bilgisini gizlemek,
         * yanlış alarm vermekten daha kötüdür. Artık iki alan da kaydedilir:
         *   · `sorun`  → gerçek başarısızlık (ağ/5xx) — kırmızı uyarı,
         *   · `notlar` → beklenen durum ("bu bölüm o kaynakta yok") — bilgi.
         */
        notlar: notes.length > 0 ? notes.join(" | ") : "",
        sorun: problems.length > 0 ? problems.join(" | ") : "",
      });
      await onSaved(
        `${episode.number}. bölüm kaydedildi.${notes.length > 0 ? ` ${notes.join("; ")}` : ""}`,
      );
    } catch (err) {
      // Supabase'in `PostgrestError`'ı `Error` ÖRNEĞİ DEĞİL (düz nesne), bu yüzden
      // `String(err)` ekrana "[object Object]" yazıyordu — canlı ekran görüntüsünde
      // "Bölüm kaydedilemedi: [object Object]" olarak görüldü. Önce `message` okunur.
      const reason =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      toast.error("Bölüm kaydedilemedi: " + reason);
    } finally {
      setLocalBusy(false);
    }
  }

  async function remove() {
    const ok = await confirmAction({
      title: `${seasonNumber}. sezonun ${episode.number}. bölümü silinsin mi?`,
      description: "Bölüm kaydı ve kaynakları silinir. Bu işlem geri alınamaz.",
      confirmLabel: "Bölümü sil",
      tone: "danger",
    });
    if (!ok) return;
    setLocalBusy(true);
    const { error } = await db.from("show_episodes").delete().eq("id", episode.id);
    setLocalBusy(false);
    if (error) {
      toast.error("Bölüm silinemedi: " + error.message);
      return;
    }
    await onSaved(`${episode.number}. bölüm silindi.`);
  }

  const disabled = busy || localBusy;

  return (
    // TEK SATIR: yükseklik ~30px (py-0.5 + h-6 denetimler). Kullanıcı isteği
    // (27.09.2026): satırlar kısaltıldı — Kaydet/Sil artık YALNIZCA İKON (erişilebilir
    // ad `aria-label`+`title` ile korunur), böylece düğme metinleri genişlik/yükseklik
    // yemiyor. Kaynak listesi açılmadıkça satır BÜYÜMEZ.
    //
    // NEDEN `cn` (tailwind-merge): `inputCls` içinde `h-10` var. Sınıflar düz şablonla
    // birleştirildiğinde buradaki `h-6` yazılışa göre DEĞİL, CSS'te sonra gelen
    // `h-10`a göre kaybediyordu; kutu 40px kalıyor ve satır tarayıcıda 46px ölçülüyordu
    // (40 + iki yanda 2px `py-0.5` + 2px kenarlık). `cn` çakışan sınıfları kaldırır,
    // böylece burada yazılan h-6/h-7 GERÇEKTEN uygulanır -> satır ~30px.
    // (Aynı hata mantığı genişletilmiş durumdaki başlık kutusunda da düzeltildi.)
    <div className="rounded-xl border border-border bg-card px-2 py-0.5">
      <div className="flex items-center gap-1.5">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-extrabold text-primary">
          {episode.number}
        </span>
        <input
          className={cn(inputCls, "h-6 min-w-24 flex-1 text-xs")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Bölüm adı (opsiyonel)"
          aria-label={`${episode.number}. bölüm adı`}
        />
        {/* HANGİ kaynaktan yüklü / neyi eksik — satırı açmadan görünür. */}
        <SourceBadges stored={stored} loaded={sourcesLoaded} />
        <Button
          ref={buttonRef}
          size="sm"
          variant={open ? "secondary" : "outline"}
          className="h-6 shrink-0 gap-1 rounded-full px-2 text-[11px]"
          onClick={() => (open ? setOpen(false) : openPopover())}
          aria-expanded={open}
          aria-haspopup="dialog"
          title="Bu bölümün kaynaklarını seç"
        >
          <ChevronDown size={13} />
          Kaynaklar{tickedCount > 0 ? ` (${tickedCount})` : ""}
        </Button>
        {/* İkon-only: metin yok ama ekran okuyucu ve ipucu için ad korunur.
            RENK: Kaydet YEŞİL, Sil KIRMIZI. Eskiden ikisi de kırmızıydı; aynı renkteki
            iki yuvarlak düğme karışıyordu ("hangisi kaydet, hangisi sil?") ve panel
            gereksiz kırmızı görünüyordu. */}
        <Button
          size="sm"
          className="h-6 shrink-0 rounded-full bg-emerald-600 px-2 text-white hover:bg-emerald-500"
          onClick={() => void save()}
          disabled={disabled}
          aria-label="Kaydet"
          title="Kaydet"
        >
          {localBusy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="h-6 shrink-0 rounded-full px-2"
          onClick={() => void remove()}
          disabled={disabled}
          aria-label="Sil"
          title="Sil"
        >
          <Trash2 size={13} />
        </Button>
      </div>

      {/*
        KAYNAK SEÇİMİ ARTIK POPUP (kullanıcı isteği, 27.09.2026): "buradaki kaynaklara
        tıklayınca popup açılsın, animasyonlu şekilde öyle seçim alanı sunsun."

        NEDEN `createPortal`: satır, kaydırılan bir liste içindeki `rounded-xl` kartların
        arasında; satır içi açılan kutu listeyi aşağı itiyor ve komşu satırlarla
        karışıyordu. Portal ile panel doğrudan `document.body`ye çizilir → `fixed`
        konumlandırma hiçbir ata elemanın `transform`/`overflow`undan etkilenmez.
        Animasyon: `styles.css`teki hazır `animate-pop-in` (220ms, yumuşak yay) —
        yeni bir animasyon yazılmadı.
      */}
      {open &&
        anchor &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={`${episode.number}. bölüm kaynakları`}
            style={{ top: anchor.top, left: anchor.left }}
            className="animate-pop-in fixed z-50 w-[19rem] origin-top-right space-y-2 rounded-xl border border-border bg-card p-2.5 shadow-2xl"
          >
            {/* BAŞLIK + EYLEMLER: küçük popover olduğu için İKON-ONLY (metin yer yemesin).
                Kaydet/Sil burada da durur; her satırın ikonlarını aramak gerekmesin. */}
            <div className="flex items-center gap-1">
              <p className="min-w-0 flex-1 truncate text-[11px] font-extrabold">
                {episode.number}. bölüm · Kaynaklar
              </p>
              {/* Kaydet YEŞİL, Sil KIRMIZI (aynı renkte iki yuvarlak karışıyordu). */}
              <Button
                size="sm"
                className="size-6 shrink-0 rounded-full bg-emerald-600 p-0 text-white hover:bg-emerald-500"
                onClick={() => void save()}
                disabled={disabled}
                aria-label="Kaydet"
                title="Kaydet"
              >
                {localBusy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="size-6 shrink-0 rounded-full p-0"
                onClick={() => void remove()}
                disabled={disabled}
                aria-label="Sil"
                title="Sil"
              >
                <Trash2 size={12} />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="size-6 shrink-0 rounded-full p-0"
                onClick={() => setOpen(false)}
                aria-label="Kapat"
                title="Kapat (Esc)"
              >
                <X size={12} />
              </Button>
            </div>
            {/*
            KAYNAK ÇİPLERİ — TEK SATIR (kompakt).
            Kullanıcı (27.09.2026): "bölümler kısmındaki kaynaklar'a basınca gelen o
            kutu hiç temiz değil, panele uygun değil, çok çirkin kaba duruyor; daha
            kompakt tasarla." Eskiden İKİ AĞIR kutu vardı (TÜRKÇE KAYNAK / YABANCI
            KAYNAK): her biri kendi çerçevesi + büyük harfli başlığı + `p-3` dolgusuyla
            satırı iki kez şişiriyordu. Artık kaynaklar TEK satırda çip olarak durur;
            kategori ayrımı çipin içindeki küçük simgeyle (TR / yabancı) verilir —
            işaretli çip dolu, işaretsiz çip soluk.
            Kutuya hangi sağlayıcının girdiği `PICK_ORDER.language` alanından okunur;
            yeni kaynak eklenince kategori kendiliğinden doğru olur.
          */}
            <div className="flex flex-wrap items-center gap-1">
              {PICK_ORDER.map((item) => {
                const on = isTicked(item.id);
                return (
                  <label
                    key={item.id}
                    title={
                      item.kind === "foreign"
                        ? `${item.short}: oynatıcı direktifi yazılır (bölüme özel adres gerekmez)`
                        : `${item.short}: adres sunucuda çözülür ve bu bölüme yazılır`
                    }
                    className={cn(
                      "flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-all active:scale-[0.97]",
                      // YEŞİL = seçili/var. Eskiden `primary` (KIRMIZI) dolgu vardı ve
                      // panel kırmızı-yeşil-sarı bir karışıma dönüyordu (kullanıcı:
                      // "çok renkli, ülke rengi gibi oldu"). Seçili çip artık sakin yeşil.
                      on
                        ? "border-emerald-500/50 bg-emerald-500/10 font-bold text-emerald-400"
                        : "border-border text-muted-foreground hover:text-foreground",
                      (disabled || !sourcesLoaded) && "cursor-not-allowed opacity-60",
                    )}
                  >
                    {/*
                    TARAYICININ TİK KUTUSU KULLANILMAZ: `accent-color` her tarayıcıda
                    uygulanmadığı için kutu MAVİ çiziliyordu ve tasarımı bozuyordu
                    (kullanıcı bildirimi 27.09.2026: "o tik işareti rengi zaten mavi,
                    bozuyor"). Girdi görünmez (`sr-only`) ama işlevi ve klavye erişimi
                    aynı; görünen işaret BİZİM: işaretliyken ana renk, değilse boş.
                  */}
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={disabled || !sourcesLoaded}
                      onChange={() => toggle(item.id)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-3.5 shrink-0 place-items-center rounded-[4px] border transition-colors",
                        on
                          ? "border-emerald-500 text-emerald-400"
                          : "border-muted-foreground/40 text-transparent",
                      )}
                    >
                      <Check size={10} strokeWidth={3.5} />
                    </span>
                    {item.language === "tr" ? <Languages size={11} /> : <Globe size={11} />}
                    {item.short}
                  </label>
                );
              })}
            </div>

            {/* Bölüm adı alanı KALDIRILDI (kullanıcı, 28.09.2026: "popup'daki bölüm adı
              kısmını ve etiket kısmını sil, gereksiz buluyorum").
              Ad düzenleme gerekirse satırın KENDİ kutusu var (bkz. satır içi
              "Bölüm adı (opsiyonel)" girdisi) — popover yalnızca KAYNAK işine bakar. */}

            {/*
            MANUEL EMBED — kullanıcı isteği (27.09.2026): "kaynağı elle ekleyebilme
            için olan yer olsa yeter … manuel nasıl gireceğimi, embed çekmeyi
            bilmiyorum ben."

            Kutunun içine İKİ ŞEY yapıştırılabilir, ikisi de çalışır:
              · oynatıcının tam `<iframe …>` embed kodu → `pasteEmbed` yapıştırma
                anında `src="…"` içindeki adresi ayıklar (kullanıcının embed kodunu
                anlamasına gerek yok, kopyalayıp yapıştırması yeter),
              · doğrudan adres (ör. https://filemoon.org/xxxxxx/embed).
            Kaydet, adresi bu bölüme **Manuel** kaynağı olarak yazar; izleme
            sayfasında oynatıcının altında çip olarak çıkar.
          */}
            <label className="flex items-center gap-2 text-[11px] font-bold text-muted-foreground">
              Manuel embed
              <input
                className={cn(inputCls, "h-7 min-w-40 flex-1 text-xs")}
                value={manualUrl}
                onChange={(event) => setManualUrl(event.target.value)}
                onPaste={pasteEmbed(setManualUrl)}
                placeholder="iframe kodunu ya da adresi yapıştır"
                aria-label={`${episode.number}. bölüm manuel embed adresi`}
              />
            </label>
            {manualUrl.trim() && watchUrlError(extractEmbedUrl(manualUrl)) ? (
              <p className="text-[10.5px] leading-4 text-amber-500">
                {watchUrlError(extractEmbedUrl(manualUrl))}
              </p>
            ) : null}

            {/* Etiket alanı KALDIRILDI (kullanıcı, 28.09.2026: "etiket kısmını sil,
              gereksiz buluyorum"). Elle eklenen kaynağın çip yazısı eskisi gibi
              "Manuel" kalır. */}
            <p className={`text-[10.5px] leading-4 ${hintCls}`}>{hint.text}</p>
          </div>,
          document.body,
        )}
    </div>
  );
}

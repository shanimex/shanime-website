import {
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
import { db, extractEmbedUrl, inputCls, pasteEmbed, watchUrlError } from "@/lib/admin";
import { AnizipSyncPanel, type PanelActivity } from "@/components/admin/AnizipSyncPanel";
import { toast } from "@/lib/admin-toast";
import { confirmAction } from "@/lib/admin-confirm";
import type { Episode, Season } from "@/lib/content";
import { devMark } from "@/lib/dev-log";
import { SOURCE_GROUPS } from "@/lib/embed-sources";
import { isPartContinuation, puffySlugFor, puffySlugForSeason } from "@/lib/puffy";
import { findResumableKeys } from "@/lib/anizip-sync-store";
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
    /**
     * Girilen kaydın BİÇİMİ (AniList: TV/MOVIE/OVA/SPECIAL/…). OVA/SPECIAL/ONA
     * tekil işlem görür (`standalone`): zincire düşmeden kendi kataloğu kullanılır.
     */
    format?: string | null | undefined;
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
   * YARIDA KALMIŞ SEZON — panel KAPALIYKEN (özellikle F5 sonrası) bu seride
   * tamamlanmamış bir yazma var mı? Varsa sağ alttaki kalıcı rozet "devam et"
   * gösterir ve tek tıkla o sezonun panelini AYNI durumla geri açar
   * (durum `lib/anizip-sync-store.ts` içinde sezon anahtarıyla saklı).
   */
  const [resumableSeason, setResumableSeason] = useState<number | null>(null);

  useEffect(() => {
    // Panel açıkken kalıcı "devam et" rozetine gerek yok (panel zaten görünür).
    if (catalogSeason !== null) {
      setResumableSeason(null);
      return;
    }
    const keys = findResumableKeys(showId);
    if (keys.length === 0) {
      setResumableSeason(null);
      return;
    }
    const season = Number.parseInt(keys[0]?.split(":").pop() ?? "", 10);
    setResumableSeason(Number.isFinite(season) ? season : null);
  }, [showId, catalogSeason]);
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
    /**
     * ÇALIŞAN İŞ VARSA KAPATMA → MİNİMİZE ET (kullanıcı isteği, 30.09.2026).
     * "Panelde yükleme yaparken başka yere dokunursam minimize etsin."
     *
     * Dışarı tıklama / ESC / X artık yazma sürerken paneli YOK ETMEZ; sağ alttaki
     * canlı rozete küçültür. Böylece süren iş görünür kalır ve panel geri açılınca
     * AYNI seçim/liste/ilerleme ile devam eder (çekilen liste sıfırlanmaz).
     * Yazma bitince (busy=false) kapatma eskisi gibi tamamen kapatır.
     */
    if (catalogActivity?.busy) {
      setCatalogMin(true);
      return;
    }
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
   * GİRİLEN KAYDIN BİÇİMİ — OVA/SPECIAL/ONA tekil işlem görür.
   * `partSeasonMalId` ile aynı yaşam döngüsü (istekle gelir, hedefle tüketilir).
   */
  const [entryFormat, setEntryFormat] = useState<string | null>(null);
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
        format?: string | null;
      } = {},
    ) => {
      setPartSeasonMalId(opts.part ?? null);
      setPendingSeasonMalId(opts.pending ?? null);
      setTargetSeasonMalId(opts.seasonMalId ?? null);
      setEntryFormat(opts.format ?? null);
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
    // Giriş biçimi hedefe taşınır (OVA/SPECIAL/ONA tekil işlem görür).
    setEntryFormat(catalogOpenRequest.format ?? null);
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
              } fixed inset-0 z-[70] overflow-y-auto overscroll-contain bg-black/70 p-3 [scrollbar-width:none] sm:p-6 [&::-webkit-scrollbar]:hidden${catalogMin ? " hidden" : ""}`}
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
                } mx-auto w-full max-w-xl overflow-hidden rounded-2xl bg-background shadow-2xl`}
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
                {/* Dış kaydırma çubukları gizli (kullanıcı bildirimi: kaba duruyor);
                  kaydırma işlevi durur — yalnızca görsel temizlik. İç bölüm
                  listesinin ince çubuğu aynen kalır. */}
                <div className="max-h-[62vh] min-h-[20rem] overflow-y-auto overscroll-contain p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                     * TEKİL KAYIT (OVA/SPECIAL/ONA) — kendi kataloğundan başka
                     * yere düşmez (bkz. `standalone` prop notu).
                     */
                    standalone={["OVA", "SPECIAL", "ONA"].includes(
                      (entryFormat ?? "").toUpperCase(),
                    )}
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
        KÜÇÜLTÜLMÜŞ ROZET — sağ altta, CANLI ilerleme (kullanıcı isteği, 30.09.2026).

        İKİ DURUMDA görünür:
          · panel küçültülmüşse (`catalogMin`) — yazma sürerken
            "Kaynak yazılıyor 7/23 · %30 · kalan ~6 sn" yazar;
          · panel kapalıyken ama bu seride YARIDA KALMIŞ iş varsa (kapatma/F5
            sonrası) — "yarıda kaldı · devam et" gösterir; tıklanınca panel
            AYNI durumla (aynı seçim/liste/ilerleme) geri açılır.

        Modal `hidden` ile gizlenir ama BİLEŞEN DURUR (yazma devam eder). Durum
        `lib/anizip-sync-store.ts`te sezon anahtarıyla saklı olduğu için panel
        kapalıyken de geri gelebilir.
      */}
      {(catalogSeason !== null && catalogMin) ||
      (catalogSeason === null && resumableSeason !== null)
        ? createPortal(
            <button
              type="button"
              onClick={() => {
                if (catalogSeason === null && resumableSeason !== null) {
                  // Panel kapalıyken: yarıda kalan sezonu aynı durumla geri aç.
                  setCatalogSeason(resumableSeason);
                  setCatalogMin(false);
                  setResumableSeason(null);
                } else {
                  setCatalogMin(false);
                }
              }}
              title="Katalog paneline dön"
              className="fixed bottom-4 right-4 z-[75] flex animate-rise-in items-center gap-2 rounded-full border border-border bg-background/95 py-2 pl-3 pr-2 text-xs font-bold text-foreground shadow-2xl backdrop-blur transition-transform hover:scale-[1.04] active:scale-95"
            >
              {catalogActivity?.busy ? (
                <Loader2 size={13} className="animate-spin text-emerald-400" />
              ) : (
                <CloudDownload size={13} className="text-emerald-400" />
              )}
              <span>Katalog · S{catalogSeason ?? resumableSeason}</span>
              {catalogActivity?.busy && catalogActivity.total > 0 ? (
                <PillProgress
                  done={catalogActivity.done}
                  total={catalogActivity.total}
                  startedAt={catalogActivity.startedAt}
                />
              ) : catalogActivity && catalogActivity.total > 0 ? (
                <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 tabular-nums">
                  {catalogActivity.done}/{catalogActivity.total}
                  {catalogActivity.fail > 0 ? ` · ${catalogActivity.fail} hata` : ""}
                </span>
              ) : (
                <span className="font-normal text-muted-foreground">
                  {catalogSeason === null ? "yarıda kaldı · devam et" : "hazır"}
                </span>
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
           · Kapak senkronu KAYBOLMADI — bölüm kapakları artık YALNIZCA TVDB'den
             gelir ve derleme öncesi boru hattıyla üretilir
             (`scripts/sync-covers-all.mjs`); giden yalnızca ELLE tetiklenen düğmedir.
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
          className={cn(inputCls, "h-8 min-w-28 flex-1 text-xs")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Bölüm adı (opsiyonel)"
          aria-label="Bölüm adı"
        />
        {/* Kaynak seçimi artık bölüm satırındaki TİK LİSTESİNDE (episode_sources):
            burada yalnızca serinin eski "video linki" alanı kalır — boş bırakılabilir. */}
        <input
          className={cn(inputCls, "h-8 min-w-40 flex-1 text-xs")}
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

/**
 * ROZET İLERLEMESİ — CANLI, GERÇEK ÖLÇÜM (uydurma animasyon DEĞİL).
 *
 * Küçültülmüş rozette "Kaynak yazılıyor 7/23 · %30 · kalan ~6 sn" gösterir.
 *   · yüzde  = tamamlanan ÷ toplam,
 *   · kalan  = şu ana kadarki hızdan doğrusal TAHMİN (garanti değil, tahmin).
 * Kendi saatini kendisi işletir (500 ms); yalnızca bu küçük satır yeniden çizilir.
 */
function PillProgress({
  done,
  total,
  startedAt,
}: {
  done: number;
  total: number;
  startedAt: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const seconds = startedAt > 0 ? Math.max(0.5, (now - startedAt) / 1000) : 0;
  const remaining =
    done > 0 && total > done && seconds > 0 ? Math.round(((total - done) * seconds) / done) : null;

  return (
    <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 tabular-nums">
      Kaynak yazılıyor {done}/{total} · %{pct}
      {remaining !== null ? ` · kalan ~${remaining} sn` : ""}
    </span>
  );
}

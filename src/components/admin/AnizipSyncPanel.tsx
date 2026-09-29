import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CloudDownload,
  Globe,
  Languages,
  ListPlus,
  Loader2,
  Save,
  Search,
  RefreshCw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/admin-toast";
import { confirmAction } from "@/lib/admin-confirm";
import { createPortal } from "react-dom";
import { db, inputCls } from "@/lib/admin";
import { puffySlugForSeason } from "@/lib/puffy";
import { SOURCE_GROUPS } from "@/lib/embed-sources";
import {
  fetchSourcesForEpisodes,
  replaceEpisodeSources,
  type EpisodeSourceInput,
} from "@/lib/episode-sources";
import { collapseEpisodeReasons } from "@/lib/admin-report";
import { devMark } from "@/lib/dev-log";

/**
 * MANUEL KAYNAK KİMLİĞİ.
 *
 * `SeasonsPanel` içindeki `MANUAL_SOURCE_ID` ile AYNI değer olmalı: elle girilen
 * embed adresi `episode_sources.provider = "manual"` olarak yazılır ve oynatıcı
 * bu satırı "Manuel" etiketiyle gösterir. İki dosyada ayrı sabit tutulmasının
 * sebebi, panel bileşenleri arasında döngüsel import oluşturmamak; değer
 * değişecekse İKİSİ BİRDEN güncellenmeli.
 */
const MANUAL_ID = "manual";
import {
  DEFAULT_RETRIES,
  ImportSkip,
  RATE_LIMIT_DELAY_MS,
  RETRY_BASE_DELAY_MS,
  asArray,
  asNumber,
  isTransient,
  retryTransient,
  runSequentialImport,
  sleep,
  type ImportLogChild,
  type ImportLogEntry,
} from "@/lib/import-runner";
import { arrayField, boolField, readJsonObject, textField } from "@/lib/safe-json";
import { rankMatches } from "@/lib/title-match";
import { ImportLogList } from "@/components/admin/ImportLogList";
import {
  CatalogHttpError,
  catalogFailureMessage,
  catalogSeasons,
  fetchCatalogEpisodes,
  isPlaceholderTitle,
  fetchRelatedRecords,
  fetchSeasonChain,
  numberPartEpisodes,
  pickChainSeason,
  type CatalogAttempt,
  type CatalogEpisode,
  type RelatedRecord,
} from "@/lib/admin-anizip";

type Existing = {
  /**
   * BÖLÜM KİMLİĞİ — "bu bölümde hangi kaynak ZATEN yüklü?" sorusunu cevaplamak
   * için gerekli (bkz. `alreadyLoadedNumbers`).
   *
   * NEDEN EKLENDİ (kullanıcı, 28.09.2026): "yüklü olan kaynakları/bölümleri bir
   * daha yüklemeyeyim." Ölçülen olay: kullanıcı Erased S1'de **12 bölümü üst üste
   * 3 kez** yazdı; her seferinde "eklenen: 0 · güncellenen: 12" — yani hepsi
   * zaten yüklüydü ve panel bunu ne söyledi ne engelledi. Kapsama hesabı için
   * `episode_sources` sorgusunu bölüm kimliğiyle yapmak şart.
   *
   * Eski çağrı yerleri kimlik vermezse alan `undefined` kalır ve kapsama kontrolü
   * sessizce devre dışı olur (panel yine çalışır).
   */
  id?: string | undefined;
  season: number;
  number: number;
  title?: string | null;
};

/**
 * Hata nesnesinden OKUNABİLİR bir metin çıkarır.
 *
 * NEDEN AYRI: Supabase'in `PostgrestError`'ı `Error` ÖRNEĞİ DEĞİL, düz bir
 * nesnedir. `String(err)` ekrana "[object Object]" yazıyordu — canlı testte 24
 * bölümün tamamı böyle göründü ve kullanıcı hatanın ne olduğunu anlayamadı
 * (gerçek sebep: `episode_sources` tablosu henüz yoktu, migration çalıştırılmamış).
 */
function reasonOf(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Kaynak kimlikleri (panelde `picked` sözlüğü bunları taşır).
 *
 * `anizm` ve `animecix` Türkçe taraftadır ama kaynakları FARKLI yerde çözülür:
 * anizm hash'i puffytr adresinden, animecix oynatıcısı eşlenmiş kayıttan gelir.
 * İkisi de bir sağlayıcı direktifi DEĞİL (bölüme özel adres üretirler), bu yüzden
 * `lib/embed-sources.ts` listesinde yalnızca `anizm` var; animecix buraya aittir.
 */
const TR_SOURCE_ID = "anizm";
const ANIMECIX_SOURCE_ID = "animecix";

/** Tüm sağlayıcı kalemleri — liste KOPYALANMAZ, tek kaynak `lib/embed-sources.ts`. */
const ALL_SOURCES = SOURCE_GROUPS.flatMap((group) => group.items);

/** Anizm'in açıklaması SeasonsPanel ile aynı kalsın diye paylaşılan listeden okunur. */
const ANIZM_SOURCE = ALL_SOURCES.find((item) => item.id === TR_SOURCE_ID);

/**
 * YABANCI taraf: Türkçe olmayan sağlayıcılar (MegaPlay, Videasy, VidSrc).
 *
 * `anizm` dışarıda çünkü onun kendi çözücüsü var (Türkçe taraf); `tauvideo` de
 * dışarıda çünkü o bir direktif değil — adresi bölüme özel olarak animecix
 * sayfasından gelir (bkz. SeasonsPanel'deki "elle embed adresi" davranışı).
 */
const FOREIGN_SOURCES = ALL_SOURCES.filter(
  (item) => item.id !== TR_SOURCE_ID && item.id !== "tauvideo",
);

/**
 * Kaynağın nerede çözüleceğini söyler: Türkçe sağlayıcılar sunucu rotasıyla,
 * animecix eşlenmiş kayıttan, yabancılar `@sağlayıcı` direktifiyle.
 */
type PickKind = "anizm" | "animecix" | "foreign";
type PickItem = { id: string; short: string; language: string; kind: PickKind; order: number };

/**
 * Yazılış sırası ve kısa adlar — `order` alanı `episode_sources.sort_order`a yazılır,
 * böylece oynatıcı altındaki diziliş her seferinde aynı (Türkçe önce) olur. Sağlayıcı
 * listesi TEKRAR yazılmaz, `lib/embed-sources.ts`ten türetilir.
 */
const PICK_ORDER: PickItem[] = [
  { id: TR_SOURCE_ID, short: "Anizm", language: "tr", kind: "anizm", order: 0 },
  // Görünen ad "TauVideo": animecix kaydının gömülü oynatıcısı tau-video.xyz olduğu
  // için kullanıcı gerçek oynatıcı adını görmek istedi (kaynak id'si `animecix` ve
  // `@animecix` direktifi DEĞİŞMEZ).
  { id: ANIMECIX_SOURCE_ID, short: "TauVideo", language: "tr", kind: "animecix", order: 1 },
  ...FOREIGN_SOURCES.map((item, index) => ({
    id: item.id,
    short: item.label.split(" — ")[0] ?? item.label,
    language: "en",
    kind: "foreign" as const,
    order: 2 + index,
  })),
];

/** animecix arama sonucu (yalnızca kullandığımız alanlar). */
type AnimecixHit = {
  id: number;
  name: string;
  english: string;
  romanji: string;
  episodes: number;
};

/**
 * Animecix adında "ek kelime" sayılan işaretler.
 *
 * ÖLÇÜM: ada göre aramada SPECIALS/Movie gibi kayıtlar ana diziden önce geliyordu
 * ("mushoku tensei" aramasının ilk sonucu SPECIALS kaydıydı). Bunlar elenir.
 */
/**
 * Ana dizinin YAN ÜRÜNÜ olduğunu gösteren işaretler (film/özel bölüm/kısa bölüm…).
 *
 * ÖLÇÜM (27.09.2026, canlı): "re zero" aramasında `… Kyuukei Jikan (Break Time)`
 * kaydı 66 bölümle, ana dizi (`Re:Zero kara Hajimeru Isekai Seikatsu`, 53 bölüm)
 * kaydının ÖNÜNE geçiyordu — çünkü İngilizce adı "… Shorts" ile bitiyor ama listede
 * "shorts"/"break time" işareti YOKTU. Yan ürün seçilirse yanlış kayda video yazılır;
 * bu yüzden işaret listesi genişletildi.
 */
const ANIMECIX_EXTRA_RE =
  /\b(movie|film|specials?|ova|ona|pv|adaptation|recap|summary|shorts?|break\s*time|picture\s+drama)\b/i;

/** Kaydın BÜTÜN adlarını tek metne çevirir (yan ürün denetimi hepsine bakar). */
function animecixNamesOf(hit: AnimecixHit | null | undefined): string {
  return [hit?.name, hit?.english, hit?.romanji]
    .map((value) => (typeof value === "string" ? value : ""))
    .filter(Boolean)
    .join(" ");
}

/**
 * Arama sonuçlarından EN İYİ animecix kaydını seçer (kullanıcıya liste gösterilmez).
 *
 * ESKİ MANTIK KATIYDI (kullanıcı şikâyeti): önce birebir ad eşleşmesi aranıyordu;
 * tutmazsa "adında ek kelime bulunmayan + en çok bölümlü" kayda düşülüyordu. Yani
 * `Mushoku Tensei` ↔ `Mushoku Tensei: Jobless Reincarnation` gibi yazım farkları
 * eşleşme sayılmıyor, yanlış kayıt seçilebiliyordu.
 *
 * YENİ MANTIK: adlar `lib/title-match.ts` ile PUANLANIR (benzerlik + yazım yakınlığı),
 * her kaydın ÜÇ adı (name/english/romanji) eşanlamlı gibi denenir. Eşitlikte
 * "ek kelime" işareti taşıyan kayıt (SPECIALS/Movie/OVA…) geriye düşer, kalan
 * eşitlikte çok bölümlü kayıt öne geçer. Hiçbiri asgari benzerliği geçemezse
 * `null` döner — uydurma yerine "bulunamadı" der.
 */
function pickAnimecixMatch(
  /** Sorgu ADLARI, güvenilir olandan sırayla: bizim başlık, romaji, eşanlamlılar… */
  terms: string[],
  results: AnimecixHit[],
): { id: number; matchedTitle: string; score: number } | null {
  const valid = asArray<AnimecixHit>(results).filter((hit) => asNumber(hit?.id) > 0);
  if (valid.length === 0) return null;

  // Her kaydın ÜÇ adı eşanlamlı gibi verilir: bizim adımız İngilizce, kaydınki
  // romaji olsa da eşleşme kurulur (kullanıcı isteğinin özü).
  const candidates = valid.map((hit) => ({
    value: hit,
    titles: [hit?.name, hit?.english, hit?.romanji, `${hit?.name ?? ""} ${hit?.english ?? ""}`],
  }));
  const ranked = rankMatches(terms, candidates, { minScore: 0.6 });
  if (ranked.length === 0) return null;

  /**
   * SIRALAMA: (1) benzerlik puanı, (2) "ek kelime" işareti taşımayan önce,
   * (3) çok bölümlü önce. Böylece hem ad eşleşmesi hem de dizinin ANA kaydı olması
   * birlikte gözetilir (ölçüm: "mushoku tensei" aramasının ilk sonucu SPECIALS'tı).
   */
  const best = [...ranked].sort((a, b) => {
    /**
     * BENZERLİK ÖNCE, TAM SAYI HASSASİYETİYLE.
     *
     * NEDEN EPSİLON KULLANILMIYOR: eskiden 0.05'ten küçük farklar "eşit" sayılıp
     * bölüm sayısına bakılıyordu; tam örtüşme (1.00) ile "içeriyor" (0.95) farkı
     * tam 0.05 olduğu için yan ürün kaydı ana diziyi geçebiliyordu (ölçülen hata:
     * Re:Zero → `… Shorts` 66 bölüm vs ana dizi 53 bölüm). Artık yüzdelik puan
     * karşılaştırılır: 100 ≠ 95 → doğru kayıt kazanır.
     */
    const scoreDiff = Math.round(b.score * 100) - Math.round(a.score * 100);
    if (scoreDiff !== 0) return scoreDiff;
    const aExtra = ANIMECIX_EXTRA_RE.test(animecixNamesOf(a.value)) ? 1 : 0;
    const bExtra = ANIMECIX_EXTRA_RE.test(animecixNamesOf(b.value)) ? 1 : 0;
    if (aExtra !== bExtra) return aExtra - bExtra;
    return asNumber(b.value?.episodes) - asNumber(a.value?.episodes);
  })[0];
  if (!best) return null;
  return { id: asNumber(best.value?.id), matchedTitle: best.matchedTitle, score: best.score };
}

/**
 * Kaynak SATIRI — bağımsız bir onay kutusu.
 *
 * Kullanıcı isteği (27.09.2026): panelde sağlayıcı başına ayrı kutu vardı ("neden 4
 * kutu var?"), üstelik kutuların içindeki küçük çipler ne işe yaradığını anlatmıyordu.
 * Artık satır KUTU DEĞİL: yalnızca iki kapsayıcı kutu var (TÜRKÇE KAYNAK / YABANCI
 * KAYNAK) ve satırlar onların İÇİNDE durur — bu yüzden satırın kendi çerçevesi yok.
 * Her satır BAĞIMSIZDIR ve birden fazlası aynı anda seçilebilir (seçilenler ayrı
 * tabloya satır satır yazılır). Kare/kare-işaretli simgeler bilerek kullanıldı: görsel
 * dil dosyadaki (ve paneldeki) onay kutularıyla aynı.
 */
function SourceRow({
  title,
  hint,
  checked,
  disabled,
  onToggle,
}: {
  title: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={checked}
      className="flex items-start gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-background/60 disabled:opacity-50"
    >
      {/* RENK TUTARLIĞI: seçili kaynak YEŞİL. Eskiden `text-primary` (KIRMIZI) idi ve
          bölüm satırlarındaki yeşil seçim stiliyle çelişiyordu (ölçüm 27.09.2026:
          "ANİZM / PUFFY kırmızı ↔ popover'da seçili kaynak yeşil"). Kırmızı yalnızca
          SİLME eylemine ayrıldı. */}
      {checked ? (
        <CheckSquare size={14} className="mt-0.5 shrink-0 text-emerald-400" />
      ) : (
        <Square size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0">
        <span
          className={`block text-[11px] font-extrabold uppercase tracking-wider ${
            checked ? "text-emerald-400" : "text-foreground"
          }`}
        >
          {title}
        </span>
        <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

/**
 * "Bir sezonun bölümlerini katalogdan çek ve kaynağını yaz."
 *
 * AKIŞ (kullanıcı isteği, 27.09.2026): sezon açılır → panel KENDİLİĞİNDEN bölüm
 * listesini bulur (hepsi işaretli) → İSTENİLDİĞİ KADAR kaynak kutusu işaretlenir →
 * tek düğme tüm sezonu yazar. Kullanıcıya MAL kimliği, "diğer kayıtlar", sezon atama
 * gibi hiçbir soru sorulmaz; animecix eşlemesi bile sessizce yapılır.
 *
 * KAYNAK: `api.ani.zip` — MAL kimliğiyle bölüm listesi (CORS `*`, tarayıcıdan
 * doğrudan çağrılır; bkz. `lib/admin-anizip.ts`).
 */
/**
 * Katalog aramasının sonucu: ya hedef sezonun bölümleri (başarı) ya da denenen
 * MAL kimlikleriyle DÜRÜST başarısızlık bilgisi. Başarısızlıkta panel uydurma
 * yapmaz; denenen kimlikleri ve 404/geçici ayrımını kullanıcıya gösterir.
 */
/**
 * `malId` — bölüm listesini ÜRETEN kaydın MAL kimliği.
 *
 * ── NEDEN EKLENDİ (kullanıcı bildirimi, 28.09.2026) ───────────────────────────
 * "Hedef S1 iken kimlik 31240; S2/S3'e geçince HÂLÂ aynı kimlik görünüyor."
 * Panel başlığındaki kimlik `shows.mal_id`den (SERİ seviyesi, tek değer) geliyordu;
 * o yüzden sezon değişince sayı değişmiyordu. Sezonun kendi kaydı bu çözümleyicinin
 * İÇİNDE bulunuyor (ilişkili kayıt ya da zincir basamağı) ama dışarı verilmiyordu.
 * Artık hangi kayıt kullanıldıysa o kimlik döner ve ekranda GÖSTERİLİR.
 *
 * Bu, sezon başına kimlik SAKLAMAZ (migration yok): kimlik her çözümlemede yeniden
 * bulunur, yani veritabanına yazma yapılmaz.
 */
type CatalogLookup =
  | {
      ok: true;
      episodes: CatalogEpisode[];
      malId: number;
      /**
       * ÖZEL / ÖN BÖLÜMLER — ani.zip katalogunda `season: 0` altında duran
       * "0. Bölüm"ler (ör. Mushoku S2 → "Guardian Fitz"). Ana bölüm listesinden
       * AYRI tutulur ki numaralandırma/kaydırma (part offset) hesabı KAYMASIN;
       * panelde en başta `0. Bölüm` olarak gösterilir.
       */
      specials: CatalogEpisode[];
    }
  | { ok: false; attempts: CatalogAttempt[] };

/**
 * YUMUŞAK İLERLEME — BİR SATIRIN çubuğu ve yüzdesi.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * NEDEN AYRI BİLEŞEN (kullanıcı bildirimi, 29.09.2026: "katalog panelinin içi
 * akıcı olsun")
 *
 * ÖNCEKİ HÂLİ KASIYORDU: saat 150 ms'de bir PANEL seviyesinde tazeleniyordu.
 * Panel yeniden çizilince görünürdeki TÜM satırlar (sayfa başına 50, seçilebilir
 * aralıkta 1000+) de yeniden çiziliyordu — yalnızca yazılan TEK satır değiştiği
 * hâlde. Uzun listelerde bu görünür takılmaya yol açıyordu.
 *
 * YENİ HÂLİ: saat ve yüzde hesabı bu KÜÇÜK bileşenin içinde. Yazma sırasında
 * yalnızca o satır yeniden çizilir; panel ve diğer satırlar hiç dokunulmaz.
 * Ayrıca zamanlayıcı YALNIZCA "writing" durumundaki satırda çalışır — bitmiş
 * satırlar için hiç zamanlayıcı kurulmaz.
 *
 * YÜZDE HESABI (değişmedi): gerçek kilometre taşları (`pct`) durur; taşlar
 * arasında çubuk sürekli yaklaşır ama bir sonraki taşı (`cap`) AŞMAZ. Böylece
 * çubuk beklerken donmaz, ilerlemeyi de abartmaz — %100 yalnızca gerçekten
 * bitince görünür.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function RowProgress({
  row,
}: {
  row: { pct: number; cap: number; at: number; status: string; step?: string | undefined };
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (row.status !== "writing") return;
    const id = window.setInterval(() => setNow(Date.now()), 150);
    return () => window.clearInterval(id);
    // `row.at` bağımlılıkta: yeni bir adım başladığında saat hemen tazelenir.
  }, [row.status, row.at]);

  let pct = row.pct;
  if (row.status === "writing") {
    const span = row.cap - row.pct;
    if (span > 0) {
      // ~1,5 sn'de aralığın %90'ına yaklaşır; gerçek taş gelince ona atlar.
      const ratio = Math.min(0.9, ((now - row.at) / 1500) * 0.9);
      pct = Math.min(row.cap, row.pct + Math.round(span * ratio));
    }
  }

  return (
    <>
      <span className="h-1 w-14 overflow-hidden rounded-full bg-foreground/10">
        <span
          className="block h-full rounded-full bg-emerald-700 transition-[width] duration-150 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </span>
      {/* `w-20` YETMİYORDU: adım adı da yazıldığı için ("yükleniyor · TauVideo 66%"). */}
      <span className="w-44 text-[10px] font-bold text-muted-foreground">
        yükleniyor {pct}%{row.step ? ` · ${row.step}` : ""}
      </span>
    </>
  );
}

/**
 * KOŞU HIZI — GERÇEK ÖLÇÜM (uydurma animasyon DEĞİL).
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * Kullanıcı isteği (29.09.2026): "yükleme çubuğunu sırf gerçekçi olsun diye mi
 * yavaşlattın? Ben CANLI olarak dolum çubuğu göstermesini istedim, yavaşlatmanı
 * istemedim. En yüksek hızda yüklesin ama canlı olarak GERÇEK yükleme hızını
 * göstersin bana."
 *
 * Bu bileşen hiçbir şeyi yavaşlatmaz — yalnızca ÖLÇER:
 *   · `bölüm/sn`  → tamamlanan bölüm ÷ geçen süre,
 *   · `mm:ss`     → koşunun başından bu yana geçen GERÇEK süre,
 *   · `kalan ~Ns` → şu ana kadarki hızdan doğrusal tahmin (garanti değil, tahmin).
 *
 * Kendi saatini kendisi işletir: 250 ms'de bir YALNIZCA bu satır yeniden çizilir,
 * liste değil (aynı gerekçe: `RowProgress` notu).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function RunRate({ done, total, startedAt }: { done: number; total: number; startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  // Çok küçük sürelerde hız sonsuza kaçmasın diye taban 0,5 sn.
  const seconds = Math.max(0.5, (now - startedAt) / 1000);
  const elapsed = Math.floor(seconds);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const rate = done / seconds;
  // Kalan süre yalnızca ölçülecek veri oluştuğunda gösterilir.
  const remaining = done > 0 && total > done ? Math.round(((total - done) * seconds) / done) : null;

  return (
    <span className="text-xs font-bold text-emerald-500">
      {rate.toFixed(1)} bölüm/sn · {mm}:{ss}
      {remaining !== null ? ` · kalan ~${remaining} sn` : ""}
    </span>
  );
}

/**
 * Panelin DIŞARIYA bildirdiği canlı durum — küçültülmüş hapta gösterilir.
 * Üst bileşen (`SeasonsPanel`) bunu hapta çizer; yazma sürerken panel
 * kapalıyken bile ilerleme görünür.
 */
export type PanelActivity = {
  busy: boolean;
  done: number;
  total: number;
  fail: number;
};

export function AnizipSyncPanel({
  showId,
  malId,
  seasonNumber,
  existing,
  puffySlug,
  notice = null,
  ambiguousChoice = null,
  singlePart = false,
  partContinuation = false,
  seasonOwnMalId = null,
  seasons = [],
  onSelectSeason,
  onDeleteSeason,
  onDeleteSeasonNumber,
  onDone,
  onManualAdd,
  onActivity,
}: {
  showId: string;
  /**
   * SERİNİN MAL KİMLİĞİ — kutudaki değer, HENÜZ KAYDEDİLMEMİŞ OLSA BİLE.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * ⚠️ BU PROP ÖNCEDEN HİÇ KULLANILMIYORDU — ÖLÇÜLEN HATA (28.09.2026).
   *
   * `ShowEditor` "kaydedilmemiş kimlik de geçerli" diye bu değeri gönderiyordu,
   * `SeasonsPanel` da alıyordu; ama `AnizipSyncPanel`'e AKTARILMIYORDU ve burada
   * da yoktu. Panel kimliği yalnızca `readShowMeta()` (veritabanı) üzerinden
   * okuduğu için YENİ eklenen seride `show.mal_id` boş olduğundan katalog hiç
   * denenmiyor, şu mesaj çıkıyordu:
   *
   *   "Bu serinin MAL kimliği yok — seri ayarlarından MAL kimliğini doldur."
   *
   * Kullanıcı akışı (canlı günlük): 20:21:09 "Oluştur" → Death Note kaydı;
   * 20:22:54 kutuya 1535 yazdı; 20:22:57 "MAL'de ara"; 20:22:59 sonuç satırına
   * tıkladı (kutu doldu, panel açıldı) — ama katalog HİÇ denenmedi, elle ekleme
   * formu öne çıktı. Şikâyet: "ben her animeyi elle ekleyeceksem ne anlamı var".
   *
   * Artık `load()` bu değeri ÖNCELİKLİ kullanır; veritabanı yalnızca yedektir.
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * `| undefined` şart: proje `exactOptionalPropertyTypes: true` ile derliyor,
   * `ShowEditor` ise `number | null | undefined` gönderiyor.
   */
  malId?: number | null | undefined;
  /**
   * HEDEF SEZON UYARISI — "bu sezon zaten var (S1)" / "45576 → S1'in partı, S2
   * değil" gibi NET bilgi. `SeasonsPanel` üretir; panel bunu üstte amber kutuda
   * gösterir. `null` ise hiçbir şey çizilmez.
   */
  notice?: string | null | undefined;
  /**
   * BELİRSİZ GİRİŞ SEÇİMİ — "bu giriş yeni sezon mu, aynı sezonun devamı mı?"
   *
   * Yalnızca başlıkta ne "Season N" ne "Part/Cour" ibaresi olan bir kimlik
   * girildiğinde dolar (`SeasonsPanel → classifySeasonTitle === "ambiguous"`).
   * Panel, "Hedef: S{n}" etiketinin yanında küçük bir seçim çizer; heuristiğin
   * önerisi (`value`) varsayılan seçilidir. `null` ise HİÇBİR ŞEY çizilmez —
   * bugünkü görünüm değişmez.
   */
  ambiguousChoice?:
    { value: "part" | "season"; onChange: (choice: "part" | "season") => void } | null | undefined;
  /**
   * BU SEZONU TAMAMEN SİL — bölümleriyle birlikte.
   *
   * Kullanıcı isteği (28.09.2026): "direkt sezonu silemiyorum kanka ya."
   *
   * `SeasonsPanel` içinde `removeSeason()` ZATEN VARDI ve çalışıyordu; ama onu
   * çağıran düğme, artık çizilmeyen `SeasonCard` bileşenindeydi — yani işlev
   * vardı, ULAŞILAMIYORDU. Panel bu geri çağrıyı "Gelişmiş" bölümündeki düğmeye
   * bağlar; silme işini (onay + veritabanı + yeniden yükleme) üst bileşen yapar.
   */
  onDeleteSeason?: (() => void) | undefined;
  /**
   * SEZONU NUMARASIYLA SİL — panelin sezon seçicisinin yanındaki çöp kutusu.
   *
   * Kullanıcı isteği (29.09.2026): "sezonlardan birine sağ tıklayıp silebileyim,
   * tamamen kalıntısız şekilde, diğer şekilde uzun sürüyor." Üst bileşen aynı
   * silme akışını (onay penceresi + bölüm/kaynak temizliği) numarayla çalıştırır.
   */
  onDeleteSeasonNumber?: ((number: number) => void) | undefined;
  seasonNumber: number;
  existing: Existing[];
  /**
   * FİLM (tek parça) modu — katalog YEDEK ZİNCİRİNİ kapatır.
   *
   * ── NEDEN (ölçülen hata, 28.09.2026) ────────────────────────────────────────
   * Jujutsu Kaisen 0 (film, MAL 48561) kaydında panel **TV dizisinin 24 bölümünü**
   * listeliyordu: "Ryoumen Sukuna", "For Myself", "Girl of Steel" — bunlar MAL
   * **40748**'in (TV) bölümleri.
   *
   * MEKANİZMA: ani.zip filmde bölümü `sezon 0` altında veriyor; `seek()` hedef
   * sezonu (1) aradığı için kendi kaydında bulamıyor, kod İLGİLİ KAYITLARA (adım 2)
   * düşüyor; AniList filmi TV dizisiyle ilişkili gösterdiği için 40748 çekiliyor ve
   * 24 bölüm "filmin bölümleri" gibi dönüyor.
   *
   * Filmde bu yedek YANLIŞTIR: film tek parçadır ve kendi kaydı dışındaki hiçbir
   * bölüm ona ait değildir. Bu bayrak açıkken yalnızca KENDİ kataloğu kullanılır ve
   * sonuç TEK bölüme indirgenir.
   */
  singlePart?: boolean;
  /**
   * `true` = bu katalog kaydı sezonun DEVAMI (MAL'de "Part N").
   * Numaralar mevcut bölümlerin ardından sürer (11 varsa 12–23 olur) ve sezonun
   * kendi MAL kimliği DEĞİŞMEZ. Gerekçe: Mushoku Tensei 39535 → 45576 "Part 2".
   */
  partContinuation?: boolean;
  /**
   * HEDEF SEZONUN KENDİ MAL KİMLİĞİ (yeni sezon hedefleniyorsa `null`).
   *
   * Part kaydının numaralandırma çıpası budur: bu kaydın katalog uzunluğu
   * part'ın başlangıcını verir (Mushoku S1: 11 → Part 2 = 12–23) ve part'ın
   * kendi bölümleri yazıldıkça DEĞİŞMEZ → kayma olmaz.
   */
  seasonOwnMalId?: number | null;
  /**
   * SEZON LİSTESİ — panelde sezon değiştirmeyi mümkün kılar.
   *
   * Kullanıcı isteği (28.09.2026): "sadece sezon değişip bölümleri öyle
   * görebileceğim şeyi ayarlasan yeter." Panel İÇERİĞİ değişmedi; yalnızca
   * "Hedef: S1" etiketi, birden fazla sezon varsa SEÇİCİ olur.
   *
   * Boş bırakılırsa (tek sezonlu diziler/filmler) davranış eskisi gibidir:
   * sabit etiket.
   */
  seasons?: { number: number }[];
  /** Sezon değiştirildiğinde çağrılır; panel o sezonun bölümlerini yükler. */
  onSelectSeason?: ((seasonNumber: number) => void) | undefined;
  /**
   * puffytr'daki dizi slug'ı — Türkçe (Anizm) kaynağını çözerken kullanılır.
   * `puffySlugFor(showSlug)` ile üretilir (ölçülmüş farklar `lib/puffy.ts`te).
   */
  puffySlug: string;
  onDone: (message: string) => Promise<void>;
  /**
   * Katalog bulunamadığında çağrılır: üst panelin (SeasonsPanel) ELLE bölüm ekleme
   * formunu AÇIP öne çıkarması için. Kullanıcı şikâyeti: "yeni sezon/bölüm
   * ekleyemiyorum" — katalog 404 verince form gömülü kalmasın.
   */
  onManualAdd?: () => void;
  /**
   * CANLI DURUM BİLDİRİMİ — küçültülmüş hap için.
   *
   * `busy`/`progress` değiştiğinde üst bileşene `{ busy, done, total, fail }`
   * gönderilir. Üst bileşen aynı değerde yeniden çizmez (referans koruması
   * kendisinde). `undefined` ise hiçbir şey bildirilmez — bugünkü davranış.
   */
  onActivity?: ((activity: PanelActivity) => void) | undefined;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [problem, setProblem] = useState<string | null>(null);
  /** Hedef sezonun bölümleri (katalogdan; başka sezon karışmaz). */
  const [list, setList] = useState<CatalogEpisode[]>([]);
  /** Serinin kayıtlı MAL kimliği (bilgi amaçlı gösterilir). */
  const [showMalId, setShowMalId] = useState<number | null>(null);
  /**
   * HEDEF SEZONUN KENDİ MAL KİMLİĞİ — başlıkta gösterilen sayı budur.
   *
   * ── NEDEN (kullanıcı bildirimi, 28.09.2026) ────────────────────────────────
   * Başlıkta `showMalId` (SERİ seviyesi, tek değer) gösteriliyordu; sezon
   * değiştirildiğinde sayı DEĞİŞMİYORDU. Artık çözümleyicinin gerçekten kullandığı
   * kaydın kimliği gösterilir; her sezon yüklenişinde sıfırlanır ki eski sezonun
   * kimliği yanlışlıkla yeni sezonunmuş gibi görünmesin.
   */
  const [seasonMalId, setSeasonMalId] = useState<number | null>(null);
  /** Serinin KENDİ slug'ı (`re-zero`) — Türkçe bölüm adlarının adres merdiveni bunu ister. */
  const [showSlug, setShowSlug] = useState("");
  /**
   * İşaretli KAYNAK KUTULARI — sözlük, sağlayıcı kimliğiyle anahtarlanır.
   *
   * ÇOK SEÇİM (kullanıcı kararı, 27.09.2026): "birden fazla kaynak seçemiyorum;
   * hangilerini seçersem oynatıcının altında o kaynaklar çıksın." Eski tek seçim
   * kısıtı `show_episodes.watch_url`in tek kolon olmasındandı; artık kaynaklar ayrı
   * tabloya (`episode_sources`) satır satır yazıldığı için sınır yok.
   * VARSAYILAN: TÜM KAYNAKLAR SEÇİLİ (kullanıcı isteği, 29.09.2026).
   * "MAL id girip yeni sezon ekleyeceğim ya, bunlar varsayılan olarak öncelikli
   * seçili gelsin — tümü. Ben istemesem çıkarırım seçimden."
   *
   * Eskiden yalnızca Anizm açıktı; kullanıcı her seferinde TauVideo ve MegaPlay'i
   * elle işaretlemek zorunda kalıyordu. Liste `PICK_ORDER`'dan türetilir, yani
   * ileride bir kaynak eklenirse kendiliğinden seçili gelir.
   */
  const [picked, setPicked] = useState<Record<string, boolean>>(() =>
    PICK_ORDER.reduce<Record<string, boolean>>((acc, item) => {
      acc[item.id] = true;
      return acc;
    }, {}),
  );
  /** Yazma ilerlemesi (bölüm bölüm raporlanır). */
  const [progress, setProgress] = useState<{ done: number; total: number; fail: string[] } | null>(
    null,
  );
  /**
   * KOŞUNUN BAŞLANGIÇ ANI (ms) — canlı hız/geçen süre ölçümü için.
   * Yazma başlarken bir kez yazılır; `RunRate` buradan geçen süreyi hesaplar.
   */
  const [runStartedAt, setRunStartedAt] = useState(0);

  /**
   * BÖLÜM BÖLÜM YAZMA DURUMU — "hangi bölüm yazılıyor, hangisi bitti?"
   *
   * KULLANICI İSTEĞİ (28.09.2026): "1. bölümün yanında bir çubuk olsun, 0'dan yüze
   * dolsun; hangi bölüm yükleniyorsa belli olsun, yüklenince yanında yeşil 'yüklendi'
   * yazsın." Eskiden yalnızca düğmenin yanında "Kaynak yazıyor: 3/11" sayacı vardı;
   * listede HANGİ bölümün işlendiği görünmüyordu.
   *
   * Yüzde, bölümün KENDİ kaynakları üzerinden hesaplanır (3 kaynak seçiliyse
   * 33 → 66 → 100) — yani uydurma bir zamanlayıcı değil, GERÇEK ilerleme.
   */
  const [rowProgress, setRowProgress] = useState<
    Map<
      number,
      {
        pct: number;
        status: "writing" | "done" | "error";
        step?: string | undefined;
        /** Bir SONRAKİ gerçek kilometre taşı — yumuşak doldurma bunu AŞMAZ. */
        cap: number;
        /** Bu adımın başladığı an (ms) — doldurma hızı buradan hesaplanır. */
        at: number;
      }
    >
  >(new Map());

  /**
   * Tek bölümün çubuk durumunu yazar (fonksiyonel güncelleme → eşzamanlılık güvenli).
   *
   * `step` — O AN YAPILAN İŞİN ADI ("TauVideo", "bölüm kaydediliyor"…).
   *
   * ── NEDEN EKLENDİ (kullanıcı bildirimi, 28.09.2026) ─────────────────────────
   * "yükleniyor kısmı hep aynı sayıları gösteriyor … her şey gerçek hesaplansın,
   *  anlamlı ilerlesin, canlı şekilde ilerlesin istiyorum."
   *
   * ÖLÇÜLEN SEBEP: yüzde YALNIZCA kaynak çözümünü sayıyordu. Her bölüm aynı
   * kaynaklarla aynı adımları yaptığı için her satır birebir aynı diziyi
   * gösteriyordu (3 kaynak → 33 → 66 → 100). Daha kötüsü: kaynaklar bittikten
   * sonra yapılan İKİ veritabanı yazımı (bölüm satırı + kaynak satırları)
   * sayılmadığı için satır "yükleniyor 100%" yazıp DURUYORDU — iş bitmemişken.
   *
   * YENİ: yüzde gerçek adım sayısına bölünür (kaynak sayısı + 2) ve etikette o
   * anki adımın adı yazar. Böylece ilerleme hem canlı hem de gerçek.
   */
  const markRow = (
    number: number,
    pct: number,
    status: "writing" | "done" | "error",
    step?: string | undefined,
    cap?: number,
  ) => {
    setRowProgress((prev) =>
      new Map(prev).set(number, { pct, status, step, cap: cap ?? pct, at: Date.now() }),
    );
  };

  /**
   * BÖLÜM ARALIĞI — uzun seriler için PARÇA PARÇA yazma.
   *
   * Kullanıcı (28.09.2026): "çok fazla bölüm olanlar (One Piece falan) yükleyeceğim
   * zamanlar sıkıntı çıkmasın, düzen çekelim." 1000+ bölümü tek koşuda yazmak hem
   * saatler sürer hem sağlayıcıyı yorar (istek başına bekleme var). Aralık
   * verildiğinde yalnızca o bölümler işlenir; iki alan da boşsa TÜMÜ yazılır —
   * yani varsayılan davranış değişmedi.
   */
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  /**
   * SATIR SEÇİMİ — yalnızca seçilen bölümleri yaz.
   *
   * KULLANICI İSTEĞİ (28.09.2026): "mesela sadece 4. bölümün belli bir kaynağını
   * indireceğim, neden seçim yapmıyorum?" Bu, 27.09'daki TERS kararı değiştiriyor
   * (o gün "satır seçimi YOK, düğme sezonun tamamına uygular" denmişti çünkü panel
   * kalabalıklaşıyordu). Artık satırlar seçilebilir; HİÇBİR satır seçilmezse eski
   * davranış (aralık → tümü) aynen sürer, yani kimse zorlanmaz.
   */
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggleSelected = (number: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
  };

  /**
   * LİSTE SAYFALAMASI — uzun serilerde panelin kilitlenmemesi için.
   *
   * Kullanıcı (28.09.2026): "çok fazla bölüm olanlar (One Piece falan) yükleyeceğim
   * zamanlar sıkıntı çıkmasın."
   *
   * NEDEN ŞART: liste eskiden `list.map` ile TEK SEFERDE çiziliyordu; 1000+ bölümlü
   * bir seride binlerce DOM düğümü (her satırda tik kutusu + etiketler + rozetler)
   * oluşuyor ve panel donuyordu. Artık sayfa başına 50 satır çizilir.
   *
   * ÖNEMLİ: seçim ve aralık TÜM liste üzerinde çalışır (sayfayla sınırlı DEĞİL);
   * sayfalama yalnızca GÖRÜNÜRLÜĞÜ böler, yazma kapsamını değiştirmez — yani
   * 1. sayfadayken "tümünü seç" deyip yazmak 1100 bölümün tamamını kapsar.
   */
  const LIST_PAGE_SIZE = 50;
  const [page, setPage] = useState(0);

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * BÖLÜM ARAMA / ATLAMA (kullanıcı isteği, 28.09.2026)
   *
   * "İstersen arama kısmı da koy; One Piece örneğini verdin, kompakt minimal olsun."
   *
   * SORUN: uzun serilerde (One Piece 1100+ bölüm) belli bir bölüme ulaşmak için
   * 22 sayfa kaydırmak gerekiyordu — liste 50'lik parçalara bölünmüştü ama
   * "şu bölüme git" yolu yoktu.
   *
   * ÇÖZÜM: sayaç satırına sığan minik bir kutu. Numara yazıp Enter'a basınca
   * o bölümün SAYFASI açılır ve satır 2,5 saniye vurgulanır. Yeni bir liste
   * çizilmez, mevcut listenin içinde atlanır — panel içeriği değişmez.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  const [jump, setJump] = useState("");
  const [highlight, setHighlight] = useState<number | null>(null);

  function jumpToEpisode() {
    const target = Number.parseInt(jump, 10);
    if (!Number.isFinite(target)) return;
    const index = list.findIndex((ep) => ep.number === target);
    if (index < 0) {
      toast.error(`${target}. bölüm bu listede yok.`);
      return;
    }
    setPage(Math.floor(index / LIST_PAGE_SIZE));
    setHighlight(target);
    // Vurgu KISA SÜRELİ: kalıcı olsaydı hangi bölümün seçili olduğu karışırdı.
    window.setTimeout(() => setHighlight(null), 2500);
  }
  const pageCount = Math.max(1, Math.ceil(list.length / LIST_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageList = list.slice(
    safePage * LIST_PAGE_SIZE,
    safePage * LIST_PAGE_SIZE + LIST_PAGE_SIZE,
  );

  /**
   * YAZILACAK BÖLÜMLER: SEÇİM varsa seçim → yoksa ARALIK → o da yoksa TÜMÜ.
   * Hem düğme metni hem yazma döngüsü bu fonksiyonu kullanır, böylece ekranda
   * yazan sayı ile gerçekten işlenen bölüm sayısı asla ayrışmaz.
   */
  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * HÂLİHAZIRDA YÜKLÜ KAYNAKLAR — "tekrar yazmayı engelle" altyapısı.
   *
   * ── NEDEN (ölçülen olay, 28.09.2026) ────────────────────────────────────────
   * Kullanıcı Erased S1'de **12 bölümü üst üste 3 kez** yazdı; günlük her seferinde
   * "eklenen: 0 · güncellenen: 12" dedi. Yani hepsi zaten yüklüydü, panel bunu
   * ne söyledi ne engelledi. Kullanıcının cümlesi: "yüklü olan kaynakları/bölümleri
   * bir daha yüklemeyeyim … kaç defa bölümleri yüklüyorum."
   *
   * ── NASIL ÇALIŞIR ──────────────────────────────────────────────────────────
   * `existing` üzerinden sezonun bölüm KİMLİKLERİ alınır, tek sorguda
   * `episode_sources` okunur (bölüm başına ayrı istek YOK) ve
   * `bölüm numarası → {yüklü sağlayıcılar}` haritası kurulur.
   *
   * Sonra `targetList(wanted)` bu haritayı kullanarak **seçili kaynakların TAMAMI
   * zaten yüklü olan bölümleri listeden çıkarır**. Böylece düğme metni, ilerleme
   * çubuğu ve gerçek yazma döngüsü AYNI kümeyi görür — "ekranda 12 yazıyor ama
   * 0 yazıldı" tutarsızlığı oluşmaz.
   *
   * NOT: yalnızca KISMİ eksiklik varsa bölüm atlanmaz; eksik kaynak tamamlanır.
   * Kullanıcı hiçbir şeyi kaybetmez, yalnızca gereksiz yazmadan kurtulur.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  const [loadedByNumber, setLoadedByNumber] = useState<Map<number, Set<string>>>(new Map());
  useEffect(() => {
    const ids = existing.map((item) => item.id).filter((id): id is string => Boolean(id));
    if (ids.length === 0) {
      setLoadedByNumber(new Map());
      return;
    }
    let alive = true;
    void (async () => {
      try {
        // DÖNÜŞ BİÇİMİ: `Map<bölümKimliği, EpisodeSource[]>` — düz satır dizisi DEĞİL.
        const byEpisode = await fetchSourcesForEpisodes(ids);
        if (!alive) return;
        const numberById = new Map<string, number>();
        for (const item of existing) if (item.id) numberById.set(item.id, item.number);
        const next = new Map<number, Set<string>>();
        for (const [episodeId, rows] of byEpisode) {
          const number = numberById.get(episodeId);
          if (number === undefined) continue;
          const bucket = next.get(number) ?? new Set<string>();
          for (const row of rows) bucket.add(row.provider);
          next.set(number, bucket);
        }
        setLoadedByNumber(next);
      } catch {
        // Kapsama okunamazsa koruma DEVRE DIŞI kalır (panel yine çalışır) —
        // listeyi boşaltıp kullanıcıyı yanlışlıkla "hepsi yüklü" sanmaya itmeyiz.
        if (alive) setLoadedByNumber(new Map());
      }
    })();
    return () => {
      alive = false;
    };
  }, [existing]);

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * SAĞ TIK → EMBED AYARI (kullanıcı isteği, 28.09.2026)
   *
   * "embed için bölümün sütuna sağ tık yapıp öyle ayarlama seçeneği falan ona göre
   *  ayarla."
   *
   * Bölüm satırına sağ tıklanınca imlecin yanında küçük bir kutu açılır; o bölüme
   * **manuel embed adresi** girilir veya var olan kaldırılır. Panelin mevcut
   * listesi/içeriği DEĞİŞMEZ — yalnızca satıra yeni bir etkileşim eklenir.
   *
   * KAYIT MANTIĞI: o bölümün mevcut kaynakları okunur, YALNIZCA `manual` satırı
   * değiştirilir, diğer sağlayıcılar (anizm/animecix/megaplay) AYNEN korunur.
   * Yani embed girmek, yazılmış kaynakları ASLA silmez.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  const [rowMenu, setRowMenu] = useState<{ number: number; x: number; y: number } | null>(null);
  const [embedDraft, setEmbedDraft] = useState("");
  const [embedBusy, setEmbedBusy] = useState(false);

  /** Sağ tıklanan satırın veritabanındaki bölüm kimliği (yoksa null). */
  const menuEpisodeId =
    rowMenu === null ? null : (existing.find((item) => item.number === rowMenu.number)?.id ?? null);

  /**
   * BÖLÜMÜN YAZILMIŞ KAYNAKLARINI SİL (tek bölüm) — sağ tık menüsünden.
   *
   * Kullanıcı isteği (28.09.2026): "ben kaynağı nasıl silcem? yanlarda silme yeri
   * yok … silip tekrar yeni kaynaktan yüklemem gerekiyor."
   *
   * NE SİLİNİR: yalnızca `episode_sources` satırları (`replaceEpisodeSources(id, [])`
   * → mevcut tüm sağlayıcılar "eski" sayılır ve silinir; yerine hiçbir şey yazılmaz).
   * NE KALIR: bölüm kaydı (`show_episodes`) ve ADI — yani bölüm listede durur,
   * yalnızca kaynakları boşalır ve yeniden yazılabilir.
   *
   * Yıkıcı ve geri alınamaz → SİTEYE ÖZEL onay penceresi (`confirmAction`).
   * (Native `window.confirm` tamamen kaldırıldı — kullanıcı isteği, 29.09.2026.)
   */
  async function clearEpisodeSources() {
    if (!menuEpisodeId || embedBusy) return;
    const number = rowMenu?.number ?? 0;
    const ok = await confirmAction({
      title: `${number}. bölümün kaynakları silinsin mi?`,
      description:
        "Bölüm kaydı ve adı KALIR; yalnızca kaynaklar (Anizm/TauVideo/MegaPlay/manuel) " +
        "silinir ve sezonu yeniden yazabilirsin. Bu işlem geri alınamaz.",
      confirmLabel: "Kaynakları sil",
      tone: "danger",
    });
    if (!ok) return;
    setEmbedBusy(true);
    try {
      await replaceEpisodeSources(menuEpisodeId, []);
      devMark("bölüm kaynakları silindi", { bolum: number });
      toast.success(`${number}. bölümün kaynakları silindi.`);
      setRowMenu(null);
      await onDone(`${number}. bölümün kaynakları silindi — yeniden yazabilirsin.`);
    } catch (error) {
      toast.error(
        "Kaynaklar silinemedi: " + (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setEmbedBusy(false);
    }
  }

  /**
   * SEÇİLİ BÖLÜMLERİ TAMAMEN SİL — satır listesindeki çöp kutusu ikonu.
   *
   * Kullanıcı isteği (28.09.2026): "sadece sağ tık niye var ki? Tümünü seç
   * düğmesinin yanına silme ikonu ekleyemez misin?" Seçim zaten mevcut olduğu
   * için silme işlemi oraya bağlandı; sağ tık yalnızca TEK bölümü siliyordu.
   *
   * SIRA ÖNEMLİ: önce KAYNAKLAR, sonra bölüm satırları. `episode_sources` için
   * şemada `on delete cascade` GARANTİSİ yok (repoda `episode_sources` göçü yok),
   * bu yüzden yetim kaynak bırakmamak için kaynaklar açıkça temizlenir.
   *
   * Geri alınamaz → SİTEYE ÖZEL onay penceresi (`confirmAction`); native kutu YOK.
   */
  async function deleteSelectedEpisodes() {
    const numbers = [...selected];
    if (numbers.length === 0 || busy) return;
    const ok = await confirmAction({
      title: `Seçili ${numbers.length} bölüm tamamen silinsin mi?`,
      description:
        "Bölüm kayıtları, adları ve kaynakları silinir. Bölümler katalogda " +
        '"yeni" görünür ve aynı sezonu yeniden yazabilirsin. Bu işlem geri alınamaz.',
      confirmLabel: "Bölümleri sil",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    let removedSources = 0;
    try {
      // 1) KAYNAKLAR — yalnızca kimliği bilinen satırlar için.
      for (const item of existing) {
        if (!item.id || !selected.has(item.number)) continue;
        try {
          await replaceEpisodeSources(item.id, []);
          removedSources += 1;
        } catch {
          // Kaynak temizliği başarısızsa bölümü yine de sil: yetim kaynak kalırsa
          // da bölüm satırı olmadığı için görünmez, en azından iş tamamlanır.
        }
      }
      // 2) BÖLÜM SATIRLARI.
      const { error } = await db
        .from("show_episodes")
        .delete()
        .eq("show_id", showId)
        .eq("season", seasonNumber)
        .in("number", numbers);
      if (error) throw new Error(error.message);
      devMark("seçili bölümler silindi", {
        sezon: seasonNumber,
        bolum: numbers.length,
        kaynakTemizlenen: removedSources,
      });
      setSelected(new Set());
      await onDone(`S${seasonNumber}: ${numbers.length} bölüm silindi.`);
    } catch (error) {
      toast.error(
        "Bölümler silinemedi: " + (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * SEZONUN TÜM KAYNAKLARINI SİL (toplu) — "Gelişmiş" bölümünden.
   *
   * Kullanıcı isteği (28.09.2026): "bölümlerin veya toplu silme şeyim de yok."
   *
   * Sayfa sayfa değil, bölüm bölüm ilerler; her bölüm için tek istek atılır ve
   * hata olsa bile KALANLAR silinmeye devam eder (tek bir aksilik tüm işi
   * durdurmasın). Sonuç `onDone` ile bildirilir ve panel yeniden yüklenir.
   */
  async function clearSeasonSources() {
    if (busy || existing.length === 0) return;
    const ok = await confirmAction({
      title: `${seasonNumber}. sezonun kaynakları silinsin mi?`,
      description:
        `${existing.length} bölümün yazılmış tüm kaynakları silinir. Bölüm kayıtları ve ` +
        "adları KALIR; sezonu yeniden yazabilirsin. Bu işlem geri alınamaz.",
      confirmLabel: "Kaynakları sil",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    let done = 0;
    const failures: string[] = [];
    try {
      for (const item of existing) {
        // `id` tipi `string | undefined` — kimliksiz satır atlanır, yanlış kayda
        // kaynak silme riski alınmaz (başarısız sayılır ve raporda görünür).
        if (!item.id) {
          failures.push(String(item.number));
          continue;
        }
        try {
          await replaceEpisodeSources(item.id, []);
          done += 1;
        } catch {
          failures.push(String(item.number));
        }
      }
      devMark("sezon kaynakları silindi", { sezon: seasonNumber, bolum: done });
      await onDone(
        `S${seasonNumber}: ${done} bölümün kaynakları silindi` +
          (failures.length > 0
            ? ` · ${failures.length} başarısız (${failures.slice(0, 5).join(", ")})`
            : "") +
          ".",
      );
    } catch (error) {
      await onDone(
        `Kaynaklar silinemedi: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  /** Sağ tık: menüyü aç ve o bölümün MEVCUT embed adresini kutuya doldur. */
  async function openRowMenu(number: number, x: number, y: number) {
    setRowMenu({ number, x, y });
    setEmbedDraft("");
    const id = existing.find((item) => item.number === number)?.id;
    if (!id) return;
    try {
      const byEpisode = await fetchSourcesForEpisodes([id]);
      const manual = (byEpisode.get(id) ?? []).find((row) => row.provider === MANUAL_ID);
      if (manual?.url) setEmbedDraft(manual.url);
    } catch {
      // Okunamazsa kutu boş kalır; kaydetme yine çalışır (diğer kaynaklar korunur).
    }
  }

  /** Embed'i kaydet (boş bırakılırsa yalnızca manuel satırı kaldırır). */
  async function saveEmbed() {
    if (!menuEpisodeId || embedBusy) return;
    setEmbedBusy(true);
    try {
      const current = (await fetchSourcesForEpisodes([menuEpisodeId])).get(menuEpisodeId) ?? [];
      // Diğer sağlayıcılar AYNEN korunur — yalnızca `manual` satırı yenilenir.
      const rows: EpisodeSourceInput[] = current
        .filter((row) => row.provider !== MANUAL_ID)
        .map((row) => ({
          provider: row.provider,
          language: row.language,
          label: row.label,
          url: row.url,
          sort_order: row.sort_order,
        }));
      const value = embedDraft.trim();
      if (value) {
        rows.push({
          provider: MANUAL_ID,
          language: "tr",
          label: "Manuel",
          url: value,
          sort_order: 90,
        });
      }
      await replaceEpisodeSources(menuEpisodeId, rows);
      devMark("manuel embed kaydedildi", {
        bolum: rowMenu?.number ?? 0,
        adres: value.slice(0, 90),
      });
      toast.success(value ? "Embed kaydedildi." : "Embed kaldırıldı.");
      setRowMenu(null);
      await onDone(value ? "Manuel embed kaydedildi." : "Manuel embed kaldırıldı.");
    } catch (error) {
      toast.error(
        "Embed kaydedilemedi: " + (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setEmbedBusy(false);
    }
  }

  /** Seçili kaynakların TAMAMI hâlihazırda yüklü olan bölüm numaraları. */
  const fullyLoadedNumbers = (wanted: PickItem[]): Set<number> => {
    const out = new Set<number>();
    if (loadedByNumber.size === 0 || wanted.length === 0) return out;
    for (const [number, providers] of loadedByNumber) {
      if (wanted.every((item) => providers.has(item.id))) out.add(number);
    }
    return out;
  };

  const baseTargets = (): CatalogEpisode[] =>
    selected.size > 0 ? list.filter((ep) => selected.has(ep.number)) : rangedList(list);

  const targetList = (wanted?: PickItem[]): CatalogEpisode[] => {
    const base = baseTargets();
    if (!wanted || wanted.length === 0) return base;
    const done = fullyLoadedNumbers(wanted);
    return base.filter((ep) => !done.has(ep.number));
  };

  /** Aralık uygulanmış hedef liste (boş alan = sınır yok). */
  const rangedList = (items: CatalogEpisode[]): CatalogEpisode[] => {
    const lo = Number.parseInt(rangeFrom, 10);
    const hi = Number.parseInt(rangeTo, 10);
    if (!Number.isFinite(lo) && !Number.isFinite(hi)) return items;
    return items.filter(
      (ep) =>
        ep.number >= (Number.isFinite(lo) ? lo : Number.NEGATIVE_INFINITY) &&
        ep.number <= (Number.isFinite(hi) ? hi : Number.POSITIVE_INFINITY),
    );
  };
  const [busy, setBusy] = useState(false);
  /**
   * CANLI DURUM ÇIKIŞI — küçültülmüş hap beslenir.
   * `busy`/`progress` her değiştiğinde üst bileşene bildirilir; üst bileşen
   * aynı değerde yeniden çizmez (referans koruması kendisinde).
   */
  useEffect(() => {
    onActivity?.({
      busy,
      done: progress?.done ?? 0,
      total: progress?.total ?? 0,
      fail: progress?.fail.length ?? 0,
    });
  }, [busy, progress, onActivity]);

  // NOT: Yumuşak ilerleme saati ARTIK BURADA DEĞİL — `RowProgress` bileşeninin
  // içinde. Gerekçe o bileşenin başında yazılı (kullanıcı bildirimi, 29.09.2026:
  // "katalog panelinin içi akıcı olsun" → panel seviyesindeki 150 ms tiki tüm
  // listeyi yeniden çiziyordu).
  /**
   * Çalışan yükleme sayacı — yalnızca SON yüklemenin sonucu ekrana yazılır.
   * (StrictMode'un çift effect'i ya da arka arkaya "yenile" tıklamaları eski
   * yanıtla yeni listeyi ezmesin.)
   */
  const runRef = useRef(0);
  /**
   * `onManualAdd` bir REF üzerinden tutulur.
   *
   * NEDEN REF: `load` geri çağrısı bu işlevi hata anında çağırır. Prop doğrudan
   * kullanılsa, üst panel her render'da yeni bir fonksiyon gönderdiği için `load`
   * kimliği değişir, `useEffect([load])` yeniden tetiklenir ve istek döngüsüne
   * girilirdi. Ref ile kimlik SABİT kalır.
   */
  const manualAddRef = useRef(onManualAdd);
  useEffect(() => {
    manualAddRef.current = onManualAdd;
  }, [onManualAdd]);
  /**
   * Bu sezonun puffytr dizi adresi.
   *
   * ÖLÇÜM (26.09.2026): puffytr HER SEZONU AYRI sayfada tutuyor —
   * `puffytr.com/jujutsu-kaisen` 24 bölüm (1. sezon),
   * `puffytr.com/jujutsu-kaisen-2nd-season` 23 bölüm (2. sezon) ✔ birebir eşleşti.
   * Bu yüzden 2. sezon için aynı adrese bölüm numarası yazmak YANLIŞ bölümü verir;
   * doğru yol sezon ekini taşıyan adrestir (sayfa içinde numaralar 1'den başlar).
   * Varsayılan: `puffySlugForSeason(puffySlug, seasonNumber)` — yanlışsa düzeltilir.
   */
  const [puffyInput, setPuffyInput] = useState(() => puffySlugForSeason(puffySlug, seasonNumber));
  /** Adres kontrolünün sonucu ("✓ bulundu" ya da sebep). */
  const [puffyProbe, setPuffyProbe] = useState<string | null>(null);
  /**
   * KAYNAĞIN bölüm sayısı (puffytr) — "Kontrol et" sonucunda doldurulur.
   * `null` = henüz sorulmadı ya da kaynak okunamadı. Bu sayı bizim katalogdan
   * BÜYÜKSE eksik bölüm var demektir (bkz. `missingNumbers`).
   */
  const [puffySource, setPuffySource] = useState<number | null>(null);
  /** Eksik bölümleri yazarken düğme kilitlenir (çift tıklama = çift INSERT olmasın). */
  const [gapBusy, setGapBusy] = useState(false);
  /**
   * KALICI "yazılamayan kaynaklar" raporu.
   *
   * NEDEN KALICI (toast DEĞİL): toast 4-5 saniyede kaybolur; kullanıcı "Anizm
   * eklenmedi" sorusunu çoğu zaman sonradan soruyor. Rapor bu yüzden panelde
   * DURUR ve bir sonraki yazmaya kadar silinmez.
   */
  const [unresolved, setUnresolved] = useState<string[]>([]);
  /**
   * YÜKLEME KAYDI — son koşunun bölüm→kaynak kırılımı (kullanıcı isteği: "hangi
   * bölümlerin/kaynakların başarılı, hangilerinin başarısız olduğunu panelde liste
   * olarak göster ki nerede tıkandığını görebileyim"). Toast kaybolur, bu liste KALIR.
   */
  const [runLog, setRunLog] = useState<ImportLogEntry[]>([]);
  /** Hata olmayan bilgi satırları (ör. kullanılan puffytr adresi otomatik düzeltildi). */
  const [notes, setNotes] = useState<string[]>([]);
  /**
   * "Gelişmiş" bölümü açık mı — VARSAYILAN KAPALI.
   *
   * Kullanıcı isteği (27.09.2026): panel kalabalık. Kaynak tikleri dışındaki her denetim
   * (puffytr adresi, adres kontrolü, animecix eşlemesi) bu başlığın altına taşındı;
   * hiçbiri SİLİNMEDİ, açıldığında eskisi gibi çalışır.
   */
  const [advanced, setAdvanced] = useState(false);

  /**
   * ANIMECIX eşlemesi — kullanıcı kararı: SESSİZ otomatik eşleme.
   *
   * Kimlik bir kez `shows.animecix_id` kolonunda saklanır; kolon boşsa panel seri
   * adıyla TEK arama yapıp en iyi kaydı KODDA seçer. NEDEN: arama listesini kullanıcıya
   * seçtirmek paneli kalabalıklaştırıyordu, ama ada körlemesine güvenmek de yanlış
   * seriye bağlıyordu ("mushoku tensei"nin ilk sonucu SPECIALS kaydıydı — ölçüm).
   * Kullanıcı yalnızca gerekirse "Değiştir" ile numarayı elle yazar.
   */
  const [animecixId, setAnimecixId] = useState<number | null>(null);
  /** Serinin başlığı — otomatik animecix eşlemesinin arama terimi. */
  const [showTitle, setShowTitle] = useState("");
  /** "Değiştir" açıldı mı: numarayı elle girebileceği küçük kutu görünür. */
  const [animecixEdit, setAnimecixEdit] = useState(false);
  /** Elle girilen animecix dizi numarası. */
  const [animecixInput, setAnimecixInput] = useState("");
  /** Eşleme durum satırı (kolon yok / eşleşme bulunamadı gibi durumlarda dolu). */
  const [animecixNote, setAnimecixNote] = useState<string | null>(null);
  const [animecixBusy, setAnimecixBusy] = useState(false);

  /**
   * puffytr adresini SUNUCUDA dener ve SEZON BAŞINA BİR KEZ çözer.
   *
   * NEDEN `number` YOK: yalnızca adresin geçerliliği denetlenir (dizi sayfası 200 +
   * bölüm linkleri). Adres burada bir kez doğrulanır, tüm sezon onunla yazılır;
   * aksi hâlde 26 bölüm için 26 kez aday denemesi yapılırdı.
   *
   * NEDEN `base` + `season` GÖNDERİLİR: sunucu, sezon adlandırması tutmadığında
   * aday adresleri sırayla dener (`lib/puffy.ts`). Re:Zero 2. sezonunda üretilen
   * `…-2nd-season` adresi puffytr'da YOK (302 → /notfound); eski kod bu yüzden
   * Anizm'i sessizce atlıyordu.
   *
   * @returns `{ slug, note }` — `slug` kullanılabilir adres (yoksa ""), `note` ekranda
   *          ve raporda AYNEN gösterilecek sebep/özet metni. Sebep döndürülür (state
   *          okunmaz): `writeSelected` aynı render'ın state'ini okuyacağı için taze
   *          değeri göremezdi.
   */
  async function resolvePuffy(): Promise<{ slug: string; note: string }> {
    if (!puffyInput.trim()) {
      const note = "puffytr adresi boş — Gelişmiş bölümündeki kutuya yaz.";
      setPuffyProbe(note);
      return { slug: "", note };
    }
    setPuffyProbe("kontrol ediliyor…");
    try {
      const params = new URLSearchParams({
        puffy: puffyInput,
        base: puffySlug,
        season: String(seasonNumber),
        /**
         * KALICI ÇÖZÜM İÇİN EK BİLGİ (kullanıcı "her seferinde adres yapıştırmak
         * zorunda mıyım?" dedi): kalıp adresler tutmazsa sunucu ağın KENDİ dizininden
         * arar ve bu arama için üç ipucu kullanır —
         *   `show`  : bizim slug'ımız (adres ailesi; ör. `mushoku-tensei` → `…-iii-…`),
         *   `title` : bizim başlığımız (ad eşleşmesi),
         *   `mal`   : MAL kimliği → AniList'ten romaji/eşanlamlı adlar (ağ romaji
         *             adlandırıyor; bizim başlık İngilizce olabilir).
         * Üçü de opsiyoneldir; verilmezse yalnızca kalıp adresler denenir.
         */
        show: showSlug,
        title: showTitle,
        mal: showMalId ? String(showMalId) : "",
      });
      const res = await fetch(`/api/anizm?${params.toString()}`);
      const json = (await res.json()) as {
        ok?: boolean;
        slug?: string;
        server?: string;
        reason?: string;
        tried?: string[];
      };
      const used = json.ok ? (json.slug ?? puffyInput) : "";
      if (used) {
        /**
         * `server` alanı KAYNAĞIN bölüm sayısıdır (puffytr dizi sayfasındaki bölüm linki
         * sayısı) — bizim sezonumuzun değil. İki sayı FARKLI kaynaktan geldiği için
         * tutmayabilir (canlı örnek: puffytr 26 ↔ bizim sezon 25) ve etiket bunu
         * söylemezse "hangisi doğru, 26 mı 25 mi?" sorusu havada kalıyordu
         * (kullanıcı, 27.09.2026). Artık kaynak sayısı ile BİZİM bölüm sayımız ayrı yazılır.
         */
        const sourcePart = json.server ? `kaynakta ${json.server}` : "bölüm listesi okundu";
        const minePart = list.length > 0 ? ` · bizim sezonda ${list.length} bölüm` : "";
        /**
         * EKSİK BÖLÜM UYARISI — katalog gerçekten geride kalabiliyor.
         *
         * ── ÖLÇÜM (28.09.2026) ──────────────────────────────────────────────────
         * Mushoku Tensei S3: Türkçe kaynakta (puffytr) **14** bölüm var, katalogumuzda
         * **12**. Re:Zero S1: kaynakta **26**, bizde **25**. Sebep: katalog `ani.zip`ten
         * geliyor ve o kayıt bu seride eksik/bayat (`ani.zip` 0 bölüm, AniList 11
         * döndü — ikisi de gerçeğin ALTINDA). Yani "kaç bölüm var" sorusunun en
         * güvenilir cevabı YAYINLAYAN kaynaktan geliyor.
         *
         * Bu yüzden "Kontrol et" sonucu bizim sayımızla karşılaştırılıp fark
         * kullanıcıya AÇIKÇA gösterilir; eskiden yalnızca iki sayı yan yana yazılıyordu
         * ve fark gözden kaçıyordu (kullanıcı: "bizimki 12 bölüm bulmuş, eksik var mı?").
         */
        const sourceCount = json.server ? Number.parseInt(json.server, 10) : Number.NaN;
        setPuffySource(Number.isFinite(sourceCount) && sourceCount > 0 ? sourceCount : null);
        const note =
          used === puffyInput
            ? `✓ bulundu — ${sourcePart}${minePart}`
            : `✓ bulundu (kullanılan adres: ${used}) — ${sourcePart}${minePart}`;
        setPuffyProbe(note);
        return { slug: used, note };
      }
      const tried = json.tried?.length ? ` [denenen adresler: ${json.tried.join(", ")}]` : "";
      const note = `bulunamadı — ${json.reason ?? "sebep yok"}${tried}`;
      setPuffyProbe(note);
      return { slug: "", note };
    } catch (err) {
      const note = `kontrol edilemedi — ${err instanceof Error ? err.message : String(err)}`;
      setPuffyProbe(note);
      return { slug: "", note };
    }
  }

  /**
   * Kayıtlı bölümler: `numara → başlık` — HEDEF sezonun kayıtları.
   *
   * Hedef sezon esas alınır, çünkü yazma her zaman hedef sezona yapılır; "zaten
   * kayıtlı" bilgisinin de ona göre olması gerekir (INSERT mi UPDATE mi kararı).
   */
  const taken = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of existing) {
      if (row.season === seasonNumber) map.set(row.number, (row.title ?? "").trim());
    }
    return map;
  }, [existing, seasonNumber]);

  /**
   * PART DEVAMI İÇİN GÜNCEL DEĞERLER — REF OLARAK.
   * `taken` her yazımdan sonra değişir; bağımlılığa konsaydı katalog her yazımda
   * yeniden çekilirdi (ağ + liste sıfırlama).
   */
  const takenRef = useRef(taken);
  takenRef.current = taken;
  const puffySourceRef = useRef(puffySource);
  puffySourceRef.current = puffySource;

  /** PART DEVAMI İÇİN NUMARA KAYDIRMASI — 0 = normal davranış. */
  const [partOffset, setPartOffset] = useState(0);
  /**
   * Kaydırma YAZILMIŞ part'tan mı sabitlendi? (Yalnızca bilgi satırını netleştirir:
   * "yazılmış part'tan: 11" ↔ "mevcut son bölümden: 11".)
   */
  const [partOffsetFromWritten, setPartOffsetFromWritten] = useState(false);

  /**
   * EKSİK BÖLÜM NUMARALARI — kaynak (puffytr) bizden fazla bölüm yayınlıyorsa
   * aradaki numaralar.
   *
   * ── NEDEN GEREKLİ (kullanıcı, 28.09.2026) ──────────────────────────────────
   * "Mushoku Tensei S3'te AnimeciX'te 14. bölümü izliyorum ama bizimki 12 bölüm
   * bulmuş." Ölçüm doğruladı: kaynakta **14**, katalogda **12** (ani.zip bu seride
   * eksik; AniList 11 diyor — ikisi de gerçeğin altında). Re:Zero S1: kaynakta 26,
   * bizde 25. Yani katalog verisi geride kalabiliyor ve o bölümler siteye HİÇ
   * düşmüyordu; panelde elle tek tek eklemek gerekiyordu.
   *
   * ── NUMARALANDIRMA ────────────────────────────────────────────────────────
   * Taban, sezonun EN KÜÇÜK numarasıdır (`seasonMin`), 1 DEĞİL: katalog bazı
   * sezonları 1'den başlatmıyor (Re:Zero 2. sezon 12…23 idi). Beklenen aralık
   * `taban … taban + kaynakSayısı - 1`; kayıtlı olmayanlar "eksik" sayılır.
   *
   * ⚠️ Sınır: kaynak sayısı ÖZEL bölümleri (OVA/recap) da sayıyorsa fazladan boş
   * satır oluşabilir. Bu yüzden düğme kaç satır ekleyeceğini ÖNCE yazar ve
   * oluşan satırlar boştur — kaynak yazılmadan siteye "hazır" görünmez.
   */
  const missingNumbers = useMemo(() => {
    if (puffySource === null) return [] as number[];
    const numbers = [
      ...taken.keys(),
      ...list.map((ep) => ep.number).filter((n) => Number.isFinite(n) && n > 0),
    ].filter((n) => n > 0);
    if (numbers.length === 0) return [] as number[];
    const base = Math.min(...numbers);
    const out: number[] = [];
    for (let n = base; n <= base + puffySource - 1; n += 1) {
      if (!taken.has(n)) out.push(n);
    }
    return out;
  }, [puffySource, taken, list]);

  // "ADLARI İNGİLİZCE'YE ÇEVİR" ÖZELLİĞİ TAMAMEN KALDIRILDI.
  // (kullanıcı, 28.09.2026: "adları ingilizce çevir şeyi tamamen gereksiz özellik,
  //  onu sil yok et kalıntısız.")
  // Kaldırılanlar: `retitleBusy` durumu, `retitleTargets` listesi,
  // `retitleFromCatalog()` işlevi, düğme ve "N başlık zayıf" sayacı.
  //
  // KORUNAN: yazma sırasındaki otomatik başlık düzeltmesi (`writeEpisodeRow`
  // içindeki `retitle`). O, ayrı bir "özellik" değil; yazılan kaydın adının
  // katalogun ORİJİNAL adı olmasını sağlayan mekanizmadır ve kullanıcının
  // "site tamamen İngilizce olacak" kuralını yürürlükte tutar.

  /** Eksik bölüm satırlarını BOŞ olarak oluşturur (başlık/adres sonra doldurulur). */
  async function addMissingEpisodes() {
    if (missingNumbers.length === 0 || gapBusy) return;
    setGapBusy(true);
    try {
      const rows = missingNumbers.map((number) => ({
        show_id: showId,
        season: seasonNumber,
        number,
        // Boş başlık: site kendi yedek etiketini gösterir ("N. Bölüm"). Başlık/adres
        // katalog ya da kaynak yazımıyla sonradan dolar — uydurma ad yazılmaz.
        title: "",
        watch_url: "",
      }));
      const CHUNK = 100;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await db.from("show_episodes").insert(rows.slice(i, i + CHUNK));
        if (error) throw error;
      }
      setPuffySource(null);
      await onDone(
        `S${seasonNumber}: ${missingNumbers.length} eksik bölüm eklendi ` +
          `(${missingNumbers.join(", ")}). Kaynaklarını yazmak için «Bölümleri elle ekle» ` +
          `yerine oynatıcıdaki kaynak seçimini kullanabilirsin.`,
      );
    } catch (err) {
      // Yarım yazımı gizleme: hangi numaraların yazılamadığı anlaşılsın.
      await onDone(
        `Eksik bölümler eklenemedi: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setGapBusy(false);
    }
  }

  /**
   * SEZONUN EN KÜÇÜK BÖLÜM NUMARASI — Anizm çözümlemesine `min` olarak gönderilir.
   *
   * NEDEN: katalogdaki numaralandırma her zaman 1'den başlamaz (Re:Zero 2. sezonda
   * 12…23 idi) ama puffytr sezonu her zaman 1'den numaralandırır. Sunucu, `min`
   * sayesinde SEZONA GÖRE numarayı (12…23 → 1…12) ve ham numarayı aday olarak
   * sırayla dener; böylece numara kayması çözümü sessizce bozamaz. 1 tabanlı
   * sezonlarda `min = 1` olduğu için davranış birebir aynı kalır.
   */
  const seasonMin = useMemo(() => {
    const numbers = list.map((ep) => ep.number).filter((n) => Number.isFinite(n) && n > 0);
    return numbers.length > 0 ? Math.min(...numbers) : 1;
  }, [list]);

  /**
   * Serinin kayıtlı künyesini okur: MAL kimliği, başlık ve animecix kimliği.
   *
   * ⚠️ `animecix_id` kolonu henüz eklenmemiş olabilir (migration kullanıcı
   * tarafından çalıştırılır). Kolon yoksa sorgu HATA verir ve panelin tamamı
   * çökerdi; bu yüzden kolonsuz sorguya düşülür: kimlik `null` kalır, panel
   * çalışmaya devam eder ve "Kaydet" denendiğinde anlaşılır bir uyarı çıkar.
   */
  const readShowMeta = useCallback(async () => {
    const full = await db
      .from("shows")
      .select("mal_id, title, animecix_id, slug")
      .eq("id", showId)
      .single();

    let row: {
      mal_id?: number | null;
      title?: string | null;
      animecix_id?: number | null;
      slug?: string | null;
    };
    if (full.error) {
      const basic = await db.from("shows").select("mal_id, title, slug").eq("id", showId).single();
      if (basic.error) throw new Error(basic.error.message);
      row = (basic.data ?? {}) as typeof row;
    } else {
      row = (full.data ?? {}) as typeof row;
    }

    const mal = Number(row.mal_id ?? 0);
    const animecix = Number(row.animecix_id ?? 0);
    return {
      malId: Number.isFinite(mal) && mal > 0 ? mal : null,
      title: (row.title ?? "").trim(),
      animecixId: Number.isFinite(animecix) && animecix > 0 ? animecix : null,
      /**
       * `slug`: serinin KENDİ adresi (`re-zero` gibi). NEDEN BURADA OKUNUYOR:
       * Türkçe bölüm adları kaynağın adresini bizim slug'dan türetiyor
       * (`routes/api.tr-titles.ts`). `puffySlug` prop'u puffytr eşlemesi taşıdığı
       * için bizim slug'ı YERİNE KOYAMAZ; kolon zaten var, ek sorgu gerekmez.
       */
      slug: (row.slug ?? "").trim(),
    };
  }, [showId]);

  /**
   * Hedef sezonun zincirdeki ORDİNAL basamağını (0 tabanlı) verir.
   *
   * NEDEN: devam sezonlarında birebir "sezon numarası" eşleşmesi kırılır — bizim
   * S3'ümüz, zincirdeki 3. halkaya karşılık gelir. Basamak serinin KENDİ sezon
   * sırasından (`show_seasons`, `number`a göre) türetilir ki numaralandırmada boşluk
   * olsa bile eşleme kaymasın; sezon listesi okunamazsa 1 tabanlı varsayıma düşülür.
   */
  const resolveOrdinal = useCallback(async (): Promise<number> => {
    try {
      const { data } = await db
        .from("show_seasons")
        .select("number")
        .eq("show_id", showId)
        .order("number", { ascending: true });
      const numbers = ((data ?? []) as { number: number }[])
        .map((row) => row.number)
        .filter((value) => value > 0);
      const index = numbers.indexOf(seasonNumber);
      if (index >= 0) return index;
    } catch {
      // Sezon listesi okunamadı: varsayılana düşülür, eşleme yine denenir.
    }
    return Math.max(0, seasonNumber - 1);
  }, [showId, seasonNumber]);

  /**
   * Hedef sezonun bölüm listesini SESSİZCE bulur (kullanıcıya hiçbir şey sorulmaz).
   *
   * Kullanıcı kararı (27.09.2026): paneldeki "Diğer kayıtlar" listesi ve MAL
   * kimliği kutusu kalabalık yapıyordu — "kendisi bulsun" dedi. Devam sezonu ayrı
   * bir MAL kaydıdır ve serinin ilişkilerinde bağlıdır; bu yüzden sırayla:
   *   1) serinin KENDİ kataloğu (hedef sezon buradaysa biter),
   *   2) ilişkili kayıtlar — hedef sezonu içeren İLK kayıt kullanılır,
   *   3) ORDİNAL eşleme — birebir numara tutmadıysa zincir SIRAYLA yürünür.
   * Hiçbiri uymazsa `null` döner ve panel sade bir "bulunamadı" hatası gösterir.
   *
   * @param isCurrent sayaç kontrolü: eski yanıt yeni liste gelmişken yazılmasın
   */
  const findSeasonEpisodes = useCallback(
    async (malId: number, isCurrent: () => boolean): Promise<CatalogLookup> => {
      /**
       * Denenen her MAL kimliğinin sonucu burada birikir. NEDEN: panel "kayıt yok"
       * (404) ile "geçici ağ hatası"nı ayırt edip denenen kimlikleri kullanıcıya
       * göstermek zorunda (kullanıcı şikâyeti: "yeni sezon/bölüm ekleyemiyorum").
       */
      const attempts: CatalogAttempt[] = [];

      /**
       * Bir MAL kimliğinin kataloğunu çeker ve sonucu `attempts`e YAZAR.
       * Ağ hatası (`status: 0`) ile HTTP 404 (`status: 404`) burada ayrışır;
       * hiçbir hata yutmadan "sessizce bulunamadı"ya dönüşmez.
       */
      async function attempt(id: number): Promise<CatalogEpisode[] | null> {
        try {
          const catalog = await fetchCatalogEpisodes(id);
          attempts.push({ malId: id, ok: true, status: 200 });
          return catalog;
        } catch (err) {
          attempts.push({
            malId: id,
            ok: false,
            status: err instanceof CatalogHttpError ? err.status : 0,
          });
          return null;
        }
      }

      /** Katalogdan hedef sezonu seçer; `singleIsTarget` ise tek sezonluk katalog da kabul. */
      const seek = (catalog: CatalogEpisode[], singleIsTarget: boolean) => {
        const exact = catalog.filter((ep) => ep.season === seasonNumber);
        if (exact.length > 0) return exact;
        if (singleIsTarget && catalog.length > 0 && catalogSeasons(catalog).length === 1) {
          return catalog;
        }
        return null;
      };

      /**
       * ÖZEL / ÖN BÖLÜMLER — kataloğun `season: 0` kayıtları.
       *
       * NEDEN AYRI: ani.zip özel bölümleri (ör. Mushoku S2 "Guardian Fitz") `sezon 0`
       * altında verir; `seek()` yalnızca hedef sezonu süzdüğü için bunlar hiç
       * görünmüyordu. Kullanıcı isteği: "S2'de 0. bölüm olarak görünsün". Bunlar ana
       * listeye KARIŞTIRILMAZ (numaralandırma/kaydırma kaymasın), ayrı taşınır ve
       * panelde `0. Bölüm` olarak en başta gösterilir.
       */
      const specialsOf = (list: CatalogEpisode[]): CatalogEpisode[] =>
        list.filter((ep) => ep.season === 0);

      // 1) KENDİ kayıt: burada tek sezonluk katalog "hedef" SAYILMAZ. Ölçülmüş hata
      //    buydu: Re:Zero S2 açılırken MAL 31240 kataloğu yalnızca S1 içeriyor ve
      //    panel S1'in 25 bölümünü S2'ye yazacak gibi listeliyordu.
      const own = await attempt(malId);
      if (!isCurrent()) return { ok: false, attempts };

      /**
       * PART DEVAMI + KENDİ KAYIT 404: ilişkili kayıtlara DÜŞME.
       *
       * Ölçüm (65077, S3 Part 2): part'ın kendi kataloğu upstream'de YOK
       * (ani.zip 404; AniList NOT_YET_RELEASED). Düşülürse ilişkili kayıtlardan
       * S3 Part 1'in bölümleri dönüp "part'ın bölümleri" gibi listeleniyor.
       * Dürüst sonuç `ok: false` + denenen kimliklerdir → panel "katalog kaydı
       * YOK" mesajını gösterir, başka sezonun bölümleri KARIŞMAZ.
       * Normal akış (kendi kayıt 200) ve filmsi akış etkilenmez.
       */
      const ownMissing = attempts.some((a) => a.malId === malId && !a.ok && a.status === 404);
      if (partContinuation && ownMissing) return { ok: false, attempts };

      /**
       * FİLM (TEK PARÇA): YALNIZCA KENDİ KAYDI — ve sonuç TEK bölüm.
       *
       * Filmde ani.zip bölümü `sezon 0` altında verir, bu yüzden aşağıdaki `seek()`
       * hedef sezonu bulamaz ve kod ilgili kayıtlara düşerdi. AniList filmi TV
       * dizisiyle ilişkilendirdiği için o yoldan **24 bölüm** dönüyordu (ölçüm:
       * MAL 48561 → ekranda MAL 40748'in "Ryoumen Sukuna" vb. bölümleri).
       *
       * Filmde doğru davranış: kendi kaydındaki ilk anlamlı kaydı AL, sezon/bölüm
       * numarasını sezonun hedefine (1. bölüm) sabitle ve DUR. Yedek zinciri
       * çalıştırılmaz — film tek parçadır, başka kaydın bölümleri ona ait değildir.
       */
      if (singlePart) {
        const candidates = own ?? [];
        const first = candidates.find((ep) => ep.title || ep.image) ?? candidates[0];
        if (!first) return { ok: false, attempts };
        return {
          ok: true,
          // Film kendi kaydından okunur → kimlik zaten serinin kimliğidir.
          episodes: [{ ...first, season: seasonNumber, number: 1 }],
          malId,
          // Film tek parçadır: ayrı "0. bölüm" YOK (kendi kaydı zaten tek bölüm).
          specials: [],
        };
      }

      if (own) {
        const ownHit = seek(own, false);
        // Serinin KENDİ kaydı kullanıldı (tipik olarak 1. sezon) → kimlik serinin kimliği.
        if (ownHit) return { ok: true, episodes: ownHit, malId, specials: specialsOf(own) };
      }

      // 2) İLİŞKİLİ kayıtlar (devam sezonu, film, yan hikâye…). Sıra AniList'ten
      //    gelir: DEVAM (SEQUEL) önce. Bu yüzden ilk uyan kayıt doğru sezonun
      //    kaydı olur ve kullanıcı liste arasında seçim yapmak zorunda kalmaz.
      let records: RelatedRecord[] = [];
      try {
        records = await fetchRelatedRecords(malId);
      } catch {
        // AniList düşerse panel çökmez: aşağıdaki döngü boş kalır ve sonuç "bulunamadı".
        records = [];
      }
      if (!isCurrent()) return { ok: false, attempts };

      for (const record of records) {
        if (!isCurrent()) return { ok: false, attempts };
        if (record.malId === malId) continue;
        const catalog = await attempt(record.malId);
        if (!catalog) continue; // tek kaydın hatası aramayı bitirmez (log'da kalır)
        // DEVAM (SEQUEL) kaydının kendi kataloğu genelde TEK sezonluktur (her sezon
        // ayrı MAL kaydıdır, ani.zip bölümleri o kayıt altında S1 olarak verir) ve o
        // sezon hedef sezonun ta kendisidir → burada tek sezonluk katalog kabul edilir.
        const hit = seek(catalog, record.relationType === "SEQUEL");
        // Bölümler İLİŞKİLİ kayıttan geldi (devam sezonu) → kimlik O kaydın kimliğidir.
        if (hit) {
          return { ok: true, episodes: hit, malId: record.malId, specials: specialsOf(catalog) };
        }
      }

      // 3) ORDİNAL sezon eşlemesi (yeni): birebir sezon numarası hiçbir kayıtta
      //    tutmadıysa, serinin sezon zincirini yürüyüp hedef sezonu SIRAYLA eşleriz.
      //    NEDEN: devam kayıtları bölümlerini kendi içinde yeniden numaralandırır
      //    (bizim S3 → zincirin 3. halkası) ve zincir geçişli DEĞİLDİR — ilgili kayıt
      //    bir ÖNCEKİ kaydın ilişkisinde durur (bkz. `fetchSeasonChain`). Belirsizlikte
      //    (aynı basamakta birden çok devam kaydı) ya da zincir hedef sezondan kısaysa
      //    TAHMİN YAPILMAZ; bugünkü dürüst "bulunamadı" sonucu korunur.
      const ordinal = await resolveOrdinal();
      if (!isCurrent()) return { ok: false, attempts };
      const chain = await fetchSeasonChain(malId, seasonNumber);
      if (!isCurrent()) return { ok: false, attempts };
      if (!chain.ambiguous && ordinal < chain.entries.length) {
        const catalogs: CatalogEpisode[][] = [];
        for (const entry of chain.entries) {
          if (!isCurrent()) return { ok: false, attempts };
          // İlk halka serinin KENDİ kaydıdır: zaten denendi, tekrar istek ATILMAZ.
          if (entry.malId === malId) {
            catalogs.push(own ?? []);
            continue;
          }
          catalogs.push((await attempt(entry.malId)) ?? []);
        }
        const mapped = pickChainSeason(chain.entries, catalogs, ordinal, seasonNumber);
        // Zincir eşlemesi: bölümler `ordinal` basamağındaki kaydın kataloğundan gelir,
        // dolayısıyla sezonun kimliği O basamağın kimliğidir (0. basamak = serinin kendisi).
        if (mapped) {
          return {
            ok: true,
            episodes: mapped,
            malId: chain.entries[ordinal]?.malId ?? malId,
            specials: specialsOf(catalogs[ordinal] ?? []),
          };
        }
      }

      return { ok: false, attempts };
    },
    // `singlePart` BURADA gerekli: film modu bu çözümleyicinin İÇİNDE dallanıyor
    // (aşağıdaki `load` yalnızca çağırıyor, bayrağı kendisi kullanmıyor).
    // `partContinuation` da gerekli: kendi kayıt 404'üyken part devamında
    // ilişkili kayıtlara düşülmez (bkz. yukarıdaki PART DEVAMI guard'ı).
    [seasonNumber, resolveOrdinal, singlePart, partContinuation],
  );

  /**
   * PROP'TAKİ MAL KİMLİĞİ — her render'da tazelenen ref.
   *
   * NEDEN REF, DOĞRUDAN DEĞİŞKEN DEĞİL: değeri `load` içinde kapatma (closure)
   * olarak okumak, `malId`yi `useCallback` bağımlılıklarına eklemeyi gerektirirdi.
   * O zaman kullanıcı kimlik kutusunu her düzenlediğinde (her tuş vuruşunda)
   * `load` yeniden yaratılır ve katalog BAŞTAN ÇEKİLİRDİ. Ref ile hem her zaman
   * GÜNCEL değeri okuruz hem de gereksiz istek üretmeyiz.
   */
  const malIdRef = useRef<number | null>(malId ?? null);
  malIdRef.current = malId ?? null;

  /** Bölüm listesini getirir; aynı anda çalışanlardan yalnızca sonuncusu yazar. */
  const load = useCallback(async () => {
    runRef.current += 1;
    const run = runRef.current;
    const isCurrent = () => runRef.current === run;
    setStatus("loading");
    setProblem(null);
    // Önceki sezonun kimliği ekranda kalmasın: yeni sezonun kimliği çözülene kadar
    // başlık "çözülüyor" der (yanlış sayı göstermek yerine — bkz. `seasonMalId` notu).
    setSeasonMalId(null);
    try {
      const meta = await readShowMeta();
      if (!isCurrent()) return;
      setShowTitle(meta.title);
      setAnimecixId(meta.animecixId);
      /**
       * KİMLİK SEÇİMİ — ÖNCE KUTUDAKİ (prop), SONRA VERİTABANI.
       *
       * Sıra kritik: kullanıcı yeni seride MAL kimliğini yazıp HENÜZ KAYDETMEDEN
       * katalog çekmek istiyor. O anda `meta.malId` (veritabanı) boştur; eskiden
       * bu yüzden katalog hiç denenmiyordu (bkz. `malId` prop notu).
       */
      const effectiveMalId = malIdRef.current ?? meta.malId ?? null;
      setShowMalId(effectiveMalId);
      setShowSlug(meta.slug);
      if (!effectiveMalId) {
        setList([]);
        setStatus("error");
        setProblem("Bu serinin MAL kimliği yok — seri ayarlarından MAL kimliğini doldur.");
        // MAL kimliği olmadan katalog hiç denenemez; elle ekleme formu öne çıkarılır.
        manualAddRef.current?.();
        return;
      }

      const lookup = await findSeasonEpisodes(effectiveMalId, isCurrent);
      if (!isCurrent()) return;
      if (!lookup.ok) {
        setList([]);
        setStatus("error");
        // DÜRÜST mesaj: denenen MAL kimlikleri + 404 / geçici ayrımı (bkz. `catalogFailureMessage`).
        setProblem(catalogFailureMessage(lookup.attempts, seasonNumber));
        // Katalogdan bölüm gelmiyor → ELLE ekleme formunu AÇ ve ÖNE ÇIKAR.
        manualAddRef.current?.();
        return;
      }
      /**
       * CANLI GÜNLÜĞE İŞARET — KATALOG SONUCU.
       *
       * ── NEDEN (kullanıcı bildirimi, 28.09.2026) ────────────────────────────────
       * "Filmde MAL kimliği girmeme rağmen Jujutsu Kaisen sezon 1 bölümleri çıkıyor;
       * 24 bölüm ekleyebiliyorum."
       *
       * Ölçüm: ani.zip MAL **48561** (film) için 4 kayıt veriyor (1 film + 3 özel
       * video), MAL **40748** (TV) için 24 gerçek bölüm. Yani "24 bölüm" TV serisinin
       * kimliğinden geliyor. Hangi kimliğin kullanıldığını KESİNLEŞTİRMEK için
       * kullanılan MAL kimliği ve dönen liste buraya yazılır.
       */
      devMark("katalog listesi yüklendi", {
        malId: showMalId ?? null,
        sezon: seasonNumber,
        bolumSayisi: lookup.episodes.length,
        ilkAdlar: lookup.episodes
          .slice(0, 4)
          .map((item) => item.title)
          .join(" | "),
      });
      /**
       * PART (KISIM) DEVAMI — NUMARALAR KALDIĞI YERDEN SÜRER.
       *
       * Kaydırmasız yazmak VERİYİ BOZAR: Part 2'nin 1–12'si, Part 1'in 1–12'siyle
       * çakışır ve `writeEpisodeRow` numara doluysa mevcut satırı GÜNCELLER.
       *
       * ÜST SINIR (`puffySource`): kaynak sezonu kaç bölüm veriyorsa toplamı o
       * kadardır; bu sınır kaydırmayı aynı part kaydının ikinci çekilişinde de aynı
       * değerde tutar → yazım tekrarlanabilir olur.
       */
      const takenNow = takenRef.current;
      const existingMax = [...takenNow.keys()].reduce((max, n) => Math.max(max, n), 0);

      /**
       * ⚠️ KAYDIRMA SABİT OLMALI — YOKSA HER AÇILIŞTA ŞAŞAR.
       *
       * KULLANICI BİLDİRİMİ (29.09.2026): "1. sezona 12 bölüm yükledim, part 2
       * id'sini girdim, 23'ten başlıyor, bu ne?"
       *
       * ÖLÇÜLEN SEBEP: kaydırma `existingMax`ten hesaplanınca, part BİR KEZ
       * yazıldıktan sonra sezonun en büyük numarası part'ın kendi bölümleri olur
       * (12–23) → ikinci açılışta kaydırma 22'ye çıkar → aynı bölümler 23–34 diye
       * numaralanır, "yüklendi" görünmez. Yazılırsa ÇİFT kayıt oluşur.
       *
       * ÇÖZÜM (sabit hesap): part'ın bölümlerinden HERHANGİ biri sezonda BAŞLIĞIYLA
       * bulunuyorsa kaydırma o satırdan geri hesaplanır (bulunan numara − part'taki
       * sırası). Yazımdan etkilenmez → her açılışta aynı çıkar. Bulunamazsa (henüz
       * yazılmamış) mevcut son bölümden sürer; kaynak bölüm sayısı okunmuşsa üst
       * sınır uygulanır.
       */
      const titleToNumber = new Map<string, number>();
      for (const [number, title] of takenNow) {
        const key = title.trim().toLocaleLowerCase("tr");
        if (!key) continue;
        /**
         * EN KÜÇÜK numara kazanır.
         *
         * Ölçüm (29.09.2026): part bir kez yanlış numarayla yazıldığında sezonun
         * son satırları part'ın kopyaları oluyor (ör. 23–34). Sözlük SON değeri
         * tutarsa eşleşme 23'ü bulup kaydırmayı 22 yapıyordu → panel 23–34 diye
         * numaralıyordu. Küçük numara (gerçek başlangıç) seçilince kaydırma sabit
         * ve doğru kalır.
         */
        const current = titleToNumber.get(key);
        if (current === undefined || number < current) titleToNumber.set(key, number);
      }
      let matchedOffset: number | null = null;
      for (let index = 0; index < lookup.episodes.length; index += 1) {
        const title = (lookup.episodes[index]?.title ?? "").trim().toLocaleLowerCase("tr");
        if (!title) continue;
        const found = titleToNumber.get(title);
        if (found !== undefined) {
          matchedOffset = Math.max(0, found - (index + 1));
          break;
        }
      }

      /**
       * KAYNAK SAYISI ÜST SINIRI KALDIRILDI.
       *
       * Ölçüm (29.09.2026): kaynak (TR) sayfası sezonu DAHA AZ bölümle listelerse
       * sınır negatife düşüp kaydırmayı 0'a çekiyordu — panelde "kaynakta 11 bölüm"
       * yazarken 12 part bölümü vardı ve kaydırma 0 oluyordu. Sabitlik zaten
       * YAZILMIŞ PART BAŞLIĞINDAN geliyor (`matchedOffset`), sınıra gerek yok.
       */
      /**
       * ═══ KAYDIRMANIN TEK GÜVENİLİR ÇIPASI: SEZONUN KENDİ KATALOĞU ═══
       *
       * ÖLÇÜM (29.09.2026, canlı koşu): türetilen çıpalar KARARSIZ kaldı —
       * "mevcut son bölüm" çıpası, part bir kez yazıldıktan sonra part'ın KENDİ
       * bölümlerini de sayıyor. Mushoku'da (1–11 + 23–34) kaydırma bir açılışta
       * 22, sonraki açılışta 33 oldu; liste 23–34 → 34–45 diye kaydı. Başlık
       * eşleşmesi de aynı kirlenmeden etkileniyor.
       *
       * SEZONUN KENDİ KAYDI (Mushoku S1 = MAL 39535 → 11 bölüm) part'ın
       * bölümlerini İÇERMEZ; sayısı sabittir (11). Kaydırma = o sayı →
       * Part 2 = 12–23. Her açılışta AYNI sonuç, veritabanı durumundan bağımsız.
       */
      let ownCatalogCount = 0;
      if (partContinuation && seasonOwnMalId && seasonOwnMalId !== lookup.malId) {
        const own = await findSeasonEpisodes(seasonOwnMalId, isCurrent);
        if (own.ok) ownCatalogCount = own.episodes.length;
      }

      /**
       * SAKLANAN PART KAYITLARI — `show_seasons.parts` (jsonb).
       * Şekil: [{ malId, animecixId?, start, count }]. Kolon yoksa/boşsa sessizce
       * eski türetme yoluna düşülür (panel çökmez).
       */
      let rawParts: { malId?: number; start?: number; count?: number }[] = [];
      if (partContinuation) {
        try {
          const { data } = await db
            .from("show_seasons")
            .select("*")
            .eq("show_id", showId)
            .eq("number", seasonNumber)
            .maybeSingle();
          const stored = (data as { parts?: unknown } | null)?.parts;
          if (Array.isArray(stored)) {
            rawParts = stored as { malId?: number; start?: number; count?: number }[];
          }
        } catch {
          rawParts = [];
        }
      }

      /**
       * ⚠️ KENDİ KAYDI HARİÇ — bulunan kaymanın kaynağı buydu.
       *
       * Part'ın KENDİ `parts` satırı toplama eklenirse: 11 (Part 1) + 12 (bu part)
       * = 23 → liste 24–35'e kayar. Ölçülen "23–34 / 34–45" kayması tam buydu:
       * part bir kez yazıldıktan sonra kendi sayısı ikinci kez hesaba giriyordu.
       */
      /**
       * ═══ ÇIPA: YALNIZCA SEZONUN KENDİ KATALOĞU ═══
       *
       *   kaydırma = sezonun kendi katalog bölüm sayısı   (Mushoku S1: 11 → 12–23)
       *
       * SAKLANAN `parts` KAYITLARI TOPLAMA KATILMIYOR — ölçülen kaymanın kaynağı
       * buydu: veritabanında kalan eski/yanlış part kayıtları (ör. yanlış kayıttan
       * yazılmış `malId: 39535, count: 11`) hesaba girip 11 + 11 = 22 yapıyordu →
       * liste 23–34. Sezonun kendi kaydı bu kirlilikten ETKİLENMEZ, o yüzden tek
       * çıpa o: her açılışta aynı sonuç.
       */
      /**
       * ⚠️ ÇİFT SAYMA KORUMASI — bulunan son kaymanın kaynağı.
       *
       * ÖLÇÜM (29.09.2026): part kaydının kataloğu (45576 "Cour 2") bölümleri
       * ZATEN mutlak (sezon içi) numarayla getiriyor: 12…23. Üstüne offset (11)
       * eklenince liste 23–34 oluyordu. Yani offset PART kataloğunda ÇİFT sayıyor.
       *
       * Kural: katalog 1'den başlıyorsa (göreli numaralandırma) offset uygulanır;
       * 1'den başlamıyorsa katalog zaten mutlak → offset UYGULANMAZ.
       */
      const catalogStartsAtOne = (lookup.episodes[0]?.number ?? 1) === 1;
      const offset =
        partContinuation && catalogStartsAtOne
          ? ownCatalogCount > 0
            ? ownCatalogCount
            : (matchedOffset ?? Math.max(0, existingMax))
          : 0;
      setPartOffset(offset);

      /**
       * ═══ PART'IN MUTLAK (SEZON İÇİ) BÖLÜMLERİ ═══
       *
       * Oyuncu bunları YAZAR; iki kaynak biçimi vardır ve ikisi de 12..23'e çıkar:
       *   · katalog GÖRELİ numaralandırıyorsa (1..12) → kaydırma eklenir → 12..23,
       *   · katalog ZATEN mutlak numaralandırıyorsa (ani.zip `Court 2` = 12..23)
       *     → kaydırma EKLENMEZ → 12..23 (çift sayma koruması, bkz. yukarısı).
       * Kaydırma `{malId,start,count}` çıpasına dayanır; Mushoku'da ani.zip part
       * kataloğu mutlak verdiği için `offset = 0` olur ve liste doğrudan 12..23 kalır.
       */
      const numbered =
        offset > 0
          ? lookup.episodes.map((ep) => ({ ...ep, number: ep.number + offset }))
          : lookup.episodes;

      /**
       * KAYDI SAKLA — bir kez yazılır, sonraki açılışlar buradan okur.
       *
       * `start` = part'ın İLK MUTLAK bölüm numarası (12), `count` = bölüm sayısı (12).
       * ESKİ KOŞUL `offset > 0` idi; katalog ZATEN mutlak numaralı olduğunda (ani.zip
       * Mushoku S1 Part 2: 12..23) offset 0 kalıyor ve kayıt HİÇ yazılmıyordu — yani
       * part tanınsa bile `parts`ta iz bırakmıyordu. Artık mutlak durumda da yazılır;
       * `start` doğrudan ilk bölüm numarasından gelir.
       */
      const firstAbsolute = numbered[0]?.number ?? 0;
      if (partContinuation && lookup.malId && firstAbsolute > 0) {
        const next = [
          ...rawParts.filter((entry) => entry?.malId !== lookup.malId),
          { malId: lookup.malId, start: firstAbsolute, count: lookup.episodes.length },
        ];
        if (JSON.stringify(next) !== JSON.stringify(rawParts)) {
          void db
            .from("show_seasons")
            .update({ parts: next } as never)
            .eq("show_id", showId)
            .eq("number", seasonNumber);
        }
      }

      // Kaydırma SABİT bir çıpadan geldiyse bilgi satırı bunu söyler:
      // sezonun kendi katalog uzunluğu (birincil çıpa) veya yazılmış part satırı.
      setPartOffsetFromWritten(ownCatalogCount > 0 || matchedOffset !== null);
      /**
       * ÖZEL BÖLÜMLER (0. Bölüm) HER ZAMAN EN BAŞTA — kaydırmadan BAĞIMSIZ.
       *
       * `number: 0` SABİTTİR: özel bölüm sezonun bölüm aralığının (1..N ya da
       * 12..23) DIŞINDA durur; bu yüzden kaydırma/part offset hesabına KATILMAZ ve
       * onu KAYDIRMAZ (aksine, 0'ı ana listeye katsaydık `catalogStartsAtOne` ve
       * aralık hesabı bozulurdu). Listedeki ilk satır olur.
       */
      const specialList = lookup.specials.map((ep) => ({ ...ep, season: seasonNumber, number: 0 }));
      // `numbered` YUKARIDA (parts kaydından ÖNCE) hesaplandı — kayıt `start`ı ondan alır.
      setList([...specialList, ...numbered]);
      // Başlıktaki kimlik, bölümleri ÜRETEN kaydın kimliğidir (sezonun kendisi).
      setSeasonMalId(lookup.malId);
      // Satır seçimi YOK: liste bölümünün TAMAMI yazılır (tek düğme = tüm sezon).
      setStatus("ready");
    } catch (err) {
      if (!isCurrent()) return;
      setList([]);
      setStatus("error");
      setProblem(err instanceof Error ? err.message : String(err));
    }
    // `showMalId` bağımlılığa EKLENDİ: MAL kimliği değişince katalog yeniden
    // yüklenmeli. (Günlük kaydı bu değeri kullandığı için eksikliği uyarı verdi;
    // eksik bırakmak, kimlik değiştiğinde eski liste kalması demekti.)
    //
    // `partContinuation` de bağımlılık: numara kaydırması bu bayrağa bağlı ve
    // bayrak panel açılırken sabitlenir; değişirse kaydırma yeniden hesaplanır.
    //
    // `seasonOwnMalId` de bağımlılık: part kaydının numaralandırma çıpası ondan
    // geliyor (sezonun kendi katalog uzunluğu) — kimlik değişirse yeniden hesaplanır.
    //
    // `showId` de bağımlılık: `show_seasons.parts` kaydı bu kimlikle okunup yazılıyor.
  }, [
    findSeasonEpisodes,
    readShowMeta,
    showId,
    seasonNumber,
    showMalId,
    partContinuation,
    seasonOwnMalId,
  ]);

  /**
   * animecix kaydını seriye yazar (`shows.animecix_id`) ve belleğe alır.
   *
   * Kimlik ÖNCE belleğe yazılır: `animecix_id` kolonu henüz eklenmemiş olabilir
   * (migration kullanıcı tarafından çalıştırılır). Kolon yoksa kalıcı kayıt
   * başarısız olur ama panel o oturumda bu kimlikle yine de kaynak çözebilir ve
   * kullanıcıya kolonu çalıştırması gerektiği SÖYLENİR — sessiz veri kaybı olmaz.
   */
  const linkAnimecix = useCallback(
    async (id: number, silent = false) => {
      setAnimecixId(id);
      setAnimecixEdit(false);
      setAnimecixInput("");
      try {
        const { error } = await db.from("shows").update({ animecix_id: id }).eq("id", showId);
        if (error) throw error;
        setAnimecixNote(null);
        if (!silent) toast.success(`TauVideo kaydı eşlendi: ${id}`);
      } catch (err) {
        // Gerçek sebep okunur (bkz. `reasonOf`): kolon yoksa mesaj artık
        // "Could not find the 'animecix_id' column…" diye çıkar, yani kullanıcı
        // hangi migration'ı çalıştıracağını doğrudan görür.
        const reason = reasonOf(err);
        setAnimecixNote(
          "TauVideo kimliği seriye KAYDEDİLEMEDİ (kolon yok) — yalnızca bu panel oturumunda " +
            "kullanılır. supabase/migrations/20260927_animecix_id.sql dosyasını Supabase SQL " +
            "Editor'de çalıştır. Ayrıntı: " +
            reason,
        );
        if (!silent) toast.error(`TauVideo kimliği kaydedilemedi: ${id}`);
      }
    },
    [showId],
  );

  /**
   * Uygun animecix kaydını SESSİZCE bulur ve eşler (kullanıcıya liste gösterilmez).
   *
   * Yalnızca `shows.animecix_id` boşken çağrılır; seçim kuralı `pickAnimecixMatch`te.
   */
  const autoMatchAnimecix = useCallback(
    async (title: string) => {
      const query = title.trim();
      if (query.length < 2) {
        setAnimecixNote("otomatik eşleme için seri adı gerekli — numarayı elle yaz.");
        return;
      }
      setAnimecixBusy(true);
      setAnimecixNote("TauVideo kaydı aranıyor…");
      try {
        /**
         * ARAMA TERİMLERİ — SIRAYLA denenir (kullanıcı isteği: "tam isimle
         * bulamıyorsa alternatif isimleri de deneyecek bir fallback mekanizması").
         *   1) serinin başlığı, 2) slug'ın sözcükleri (`mushoku-tensei` → "mushoku
         *   tensei"), 3) başlığın ilk üç sözcüğü (uzun/alt başlıklı adlar için).
         * Ayrıca her sonuç kaydının ÜÇ adı (name/english/romanji) eşanlamlı sayılır,
         * yani bizim adımız İngilizce, kaydınki romaji olsa da eşleşir.
         * HİÇBİRİ tutmazsa hata FIRLATILMAZ: not yazılır, numara elle girilebilir.
         */
        /**
         * ADAY ANIMECIX KİMLİĞİNİ SINA — "bu kimlikte bölüm var mı?"
         *
         * ÖLÇÜM (29.09.2026): animecix API'si SAĞLAM çalışıyor —
         * `titleId=7352&season=1&episode=1` (Jujutsu Kaisen) 200 + geçerli
         * `tau-video.xyz/embed/...` kaydı döndürüyor. Buna karşılık panel her bölüm
         * için "bu bölüm için TauVideo kaydı yok" alıyordu → yani EŞLENEN KİMLİK
         * yanlıştı (film/özel bölüm/benzer adlı başka kayıt) ve o kimlikte bölüm yok.
         *
         * S1B1 ve S1B2 denenir: ikisinden biri veri döndürürse kimlik kullanılabilir.
         */
        const probeAnimecix = async (id: number): Promise<boolean> => {
          for (const episode of [1, 2]) {
            try {
              const res = await fetch(`/api/animecix?titleId=${id}&season=1&episode=${episode}`);
              if (!res.ok) continue;
              const json = (await res.json()) as { ok?: boolean; best?: string };
              if (json.ok === true && Boolean(json.best)) return true;
            } catch {
              continue;
            }
          }
          return false;
        };

        const terms = [query, showSlug.replace(/-/g, " "), query.split(/\s+/).slice(0, 3).join(" ")]
          .map((value) => value.trim())
          .filter((value, index, all) => value.length >= 2 && all.indexOf(value) === index);

        for (const term of terms) {
          const res = await fetch(`/api/animecix?search=${encodeURIComponent(term)}`);
          if (!res.ok) throw new Error(`sunucu hatası (HTTP ${res.status})`);
          const json = await readJsonObject(res);
          const rows = arrayField<AnimecixHit>(json, "results");
          const hit = pickAnimecixMatch(terms, rows);

          /**
           * ARAMA SONUCU ARTIK DOĞRULANARAK BAĞLANIR.
           *
           * Eski davranış: önerilen aday körlemesine bağlanıyordu. Aday yanlışsa
           * (film/özel/benzer ad) panel HER bölüm için "TauVideo kaydı yok" diyordu
           * ve kullanıcı "kaynak yok" sanıyordu — oysa kaynak animecix'te VARDI.
           * Sıra: önce önerilen aday, sonra arama sırasındaki diğer adaylar.
           */
          const probeOrder = [...(hit ? [hit.id] : []), ...rows.map((row) => row.id)].filter(
            (id, index, all) => Number.isFinite(id) && id > 0 && all.indexOf(id) === index,
          );

          for (const id of probeOrder) {
            if (!(await probeAnimecix(id))) continue;
            await linkAnimecix(id, true);
            setAnimecixNote(
              id === hit?.id ? `eşleşti: ${hit.matchedTitle}` : `eşleşti ve doğrulandı: #${id}`,
            );
            return;
          }
        }
        setAnimecixNote(
          `TauVideo kaydı bulunamadı (${terms.length} ad denendi) — numarayı elle yaz.`,
        );
        return;
      } catch (err) {
        setAnimecixNote(`TauVideo aranamadı — ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setAnimecixBusy(false);
      }
    },
    // `showSlug` bağımlılığı: arama terimleri artık slug sözcüklerini de kullanıyor
    // (bkz. `autoMatchAnimecix` içindeki "ARAMA TERİMLERİ").
    [linkAnimecix, showSlug],
  );

  // İlk yükleme: serinin künyesi okunur, sezonun bölümleri kendiliğinden bulunur.
  useEffect(() => {
    void load();
  }, [load]);

  // Kayıtlı animecix kimliği yoksa SESSİZCE bir kez eşle (kullanıcı arama yapmasın).
  // Yalnızca başlık geldiğinde ve kimlik boşken çalışır; başarısızlıkta bağımlılıklar
  // değişmediği için tekrar denenmez.
  useEffect(() => {
    if (!showTitle || animecixId) return;
    void autoMatchAnimecix(showTitle);
  }, [showTitle, animecixId, autoMatchAnimecix]);

  const missing = list.filter((ep) => !taken.has(ep.number));

  /**
   * TOPLU SEÇİM KÜMESİ — 0. bölüm (özel/ön bölüm) DIŞARIDA.
   *
   * ── NEDEN (kullanıcı bildirimi, 29.09.2026) ────────────────────────────────
   * Katalogda "0. Bölüm" bulunduğunda (ör. Mushoku S2 → "Guardian Fitz + 1..12")
   * "Tümünü seç" onu da işaretliyordu: kullanıcı 1..N aralığını yazmak isterken
   * farkında olmadan 0. bölümü de veritabanına ekliyordu. `number: 0` diğer tüm
   * mekanizmalarda AYRI ele alınır (part offset hesabına katılmaz, izleme
   * sayfasında aralığın dışında durur) — toplu seçimin de aynı kurala uyması
   * gerekir.
   *
   * Özel bölüm listeden ÇIKARILMAZ: tek tek işaretlenip normal şekilde
   * yazılabilir; yalnızca "hepsini seç" kısayoluna girmez.
   */
  const selectableNumbers = useMemo(
    () => list.filter((ep) => ep.number > 0).map((ep) => ep.number),
    [list],
  );

  /** Kaynak kutusunu aç/kapat — kutular birbirinden BAĞIMSIZ (çok seçim). */
  function toggleProvider(id: string) {
    setPicked((map) => ({ ...map, [id]: map[id] !== true }));
  }

  /** Bu sağlayıcı işaretli mi. */
  const isPicked = (id: string) => picked[id] === true;

  /** İşaretli kaynak sayısı — düğme ve yazma akışı bunu bekler. */
  /**
   * İŞARETLİ KAYNAKLAR — hem düğme metni hem "zaten yüklü" kontrolü kullanır.
   * (Eskiden bu liste yalnızca düğme metninin içinde satır içi hesaplanıyordu;
   * kapsama kontrolü de aynı listeye ihtiyaç duyduğu için dışarı alındı.)
   */
  const pickedItems = PICK_ORDER.filter((item) => isPicked(item.id));
  const pickedCount = pickedItems.length;

  /**
   * KAYNAK BAZINDA EKSİKLER — "hangi bölümde HANGİ kaynak yok".
   *
   * KULLANICI BİLDİRİMİ (29.09.2026): "üstte 3 tane kaynak var ya … o kaynakların
   * yüklü olup olmadığı belli olsun. Tikler var ya, seçtiğim tiklerdeki kaynaklar
   * yüklü olmayan varsa belli etsin bölümlerde."
   *
   * ÖLÇÜLEN SEBEP: satırın sağında yalnızca TEK durum vardı (üstteki yazma
   * ilerlemesi ya da "yüklendi"); bölüm bazlı "hangi kaynak eksik" bilgisi
   * ekranda HİÇ yoktu — oysa VERİDE vardı: `loadedByNumber` zaten
   * "bölüm numarası → yüklü sağlayıcı kimlikleri" haritasını tutuyor.
   *
   * `pickedItems` (üstteki tikler) esas alınır: kullanıcı yalnızca KENDİ seçtiği
   * kaynakların durumunu görmek istiyor. Tik değişince özet de değişir.
   */
  const missingBySource = useMemo(
    () =>
      pickedItems
        .map((item) => ({
          id: item.id,
          short: item.short,
          numbers: [...taken.keys()]
            .filter((number) => !(loadedByNumber.get(number)?.has(item.id) ?? false))
            .sort((a, b) => a - b),
        }))
        .filter((entry) => entry.numbers.length > 0),
    [pickedItems, taken, loadedByNumber],
  );

  /**
   * Bölüm satırını yazar (yoksa EKLER, varsa GÜNCELLER) ve `id`ini döndürür.
   *
   * NEDEN `id` GEREKLİ: kaynak satırları `episode_id`ye bağlanır; INSERT sonrası
   * oluşan kimliği almak için `.select("id").single()` ile geri okunur. Kayıtlı
   * bölümde zayıf/jenerik başlık katalogdaki gerçek adla düzeltilir.
   *
   * ── BAŞLIK ARTIK KATALOGDAN GELİR (kullanıcı, 28.09.2026) ─────────────────
   * "Katalogdan yabancı isimle çekiliyor, orijinal ismiyle gelsin; asla çeviri
   * yapma. Sitemiz tamamen İngilizce olacak, orijinal doğru İngilizce kullansın."
   *
   * ESKİ DAVRANIŞ: yazma sırasında kaynaktan (puffytr) TÜRKÇE bölüm adları çekilip
   * `title` alanına yazılıyordu. Bu, veritabanına dönüşü olmayan bir ADLANDIRMA
   * yapıyordu — hem İngilizce varsayılanı bozuyor hem de her yazmada dış bir
   * sayfaya istek atmayı gerektiriyordu. Artık `title` KATALOGUN ORİJİNAL adıdır
   * (ani.zip, İngilizce önceliğiyle — bkz. `lib/admin-anizip.ts` `readTitle`).
   * Çeviri işi yazma anından çıkarıldı; TR görünüm gerektiğinde çevrilir.
   */
  /**
   * SEZON KAYDI YOKSA AÇAR — yazmadan ÖNCE bir kez.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * NEDEN GEREKLİ (kullanıcı isteği, 29.09.2026): "sezon oluştur" düğmesi tamamen
   * kaldırıldı — tek akış artık şu: MAL kimliği → "MAL'de ara" → sonuç satırı →
   * katalog paneli → "N bölüme yaz".
   *
   * AMA `writeEpisodeRow` yalnızca `show_episodes` yazar; `show_seasons` satırını
   * KİMSE açmıyordu (bu panel o tablodan yalnızca zincir sırasını OKUR). Sezon
   * kaydı olmadan bölüm yazmak sitenin "0 sezon · N bölüm" göstermesine yol açardı
   * — projede bunun için sağlık kontrolü bile var
   * (`lib/content-health.ts` → `findMissingSeasons`).
   *
   * Bu yüzden yazma işi artık sezon kaydını da kendisi kurar. VAR OLANI TEKRAR
   * YAZMAZ (ikinci yazımda çift kayıt oluşmasın).
   *
   * HATA DURUMU: sezon yazılamazsa yazma DURDURULMAZ — bölümler yine yazılır ve
   * sebep canlı günlüğe işlenir; eksik sezon kaydı panelin "Veri sağlığı"
   * bölümünden tek tıkla onarılabiliyor.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  async function ensureSeasonRow() {
    try {
      const { data, error } = await db
        .from("show_seasons")
        .select("id")
        .eq("show_id", showId)
        .eq("number", seasonNumber)
        .limit(1);
      if (error) throw error;
      if ((data ?? []).length > 0) return;
      const base = {
        show_id: showId,
        number: seasonNumber,
        title: "",
        sort_order: seasonNumber,
      };
      /**
       * `mal_id` — SEZONUN KENDİ KİMLİĞİ (29.09.2026). Böylece "sıradaki sezon"
       * olarak girilen kimlik sezon kaydına işlenir ve o sezonun katalogu bir
       * daha zincir tahminine kalmaz.
       *
       * KOLON YOKSA (göç çalıştırılmadıysa) insert hata verir; o durumda ALANSIZ
       * yeniden denenir — kimliğin yazılamaması sezon kaydının oluşmasını
       * engellememeli.
       */
      const first = await db
        .from("show_seasons")
        .insert({ ...base, mal_id: malIdRef.current ?? null });
      if (first.error) {
        const second = await db.from("show_seasons").insert(base);
        if (second.error) throw second.error;
        devMark("sezon kaydı açıldı (mal_id kolonu yok — göç çalıştırılmamış)", {
          sezon: seasonNumber,
        });
        return;
      }
      devMark("sezon kaydı açıldı", { sezon: seasonNumber, malId: malIdRef.current ?? null });
    } catch (error) {
      devMark("sezon kaydı açılamadı", {
        sezon: seasonNumber,
        hata: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function writeEpisodeRow(
    ep: CatalogEpisode,
    watchUrl: string,
    retitle: boolean,
  ): Promise<string> {
    const idOf = (data: unknown) => String((data as { id?: string } | null)?.id ?? "");
    if (taken.has(ep.number)) {
      const patch: { watch_url: string; title?: string } = { watch_url: watchUrl };
      if (retitle && ep.title) patch.title = ep.title;
      const { data, error } = await db
        .from("show_episodes")
        .update(patch)
        .eq("show_id", showId)
        .eq("season", seasonNumber)
        .eq("number", ep.number)
        .select("id")
        .single();
      if (error) throw error;
      return idOf(data);
    }
    const { data, error } = await db
      .from("show_episodes")
      .insert({
        show_id: showId,
        season: seasonNumber,
        number: ep.number,
        title: ep.title,
        watch_url: watchUrl,
      })
      .select("id")
      .single();
    if (error) throw error;
    return idOf(data);
  }

  /**
   * İŞARETLİ KAYNAKLARI bölüm bölüm çözer ve yazar (ortak akış).
   *
   * NEDEN ORTAK: Türkçe (sunucu rotalarıyla çözülen) ve yabancı (`@sağlayıcı`
   * direktifi) kaynaklar aynı işi yapıyor, yalnızca değerin nereden geldiği farklı.
   * İki kopya yazılınca "kaydet" mantığı birinde düzeltilip ötekinde unutuluyordu.
   * Bölüm bölüm ilerlenir: tek istekte 24 bölüm çözmek uzun sürer ve yarıda kalırsa
   * hiçbir şey yazılmaz. İlerleme panelde gösterilir, başarısızlar TEK TEK bildirilir.
   *
   * @param resolve `(bölüm, kaynak)` → o TEK kaynağın adresi ve kısa notu.
   *        FIRLATMASI BEKLENİR: "kaynakta yok" için `ImportSkip` (durum: `skipped`),
   *        gerçek arıza için normal `Error` (durum: `failed`). Tek kaynağın patlaması
   *        yalnızca o kaynağı etkiler; bölümün öteki kaynakları ve sonraki bölümler
   *        işlenmeye devam eder (`lib/import-runner.ts`).
   * @param label sonuç bildiriminde görünecek kaynak özeti (ör. "Anizm + MegaPlay")
   * @param preIssues bölüm döngüsünden ÖNCE bilinen sorunlar (ör. "Anizm adresi
   *        çözülemedi"): her bölüm için istek atılmadan doğrudan rapor edilir.
   * @param preNotes hata SAYILMAYAN bilgi satırları (ör. "adres otomatik düzeltildi").
   */
  async function resolveAndWrite(
    resolve: (ep: CatalogEpisode, item: PickItem) => Promise<{ url: string; note?: string }>,
    label: string,
    /** İşaretli kaynaklar (kutular): her bölümde SIRAYLA bunlar denenir. */
    wanted: PickItem[],
    preIssues: string[] = [],
    preNotes: string[] = [],
  ) {
    if (list.length === 0) return;
    /**
     * HEDEF LİSTE = aralık uygulanmış liste. Tüm sayaçlar ve döngü BU listeyi
     * kullanır; böylece "16 bölümün 1–10'u" dendiğinde ilerleme de 10 üzerinden
     * yürür ve panel yanlış bir "16'da 3" tablosu göstermez.
     */
    const targets = targetList(wanted);
    if (targets.length === 0) {
      toast.error("Yazılacak bölüm yok — seçim ya da aralık boş.");
      return;
    }
    setBusy(true);
    setProgress({ done: 0, total: targets.length, fail: [] });
    // Yeni yazma başlıyor: önceki turun çubukları listede kalmasın.
    setRowProgress(new Map());
    try {
      const fail: string[] = [];
      /**
       * Sağlayıcı bazında çözülemeyen kaynaklar: `sağlayıcı → { bölümler, sebepler }`.
       *
       * NEDEN AYRI TUTULUR (KÖK SEBEP DÜZELTMESİ): eskiden sebep yalnızca
       * `rows.length === 0` iken (bölümün HİÇ kaynağı yoksa) raporlanıyordu. Yabancı
       * sağlayıcılar bir DİREKTİF (`@megaplay`) yazdığı için her zaman en az bir satır
       * oluşuyordu; böylece Anizm'in sebepleri (ör. puffytr adresi yok) hiçbir yere
       * yazılmadan siliniyordu — kullanıcının "Anizm neden eklenmedi?" sorusu
       * cevapsız kalıyordu.
       */
      const skipped = new Map<string, { numbers: number[]; reasons: Set<string> }>();
      let added = 0;
      let updated = 0;
      let retitled = 0;
      /**
       * Türkçe ad sayacı YALNIZCA gerçekten yazılan bölümler üzerinden tutulur.
       * NEDEN: kaynağı hiç çözülemeyen bölüm hiç yazılmıyor; onu "Türkçe adı olmadı"
       * diye saymak kullanıcıya yanlış bir tablo gösterirdi.
       */

      /**
       * SIRALI, ÇÖKMEYEN KOŞU (kullanıcı kararı, 27.09.2026).
       *
       * ESKİ DAVRANIŞIN NEDEN KIRILGAN OLDUĞU: bölümler önce TOPLUCA çözülür, sonra
       * yazılırdı. İki ayrı döngü vardı, istekler arasında bekleme YOKTU ve tek bir
       * kalemin patlaması raporu bozabiliyordu.
       *
       * YENİ YOL (`lib/import-runner.ts`): kalem = bölüm; bölümün İÇİNDE kaynaklar da
       * SIRAYLA işlenir, her istekten sonra `RATE_LIMIT_DELAY_MS` (300 ms) beklenir,
       * kalemler arasında da aynı bekleme vardır. Bir bölüm/kaynak patlarsa YALNIZCA
       * o kalem "başarısız" olur; koşu devam eder. Her kalem ve altındaki kaynaklar
       * KAYDA geçer (`runLog`) ve panelde liste hâlinde gösterilir.
       */
      const run = await runSequentialImport<CatalogEpisode, number>({
        items: targets,
        labelOf: (ep) => `${ep.number}. Bölüm`,
        delayMs: RATE_LIMIT_DELAY_MS,
        // Geçici ağ hataları kısa beklemeyle yeniden denenir; kalıcı hatada boşuna denenmez.
        retries: DEFAULT_RETRIES,
        onProgress: (state) => setProgress({ done: state.done, total: state.total, fail: [] }),
        process: async (ep) => {
          const children: ImportLogChild[] = [];
          const rows: EpisodeSourceInput[] = [];
          let watchUrl = "";
          const exists = taken.has(ep.number);
          const retitle = exists && Boolean(ep.title) && isPlaceholderTitle(taken.get(ep.number));
          /**
           * GERÇEK ADIM SAYISI: her kaynak için 1 adım + bölüm satırının yazımı
           * + kaynak satırlarının yazımı. Yüzde buna göre bölünür ki çubuk iş
           * BİTMEDEN %100'e ulaşmasın (eski kusur: "yükleniyor 100%" diye asılı
           * kalıyordu — kullanıcının "hep aynı sayılar" dediği görüntü).
           */
          const totalSteps = wanted.length + 2;
          const stepPct = (step: number) => Math.round((step / Math.max(1, totalSteps)) * 100);
          // Sıra bu bölüme geldi → çubuk 0'dan başlar, ne yapıldığı yazılır.
          markRow(ep.number, 0, "writing", "kaynaklar çözülüyor", stepPct(1));

          // ── Kaynak kaynak SIRAYLA (her istek arasında 300 ms) ────────────────
          for (let index = 0; index < wanted.length; index += 1) {
            const item = wanted[index] as PickItem;
            // ÇUBUK: kaynak işlenmeye BAŞLARKEN ilerler; hangi kaynak olduğu etikete yazılır.
            markRow(
              ep.number,
              stepPct(index),
              "writing",
              `${item.short} çözülüyor`,
              stepPct(index + 1),
            );
            const startedAt = Date.now();
            /**
             * KAYNAK DÜZEYİNDE YENİDEN DENEME (kullanıcı şikâyeti: "Erased'de 4. bölüm
             * TauVideo hata verdi"). ÖLÇÜM: animecix aynı bölüm için bazen Cloudflare
             * 502 döndürüp hemen ardından veriyi veriyor; tek denemede kalınınca
             * "kaynakta yok" gibi görünüyordu. Geçici hata artık burada da denenir
             * (`ImportSkip` = gerçekten yok → ASLA denenmez).
             */
            let attempts = 0;
            try {
              const outcome = await retryTransient(() => resolve(ep, item), {
                attempts: DEFAULT_RETRIES,
                baseDelayMs: RETRY_BASE_DELAY_MS,
                onAttempt: (attempt) => {
                  attempts = attempt;
                },
              });
              const resolved = outcome.value;
              attempts = outcome.attempts;
              rows.push({
                provider: item.id,
                language: item.language,
                label: item.short,
                url: resolved.url,
                sort_order: item.order,
              });
              if (!watchUrl) watchUrl = resolved.url;
              children.push({
                label: item.short,
                provider: item.short,
                status: "ok",
                detail: resolved.note ?? resolved.url,
                ms: Date.now() - startedAt,
                attempts,
              });
            } catch (error) {
              // "Kaynakta yok" HATA DEĞİLDİR: ayrı durum + ayrı sayaç + ayrı renk.
              const status = error instanceof ImportSkip ? "skipped" : "failed";
              const detail = reasonOf(error);
              children.push({
                label: item.short,
                provider: item.short,
                status,
                detail,
                ms: Date.now() - startedAt,
                attempts,
              });
              // Sağlayıcı özeti (bölüm numaraları BİR kez, aralık hâlinde) için toplanır.
              const entry = skipped.get(item.short) ?? { numbers: [], reasons: new Set<string>() };
              entry.numbers.push(ep.number);
              entry.reasons.add(detail);
              skipped.set(item.short, entry);
            }
            // Kaynak tamamlandı → bu adım bitti sayılır (yüzde adım sayısına göre).
            markRow(
              ep.number,
              stepPct(index + 1),
              "writing",
              `${item.short} bitti`,
              stepPct(Math.min(index + 2, totalSteps)),
            );
            // Son kaynaktan sonra beklemeye gerek yok.
            if (index < wanted.length - 1) await sleep(RATE_LIMIT_DELAY_MS);
          }

          // Hiç kaynak çözülemediyse bölüm satırı YAZILMAZ (boş bölüm oluşturmayız).
          if (rows.length === 0) throw new ImportSkip("hiçbir kaynak çözülemedi");

          // VERİTABANI ADIMLARI DA SAYILIR (eskiden sayılmıyordu → çubuk
          // "yükleniyor 100%" yazıp asılı kalıyordu).
          markRow(
            ep.number,
            stepPct(wanted.length),
            "writing",
            "bölüm kaydediliyor",
            stepPct(wanted.length + 1),
          );
          const episodeId = await writeEpisodeRow(ep, watchUrl, retitle);
          if (!episodeId) throw new Error("bölüm kimliği alınamadı");
          markRow(ep.number, stepPct(wanted.length + 1), "writing", "kaynaklar kaydediliyor", 100);
          await replaceEpisodeSources(episodeId, rows);
          // Bölüm GERÇEKTEN bitti → çubuk 100, etiket YEŞİL "yüklendi".
          markRow(ep.number, 100, "done");

          if (exists) {
            updated += 1;
            if (retitle) retitled += 1;
          } else {
            added += 1;
          }
          return { detail: `${rows.length} kaynak yazıldı`, value: ep.number, children };
        },
      });
      /** İlerleme çubuğu son durumla kapatılır (kalan iş yok). */
      setProgress({ done: run.entries.length, total: targets.length, fail: [] });

      /**
       * Sağlayıcı bazlı okunur rapor — SEBEP BİR KEZ.
       *
       * NEDEN: bölüm başına sebep metinleri yalnızca numarada farklılaşıyordu ve
       * hepsi tek satırda " / " ile birleştiriliyordu ("puffytr'da 13. bölüm yok /
       * puffytr'da 14. bölüm yok / …"). `collapseEpisodeReasons` bunları tek satıra
       * indirir, numaraları bir kez aralık olarak verir: ör.
       * "Anizm: 13–23. bölümler puffytr'da yok (11 bölüm)".
       */
      const issueLines = [...skipped.entries()].map(([provider, entry]) => {
        return `${provider}: ${collapseEpisodeReasons(entry.numbers, [...entry.reasons])}`;
      });

      /**
       * Koşunun başarısız kalemleri rapora eklenir. Kayıt listesi (`runLog`) zaten
       * ekranda kalıcı olarak durur; burada yalnızca özet satırı için toplanır.
       */
      for (const entry of run.entries) {
        if (entry.status === "failed") fail.push(`${entry.label}: ${entry.detail}`);
      }
      /** Kalıcı YÜKLEME KAYDI: bölüm → kaynak kırılımı (panelde listelenir). */
      setRunLog(run.entries);

      /**
       * TAMAMEN ATLANAN BÖLÜMLER — "hiçbir kaynak çözülemedi" hâli.
       *
       * Kullanıcı bildirimi (29.09.2026): "sanki bir hata vardı ama bişey de yoktu…
       * herhangi bir hata olunca göstermesi gerek."
       *
       * Sağlayıcı satırları (`issueLines`) hangi kaynağın hangi bölümde olmadığını
       * söyler; buraya ise YAZILMAYAN bölümler numara olarak tek satırda eklenir →
       * "hangi bölüm eksik kaldı" sorusu tek bakışta cevaplanır (toast + panel notu).
       */
      const skippedEpisodes = run.entries.filter((entry) => entry.status === "skipped");
      const skippedLines =
        skippedEpisodes.length > 0
          ? [
              `${skippedEpisodes.length} bölüm HİÇ yazılamadı (kaynak yok): ${skippedEpisodes
                .slice(0, 15)
                .map((entry) => entry.label)
                .join(
                  ", ",
                )}${skippedEpisodes.length > 15 ? " …" : ""} — sebep: ${skippedEpisodes[0]?.detail ?? "bilinmiyor"}`,
            ]
          : [];

      const problems = [...preIssues, ...issueLines, ...fail, ...skippedLines];
      const parts = [`${added} bölüm eklendi`, `${updated} bölümün kaynakları güncellendi`];
      if (retitled > 0) parts.push(`${retitled} başlık düzeltildi`);
      if (fail.length > 0) parts.push(`${fail.length} bölüm başarısız`);
      // Eksikler ÖZET cümleye de yazılır: kullanıcı üstteki yeşil bildirimden
      // "hepsi oldu" sanmasın diye.
      if (problems.length > 0)
        parts.push(`${problems.length} kaynak/bölüm eksik — aşağıda listelendi`);
      await onDone(`S${seasonNumber} ${label}: ${parts.join(", ")}.`);

      /**
       * KALICI rapor (toast kaybolur, bu ekranda kalır).
       *
       * TÜRKÇE AD ÖZETİ KALDIRILDI (kullanıcı, 28.09.2026: "asla çeviri yapma").
       * Bölüm adları artık katalogun ORİJİNAL (İngilizce) adıdır ve yazma sırasında
       * hiçbir ad çekme isteği yapılmaz — o yüzden raporlanacak bir "ad sonucu" da
       * kalmadı. `preNotes` (ör. "adres otomatik düzeltildi") aynen gösterilir.
       */
      /**
       * CANLI KONSOLA İŞARET — TOPLU YAZIMIN SONUCU.
       *
       * ── NEDEN EKLENDİ (ölçülen olay, 28.09.2026) ─────────────────────────────
       * Kullanıcı "Anizm + TauVideo + MegaPlay → 24 bölüme yaz" düğmesine bastı ve
       * canlı günlükte bu işlemden HİÇBİR İZ yoktu: ne sonuç, ne hata. Yani en çok
       * kullanılan toplu işlem tam bir kör noktaydı — "bastım, bir şey oldu mu
       * bilmiyorum" sorusu yanıtsız kalıyordu.
       *
       * Artık kaç bölümün eklendiği/güncellendiği ve kaçının başarısız olduğu
       * kaydedilir; başarısızlık varsa sebebi de yazılır.
       */
      devMark(`S${seasonNumber} toplu kaynak yazımı bitti`, {
        eklenen: added,
        guncellenen: updated,
        basarisiz: problems.length,
        sorun: problems.length > 0 ? problems.join(" | ") : "",
      });
      setNotes([...preNotes]);
      setUnresolved(problems);
      if (problems.length > 0) {
        toast.error(`Eksik/başarısız kayıtlar:\n${problems.join("\n")}`);
      }
    } catch (err) {
      // Toplu yazım ÇÖKTÜĞÜNDE de iz kalsın (eskiden yalnızca toast vardı).
      devMark(`S${seasonNumber} toplu kaynak yazımı BAŞARISIZ`, {
        sebep: reasonOf(err),
      });
      toast.error(`${label} yazılamadı: ${reasonOf(err)}`);
    } finally {
      setBusy(false);
      setProgress(null);
      /**
       * YARIDA KALAN ÇUBUKLAR: kaynak çözülemeyen/atlanan bölümler "yükleniyor"da
       * asılı kalmasın (satır sırası gelmeden hata alanlar için). Kalan tüm
       * "writing" durumları "error" olarak işaretlenir — çubuk son oranında kalır,
       * etiket "atlandı" olur.
       */
      setRowProgress((prev) => {
        const next = new Map(prev);
        for (const [number, state] of next) {
          if (state.status === "writing") next.set(number, { ...state, status: "error" });
        }
        return next;
      });
    }
  }

  /**
   * TEK YAZMA DÜĞMESİ — işaretli kaynakların TAMAMINI SEZONUN TÜM bölümlerine yazar.
   *
   * Düğmenin tek olması kullanıcı isteğiydi: eskiden kaynağa göre farklı düğmeler
   * çıkıyordu ("çöz ve yükle" / "seçilen bölümleri ekle") ve hangisinin ne yazdığı
   * belirsizdi. Kaynak → çözücü eşlemesi burada TEK yerde durur. Bölüm satır seçimi
   * KALDIRILDI (kullanıcı kararı: panel kalabalıklaşıyordu) — düğme hepsine uygular.
   */
  async function writeSelected() {
    const wanted = PICK_ORDER.filter((item) => isPicked(item.id));
    if (list.length === 0 || wanted.length === 0) return;
    // Kimlik yoksa UYDURULMAZ: yanlış animecix kaydı yanlış bölüme video yazardı.
    if (isPicked(ANIMECIX_SOURCE_ID) && !animecixId) {
      toast.error("TauVideo kaydı eşlenmedi — numarayı yaz ya da TauVideo kutusunu kaldır.");
      return;
    }
    if (isPicked(TR_SOURCE_ID) && !puffyInput.trim()) {
      toast.error("Anizm için puffytr adresi gerekli (Gelişmiş → puffytr adresi).");
      return;
    }

    setUnresolved([]);
    setNotes([]);

    // CANLI HIZ ÖLÇÜMÜ: koşunun başlangıç anı (bkz. `RunRate`).
    setRunStartedAt(Date.now());

    /**
     * HAZIRLIK DA GÖRÜNÜR — "donuk" düğme düzeltmesi.
     *
     * Sezon satırı (`ensureSeasonRow`) + Anizm ön kontrolü (`resolvePuffy`) ağ
     * işidir; ilerleme SADECE `resolveAndWrite` içinde açılıyordu. O yüzden
     * düğmeye basınca çubuk belirene kadar panel donmuş gibi duruyordu.
     * Hedef sayı yaklaşık verilir, `resolveAndWrite` kesin sayıyla sıfırlar.
     * (İkisi de içte try/catch'li — fırlatmaz, `busy` asılı kalmaz.)
     */
    setBusy(true);
    setProgress({ done: 0, total: targetList(wanted).length, fail: [] });

    // SEZON KAYDI GARANTİSİ — "sezon oluştur" düğmesi kaldırıldığı için sezon
    // satırını yazma işi kendisi kurar (bkz. `ensureSeasonRow` notu).
    await ensureSeasonRow();

    /**
     * ANİZM ÖN KONTROLÜ — sezon başına BİR istek.
     *
     * NEDEN: puffytr adresi tutmadığında eskiden HER bölüm için ayrı ayrı başarısız
     * istek atılıyor, sebep yine yutuluyordu. Artık adres bir kez çözümlenir:
     * tutarsa tüm sezon o adresle yazılır, tutmazsa Anizm için hiç istek atılmaz ve
     * sebep + "ne yapmalı" bilgisi doğrudan rapora girer.
     */
    const anizm = isPicked(TR_SOURCE_ID) ? await resolvePuffy() : { slug: "", note: "" };
    const puffyForSeason = anizm.slug;
    const preIssues: string[] = [];
    if (isPicked(TR_SOURCE_ID) && !puffyForSeason) {
      preIssues.push(
        `Anizm: bu sezonun puffytr adresi bulunamadı — ${list.length} bölüme Anizm YAZILMADI. ` +
          `Sebep: ${anizm.note}. ` +
          // ARTIK İLK İSTENEN ŞEY ELLE ADRES YAZMAK DEĞİL: sunucu kalıp adresleri,
          // ağın KENDİ dizinini (adres ailesi + dizi adı) ve MAL → AniList adlarını
          // zaten deniyor (bkz. `routes/api.anizm.ts` → "AĞ DİZİNİ"). Elle adres
          // yalnızca SON çaredir, o yüzden ikinci sırada söyleniyor.
          `Yapılacak: bu bölüm kaynakta yok demektir; yine de elle denemek istersen ` +
          `"Gelişmiş" başlığını açıp "puffytr adresi" kutusuna adres parçasını yazabilirsin.`,
      );
    }
    /**
     * BİLGİ satırları (hata değil): adres otomatik düzeltildiyse hangi adresin
     * kullanıldığı görünsün. "Hata" sayacına KATILMAZ — yoksa başarılı bir yazma
     * işlemi kullanıcıya "eksik" gibi görünürdü.
     */
    const preNotes: string[] = [];
    if (isPicked(TR_SOURCE_ID) && puffyForSeason && puffyForSeason !== puffyInput.trim()) {
      preNotes.push(
        `Anizm: adres otomatik düzeltildi → ${puffyForSeason} (yazılan: ${puffyInput})`,
      );
    }

    const label = wanted.map((item) => item.short).join(" + ");

    await resolveAndWrite(
      /**
       * TEK KAYNAK çözücüsü: `(bölüm, kaynak)` → adres.
       *
       * KURAL (kullanıcı isteği): sunucudan dönen gövdeye ASLA körlemesine
       * `json.url` diye dokunulmaz. Yanıt `lib/safe-json.ts` ile okunur (JSON değilse
       * `null`), alanlar doğrulanır. Ayrıca "kaynakta yok" (`ImportSkip`) ile gerçek
       * arıza (normal `Error` → geçiciyse yeniden denenir) AYRI tutulur.
       */
      async (ep, item) => {
        // 1) YABANCI KAYNAKLAR: ağ isteği YOK. Oynatıcı adresi bölüme özel olmadığı
        //    için `@sağlayıcı` direktifi yazılır (bkz. `lib/embed-provider.ts`).
        if (item.kind === "foreign") {
          return { url: `@${item.id}`, note: "oynatıcı direktifi (ağ isteği yok)" };
        }

        // 2) TÜRKÇE KAYNAKLAR: adres SUNUCUDA çözülür (referer/CORS nedeniyle
        //    tarayıcıdan mümkün değil — bkz. `routes/api/anizm.ts`, `api.animecix.ts`).
        if (item.kind === "anizm") {
          // Adres ön kontrolden geçmediyse istek ATILMAZ; sebep zaten raporda.
          if (!puffyForSeason) {
            throw new ImportSkip("puffytr adresi çözülemedi (yukarıdaki rapora bak)");
          }
          // `min` SEZONUN en küçük bölüm numarasıdır: numaralandırma kaydığında
          // (Re:Zero 2. sezon: 12…23 ↔ kaynakta 1…12) sunucu sezon-relative adayı
          // önce dener. 1 tabanlı sezonda `min = 1` → davranış değişmez.
          const anizmParams = new URLSearchParams({
            puffy: puffyForSeason,
            number: String(ep.number),
            min: String(seasonMin),
            base: puffySlug,
            show: showSlug,
            title: showTitle,
            mal: showMalId ? String(showMalId) : "",
          });
          const res = await fetch(`/api/anizm?${anizmParams.toString()}`);
          // Sunucu/upstream hatası (5xx/429) GEÇİCİDİR → normal hata: yeniden denenir.
          if (!res.ok) throw new Error(`sunucu hatası (HTTP ${res.status})`);
          const json = await readJsonObject(res);
          const url = textField(json, "url");
          if (boolField(json, "ok") && url) {
            const used = textField(json, "slug");
            return { url, note: used ? `kullanılan adres: ${used}` : "oynatıcı adresi çözüldü" };
          }
          // GEÇİCİ mi kalıcı mı? Sunucu `temporary` derse ya da sebep geçici hata gibi
          // okunursa (ağ/timeout/5xx) YENİDEN DENENİR ve kırmızı gösterilir; aksi
          // hâlde bu bölüm kaynakta gerçekten yoktur (`ImportSkip`).
          {
            const reason = textField(json, "reason") ?? `beklenmeyen yanıt (HTTP ${res.status})`;
            if (boolField(json, "temporary") || isTransient(reason)) throw new Error(reason);
            throw new ImportSkip(reason);
          }
        }

        if (item.kind === "animecix") {
          if (!animecixId) throw new ImportSkip("TauVideo kaydı eşlenmemiş");
          const animecixParams = new URLSearchParams({
            titleId: String(animecixId),
            season: String(seasonNumber),
            episode: String(ep.number),
          });
          const res = await fetch(`/api/animecix?${animecixParams.toString()}`);
          // Upstream 502/504 → ROTA artık gerçek HTTP durumunu döndürüyor: geçici.
          if (!res.ok) throw new Error(`TauVideo sunucusu (HTTP ${res.status})`);
          const json = await readJsonObject(res);
          const url = textField(json, "best");
          if (boolField(json, "ok") && url) return { url, note: "TauVideo oynatıcısı" };
          {
            const reason = textField(json, "reason") ?? `beklenmeyen yanıt (HTTP ${res.status})`;
            if (boolField(json, "temporary") || isTransient(reason)) throw new Error(reason);
            throw new ImportSkip(reason);
          }
        }

        throw new ImportSkip("bilinmeyen kaynak türü");
      },
      label,
      wanted,
      preIssues,
      preNotes,
    );
  }

  /**
   * SEZONUN "YÜKLÜ" ÖZETİ — bölüm bölüm rozetlerin yanında tek bakışta durum.
   *
   * Kullanıcı isteği (28.09.2026): "yüklüyü söyle, listeyi getir" — yani sezon
   * zaten yazılmışsa bu SÖYLENSİN, ama bölüm listesi yine getirilip gösterilsin.
   * Liste aşağıda her hâlükârda çizilir; bu yalnızca bir özet etiketidir.
   *
   * KAYNAK: `loadedByNumber` — veritabanından okunan GERÇEK kaynak kapsaması
   * (`episode_sources`); tahmin veya oturum hafızası değil. Liste boşken ya da
   * hiç yüklü bölüm yokken gösterilmez.
   */
  const loadedInList = list.filter((ep) => loadedByNumber.has(ep.number)).length;
  /**
   * PART ARALIĞI İÇİN SAYIM — 0. BÖLÜM (özel) HARİÇ.
   * Özel bölüm her zaman listenin başında ve `number: 0`; part aralığı gösterimi
   * `1..N`/`12..23` üzerinden yapıldığı için 0 sayılmaz — aksi hâlde aralık bir
   * fazla görünürdü (ör. "12–24" yazarken gerçekte 12–23).
   */
  const partMainCount = list.filter((ep) => ep.number > 0).length;

  return (
    <div className="rounded-2xl border border-border bg-background/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 text-sm font-bold text-foreground">
          <CloudDownload size={15} /> Katalogdan bölüm çek
        </span>
        {/* HEDEF SEZON — artık DEĞİŞTİRİLEBİLİR.
            (kullanıcı isteği, 28.09.2026: "sadece sezon değişip bölümleri öyle
            görebileceğim şeyi ayarlasan yeter.")

            TEK SEZONDA düz etiket kalır — gereksiz bir kontrol çizilmez, panelin
            görünümü hiç değişmez. BİRDEN FAZLA sezonda seçici olur ve seçilen
            sezonun bölüm listesi yüklenir.

            Mevcut listeye/içeriğe DOKUNULMADI: yalnızca bu etiket etkileşimli
            hâle geldi, panelin geri kalanı aynen duruyor. */}
        {seasons.length > 1 && onSelectSeason ? (
          <select
            value={seasonNumber}
            onChange={(event) => onSelectSeason(Number(event.target.value))}
            title="Katalogda gösterilecek sezon"
            aria-label="Katalog sezonu"
            className="cursor-pointer rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary outline-none"
          >
            {/*
              HEDEF SEZON, KAYDI OLMAYAN YENİ SEZONDA DA LİSTEDE GÖRÜNÜR.
              (Kullanıcı bildirimi, 29.09.2026: "54857 yazıp MAL'de ara yapıyorum
              ama çıkan katalogda hedef S1 yazıyor".)

              ÖLÇÜLEN SEBEP: sezon kayıtları İLK YAZIMDA oluşur, yani yeni hedef
              sezonun (S3) satırı henüz yoktur. `<select value={3}>` seçenekler
              arasında 3 bulamayınca tarayıcı İLK seçeneği gösterir → etiket
              "Hedef: S1" görünür. Yazma yine S3'e gider (canlı günlük:
              "katalog listesi yüklendi … sezon: 3") ama etiket yalan söyler ve
              seçiciye dokunulursa hedef S1'e KAYAR — bu yüzden yalnızca kozmetik
              değil, veri güvenliği sorunu.
            */}
            {(seasons.some((item) => item.number === seasonNumber)
              ? seasons.map((item) => item.number)
              : [...seasons.map((item) => item.number), seasonNumber].sort((a, b) => a - b)
            ).map((number) => (
              <option key={number} value={number}>
                Hedef: S{number}
                {seasons.some((item) => item.number === number) ? "" : " (yeni)"}
              </option>
            ))}
          </select>
        ) : (
          <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
            Hedef: S{seasonNumber}
          </span>
        )}
        {/*
          BELİRSİZ GİRİŞ SEÇİMİ — "bu giriş yeni sezon mu, aynı sezonun devamı mı?"

          Yalnızca başlıkta ne "Season N" ne "Part/Cour" ibaresi olan bir kimlik
          girildiğinde görünür (`SeasonsPanel → classifySeasonTitle`). Heuristiğin
          önerisi varsayılan işaretli gelir; kullanıcı tek tıkla çevirir ve hedef
          yeniden çözülür (yanlış sezona yazma böylece imkânsızlaşır).
        */}
        {ambiguousChoice ? (
          <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/50 bg-amber-500/10 p-0.5 text-[10.5px] font-bold text-amber-500">
            <span className="px-1.5">Bu giriş:</span>
            <button
              type="button"
              onClick={() => ambiguousChoice.onChange("part")}
              aria-pressed={ambiguousChoice.value === "part"}
              title="Bu kayıt AYNI sezonun DEVAMI (part/cour) — yeni sezon açılmaz, numaralar önceki sezonun ardından sürer."
              className={`rounded-full px-2 py-0.5 transition-colors ${
                ambiguousChoice.value === "part"
                  ? "bg-amber-500 text-black"
                  : "hover:bg-amber-500/20"
              }`}
            >
              Bu sezonun devamı
            </button>
            <button
              type="button"
              onClick={() => ambiguousChoice.onChange("season")}
              aria-pressed={ambiguousChoice.value === "season"}
              title="Bu kayıt YENİ bir sezon — hedef sıradaki sezon numarası olur."
              className={`rounded-full px-2 py-0.5 transition-colors ${
                ambiguousChoice.value === "season"
                  ? "bg-amber-500 text-black"
                  : "hover:bg-amber-500/20"
              }`}
            >
              Yeni sezon
            </button>
          </span>
        ) : null}
        {/*
          HEDEF SEZONU SİL — TEK TIK (kullanıcı isteği, 29.09.2026):
          "sezonlardan birine sağ tıklayıp silebileyim, tamamen kalıntısız şekilde,
          diğer şekilde uzun sürüyor."

          Sağ tık yerine GÖRÜNÜR bir çöp kutusu: sezon listesi native `<select>`,
          sağ tık orada çalışmaz (tarayıcı kendi menüsünü açar) ve sağ tık zaten
          gizli bir kısayol olurdu. Silme, panelin KENDİ onay penceresinden geçer
          (tarayıcı kutusu yok) ve bölümler + kaynakları temizlenir.

          Yalnızca KAYDI OLAN sezonda çizilir: henüz oluşmamış (yeni) sezonun
          silinecek bir şeyi yoktur.
        */}
        {onDeleteSeasonNumber && seasons.some((item) => item.number === seasonNumber) ? (
          <button
            type="button"
            onClick={() => onDeleteSeasonNumber(seasonNumber)}
            disabled={busy}
            title={`${seasonNumber}. sezonu tamamen sil (bölümleri ve kaynaklarıyla)`}
            aria-label={`${seasonNumber}. sezonu tamamen sil`}
            className="grid size-6 place-items-center rounded-full border border-destructive/50 text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={12} />
          </button>
        ) : null}
        {/* KİMLİK ARTIK SEZONA GÖRE GÖSTERİLİR.
            Kullanıcı bildirimi (28.09.2026): "Hedef S1 iken kimlik 31240; S2/S3'e
            geçince HÂLÂ aynı kimlik görünüyor." Sebep: burada `shows.mal_id`
            (SERİ seviyesi, tek değer) yazıyordu. Artık bölümleri üreten kaydın
            kimliği (`seasonMalId`) yazılır; o yüzden etiket de "sezonun" olur —
            aksi hâlde seriye ait olmayan bir sayı "serinin kimliği" diye okunurdu.
            Kimlik henüz çözülmediyse "çözülüyor" denir (yanlış sayı gösterilmez),
            hiç bulunamadıysa serinin kimliğine düşülür. */}
        <span className="text-xs text-muted-foreground">
          {status === "loading"
            ? "MAL kimliği çözülüyor…"
            : seasonMalId
              ? `sezonun MAL kimliği ${seasonMalId}`
              : showMalId
                ? `serinin MAL kimliği ${showMalId}`
                : "MAL kimliği yok"}
        </span>
        {/* SEZON ZATEN YÜKLÜ MÜ? — kullanıcı isteği (28.09.2026): "yüklüyü
            söyle, listeyi getir." Liste yine gelir; bu etiket yalnızca durumu
            söyler ki hangi bölümün yazıldığını satır satır aramak gerekmesin. */}
        {status === "ready" && list.length > 0 && loadedInList > 0 ? (
          <span className="rounded-full border border-emerald-600/40 bg-emerald-600/10 px-2 py-0.5 text-[11px] font-bold text-emerald-600">
            {loadedInList === list.length
              ? `bu sezon zaten yüklü (${loadedInList}/${list.length})`
              : `${loadedInList}/${list.length} bölüm yüklü`}
          </span>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto rounded-full"
          onClick={() => void load()}
          disabled={status === "loading" || busy}
          title="Bölüm listesini yeniden çek"
        >
          <RefreshCw size={14} className={status === "loading" ? "animate-spin" : undefined} />
        </Button>
      </div>

      {/* HEDEF SEZON UYARISI — "bu sezon zaten var (S1)" / "45576 → S1'in partı,
          S2 değil" gibi NET bilgi. Panelin ne yaptığını sessizce yapmaması için
          üstte amber kutuda durur (SeasonsPanel `notice` prop'undan gelir). */}
      {notice ? (
        <p className="animate-rise-in mt-3 flex items-start gap-2 rounded-xl border border-amber-500/50 bg-amber-500/10 p-2 text-[11px] font-bold text-amber-500">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>{notice}</span>
        </p>
      ) : null}

      {/* İKİ KUTU — ETİKETLER SADELEŞTİ (kullanıcı, 28.09.2026):
          "yabancı kaynak yazmasın, sadece KAYNAK yazsın; Türkçe kaynakta ise
          KAYNAK – Türkçe yazsın… global açacağım siteyi, yabancılar gelirse tuhaf
          olmasın."
          Eski etiketler ("TÜRKÇE KAYNAK" / "YABANCI KAYNAK") Türkçe-merkezliydi;
          site global açıldığında "yabancı" kelimesi hedef kitleye göre anlamsız
          kalıyordu. Yeni mantık: varsayılan **KAYNAK**, Türkçe olan **KAYNAK – Türkçe**.
          Oynatıcı altındaki grup başlıkları da AYNI sözcükleri kullanır
          (`i18n.ts` → `watch.trBox` / `watch.foreignBox`) ki panel ile site
          ayrışmasın. Sağlayıcı başına kutu YOK; kutular bağımsız ve çok seçimli. */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card/60 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-foreground">
            <Languages size={13} /> ALTYAZI
          </p>
          <div className="mt-2 flex flex-col gap-0.5">
            <SourceRow
              title="Anizm / Puffy"
              hint={ANIZM_SOURCE?.note ?? "puffytr adresinden hash sunucuda çözülür."}
              checked={isPicked(TR_SOURCE_ID)}
              disabled={busy}
              onToggle={() => toggleProvider(TR_SOURCE_ID)}
            />
            <SourceRow
              title="TauVideo"
              hint="TauVideo oynatıcısı, eşlenmiş seri kaydından çözülür."
              checked={isPicked(ANIMECIX_SOURCE_ID)}
              disabled={busy}
              onToggle={() => toggleProvider(ANIMECIX_SOURCE_ID)}
            />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card/60 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-foreground">
            <Globe size={13} /> DİĞER ÇEVİRİLER
          </p>
          <div className="mt-2 flex flex-col gap-0.5">
            {/* Liste `SOURCE_GROUPS`ten gelir — SeasonsPanel ile ayrışmasın diye
                sağlayıcılar burada TEKRAR yazılmaz. */}
            {FOREIGN_SOURCES.map((item) => (
              <SourceRow
                key={item.id}
                title={item.label.split(" — ")[0] ?? item.label}
                hint={item.note}
                checked={isPicked(item.id)}
                disabled={busy}
                onToggle={() => toggleProvider(item.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* GELİŞMİŞ — varsayılan KAPALI başlık. Kaynak tikleri dışındaki her şey buraya
          taşındı (kullanıcı isteği: panel kalabalık); denetimler silinmedi. */}
      <button
        type="button"
        onClick={() => setAdvanced((open) => !open)}
        aria-expanded={advanced}
        title="puffytr adresi ve TauVideo eşlemesi gibi ileri ayarlar"
        className="mt-3 flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        Gelişmiş
        <ChevronDown
          size={13}
          className={advanced ? "rotate-180 transition-transform" : "transition-transform"}
        />
      </button>

      {/* Kapalıyken İÇERİK HİÇ ÇİZİLMEZ (kullanıcı bildirimi: kapalı hâlde
          içerik sızıp "yarım" görünüyordu). Koşullu render — kapalıyken DOM'da
          düğmeden başka bir şey yok, sızıntı imkânsız. */}
      {advanced ? (
        <div className="animate-rise-in mt-2 space-y-1.5 rounded-xl border border-dashed border-border p-2">
          {/*
            GELİŞMİŞ = ADRES/EŞLEME AYARLARI. Kalıcı paragraf KALDIRILDI (kullanıcı:
            "gereksiz karmaşık"); ayrıntı `title`da. Ekranda tek kısa satır kalır.
            Soru şuydu: "gelişmişe basınca neden sadece puffytr adresi diyor, 3
            kaynağımız yok mu?" — cevap: üçüncü kaynağın (MegaPlay) ayarı yoktur.
          */}
          <p
            className="text-[11px] leading-5 text-muted-foreground"
            title={
              "Bu bölüm yalnızca adres/eşleme ayarlarını tutar. Üç kaynağın ikisi ayar ister: " +
              "Anizm / Puffy → puffytr adresi, TauVideo → eşlenmiş kayıt numarası. " +
              "MegaPlay bölüme özel adres üretmediği için ayarı yoktur, bu yüzden burada görünmez."
            }
          >
            Yalnızca adres/eşleme ayarları · MegaPlay ayar istemez
          </p>
          {/* ANIZM ADRESİ — yalnızca Anizm işaretliyken görünür. puffytr her sezonu ayrı
              sayfada tutar; bu yüzden adresin sezon ekini taşıması gerekir. */}
          {isPicked(TR_SOURCE_ID) && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-muted-foreground">
                puffytr adresi
                <input
                  className={`${inputCls} h-7 w-56 text-xs`}
                  value={puffyInput}
                  onChange={(event) => {
                    setPuffyInput(event.target.value.trim());
                    setPuffyProbe(null);
                  }}
                  aria-label="puffytr dizi adresi"
                  title="puffytr.com/<bu adres>. Her sezon ayrı sayfadır (2. sezon: jujutsu-kaisen-2nd-season)."
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-full px-3 text-xs"
                  onClick={() => void resolvePuffy()}
                  disabled={busy}
                >
                  Kontrol et
                </Button>
              </label>
              {puffyProbe ? (
                /* ✓ = başarılı → YEŞİL (`text-primary` bu temada KIRMIZI; olumlu
                   mesajın kırmızı çıkması paneli "hata var" gibi gösteriyordu). */
                <span
                  className={puffyProbe.startsWith("✓") ? "text-emerald-600" : "text-amber-500"}
                >
                  {puffyProbe}
                </span>
              ) : null}
              {/* EKSİK BÖLÜM UYARISI — katalog gerçekten geride kalabiliyor
                  (ölçüm: Mushoku S3 kaynakta 14 ↔ bizde 12; Re:Zero S1 26 ↔ 25).
                  Ayrı ve DOLU bir uyarı satırı: gözden kaçmasın ve TEK basışla
                  tamamlanabilsin diye yanında düğme durur. */}
              {missingNumbers.length > 0 ? (
                <span className="mt-1 flex w-full flex-wrap items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-2 py-1.5 text-[11px] font-bold text-amber-500">
                  <span className="flex-1">
                    ⚠ Kaynak {puffySource} bölüm yayınlıyor, bizde {taken.size} var —{" "}
                    {missingNumbers.length} bölüm EKSİK ({missingNumbers.join(", ")}).
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 rounded-full border-amber-500/60 px-2 text-[11px] text-amber-500 hover:bg-amber-500/15"
                    disabled={gapBusy}
                    onClick={() => void addMissingEpisodes()}
                    title={`${missingNumbers.length} eksik bölümü boş satır olarak ekle`}
                  >
                    {gapBusy ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <ListPlus size={12} />
                    )}{" "}
                    Eksik {missingNumbers.length} bölümü ekle
                  </Button>
                </span>
              ) : null}
            </div>
          )}

          {/* ANIMECIX EŞLEMESİ — yalnızca Animecix işaretliyken görünür ve SADE:
              kimlik varsa tek satır ("TauVideo 7352 ✓ eşli" + Değiştir), yoksa küçük bir
              numara kutusu. SONUÇ LİSTESİ YOK — eşleme kodda yapılır (bkz. `pickAnimecixMatch`). */}
          {isPicked(ANIMECIX_SOURCE_ID) && (
            <div className="flex flex-wrap items-center gap-2">
              {animecixId && !animecixEdit ? (
                <>
                  <span className="rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                    TauVideo {animecixId} ✓ eşli
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 rounded-full px-3 text-xs"
                    disabled={busy || animecixBusy}
                    onClick={() => {
                      setAnimecixInput(String(animecixId));
                      setAnimecixEdit(true);
                    }}
                  >
                    Değiştir
                  </Button>
                </>
              ) : (
                <>
                  <label className="flex items-center gap-2 text-[11px] font-bold text-muted-foreground">
                    TauVideo no
                    <input
                      className={`${inputCls} h-8 w-28 text-xs`}
                      value={animecixInput}
                      inputMode="numeric"
                      onChange={(event) =>
                        setAnimecixInput(event.target.value.replace(/[^0-9]/g, ""))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && animecixInput) {
                          void linkAnimecix(Number(animecixInput));
                        }
                      }}
                      placeholder="7352"
                      aria-label="TauVideo dizi numarası"
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-full px-3 text-xs"
                    disabled={!animecixInput || busy || animecixBusy}
                    onClick={() => void linkAnimecix(Number(animecixInput))}
                  >
                    Kaydet
                  </Button>
                  {animecixEdit && animecixId ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 rounded-full px-3 text-xs"
                      disabled={busy}
                      onClick={() => {
                        setAnimecixEdit(false);
                        setAnimecixInput("");
                      }}
                    >
                      Vazgeç
                    </Button>
                  ) : null}
                  {animecixBusy ? (
                    <Loader2 size={13} className="animate-spin text-muted-foreground" />
                  ) : null}
                </>
              )}
              {animecixNote ? (
                <span className="w-full text-[11px] leading-4 text-amber-500">{animecixNote}</span>
              ) : null}
            </div>
          )}

          {/* ═══ TOPLU SİLME — SEZONUN YAZILMIŞ KAYNAKLARI ═══
              Kullanıcı isteği (28.09.2026): "bölümlerin veya toplu silme şeyim de
              yok; silip tekrar yeni kaynaktan yüklemem gerekiyor."

              Yanlış kaynağı düzeltmenin başka yolu yoktu (bölümü komple silmek
              gerekiyordu). Bu düğme yalnızca `episode_sources` satırlarını temizler:
              BÖLÜM KAYITLARI VE ADLARI KALIR, aynı sezonu yeniden yazabilirsin.
              Yıkıcı → SİTEYE ÖZEL onay penceresi ister (`confirmAction`).
              Görünüm minik tutulur (kullanıcı bildirimi: kocaman kırmızı
              düğmeler); işlev aynıdır. */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
              Sil
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 rounded-full px-2 text-[11px] text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
              disabled={busy || existing.length === 0}
              onClick={() => void clearSeasonSources()}
              title="Bu sezonun yazılmış TÜM kaynaklarını siler; bölüm kayıtları ve adları KALIR"
            >
              <Trash2 size={11} /> Kaynakları sil ({existing.length})
            </Button>
            {/* ═══ SEZONU TAMAMEN SİL ═══
                Kullanıcı isteği (28.09.2026): "direkt sezonu silemiyorum kanka ya."

                KAYNAKLARI SİLMEKTEN FARKI: bu, bölümleri VE sezon kaydını da
                siler. `SeasonsPanel.removeSeason()` bu işi zaten yapıyordu ama
                düğmesi artık çizilmeyen `SeasonCard` içinde kalmıştı — işlev
                vardı, ulaşılamıyordu. Onay metnini ve veritabanı işini üst
                bileşen yürütür. */}
            {onDeleteSeason ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 rounded-full px-2 text-[11px] text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                disabled={busy}
                onClick={onDeleteSeason}
                title="Bu sezonu bölümleriyle birlikte siler (sezon kaydı da gider)"
              >
                <Trash2 size={11} /> Sezonu sil
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {status === "loading" && (
        /*
          ⚠️ YÜKSEKLİK REZERVE EDİLİR — kullanıcı bildirimi (29.09.2026):
          "popup'la açılıyor sonra aşağı doğru katlanıyor, lag gibi".

          ÖLÇÜLEN SEBEP: bu dal yalnızca TEK SATIR metindi (≈20 px). Bölüm listesi
          ~350 ms sonra gelince (canlı günlük: tıklandı 22:05:16.835 → liste
          22:05:17.186) altına sayaç satırı + 18rem'lik liste giriyor ve panelin
          yüksekliği ANİDEN ~320 px büyüyordu. Arada geçiş olmadığı için gözde
          "aşağı doğru katlanma" olarak görünüyordu.

          ÇÖZÜM: iskelet, gelen listenin kutusuyla AYNI ölçüde durur (h-72 = 18rem,
          listenin `max-h-72` sınırıyla birebir). Panel açılıştan sonra UZAMAZ;
          yalnızca içi dolar. `animate-pulse` yükleme boyunca yumuşak nefes verir.
        */
        <div className="mt-3" aria-hidden="true">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Bölüm listesi çekiliyor…
          </span>
          <div className="mt-2 h-72 animate-pulse rounded-xl border border-border bg-card/40" />
        </div>
      )}

      {status === "error" && (
        <div className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3">
          <p className="flex items-start gap-2 text-sm text-foreground">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>{problem}</span>
          </p>
          {/* Katalog çekilemediğinde ELLE ekleme yolunu GÖRÜNÜR kılar; form zaten
              `onManualAdd` ile panelin altında açılıp odaklanır (bkz. `load`). */}
          {onManualAdd ? (
            <Button
              size="sm"
              className="mt-2 rounded-full"
              onClick={() => onManualAdd()}
              title={`${seasonNumber}. sezonun bölümlerini elle ekle`}
            >
              <ListPlus size={14} /> Bölümleri elle ekle
            </Button>
          ) : null}
        </div>
      )}

      {status === "ready" && (
        <>
          {/*
            PART DEVAMI BİLGİSİ — kaydırma SESSİZCE uygulanmasın.
            Hangi kaydın (MAL kimliği) hangi numaralarla yazılacağı burada yazılıdır.
          */}
          {partOffset > 0 ? (
            <p
              className="animate-rise-in mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] font-bold text-amber-300"
              title="Bu kayıt sezonun DEVAMI (MAL'de Part N) olduğu için numaralar mevcut bölümlerin ardından sürüyor."
            >
              Part devamı (MAL {seasonMalId ?? "?"}): bölümler {partOffset + 1}–
              {partOffset + partMainCount} olarak numaralandı ·{" "}
              {partOffsetFromWritten
                ? "kaydırma yazılmış part'tan sabitlendi (her açılışta aynı)"
                : puffySourceRef.current !== null
                  ? `kaynakta ${puffySourceRef.current} bölüm`
                  : "kaynak bölüm sayısı okunmadı"}
            </p>
          ) : null}
          {/*
            KAYNAĞI OLMAYAN BÖLÜMLER — KALICI UYARI.

            Kullanıcı bildirimi (29.09.2026):
            "bölüm yöneticisine girince hangi yerde kaynak bölüm yok, neden
            söylemiyor? … ben de ona göre seçer, sadece o bölümü denerim."

            Liste satırlarında tek tek işaretlenir (amber "kaynak yok") ve burada
            toplu özetlenir. Düğme yalnızca KATALOGDA bulunanları seçer; katalogda
            olmayan (ör. sonradan eklenmiş part bölümleri) seçilemez, çünkü yazma
            yalnızca katalog listesindeki satırlar üzerinden yapılır.
          */}
          {missingBySource.length > 0 ? (
            <p className="animate-rise-in mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] font-bold text-amber-300">
              <AlertTriangle size={13} />
              {missingBySource.map((entry) => (
                <span
                  key={entry.id}
                  title={`${entry.short} yüklü OLMAYAN bölümler: ${entry.numbers.join(", ")}`}
                  className="rounded-full border border-amber-500/40 px-1.5 py-0.5"
                >
                  {entry.short}: {entry.numbers.length} bölüm yok
                  {entry.numbers.length <= 8 ? ` (${entry.numbers.join(", ")})` : ""}
                </span>
              ))}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setSelected(
                    new Set(
                      missingBySource
                        .flatMap((entry) => entry.numbers)
                        .filter((n) => list.some((ep) => ep.number === n)),
                    ),
                  )
                }
                className="rounded-full border border-amber-500/50 px-2 py-0.5 text-[11px] font-bold text-amber-200 hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                title="Seçili kaynaklardan en az biri eksik olan bölümleri seçer — sonra yazma düğmesine bas."
              >
                yalnızca eksikleri seç
              </button>
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {/* SATIR SEÇİMİ ARTIK VAR (kullanıcı isteği, 28.09.2026). Eskiden
                "satır seçimi yok" denmişti; o karar geri alındı. Sayının yanında
                tümünü seç / seçimi temizle düğmesi durur. */}
            {/*
              KISA ETİKET + TOOLTIP (kalıcı paragraf DEĞİL).
              Kullanıcı (27.09.2026): "ben böyle uzun uzun açıklama yap demedim ki,
              gereksiz karmaşık diyorum, şimdi oraya o yazıyı ekledin daha da karmaşık
              oldu." Bu yüzden açıklama paragrafı KALDIRILDI: ekranda yalnızca üç sayı
              ve iki kelimelik kaynak etiketi (`ani.zip`) var; ayrıntı fareyle üzerine
              gelince görünen `title`da duruyor.
            */}
            <span
              title={
                "Bölüm listesi ve bölüm adları ani.zip kataloğundan gelir. " +
                "“Yeni” = veritabanında henüz olmayan bölüm. " +
                "“Kontrol et” puffytr sayfasını okur ve KAYNAKTAKİ bölüm sayısını söyler — o sayı bizim sezonumuzunkinden farklı olabilir."
              }
            >
              <b className="text-foreground">{list.length}</b> bölüm ·{" "}
              <span className="text-[11px]">ani.zip</span> ·{" "}
              <b className="text-foreground">{missing.length}</b> yeni
            </span>
            {/*
          BÖLÜM ARA — sayaç satırına sığan MİNİK kutu (kullanıcı isteği:
          "arama kısmı da koy … kompakt minimal olsun").

          Uzun serilerde (One Piece) belli bölüme atlamak için: numara yaz,
          Enter'a bas → o bölümün sayfası açılır ve satır kısa süre vurgulanır.
          Yeni liste/panel açılmaz, mevcut görünüm bozulmaz.
        */}
            <span
              className="ml-auto flex items-center gap-1 rounded-full border border-border px-2"
              title="Bölüm numarası yaz ve Enter'a bas — o bölümün sayfası açılır"
            >
              <Search size={12} className="shrink-0 text-muted-foreground" />
              <input
                value={jump}
                onChange={(event) => setJump(event.target.value.replace(/[^0-9]/g, ""))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") jumpToEpisode();
                }}
                className="h-6 w-12 bg-transparent text-[11px] text-foreground outline-none"
                placeholder="bölüm"
                inputMode="numeric"
                aria-label="Bölüm numarasına git"
              />
            </span>
            {/* SEÇİM KONTROLÜ — satırlardaki tiklerle aynı işi topluca yapar. */}
            <span className="ml-auto flex items-center gap-1.5 text-[11px]">
              {/* İKON DÜĞMELER (kullanıcı, 28.09.2026): "tümünü seç / temizle
                  yazı yerine daha kompakt şık ikonlar koysana." Artık metin yok;
                  anlam `title` + `aria-label` ile veriliyor ve elle yazılmış
                  "kapsül düğme" yerine panelin diğer ikon düğmeleriyle (popover
                  başlığı, Kapat) aynı 24 px geometri kullanılıyor. */}
              {selected.size > 0 ? (
                <span className="font-bold text-emerald-600">{selected.size} bölüm seçili</span>
              ) : null}
              {selected.size < selectableNumbers.length ? (
                <button
                  type="button"
                  onClick={() => setSelected(new Set(selectableNumbers))}
                  title={
                    list.length > selectableNumbers.length
                      ? "Tümünü seç (0. bölüm/özel bölüm hariç — onu satırından işaretle)"
                      : "Tümünü seç"
                  }
                  aria-label="Tümünü seç"
                  className="grid size-6 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  <CheckCheck size={13} />
                </button>
              ) : null}
              {selected.size > 0 ? (
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  title="Seçimi temizle"
                  aria-label="Seçimi temizle"
                  className="grid size-6 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  <X size={13} />
                </button>
              ) : null}
              {/* ═══ SEÇİLİ BÖLÜMLERİ SİL (çöp kutusu ikonu) ═══
                  Kullanıcı isteği (28.09.2026): "sadece sağ tık niye var ki?
                  Tümünü seç düğmesinin yanına silme ikonu ekleyemez misin — öyle
                  SVG ikon duracak şekilde."

                  NEDEN BURADA: seçim zaten var ("Tümünü seç" / "Seçimi temizle"
                  ikonlarının yanı), yani silmek için yeni bir yer uydurmaya gerek
                  yok. Sağ tık menüsü yalnızca TEK bölümü siliyordu.
                  Yalnızca SEÇİM VARSA görünür — boşken panelde durmaz. */}
              {selected.size > 0 ? (
                <button
                  type="button"
                  onClick={() => void deleteSelectedEpisodes()}
                  disabled={busy}
                  title={`Seçili ${selected.size} bölümü tamamen sil`}
                  aria-label="Seçili bölümleri sil"
                  className="grid size-6 place-items-center rounded-full border border-destructive/40 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                >
                  <Trash2 size={13} />
                </button>
              ) : null}
            </span>
          </div>

          <ul className="mt-2 max-h-60 space-y-0.5 overflow-y-auto rounded-xl border border-border p-1.5">
            {/* SAYFA DİLİMİ: 1100 bölümlü seride panel donmasın diye yalnızca
                 görünen 50 satır çizilir (bkz. `LIST_PAGE_SIZE` notu). */}
            {pageList.map((ep) => {
              const exists = taken.has(ep.number);
              /** Satırın yazma durumu — ilerleme çubuğuna prop olarak geçer. */
              const row = rowProgress.get(ep.number);
              // (Burada eskiden `rename` bayrağı hesaplanıyordu; hem satır rozeti
              //  hem "Adları İngilizce'ye çevir" özelliği kaldırıldı — artık gerek yok.)
              return (
                <li
                  key={`${seasonNumber}-${ep.number}`}
                  /**
                   * SAĞ TIK → EMBED AYARI (kullanıcı isteği, 28.09.2026).
                   * Menü imlecin yanında açılır (bkz. `openRowMenu`).
                   */
                  onContextMenu={(event) => {
                    event.preventDefault();
                    void openRowMenu(ep.number, event.clientX, event.clientY);
                  }}
                  title="Sağ tık: embed adresi gir / düzenle"
                  className={`flex items-center gap-2 rounded-lg px-2 py-0.5 text-xs text-foreground ${
                    selected.has(ep.number) ? "bg-foreground/[0.06]" : ""
                  } ${
                    // ARAMA VURGUSU: yazılan bölüm bulununca satır kısa süre
                    // çerçevelenir (bkz. `jumpToEpisode`) — ulaştığın bölümü
                    // gözle bulmak zorunda kalmayasın.
                    highlight === ep.number ? "bg-primary/10 ring-1 ring-primary" : ""
                  }`}
                >
                  {/* BÖLÜM SEÇİMİ — yalnızca seçilenleri yazmak için (kullanıcı
                      isteği: "sadece 4. bölümün belli bir kaynağını indireceğim,
                      neden seçim yapmıyorum?"). Tarayıcının kendi kutusu KULLANILMAZ
                      (`accent-color` uygulanmadığı için mavi çiziliyordu — kaynak
                      çiplerindeki aynı çözüm); görünen işaret bizim. */}
                  <label
                    className="flex shrink-0 cursor-pointer items-center"
                    title={`${ep.number}. bölümü seç`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(ep.number)}
                      onChange={() => toggleSelected(ep.number)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={`grid size-3.5 place-items-center rounded-[4px] border ${
                        selected.has(ep.number)
                          ? "border-emerald-500 text-emerald-400"
                          : "border-muted-foreground/40 text-transparent"
                      }`}
                    >
                      <Check size={10} strokeWidth={3.5} />
                    </span>
                    <span className="sr-only">{ep.number}. bölümü seç</span>
                  </label>
                  <span className="w-20 shrink-0 font-bold">{ep.number}. Bölüm</span>
                  {/* `min-w-0`: esnek satırda kısalan başlık dar pencerede kutuyu
                      sağdan taşırmasın (taşma modalda kırpık görünüyordu). */}
                  <span className="min-w-0 truncate">{ep.title || "—"}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    {/* İLERLEME ÇUBUĞU — yazma sırasında 0 → 100 dolar, bitince
                        yeşil "yüklendi" yazar. Kullanıcı isteği (28.09.2026):
                        "hangi bölüm yükleniyorsa belli olsun." Yüzde gerçek işe
                        bağlıdır (bölümün kaç kaynağı denendi), zamanlayıcı yok. */}
                    {row ? (
                      <span className="flex items-center gap-1.5">
                        {row.status === "done" ? (
                          /* BİTEN SATIR SADELEŞTİRİLDİ (kullanıcı, 28.09.2026):
                             "yüklenenler de koyu yeşil olsun … yükleme yeri çok kaba
                             değil mi?" Her biten satırda dolu yeşil bir blok
                             duruyordu ve liste yeşil çubuklarla doluyordu. Artık
                             biten satırda ÇUBUK YOK — yalnızca sade bir ✓ + koyu
                             yeşil "yüklendi". */
                          <>
                            <Check size={11} strokeWidth={3.5} className="text-emerald-600" />
                            <span className="text-[10px] font-bold text-emerald-600">yüklendi</span>
                          </>
                        ) : row.status === "error" ? (
                          <span className="text-[10px] font-bold text-destructive">atlandı</span>
                        ) : (
                          <RowProgress row={row} />
                        )}
                      </span>
                    ) : loadedByNumber.has(ep.number) ? (
                      /*
                         KALICI "YÜKLENDİ" — SİLİNENE KADAR KALIR.
                         (kullanıcı, 28.09.2026: "yüzde yüze gelip 'yüklendi' yazdı
                         ya, oradaki o yazı burada kalacak silinene kadar. Ama şu an
                         gözükmüyor, neden? 'yüklendi' yok.")

                         SORUN: "yüklendi" yalnızca `rowProgress` (o oturumdaki yazma
                         ilerlemesi) üzerinden gösteriliyordu. Panel kapanıp yeniden
                         açıldığında `rowProgress` boşaldığı için **zaten yüklü olan
                         bölümler boş görünüyordu** — kullanıcı hangi bölümün yüklü
                         olduğunu göremiyordu.

                         ÇÖZÜM: canlı ilerleme yoksa `loadedByNumber` (veritabanından
                         okunan gerçek kaynak kapsaması) devreye girer. Böylece
                         yüklü bölüm "yüklendi" der ve **bölüm silinene kadar** öyle
                         kalır. Rozet metni kullanıcının istediği gibi "yüklendi";
                         eski "S1'de kayıtlı" ifadesi kullanılmaz.
                       */
                      <>
                        <Check size={11} strokeWidth={3.5} className="text-emerald-600" />
                        <span className="text-[10px] font-bold text-emerald-600">yüklendi</span>
                      </>
                    ) : taken.has(ep.number) && (loadedByNumber.get(ep.number)?.size ?? 0) === 0 ? (
                      /*
                        BÖLÜM VAR AMA HİÇ KAYNAĞI YOK → açıkça söylenir.
                        (Kullanıcı bildirimi, 29.09.2026: bu hâl eskiden `null` idi,
                        yani "hiç yok" ile AYNI görünüyordu.)

                        KISMİ eksiklik (bir kaynak var, öteki yok) burada değil,
                        aşağıdaki KAYNAK ROZETLERİNDE gösterilir.
                      */
                      <>
                        <AlertTriangle size={11} strokeWidth={3.5} className="text-amber-400" />
                        <span className="text-[10px] font-bold text-amber-400">kaynak yok</span>
                      </>
                    ) : null}

                    {/*
                      KAYNAK BAZINDA DURUM — SEÇİLİ TİKLER için, bölüm başına.
                      "Anizm ✓ · TauVideo ✗" gibi: hangi kaynak yüklü, hangisi eksik.
                      (Kullanıcı bildirimi, 29.09.2026.)
                    */}
                    {taken.has(ep.number)
                      ? pickedItems.map((item) => {
                          const has = loadedByNumber.get(ep.number)?.has(item.id) ?? false;
                          return (
                            <span
                              key={item.id}
                              title={`${item.short}: ${has ? "yüklü" : "yok"}`}
                              className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${
                                has
                                  ? "border-emerald-600/50 text-emerald-500"
                                  : "border-amber-500/50 text-amber-400"
                              }`}
                            >
                              {item.short} {has ? "✓" : "✗"}
                            </span>
                          );
                        })
                      : null}
                    {/* "BAŞLIK GÜNCELLENECEK" ROZETİ KALDIRILDI.
                         (kullanıcı, 28.09.2026: "başlık güncellenecek ne? biz oraya
                         başlık güncellemek için yazmıyoruz ki. Yüklenen bir şey
                         yüklendiyse orada 'yüklendi' yazısı olmalı.")

                         GEREKÇE: rozetin söylediği şey kullanıcının İŞİ değil. Satırın
                         sağı artık yalnızca gerçek durumu gösterir: yazma sırasında
                         "yükleniyor %", bitince kalıcı "yüklendi", başarısızsa
                         "atlandı". Zayıf başlıklar yazma sırasında yine düzeltilir
                         (`retitle`) — bu yalnızca ÖNCEDEN haber veren rozetti. */}
                    {/*
                "S1'de kayıtlı" ROZETİ KALDIRILDI.
                (kullanıcı, 28.09.2026: "yüklü olanlarda 'S1'de kayıtlı' falan bunu
                sil, yok et tamamen.")

                Kullanıcı liste boyunca tekrar eden bu yeşil rozeti gürültü buluyor:
                yazma ilerledikçe her satırın yanında "yüklendi" durumu zaten
                görünüyor, ayrıca kalıcı bir "kayıtlı" etiketi gereksiz.

                DİKKAT: yazma sırasındaki ilerleme çubuğu ve "yüklendi" etiketi
                KORUNDU — yalnızca önceden kayıtlı olanları işaretleyen rozet gitti.
                (Satırın kendi rengini değiştirmiyordu; başlık metni zaten normal
                beyaz kalıyordu.)
              */}
                  </span>
                </li>
              );
            })}
            {list.length === 0 && (
              <li className="px-2 py-3 text-sm text-muted-foreground">
                Bu sezon için katalogda bölüm yok.
              </li>
            )}
          </ul>

          {/* SAYFALAYICI — yalnızca birden fazla sayfa varsa görünür (tek sayfalık
               sezonlarda panelde fazladan satır kaplamaz). Seçim/aralık TÜM listeyi
               kapsar; buradaki sayfa yalnızca görünen satırları değiştirir. */}
          {pageCount > 1 ? (
            <div className="mt-2 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
              <button
                type="button"
                onClick={() => setPage(Math.max(0, safePage - 1))}
                disabled={safePage === 0}
                title="Önceki sayfa"
                aria-label="Önceki sayfa"
                className="grid size-6 place-items-center rounded-full border border-border transition-colors hover:border-foreground/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft size={13} />
              </button>
              <span className="font-bold">
                {safePage + 1}/{pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                disabled={safePage >= pageCount - 1}
                title="Sonraki sayfa"
                aria-label="Sonraki sayfa"
                className="grid size-6 place-items-center rounded-full border border-border transition-colors hover:border-foreground/30 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight size={13} />
              </button>
            </div>
          ) : null}

          {/*
             YAZMA ALANI — sadeleştirildi (kullanıcı, 28.09.2026: "yükleme yeri çok
             kaba değil mi sence de"). Yeni sıra: solda **Aralık** (uzun seriler için
             parça parça yazma), sağda düğme. Alanlar boşsa eskisi gibi TÜM bölümler
            yazılır; yani varsayılan davranış değişmedi.

             SIKIŞIK SATIR (kullanıcı bildirimi): aralık + düğme az yer kaplasın,
             temiz dursun. Sticky denenip beğenilmedi — normal akışta, liste
             kısaltıldığı için düğmeye kayırmadan ulaşılır.
          */}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border/70 bg-card/40 px-2 py-1">
            <span className="flex items-center gap-1 text-[11px] font-bold text-muted-foreground">
              Aralık
              <input
                className={`${inputCls} h-6 w-11 text-center text-[11px]`}
                value={rangeFrom}
                onChange={(event) => setRangeFrom(event.target.value)}
                placeholder="ilk"
                inputMode="numeric"
                aria-label="Başlangıç bölüm numarası"
              />
              <span aria-hidden="true">–</span>
              <input
                className={`${inputCls} h-6 w-11 text-center text-[11px]`}
                value={rangeTo}
                onChange={(event) => setRangeTo(event.target.value)}
                placeholder="son"
                inputMode="numeric"
                aria-label="Bitiş bölüm numarası"
              />
            </span>
            <Button
              size="sm"
              className="ml-auto h-7 rounded-full px-3 text-[11px] font-bold shadow-sm"
              onClick={() => void writeSelected()}
              disabled={
                busy ||
                list.length === 0 ||
                targetList(pickedItems).length === 0 ||
                pickedCount === 0 ||
                (isPicked(ANIMECIX_SOURCE_ID) && !animecixId)
              }
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <CloudDownload size={14} />}
              {/*
                DÜĞME NE YAZACAĞINI İSMİYLE SÖYLER.
                Kullanıcı (27.09.2026): "yükleme şeyini çok saçma kurmuşsun,
                anlaşılmıyor neyin nereden geldiği." Eskiden düğme "seçtiğim
                kaynaklar" diyordu ve hangi kaynakların yazılacağı YALNIZCA yukarıdaki
                kutulardan çıkarılabiliyordu. Artık seçili kaynakların adı düğmenin
                kendisinde yazıyor → basmadan önce ne yazılacağı belli.
              */}
              {pickedCount === 0
                ? "Önce yukarıdan kaynak seç"
                : targetList(pickedItems).length === 0
                  ? /*
                       ZATEN YÜKLÜ: düğme iş yapmayacağını AÇIKÇA söyler ve
                       devre dışı kalır. Kısa metin: sağda, aralık satırıyla
                       AYNI hizada dursun (uzun cümle alta sarkıyordu).
                    */
                    `✓ ${baseTargets().length} bölüm yüklü`
                  : `${pickedItems
                      .map((item) => item.short.split(" / ")[0] ?? item.short)
                      .join(" + ")} → ${targetList(pickedItems).length} bölüme yaz${
                      targetList(pickedItems).length === list.length
                        ? ""
                        : selected.size > 0
                          ? ` (seçili)`
                          : ` (aralık)`
                    }${
                      // Kaç bölümün atlandığını da söyle: kullanıcı "neden 12 değil"
                      // diye düşünmesin.
                      baseTargets().length > targetList(pickedItems).length
                        ? ` · ${baseTargets().length - targetList(pickedItems).length} zaten yüklü`
                        : ""
                    }`}
            </Button>
            {progress && (
              <span className="animate-rise-in text-xs font-bold text-muted-foreground">
                Kaynak yazılıyor: {progress.done}/{progress.total}
                {progress.fail.length > 0 ? ` · ${progress.fail.length} başarısız` : ""}
              </span>
            )}
            {/* CANLI HIZ — gerçek ölçüm (bölüm/sn · geçen süre · tahmini kalan). */}
            {progress && runStartedAt > 0 ? (
              <RunRate done={progress.done} total={progress.total} startedAt={runStartedAt} />
            ) : null}
            {busy && !progress ? (
              <span className="animate-rise-in text-xs font-bold text-muted-foreground">
                kaydediliyor…
              </span>
            ) : null}
            {/*
              ADLARI KATALOGDAN YENİLE — veritabanındaki adlar eski senkronlardan
              Türkçe kalmış olabilir (bkz. `retitleFromCatalog` notu). Bu düğme
              yalnızca `title` alanını orijinal İngilizce adla değiştirir; kaynaklar
              ve yayın adresleri ELLENMEZ. Zaten doğru olan satırlar atlanır.
            */}
            {/*
              "ADLARI İNGİLİZCE'YE ÇEVİR" DÜĞMESİ KALDIRILDI.
              (kullanıcı, 28.09.2026: "tamamen gereksiz özellik, onu sil yok et
              kalıntısız.") Aynı sebeple "Bu sezondaki N bölümün başlığı da
              yerinde." bilgi satırı da kaldırıldı — ikisi de aynı özelliğin
              parçasıydı. Yazma sırasında başlıklar yine katalogdan gelir.
            */}
          </div>

          {/* BİLGİ: hata olmayan satırlar (ör. otomatik düzeltilen adres). */}
          {notes.length > 0 && (
            <div className="mt-2 rounded-xl border border-border bg-card/60 p-2.5">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                Bilgi
              </p>
              <ul className="mt-1 space-y-1 text-[11px] leading-4 text-foreground">
                {notes.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          {/* YÜKLEME KAYDI (kullanıcı isteği): bölüm → KAYNAK kırılımı. "12 bölüm
              başarısız" cümlesinden hangi bölümün/kaynağın nerede takıldığı
              anlaşılmıyordu; bu liste satır satır gösterir ve ekranda KALIR. */}
          <ImportLogList entries={runLog} running={busy} onClear={() => setRunLog([])} />

          {/* KALICI RAPOR: hangi sağlayıcı, hangi bölümler, HANGİ SEBEP. Toast
              kaybolduktan sonra da burada durur (kullanıcı "Anizm neden yok?"
              sorusunu sonradan soruyor). */}
          {unresolved.length > 0 && (
            <div className="mt-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-amber-500">
                <AlertTriangle size={13} /> Yazılamayan kaynaklar
              </p>
              <ul className="mt-1 space-y-1 text-[11px] leading-4 text-foreground">
                {unresolved.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          {/*
            SAĞ TIK MENÜSÜ — bölüme MANUEL EMBED girmek için.
            (kullanıcı isteği, 28.09.2026: "embed için bölümün sütuna sağ tık yapıp
            öyle ayarlama seçeneği falan ona göre ayarla.")

            NEDEN PORTAL: panel kartlarının `overflow` kırpması ve `z` katmanı
            menüyü kesebilirdi; gövdeye taşınarak her zaman en üstte açılır.
            Menü İMLECİN YANINDA belirir ve ekran kenarında taşmaz.

            İÇERİK KORUNUR: bu menü yalnızca `manual` satırını yazar/siler;
            mevcut anizm/animecix/megaplay kaynakları ASLA ellenmez.
          */}
          {rowMenu
            ? createPortal(
                <div
                  className="fixed inset-0 z-[80]"
                  onClick={() => setRowMenu(null)}
                  // Sağ tık da kapatır (ikinci sağ tık menüyü üst üste açmasın).
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setRowMenu(null);
                  }}
                >
                  <div
                    className="animate-modal-panel absolute w-72 rounded-xl border border-border bg-background p-3 shadow-2xl"
                    style={{
                      left: Math.min(rowMenu.x, Math.max(8, window.innerWidth - 300)),
                      top: Math.min(rowMenu.y, Math.max(8, window.innerHeight - 170)),
                    }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground">
                      {rowMenu.number}. Bölüm · Embed
                    </p>
                    {menuEpisodeId ? (
                      <>
                        <input
                          className={`${inputCls} mt-2 h-8 text-xs`}
                          value={embedDraft}
                          onChange={(event) => setEmbedDraft(event.target.value)}
                          placeholder="embed adresi ya da iframe kodu"
                          aria-label={`${rowMenu.number}. bölüm embed adresi`}
                          autoFocus
                        />
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            className="h-7 rounded-full px-3 text-xs"
                            disabled={embedBusy}
                            onClick={() => void saveEmbed()}
                          >
                            {embedBusy ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Save size={12} />
                            )}{" "}
                            Kaydet
                          </Button>
                          <span className="text-[10.5px] text-muted-foreground">
                            Boş bırakıp kaydet → embed kaldırılır
                          </span>
                        </div>
                        {/* ═══ KAYNAK SİLME (tek bölüm) ═══
                            Kullanıcı isteği (28.09.2026): "ben kaynağı nasıl silcem?
                            Yanlarda silme yeri yok … silip tekrar yeni kaynaktan
                            yüklemem gerekiyor."

                            Kaynaklar yazıldıktan sonra GERİ ALMA YOLU YOKTU.
                            Bu düğme yalnızca `episode_sources` satırlarını temizler:
                            BÖLÜM KAYDI VE ADI KALIR, yeniden yazabilirsin.
                            Yıkıcı olduğu için SİTEYE ÖZEL onay penceresi ister
                            (`confirmAction`). */}
                        <div className="mt-2 border-t border-border pt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 rounded-full border-destructive/40 px-3 text-xs text-destructive hover:bg-destructive/10"
                            disabled={embedBusy}
                            onClick={() => void clearEpisodeSources()}
                            title="Bu bölümün yazılmış TÜM kaynaklarını siler; bölüm kaydı ve adı KALIR"
                          >
                            <Trash2 size={12} /> Kaynakları sil
                          </Button>
                        </div>
                      </>
                    ) : (
                      <p className="mt-1.5 text-[11px] leading-4 text-amber-500">
                        Bu bölüm henüz veritabanında yok — önce kaynak yazılmalı.
                      </p>
                    )}
                  </div>
                </div>,
                document.body,
              )
            : null}
        </>
      )}
    </div>
  );
}

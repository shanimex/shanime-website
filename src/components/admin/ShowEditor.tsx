import { ImagePlus, ListVideo, Loader2, Save, Search, Star, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ImageDrop } from "@/components/admin/ImageDrop";
import { SeasonsPanel } from "@/components/admin/SeasonsPanel";
import { AnizipSyncProvider } from "@/components/admin/AnizipSyncProvider";
import { toast } from "@/lib/admin-toast";
import { db, inputCls, slugify, uniqueSlug } from "@/lib/admin";
import { cn } from "@/lib/utils";
import { showSlug } from "@/lib/content";
import { isPartContinuation } from "@/lib/puffy";
import { heroVideoSource } from "@/lib/hero-video";
/**
 * MAL ARAMASI + 404 MESAJI ARTIK ORTAK YARDIMCIDAN GELİR.
 * Aynı AniList sorgusu burada ve `AddShowButton` içinde kopyalanmıştı; tek kaynak
 * `lib/mal-search.ts` oldu (gerekçe o dosyanın başında).
 */
import { malIdMissText, searchMal, type MalHit } from "@/lib/mal-search";
import {
  deleteImage,
  signImagePath,
  uploadImage,
  uploadVideo,
  type ShowWithImage,
} from "@/lib/content";

type CatalogRequest = {
  malId: number | null;
  newSeason: boolean;
  part: boolean;
  title: string;
  format: string | null;
  autoRepair?: boolean;
};

export function ShowEditor({
  show,
  takenSlugs,
  schemaReady,
  onToggleFeatured,
  onReload,
  autoRepairSources = false,
  onAutoRepairHandled,
}: {
  show: ShowWithImage;
  /** Bu seri hariç, sistemde kullanılan slug'lar. */
  takenSlugs: (string | null)[];
  schemaReady: boolean;
  onClose: () => void;
  onToggleFeatured: () => void;
  onReload: (message: string) => void;
  autoRepairSources?: boolean;
  onAutoRepairHandled?: () => void;
}) {
  const [title, setTitle] = useState(show.title);
  const [subtitle, setSubtitle] = useState(show.subtitle ?? "");
  const [description, setDescription] = useState(show.description ?? "");
  const [year, setYear] = useState(show.year ?? "");
  const [genre, setGenre] = useState(show.genre ?? "");
  const [slugInput, setSlugInput] = useState(show.slug ?? "");
  /**
   * MAL KİMLİĞİ — katalog (ani.zip) bu kimlik olmadan SORGULANAMAZ.
   *
   * ── NEDEN EKLENDİ (kullanıcı, 28.09.2026) ──────────────────────────────────
   * Kullanıcı "Jujutsu Kaisen 0" filmini ekledi ve katalog panelinde şu hatayı
   * aldı: "Bu serinin MAL kimliği yok — seri ayarlarından MAL kimliğini doldur."
   * AMA BU ALAN HİÇ YOKTU: `ShowEditor` yalnızca başlık, alt başlık, açıklama,
   * yıl, tür ve slug kaydediyordu. Yani panel kullanıcıyı VAR OLMAYAN bir yere
   * yönlendiriyordu — film/dizi ekleme akışı burada tıkanıyordu.
   * (Ölçüm: `mal_id` migrasyon dosyalarında yok, kolon veritabanında elle
   * açılmış; okunuyordu ama panelden HİÇ yazılamıyordu.)
   *
   * ── HANGİ DEĞER GİRİLİR ───────────────────────────────────────────────────
   * `myanimelist.net` adresindeki sayı: `.../anime/48561` → **48561**.
   * Örn. Jujutsu Kaisen 0 (film, 2021) = 48561.
   * Bilmiyorsan aşağıdaki "MAL'de ara" düğmesi başlığa göre arar ve doldurur.
   */
  const [malInput, setMalInput] = useState(show.mal_id ? String(show.mal_id) : "");
  /**
   * KAYIT TÜRÜ — seri mi film mi. Panelde iki ayrı bölümde listelenir.
   *
   * Kolon veritabanında yoksa `show.kind` `undefined` gelir → "series" varsayılır
   * (bkz. `lib/content.ts` `kind` notu). Yazma AYRI bir istekle yapılır: kolon
   * yoksa bile diğer alanların (başlık, yıl, tür…) kaydedilmesi engellenmez.
   */
  const [kind, setKind] = useState<"series" | "movie">(show.kind === "movie" ? "movie" : "series");
  /**
   * FARKLI SERİYE GEÇİNCE formu tazele.
   *
   * Kutular yalnızca ilk `show`tan kuruluyordu; üst bileşen başka seriye
   * geçince eski serinin değerleri kalıyordu. Kimlik değişimi izlenir —
   * aynı seride yeniden çizim yazdıklarnı silmez (yalnızca kimlik değişince).
   */
  const syncedShowId = useRef(show.id);
  useEffect(() => {
    if (syncedShowId.current === show.id) return;
    syncedShowId.current = show.id;
    setTitle(show.title);
    setSubtitle(show.subtitle ?? "");
    setDescription(show.description ?? "");
    setYear(show.year ?? "");
    setGenre(show.genre ?? "");
    setSlugInput(show.slug ?? "");
    setMalInput(show.mal_id ? String(show.mal_id) : "");
    setKind(show.kind === "movie" ? "movie" : "series");
  }, [show]);
  /**
   * MAL EŞLEŞMESİ ONAY SAYACI — katalog popup'ını kendiliğinden açar.
   *
   * Kullanıcı isteği (28.09.2026): "MAL'de ara yaptıktan sonra açılacak dedim;
   * katalog düğmesini oradan yok et." Her onaylı eşleşmede istek doğar ve
   * `SeasonsPanel` ilk sezonun katalog popup'ını açar.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * NEDEN SAYAÇ DEĞİL DE TEK SEFERLİK İSTEK (ölçülen kusur, 28.09.2026)
   *
   * Eskiden burada bir SAYAÇ (`catalogSignal`) tutuluyor ve panel içindeki
   * `catalogSignalSeen` ile karşılaştırılıyordu. `seen` panelin KENDİ durumuydu:
   * panel her kapanıp yeniden açıldığında 0'a dönüyor, sayaç ise burada kalıyordu
   * → `signal !== seen` → **"Bölüm Yöneticisi"ne her basışta katalog popup'ı
   * kendiliğinden açılıyordu.**
   *
   * CANLI GÜNLÜK KANITI (`.dev-log.jsonl`):
   *   19:31:29 tıklandı: Bölüm Yöneticisi → 19:31:30 katalog listesi yüklendi
   *   19:33:37 tıklandı: Bölüm Yöneticisi → 19:33:39 katalog listesi yüklendi
   * (Kullanıcı şikâyeti: "basıyorum bir şey açılmıyor, bir daha basıyorum
   * açılmıyor … mantıklı yap.")
   *
   * YENİ MODEL: üst bileşen yalnızca "istek var mı" der; panel popup'ı açtıktan
   * sonra `onCatalogOpenHandled` ile isteği TÜKETİR. Tüketim burada (üst
   * bileşende) tutulduğu için panel kapanıp yeniden açılsa bile istek YENİDEN
   * DOĞMAZ — her basışta popup fırlamaz.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  const [catalogRequest, setCatalogRequest] = useState<CatalogRequest | null>(null);
  const [catalogQueue, setCatalogQueue] = useState<CatalogRequest[]>([]);
  /* Arama sonuçlarından aynı anda seçilecek MAL kayıtları. */
  const [selectedMalIds, setSelectedMalIds] = useState<number[]>([]);
  /** MAL arama sonuçları (kimlik · başlık · biçim · yıl) — tıklayınca kimlik dolar. */
  const [malHits, setMalHits] = useState<MalHit[]>([]);
  /**
   * Aramanın ÖZET satırı — "kaç eşleşme bulundu / ne yapmalısın".
   *
   * Kullanıcı isteği (28.09.2026): "bana listeyi sunması gerekli". Liste artık her
   * zaman çizildiği için bu satır, listeyi görmezden gelip ne yapacağını
   * bilemeyen kullanıcıya yol gösterir (tek eşleşmede satıra tıklamak gerekir).
   */
  const [malNotice, setMalNotice] = useState<string | null>(null);
  const [malBusy, setMalBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [bannerUrl, setBannerUrl] = useState<string>(show.banner_image ?? "");
  const autoRepairSeen = useRef(false);

  useEffect(() => {
    if (!autoRepairSources || autoRepairSeen.current) return;
    autoRepairSeen.current = true;
    setEpisodesOpen(true);
    setCatalogRequest({
      malId: null,
      newSeason: false,
      part: false,
      title: "",
      format: null,
      autoRepair: true,
    });
    onAutoRepairHandled?.();
  }, [autoRepairSources, onAutoRepairHandled]);

  useEffect(() => {
    setBannerUrl(show.banner_image ?? "");
  }, [show.banner_image]);

  /**
   * AÇIKLAMA KUTUSU OTOMATİK BÜYÜR — sabit yükseklikte metin taşınca tarayıcı
   * kendi kaydırma çubuğunu gösteriyordu (kullanıcı bildirimi, 03.10.2026:
   * "mobilde scrollbar neden olur, yok et"). Kutu artık içeriğe göre uzar;
   * `resize-none overflow-hidden` ile de elle boyutlandırma ve çubuk kapalı.
   */
  const descRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [description]);

  async function handleCover(file: File) {
    setBusy(true);
    try {
      const previous = show.image_path;
      const path = await uploadImage(file, "posters");
      const { error } = await db.from("shows").update({ image_path: path }).eq("id", show.id);
      if (error) throw error;
      // Eski dosya depoda birikmesin: yenisi onun yerine geçti.
      await deleteImage(previous);
      onReload(`"${show.title}" kapağı güncellendi.`);
    } catch (error) {
      toast.error(
        "Kapak güncellenemedi: " + (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleBanner(file: File) {
    setBusy(true);
    try {
      const previous = show.banner_image_path ?? "";
      const path = await uploadImage(file, "banners");
      const { error } = await db
        .from("shows")
        .update({ banner_image_path: path })
        .eq("id", show.id);
      if (error) throw error;
      await deleteImage(previous);
      setBannerUrl(await signImagePath(path));
      onReload(`"${show.title}" yatay kapağı güncellendi.`);
    } catch (error) {
      toast.error(
        "Banner yüklenemedi: " + (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setBusy(false);
    }
  }

  /** Vitrin videosunu (mp4) değiştirmenin tek yolu: buradan yükle. */
  async function handleVideo(file: File) {
    setBusy(true);
    try {
      const previous = show.banner_video_path ?? "";
      const path = await uploadVideo(file, "banners");
      const { error } = await db
        .from("shows")
        .update({ banner_video_path: path })
        .eq("id", show.id);
      if (error) throw error;
      await deleteImage(previous);
      onReload(`"${show.title}" vitrin videosu güncellendi.`);
    } catch (error) {
      toast.error("Video yüklenemedi: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  }

  /**
   * MAL ARAMASI — **İSİM ya da MAL KİMLİĞİ** ile.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * KULLANICI İSTEĞİ (28.09.2026): "MAL kimliği veya isim ile ara olarak
   * güncellesene altyapıyı."
   *
   * ── DÜZELTİLEN KUSUR (canlı gözlem) ─────────────────────────────────────────
   * İlk sürüm YALNIZCA başlıkla arıyordu ve sonucu kullanıcının TIKLAMASI
   * gerekiyordu. Kullanıcı aramayı çalıştırdı, tek sonuç geldi (`48561 JUJUTSU
   * KAISEN 0 · MOVIE`) ama satıra tıklamadığı için "MAL kimliği" kutusu BOŞ
   * kaldı; ardından Kaydet'e basınca `mal_id` boş (null) yazıldı. Kullanıcı
   * bunu "basınca bir şey olmuyor, siliyor galiba" diye bildirdi.
   *
   * ── YENİ DAVRANIŞ (revizyon: 28.09.2026, akşam) ─────────────────────────────
   *  1. Kutuda SAYI varsa → doğrudan o kimlik SORGULANIR (isim araması yapılmaz).
   *     Böylece kullanıcı bildiği kimliği yazıp DOĞRULAYABİLİR.
   *  2. Kutu boşsa → başlıkla aranır.
   *  3. **Sonuç listesi HER ZAMAN gösterilir** — tek eşleşmede bile. Kullanıcı
   *     isteği: "liste açık kalsın, satıra ben tıklayıp seçeyim" + "bana listeyi
   *     sunması gerekli."
   *
   * ── OTOMATİK ONAY KALDIRILDI (neden geri alındı) ────────────────────────────
   * Önceki sürüm tek eşleşmeyi kendiliğinden onaylıyor ve sonuç SATIRINI hiç
   * çizmiyordu. Amaç boş kimlikle kaydetme kazasını önlemekti; ancak kullanıcı
   * neyin bulunduğunu göremediği için "listeyi sunmuyor" diye bildirdi. Artık
   * satır her hâlükârda görünür ve seçim kullanıcıya bırakılır.
   *
   * ⚠️ Bilinçli bedel: satıra tıklanmazsa kutu DOLMAZ. Bu yüzden kutunun yanında
   * "kaydedilmemiş / kayıtlı / yok" durumu açıkça yazılır — sessiz kalma yok.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  async function runMalSearch() {
    const typedId = Number.parseInt(malInput.trim(), 10);
    const byId = Number.isFinite(typedId) && typedId > 0;
    const query = title.trim();
    if (!byId && !query) {
      toast.error("Bir ad yaz ya da MAL kimliğini gir, sonra ararım.");
      return;
    }
    setMalBusy(true);
    setMalHits([]);
    setSelectedMalIds([]);
    setMalNotice(null);
    try {
      /**
       * SORGU ARTIK ORTAK YARDIMCINDA (`lib/mal-search.ts` → `searchMal`).
       * Buradaki davranış AYNEN korunur: kimlikle arama tek kayıt, adla arama
       * sayfa döner; ikisi de aynı `MalHit` biçimine indirgenir.
       */
      const hits = await searchMal({ malId: byId ? typedId : null, title: query });
      // Dizi aramasında gerçek sezon/OVA kayıtları; film aramasında MOVIE ve
      // SPECIAL kayıtları gösterilir. Böylece film sonucu dizi sezonuna yanlış
      // yazılmaz, OVA ise hedef sezonun içine eklenmek üzere görünür.
      const visibleHits = hits.filter((hit) => {
        const format = String(hit.format ?? "").toUpperCase();
        return kind === "movie"
          ? format === "MOVIE" || format === "SPECIAL"
          : format === "TV" || format === "OVA" || format === "ONA";
      });
      // LİSTE HER ZAMAN ÇİZİLİR — tek eşleşmede de. Otomatik onay kaldırıldı
      // (gerekçe yukarıdaki "OTOMATİK ONAY KALDIRILDI" notunda).
      setMalHits(visibleHits);
      setMalNotice(
        visibleHits.length === 0
          ? null
          : visibleHits.length === 1
            ? "Tek eşleşme bulundu — kullanmak için satıra tıkla."
            : `${visibleHits.length} eşleşme bulundu — birini seç.`,
      );
      if (visibleHits.length === 0) {
        toast.error(byId ? malIdMissText(typedId) : "Sonuç bulunamadı — adı farklı yazmayı dene.");
      }
    } catch (error) {
      /*
        ANILIST 404 = "bu kimlikte kayıt yok". Ölçüm (kullanıcı isteği, 29.09.2026:
        "sitede hata falan var mı kontrol et"): canlı günlükte 17:57:11 · `404 /`
        gövdesi `{"errors":[…Not Found…],"data":{"Media":null}}`. Teknik "AniList 404"
        yerine ne yapılacağını söyleyen mesaj verilir; arama akışı çökmüyor, yalnızca
        mesaj anlaşılmaz kalıyordu.
      */
      const message = error instanceof Error ? error.message : String(error);
      toast.error(
        message.includes("404")
          ? byId
            ? malIdMissText(typedId)
            : "AniList araması 404 döndü — birazdan tekrar dene."
          : "MAL araması başarısız: " + message,
      );
    } finally {
      setMalBusy(false);
    }
  }

  /**
   * MAL EŞLEŞMESİNİ ONAYLA.
   *
   * Kimliği kutuya yazar, sonuç listesini kapatır, **bölüm panelini açar** ve
   * katalog popup'ını tetikler. Tek sonuç çıktığında ve kullanıcı listeden
   * seçtiğinde AYNI yol kullanılır — böylece iki durumda farklı davranış olmaz.
   *
   * NEDEN BÖLÜM PANELİ AÇILIYOR: katalog popup'ı `SeasonsPanel`'in içinde
   * yaşadığı için o panel kapalıyken popup çizilemez.
   */
  /**
   * "BÖLÜM YÖNETİCİSİ" — bölüm/katalog panelini AÇAR.
   *
   * Gerekçe butondaki nota bakınız: sarmalayıcı panelin gövdesi (sezon listesi)
   * kullanıcı isteğiyle kaldırıldığı için panelin içi boştu; asıl bölüm yönetimi
   * katalog popup'ında yaşıyor. Bu yüzden buton, paneli bağlar ve popup isteğini
   * doğurur.
   *
   * Her basışta yeniden istek doğar (istek açılışta tüketilir) → panel kapalıyken
   * de açıkken de basış işe yarar; "ikinci basış hiçbir şey yapmıyor" durumu yok.
   */
  function openEpisodeManager() {
    setEpisodesOpen(true);
    // Kimlik belirtilmez: panel kendi seçili/ilk sezonunu açar.
    setCatalogRequest({ malId: null, newSeason: false, part: false, title: "", format: null });
  }

  function requestForMal(hit: MalHit): CatalogRequest {
    const part = isPartContinuation(hit.title);
    return {
      malId: hit.malId,
      newSeason: !part && Boolean(show.mal_id) && hit.malId !== show.mal_id,
      part,
      title: hit.title,
      format: hit.format ?? null,
    };
  }

  function toggleMalSelection(hit: MalHit) {
    setSelectedMalIds((current) =>
      current.includes(hit.malId)
        ? current.filter((id) => id !== hit.malId)
        : [...current, hit.malId],
    );
  }

  function startBulkCatalog() {
    const selected = malHits.filter((hit) => selectedMalIds.includes(hit.malId));
    if (selected.length === 0) return;
    const movieHits = selected.filter((hit) => String(hit.format ?? "").toUpperCase() === "MOVIE");
    const catalogHits =
      kind === "movie"
        ? selected
        : selected.filter((hit) => String(hit.format ?? "").toUpperCase() !== "MOVIE");
    if (movieHits.length > 0 && kind !== "movie") {
      toast.info(
        `${movieHits.length} film sonucu ayrı Film kaydı olarak eklenmeli; dizi sezonlarına karıştırılmadı.`,
      );
    }
    if (catalogHits.length === 0) return;
    const requests = catalogHits.map(requestForMal);
    const firstRequest = requests[0];
    if (!firstRequest) return;
    setMalInput(String(firstRequest.malId));
    setSelectedMalIds([]);
    setMalHits([]);
    setMalNotice(null);
    setEpisodesOpen(true);
    setCatalogQueue(requests.slice(1));
    setCatalogRequest(firstRequest);
    toast.success(`${requests.length} MAL kaydı seçildi — kataloglar sırayla açılacak.`);
  }

  function confirmMal(malId: number, malTitle: string, malFormat?: string) {
    setMalInput(String(malId));
    setMalHits([]);
    setMalNotice(null);
    setEpisodesOpen(true);
    /**
     * YENİ SEZON MU? — kullanıcı isteği (29.09.2026): "ilk sezon için bir id
     * girdiysem otomatik 1. sezon oluyor; sonra tekrar girince OTOMATİK SIRADAKİ
     * sezon olarak kendi yaratması/algılaması gerek."
     *
     * Kural: serinin KAYITLI kimliği varsa ve girilen kimlik ondan FARKLIysa, bu
     * yeni bir sezonun kimliğidir. Serinin kimliği yoksa (ilk kayıt) bu, serinin
     * kimliğidir — sezon açılmaz.
     */
    /**
     * PART (KISIM) KONTROLÜ — PART KAYDI YENİ SEZON AÇMAZ.
     *
     * ÖLÇÜLMÜŞ OLAY (29.09.2026): MAL 39535 (Mushoku Tensei S1, 11 bölüm) yazıldı;
     * ardından MAL 45576 — MAL'in kendi ilişkisine göre bu S1'in "Part 2"sidir
     * (12 bölüm) → TEK sezon, toplam 23 bölüm. Sistem onu yeni sezon sayıp S2
     * olarak yükledi. Bu kontrol o kaydı mevcut sezonun devamı olarak işler.
     */
    const part = isPartContinuation(malTitle);
    const newSeason = !part && Boolean(show.mal_id) && malId !== show.mal_id;
    /**
     * ⚠️ `newSeason`/`part` yalnızca İPUCUDUR — KESİN KARAR PANELDE VERİLİR.
     *
     * ÖLÇÜLEN KUSUR (kullanıcı bildirimi, 29.09.2026): "S1'i işleyip sonra S1'i
     * tekrar ekleyince 2. sezon olarak atıyor." Buradaki kural girilen kimliği
     * MEVCUT SEZONLARLA (`show_seasons.mal_id`) KARŞILAŞTIRMIYORDU; bu yüzden
     * zaten bir sezonun kimliği olan bir numara yeniden girilince panel onu
     * "sıradaki sezon" sanıp yeni sezon açabiliyordu. Doğru karar (mevcut sezonun
     * kimliği mi / devam part'ı mı / gerçekten yeni sezon mu) yalnızca sezon
     * listesini gören `SeasonsPanel`de verilebilir; bu yüzden kimlik buraya öyle
     * geçirilir ve `newSeason` yalnızca ipucu olarak kullanılır.
     */
    // TEK SEFERLİK istek: panel açtıktan sonra tüketir (gerekçe `catalogRequest` notunda).
    setCatalogRequest({ malId, newSeason, part, title: malTitle, format: malFormat ?? null });
    toast.success(
      newSeason
        ? `MAL ${malId} · ${malTitle || "(ad yok)"} — SIRADAKİ sezon için katalog açılıyor`
        : part
          ? `MAL ${malId} · ${malTitle || "(ad yok)"} — SEZONUN DEVAMI (part): numaralar mevcut bölümlerden sürer`
          : `MAL ${malId} · ${malTitle || "(ad yok)"} — katalog açılıyor`,
    );
  }

  async function save() {
    if (!title.trim()) {
      toast.error("Başlık boş olamaz.");
      return;
    }
    setSaving(true);
    const nextSlug = uniqueSlug(slugify(slugInput.trim() || title), takenSlugs);
    // MAL kimliği: yalnızca geçerli bir pozitif tam sayı yazılır, boşsa null.
    const malId = Number.parseInt(malInput.trim(), 10);
    const { error } = await db
      .from("shows")
      .update({
        title: title.trim(),
        subtitle: subtitle.trim(),
        description: description.trim(),
        year: year.trim(),
        genre: genre.trim(),
        slug: nextSlug,
        mal_id: Number.isFinite(malId) && malId > 0 ? malId : null,
      })
      .eq("id", show.id);
    setSaving(false);
    if (error) {
      toast.error("Kaydedilemedi: " + error.message);
      return;
    }
    /**
     * TÜR AYRI YAZILIR — bilerek.
     *
     * `shows.kind` kolonu bir migration ile gelir. Kolon yokken `kind` alanını
     * ANA güncellemeye koysaydım, tüm kayıt hata verir ve kullanıcı başlığı bile
     * kaydedemezdi. Ayrı istek sayesinde diğer alanlar her hâlükârda yazılır;
     * yalnızca tür yazılamaz ve sebebi açıkça söylenir.
     */
    let kindFailed = false;
    if (kind !== (show.kind === "movie" ? "movie" : "series")) {
      const { error: kindError } = await db.from("shows").update({ kind }).eq("id", show.id);
      if (kindError) {
        kindFailed = true;
        toast.error(
          "Tür (seri/film) yazılamadı: " +
            kindError.message +
            "\nSupabase'de supabase/migrations/20260928_show_kind.sql dosyasını çalıştır.",
        );
      }
    }

    setSlugInput(nextSlug);
    onReload(
      `"${title.trim()}" güncellendi. Adres: /anime/${nextSlug}` +
        (kindFailed ? " (tür yazılamadı — yukarıya bak)" : ""),
    );
  }

  const disabled = busy || saving;
  /**
   * Kutudaki MAL kimliği henüz KAYDEDİLMEMİŞ olabilir. Geçerliyse katalog paneline
   * bu değer geçirilir (yukarıdaki `SeasonsPanel` notu) — kaydetme sırası
   * kullanıcıyı tıkamasın diye.
   */
  const parsedMal = Number.parseInt(malInput.trim(), 10);
  const unsavedMalId = Number.isFinite(parsedMal) && parsedMal > 0 ? parsedMal : null;

  /**
   * KİRLİ TAKİBİ — Kaydet düğmesinin rengi buradan gelir.
   *
   * Kullanıcı isteği (30.09.2026): kaydedilecek değişiklik YOKSA düğme soluk,
   * VARSA açık/kırmızı dursun. Karşılaştırma KAYITLI değere göre (kutudaki
   * değer show'dan farklıysa kirli). Zorla kaydetmek serbest — düğme hiç
   * kapanmaz, yalnızca tonu değişir.
   */
  const showKind = show.kind === "movie" ? "movie" : "series";
  const isDirty =
    title.trim() !== (show.title ?? "") ||
    subtitle.trim() !== (show.subtitle ?? "") ||
    description.trim() !== (show.description ?? "") ||
    year.trim() !== (show.year ?? "") ||
    genre.trim() !== (show.genre ?? "") ||
    slugInput.trim() !== (show.slug ?? "") ||
    unsavedMalId !== (show.mal_id ?? null) ||
    kind !== showKind;

  // DERLİ TOPLU / SIKI YERLEŞİM (kullanıcı isteği, 30.09.2026): dış boşluk
  // p-4 → p-3.5, kolonlar arası gap-4 → gap-3. Renkler tonlu.
  return (
    <div className="rounded-2xl border border-border bg-secondary/40 p-3.5">
      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)] lg:items-start">
        {/* SOL KOLON — TEK ÇERÇEVE, İKİ SATIR (kapak → banner / video → link).
            flex-wrap: telefonda kutu genişlikleri ekrana sığmadığında kutular
            kırpılmak yerine alt satıra iner. */}
        {/* TEK KUTU: eskiden bu kolonun kendi `border`+`bg` kutusu vardı ve
            editörün dış kutusuyla iç içe iki çerçeve oluşturuyordu (kullanıcı
            bildirimi, 03.10.2026: "üst üste kutu koymuşsun, tek kutu istiyorum").
            İç kutu kaldırıldı; geriye yalnızca editörün tek çerçevesi kaldı. */}
        <div className="min-w-0">
          {/* `justify-center`: kapaklar kutunun ortasında dursun (kullanıcı
              bildirimi, 03.10.2026: "sağ tarafta ne biçim boşluk var"). */}
          <div className="flex flex-wrap items-stretch gap-2">
            <div>
              {/* TEK GÖRSEL, İKİ İŞ (kullanıcı netleştirmesi, 03.10.2026):
                  dikey kapak HEM anime kapağıdır HEM de vitrinin (hero) mobil
                  kapağıdır — aynı görseldir, ayrı bir "sadece mobil" görsel yok.
                  PC'de vitrin yatay kapakla çalışır. */}
              <span className="mb-1 block text-[11px] font-bold text-muted-foreground">
                Dikey Kapak
              </span>
              <ImageDrop
                label="Dikey kapak (anime & mobil vitrin)"
                onFile={(file) => void handleCover(file)}
                disabled={disabled}
                className="group relative h-32 w-24 shrink-0 overflow-hidden rounded-xl border border-border bg-card"
              >
                <img
                  src={show.image}
                  alt=""
                  className="h-full w-full object-cover transition-opacity group-hover:opacity-60"
                />
                <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <ImagePlus size={18} className="text-white" />
                </span>
              </ImageDrop>
            </div>
            <div className="min-w-0 flex-1">
              <span className="mb-1 block text-[11px] font-bold text-muted-foreground">
                Yatay Kapak
              </span>
              {/* `flex-1 w-full`: yatay kapak satırdaki ARTAN yeri doldurur →
                  sağda boşluk kalmaz (kullanıcı isteği, 03.10.2026). */}
              <ImageDrop
                label="Yatay kapak"
                onFile={(file) => void handleBanner(file)}
                disabled={disabled}
                className="group relative h-32 w-full overflow-hidden rounded-xl border border-dashed border-border bg-card"
              >
                {bannerUrl ? (
                  <img
                    src={bannerUrl}
                    alt=""
                    className="h-full w-full object-cover transition-opacity group-hover:opacity-60"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center p-2 text-center text-xs text-muted-foreground transition-colors group-hover:text-foreground">
                    <ImagePlus size={20} className="mb-1 text-primary" />
                    <span className="font-bold">Kapak Yükle</span>
                    <span className="text-[10px] text-muted-foreground">
                      Boşsa vitrinde dikey kapağa düşülür
                    </span>
                  </div>
                )}
                <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <ImagePlus size={20} className="text-white" />
                </span>
              </ImageDrop>
            </div>
            <div className="w-full sm:w-auto">
              {/* VİDEO YALNIZCA PC'DE OYNAR (kullanıcı isteği, 03.10.2026):
                  "mobilde video kullanmak yok". Dosya burada yüklenebilir/kalır;
                  vitrinde mobilde poster, PC'de video gösterilir. */}
              <span className="mb-1 block text-[11px] font-bold text-muted-foreground">
                Vitrin Videosu
              </span>
              {/* MOBİLDE TAM GENİŞLİK: eskiden `w-36` sabitti, kendi satırında
                  sağında koca bir boşluk kalıyordu (kullanıcı bildirimi, 03.10.2026:
                  "genişlet, tam otursun kutuya"). `sm` ve üstünde eski genişlik. */}
              <ImageDrop
                label="Vitrin videosu"
                accept="video/mp4"
                onFile={(file) => void handleVideo(file)}
                disabled={disabled}
                className="group relative flex h-32 w-full shrink-0 flex-col items-center justify-center gap-1 rounded-xl bg-card px-3 text-center sm:w-44"
              >
                <Video size={20} className="text-primary" />
                <span className="text-[11px] font-bold text-foreground">
                  {show.banner_video_path
                    ? heroVideoSource(show.banner_video_path).kind === "embed"
                      ? "Link kayıtlı"
                      : "Video yüklü"
                    : "Vitrin videosu"}
                </span>
                <span className="text-[10px] leading-4 text-muted-foreground">
                  mp4 · en fazla 100 MB · yalnızca PC'de oynar
                </span>
              </ImageDrop>
            </div>
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {/* AÇIKLAMA — kendi satırında.
                AYIRICI ÇİZGİ YOK: kutunun kendi çerçevesiyle üst üste gelip "iki
                çizgi" gibi görünüyordu (kullanıcı bildirimi, 03.10.2026).
                `w-full`: üstteki satıra sığışıp yana kaymasın diye alt satıra
                iner. Kutu içeriğe göre büyür (kaydırma çubuğu yok). */}
            <div className="w-full">
              <textarea
                ref={descRef}
                className="min-h-32 w-full resize-none overflow-hidden rounded-xl border border-border bg-card p-3 text-sm text-foreground outline-none transition-colors focus:border-primary"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Detay sayfası açıklaması"
                aria-label="Açıklama"
              />
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <input
            className={inputCls}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Seri adı"
            aria-label="Başlık"
          />
          <input
            className={`${inputCls} mt-2`}
            value={subtitle}
            onChange={(event) => setSubtitle(event.target.value)}
            placeholder="Kısa alt başlık"
            aria-label="Alt başlık"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              className={cn(inputCls, "w-24")}
              value={year}
              onChange={(event) => setYear(event.target.value)}
              placeholder="Yıl"
              aria-label="Yıl"
            />
            {/* Hazır tür listesi: yazım hatası yeni tür kategorisi oluşturmasın. */}
            <input
              className={cn(inputCls, "w-40")}
              list="shows-genre-options"
              value={genre}
              onChange={(event) => setGenre(event.target.value)}
              placeholder="Tür"
              aria-label="Tür"
            />
            <div className="flex min-w-52 flex-1 items-center gap-2">
              {/* Panelde gösterilen adres ön eki: seri detayı artık `/anime/<slug>`. */}
              <span className="shrink-0 font-mono text-xs text-muted-foreground">/anime/</span>
              <input
                className={`${inputCls} min-w-24 flex-1 font-mono text-xs`}
                value={slugInput}
                onChange={(event) => setSlugInput(event.target.value)}
                placeholder={slugify(title) || "url-adresi"}
                aria-label="URL adresi (slug)"
                title="Serinin adres parçası. Türkçe karakter sadeleştirilir, boş bırakılırsa başlıktan üretilir."
              />
            </div>
          </div>
          {/*
            MAL KİMLİĞİ — katalog panelinin çalışması için ŞART.
            (Kullanıcı "Jujutsu Kaisen 0" filmini eklerken bu yüzden tıkandı:
            hata mesajı "seri ayarlarından doldur" diyordu ama alan yoktu.)
          */}
          {/*
            SERİ / FİLM — panelde iki ayrı bölümde listelenmeyi belirler.
            (Kullanıcı isteği: "filmler eklemek için ayrı yer ekle".)
          */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="shrink-0 text-[11px] font-bold text-muted-foreground">Tür</span>
            {(
              [
                ["series", "Dizi"],
                ["movie", "Film"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setKind(value);
                  setMalHits([]);
                  setSelectedMalIds([]);
                  setMalNotice(null);
                }}
                aria-pressed={kind === value}
                className={`h-7 rounded-full border px-3 text-xs font-bold transition-all active:scale-95 ${
                  kind === value
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
            <span className="text-[11px] text-muted-foreground">
              {kind === "movie"
                ? "Filmler panelde ayrı bölümde listelenir."
                : "Diziler sezon/bölüm akışıyla çalışır."}
            </span>
          </div>

          <div className="mt-3 rounded-xl border border-border/70 bg-background/35 p-2.5">
            <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-[11px] font-extrabold uppercase tracking-wide text-foreground">
                Anime kimliği · MAL
              </span>
              <span className="text-[10px] text-muted-foreground">anime başına bir kez</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-28 shrink-0">
                <input
                  className={`${inputCls} font-mono text-xs`}
                  value={malInput}
                  onChange={(event) => setMalInput(event.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="MAL ID"
                  inputMode="numeric"
                  aria-label="MyAnimeList kimliği"
                  title="Anime kimliği; sezon ve bölümler katalogdan otomatik gelir."
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-10 shrink-0 rounded-full px-3 text-xs"
                onClick={() => void runMalSearch()}
                disabled={malBusy || disabled}
                title="ID boşsa anime adına göre arar"
              >
                {malBusy ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}{" "}
                MAL&apos;de ara
              </Button>
              {parsedMal > 0 && parsedMal !== (show.mal_id ?? 0) ? (
                /* KAYDEDİLMEMİŞ KİMLİK AÇIKÇA YAZILIR.
                 Kullanıcı isteği (28.09.2026): "kimlik kutuya doğru yazılsın,
                 kaydedilmediyse belli olsun." Kutudaki değer veritabanındakinden
                 farklıyken yalnızca "kayıtlı: X" göstermek yanıltıcıydı: kullanıcı
                 kimliği değiştirdiğini kaydettiğini sanabiliyordu. */
                <span className="text-[11px] font-bold text-sky-400">
                  kaydedilmemiş: {parsedMal} — Kaydet&apos;e bas
                  {show.mal_id ? ` (kayıtlı: ${show.mal_id})` : ""}
                </span>
              ) : show.mal_id ? (
                <span className="text-[11px] font-bold text-emerald-500">
                  kayıtlı: {show.mal_id}
                </span>
              ) : (
                <span className="text-[11px] font-bold text-amber-500">
                  yok — katalog bu yüzden çekilemiyor
                </span>
              )}
              {/* Otomatik doldurma KALKTIĞI için (bkz. `searchMal` notu) kimliğin
                ne zaman yazılacağını burada açıkça söylemek gerekiyor; aksi hâlde
                kullanıcı kutu boş kaldı diye "çalışmıyor" sanır. */}
            </div>
            <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">
              ID bilmiyorsan boş bırakıp <b className="text-foreground">MAL&apos;de ara</b>ya bas.
              Bölümler için ayrıca ID girmen gerekmez; sezon katalogdan seçilir.
            </p>
          </div>

          {/* ARANIYOR DURUMU — kullanıcı isteği (28.09.2026): "MAL'de ara yapınca
              yükleme ekranı gelmesi gerekmiyor mu?" Eskiden yalnızca düğmenin
              içindeki ikon dönüyordu; istek sürerken bunun ekranda karşılığı yoktu. */}
          {malBusy ? (
            <p className="animate-rise-in mt-1.5 flex items-center gap-2 text-[11px] font-bold text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              AniList&apos;te aranıyor…
            </p>
          ) : null}

          {/* ÖZET SATIRI — liste görünür olduğu hâlde ne yapılacağını söyler
              ("Tek eşleşme bulundu — satıra tıkla" / "3 eşleşme bulundu"). */}
          {!malBusy && malNotice ? (
            <p className="animate-rise-in mt-1.5 text-[11px] font-bold text-muted-foreground">
              {malNotice}
            </p>
          ) : null}

          {/* Arama sonuçları: tıklayınca kimlik dolar. Biçim (MOVIE/TV) ve yıl
              görünür — film ile dizinin kayıtları karıştırılmasın diye.
              LİSTE ARTIK HER ZAMAN ÇİZİLİR — tek eşleşmede bile (gerekçe:
              `searchMal` başındaki "OTOMATİK ONAY KALDIRILDI" notu). */}
          {!malBusy && malHits.length > 0 ? (
            <div className="animate-rise-in mt-1.5 rounded-xl border border-border p-1">
              <div className="flex items-center justify-between gap-2 px-1 py-1">
                <label className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={malHits.length > 0 && selectedMalIds.length === malHits.length}
                    onChange={(event) =>
                      setSelectedMalIds(event.target.checked ? malHits.map((hit) => hit.malId) : [])
                    }
                  />
                  Tümünü seç
                </label>
                {selectedMalIds.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 rounded-full px-2.5 text-[10px]"
                    onClick={startBulkCatalog}
                  >
                    {selectedMalIds.length} seçiliyi kataloğa aç
                  </Button>
                ) : null}
              </div>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto">
                {malHits.map((hit) => (
                  <li key={hit.malId}>
                    <button
                      type="button"
                      onClick={() => toggleMalSelection(hit)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs transition-all hover:bg-secondary active:scale-[0.99] ${selectedMalIds.includes(hit.malId) ? "bg-primary/10" : ""}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`grid size-3.5 shrink-0 place-items-center rounded border text-[9px] leading-none ${selectedMalIds.includes(hit.malId) ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
                      >
                        {selectedMalIds.includes(hit.malId) ? "✓" : ""}
                      </span>
                      <span className="w-12 shrink-0 font-mono text-[10px] text-muted-foreground">
                        {hit.malId}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-foreground">{hit.title}</span>
                      {hit.format ? (
                        <span className="shrink-0 rounded-full border border-border px-1.5 text-[10px] font-bold text-muted-foreground">
                          {hit.format}
                        </span>
                      ) : null}
                      {hit.year ? (
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {hit.year}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* EYLEM SATIRI — tek sıra: Vitrin → Bölüm Yöneticisi → Kaydet (en sağda).
              Dar ekranda taşarsa alt satıra kayar (kullanıcı isteği, 30.09.2026:
              "zikzak" dizilimi bitti). */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5 sm:flex-nowrap sm:gap-2">
            {/* Vitrin = ana sayfadaki büyük slider. Tıklayınca anında kaydedilir. */}
            <Button
              size="sm"
              variant={show.is_featured ? "toggleOn" : "outline"}
              className="h-8 rounded-full px-3 text-xs"
              onClick={onToggleFeatured}
              disabled={disabled}
              aria-pressed={show.is_featured}
              title="Ana sayfa vitrininde (büyük slider) bu seri dönsün mü?"
            >
              <Star size={14} className={show.is_featured ? "fill-current" : ""} />
              {show.is_featured ? "Vitrin'de" : "Vitrin'e ekle"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-full px-3 text-xs"
              onClick={openEpisodeManager}
              aria-haspopup="dialog"
            >
              {/* BUTON ARTIK DOĞRUDAN PANELİ AÇAR.
                  ═══════════════════════════════════════════════════════════════
                  Kullanıcı bildirimi (28.09.2026): "bölüm yöneticisine basınca bu
                  oluyor, panel açılmıyor ki?"

                  ÖLÇÜLEN SEBEP: bu butonun açtığı sarmalayıcı panelin GÖVDESİ BOŞ.
                  Sezon listesi + sezon kartları daha önce kullanıcı isteğiyle
                  ("her şeyi katalog panelinden yönetelim, yer de kaplamaz")
                  tamamen kaldırılmıştı; geriye yalnızca "Gelişmiş" satırı kalmıştı.
                  Yani buton teknik olarak paneli açıyordu ama içinde gösterilecek
                  bir şey yoktu — ekran görüntüsünde buton "kapat" yazarken sayfada
                  yalnızca "GELİŞMİŞ" satırı görünüyordu.

                  ÇÖZÜM: buton, bölüm yönetiminin GERÇEKTE yaşadığı yeri açar —
                  katalog/bölüm panelini. Sezon seçici, bölüm listesi, kaynak
                  kutuları, sağ tık embed ve elle ekleme hepsi oradadır.

                  NEDEN AÇ/KAPA DEĞİL: kapanma popup'ın kendi yoluyla olur
                  (X · dışına tıkla · Esc). Butonu da toggle yapmak "görünmez
                  kapanma" sorununu geri getirirdi — kullanıcının ilk şikâyeti
                  tam buydu ("bir daha basıyorum açılmıyor"). Artık her basış
                  paneli AÇAR. */}
              <ListVideo size={14} /> {kind === "movie" ? "Film kaynağı" : "Bölüm Yöneticisi"}
            </Button>
            {/* Kaydet HEP KIRMIZI (kullanıcı isteği, 30.09.2026) — değişiklik
                yoksa SADECE soluklaşır. Tonu kirli takibinden. */}
            {/* KAYDET: renk/ikon DEĞİŞMEZ, tek fark OPAKLIK (kullanıcı isteği,
                03.10.2026: "rengini falan değişme, sadece opaklık kısmayı dene").
                Kayıtlı (değişiklik yok) → aynı kırmızı, %50 saydam; kaydedilmemiş
                → tam opak. Böylece "kaydedilmedi" vurgusu sadede kalır. */}
            <Button
              size="sm"
              variant="default"
              className={`ml-auto h-8 rounded-full px-3 text-xs ${isDirty ? "" : "opacity-50"}`}
              onClick={() => void save()}
              disabled={disabled}
              title={isDirty ? "Değişiklikleri kaydet" : "Kaydedilecek değişiklik yok"}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Kaydet
            </Button>
            {/*
              ALTTaki "Kapat" DÜĞMESİ KALDIRILDI (kullanıcı isteği, 30.09.2026):
              "altta kapat butonu olmayacak; Düzenle yazısı Kapat düğmesine dönecek."
              Düzenleme alanını artık satırdaki düğme (Düzenle ↔ Kapat) kapatıyor —
              iki ayrı kapatma yolu kafa karıştırıyordu.
            */}
          </div>
        </div>
      </div>

      {/* SARMALAYICI SADELEŞTİ — ÇİZGİ/BOŞLUK KALINTISI KALDIRILDI.
          Kullanıcı bildirimi (28.09.2026): "hâlâ eksik kalıntılar var … aşağıya
          çöp bırakıyor." Eski hâli `mt-4 border-t border-border pt-4` idi; sezon
          listesi kaldırıldığı için panelin gövdesi çoğu zaman BOŞ kalıyor ve
          geriye sayfada yalnızca AYIRICI ÇİZGİ + 16px boşluk kalıyordu (panel
          açılırken sayfa aşağı kayıyor, kapanınca geri geliyordu).

          Katalog paneli `createPortal` ile `document.body`ye çizildiği için
          sarmalayıcının görsel bir görevi kalmadı. İçerik çıkarsa (kayıt yoksa
          "1. sezonu oluştur" satırı, elle ekleme formu) kendi boşluğunu kendisi
          verir — bkz. `SeasonsPanel` kök elemanı (fragment). */}
      {episodesOpen && (
        <AnizipSyncProvider>
          <SeasonsPanel
            showId={show.id}
            slug={showSlug(show)}
            /**
             * ⚠️ KAYDEDİLMEMİŞ KİMLİK DE GEÇERLİ SAYILIR.
             *
             * ESKİ DAVRANIŞ `show.mal_id` (veritabanındaki değer) idi. Kullanıcı
             * MAL kimliğini yazıp KAYDETMEDEN "Katalogdan çek"e bastığında panel
             * hâlâ "MAL kimliği yok" diyordu — kullanıcının yaşadığı tıkanma tam
             * buydu. Artık kutudaki değer geçerliyse o kullanılır; böylece kaydetme
             * sırası önemli olmaktan çıkar.
             */
            malId={unsavedMalId ?? show.mal_id ?? null}
            /**
             * ⚠️ SERİNİN KENDİ KİMLİĞİ — AYRI GEÇİLİR, `malId` İLE KARIŞTIRILMAZ.
             *
             * ── ÖLÇÜLEN HATA (29.09.2026) ───────────────────────────────────────────
             * `malId` yukarıda bilerek "kutudaki (kaydedilmemiş) değer"dir: kullanıcı
             * kimliği yazıp KAYDETMEDEN katalog çekebilsin diye. Ama panel sezon/part
             * zincirini de bu değerden KURUYORDU. Kullanıcı "MAL'de ara" ile 45576'yı
             * seçtiğinde `confirmMal` kutuyu `45576`ya yazıyor → `malId` = 45576 oluyor
             * → zincir 45576'dan başlayınca 45576 KENDİSİ "1. sezon, part yok" sanılıyor
             * ve uyarı "serinin kendi kimliği — 1. sezon hedeflendi." çıkıyordu.
             *
             * Doğrusu: zincir (ve "bu kimlik serinin kendi kimliği mi?" kararı) SERİNİN
             * VERİTABANINDAKİ kök kimliğinden (`shows.mal_id`) kurulmalıdır. Bu değer
             * ayrı verilir; panel onu kullanır, `malId` yalnızca katalog çekme yedeği
             * olarak kalır.
             */
            seriesMalId={show.mal_id ?? null}
            /** Film tek parçadır: panel "Yeni sezon ekle" düğmesini gizler. */
            singlePart={kind === "movie"}
            /**
             * MAL EŞLEŞMESİ ONAYLANINCA KATALOG KENDİLİĞİNDEN AÇILSIN.
             *
             * Kullanıcı isteği (28.09.2026): "MAL'de ara yaptıktan sonra açılacak
             * dedim; katalog düğmesini oradan yok et diyorum." `searchMal()`
             * başarılı olduğunda bu sayaç artar, `SeasonsPanel` de ilk sezonun
             * katalog popup'ını açar — ayrı düğmeye gerek kalmaz.
             */
            catalogOpenRequest={catalogRequest}
            onCatalogOpenHandled={() => {
              setCatalogQueue((queue) => {
                const [next, ...rest] = queue;
                // AniList/ani.zip art arda kimlik çözümlemelerinde 429 dönebiliyor;
                // toplu seçimde bir sonraki kataloğu kısa aralıkla aç.
                window.setTimeout(() => setCatalogRequest(next ?? null), next ? 900 : 0);
                return rest;
              });
            }}
            schemaReady={schemaReady}
            onNotice={onReload}
          />
        </AnizipSyncProvider>
      )}
    </div>
  );
}

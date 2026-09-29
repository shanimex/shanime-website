import {
  ArrowDown,
  ArrowUp,
  ImagePlus,
  ListVideo,
  Loader2,
  Save,
  Search,
  Star,
  Video,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ImageDrop } from "@/components/admin/ImageDrop";
import { SeasonsPanel } from "@/components/admin/SeasonsPanel";
import { toast } from "@/lib/admin-toast";
import { db, inputCls, slugify, uniqueSlug } from "@/lib/admin";
import { showSlug } from "@/lib/content";
import { isPartContinuation } from "@/lib/puffy";
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

export function ShowEditor({
  show,
  first,
  last,
  takenSlugs,
  schemaReady,
  onMove,
  onClose,
  onToggleFeatured,
  onReload,
}: {
  show: ShowWithImage;
  first: boolean;
  last: boolean;
  /** Bu seri hariç, sistemde kullanılan slug'lar. */
  takenSlugs: (string | null)[];
  schemaReady: boolean;
  onMove: (dir: -1 | 1) => void;
  onClose: () => void;
  onToggleFeatured: () => void;
  onReload: (message: string) => void;
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
  const [catalogRequest, setCatalogRequest] = useState<{
    /** Açılacak sezonun MAL kimliği; `null` = "sadece paneli aç". */
    malId: number | null;
    /** `true` = bu kimlik serinin kimliğinden FARKLI → SIRADAKİ sezon. */
    newSeason: boolean;
    /**
     * `true` = bu kayıt AYNI SEZONUN DEVAMI (MAL'de "Part N" / "Cour N").
     * Part kaydı YENİ SEZON AÇMAZ: mevcut sezonun kaldığı numaradan sürer.
     * Gerekçe `confirmMal` notunda (Mushoku Tensei 39535 → 45576 örneği).
     */
    part: boolean;
    /**
     * Girilen kaydın ADI (AniList romaji/İngilizce) — panel part/yeni-sezon
     * ayrımını ve "S2 değil, S1'in partı" uyarısını bununla üretir.
     * (kullanıcı bildirimi, 29.09.2026: "45576 → S1'in 2. part'ı, S2 değil".)
     */
    title: string;
  } | null>(null);
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

  useEffect(() => {
    setBannerUrl(show.banner_image ?? "");
  }, [show.banner_image]);

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
      onReload(`"${show.title}" vitrin banner'ı güncellendi.`);
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
    setMalNotice(null);
    try {
      /**
       * SORGU ARTIK ORTAK YARDIMCINDA (`lib/mal-search.ts` → `searchMal`).
       * Buradaki davranış AYNEN korunur: kimlikle arama tek kayıt, adla arama
       * sayfa döner; ikisi de aynı `MalHit` biçimine indirgenir.
       */
      const hits = await searchMal({ malId: byId ? typedId : null, title: query });
      // LİSTE HER ZAMAN ÇİZİLİR — tek eşleşmede de. Otomatik onay kaldırıldı
      // (gerekçe yukarıdaki "OTOMATİK ONAY KALDIRILDI" notunda).
      setMalHits(hits);
      setMalNotice(
        hits.length === 0
          ? null
          : hits.length === 1
            ? "Tek eşleşme bulundu — kullanmak için satıra tıkla."
            : `${hits.length} eşleşme bulundu — birini seç.`,
      );
      if (hits.length === 0) {
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
    setCatalogRequest({ malId: null, newSeason: false, part: false, title: "" });
  }

  function confirmMal(malId: number, malTitle: string) {
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
    setCatalogRequest({ malId, newSeason, part, title: malTitle });
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
    if (kind !== (show.kind === "movie" ? "movie" : "series")) {
      const { error: kindError } = await db.from("shows").update({ kind }).eq("id", show.id);
      if (kindError) {
        toast.error(
          "Tür (seri/film) yazılamadı: " +
            kindError.message +
            "\nSupabase'de supabase/migrations/20260928_show_kind.sql dosyasını çalıştır.",
        );
      }
    }

    setSlugInput(nextSlug);
    onReload(`"${title.trim()}" güncellendi. Adres: /anime/${nextSlug}`);
  }

  const disabled = busy || saving;
  /**
   * Kutudaki MAL kimliği henüz KAYDEDİLMEMİŞ olabilir. Geçerliyse katalog paneline
   * bu değer geçirilir (yukarıdaki `SeasonsPanel` notu) — kaydetme sırası
   * kullanıcıyı tıkamasın diye.
   */
  const parsedMal = Number.parseInt(malInput.trim(), 10);
  const unsavedMalId = Number.isFinite(parsedMal) && parsedMal > 0 ? parsedMal : null;

  return (
    <div className="rounded-2xl border border-border bg-secondary/40 p-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        {/* flex-wrap: telefonda kutu genişlikleri ekrana sığmadığında kutular
            kırpılmak yerine alt satıra iner. */}
        <div className="flex shrink-0 flex-wrap gap-3">
          <div>
            <span className="mb-1 block text-[11px] font-bold text-muted-foreground">
              Dikey Kapak
            </span>
            <ImageDrop
              label="Dikey kapak"
              onFile={(file) => void handleCover(file)}
              disabled={disabled}
              className="group relative h-28 w-20 shrink-0 overflow-hidden rounded-xl border border-border bg-card"
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

          <div>
            <span className="mb-1 block text-[11px] font-bold text-muted-foreground">
              Vitrin Banner&apos;ı (16:9)
            </span>
            <ImageDrop
              label="Vitrin banner'ı (16:9)"
              onFile={(file) => void handleBanner(file)}
              disabled={disabled}
              className="group relative h-28 w-36 shrink-0 overflow-hidden rounded-xl border border-dashed border-border bg-card sm:w-44"
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
                  <span className="font-bold">Banner Yükle</span>
                  <span className="text-[10px] text-muted-foreground">
                    Boşsa ana sayfa kapak görselini kullanır
                  </span>
                </div>
              )}
              <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                <ImagePlus size={20} className="text-white" />
              </span>
            </ImageDrop>
            <ImageDrop
              label="Vitrin videosu"
              accept="video/mp4"
              onFile={(file) => void handleVideo(file)}
              disabled={disabled}
              className="group relative flex h-28 w-32 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-card px-3 text-center sm:w-40"
            >
              <Video size={20} className="text-primary" />
              <span className="text-[11px] font-bold text-foreground">
                {show.banner_video_path ? "Video yüklü" : "Vitrin videosu"}
              </span>
              <span className="text-[10px] leading-4 text-muted-foreground">
                mp4 · tıkla ya da sürükle
              </span>
            </ImageDrop>
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
              className={`${inputCls} w-24`}
              value={year}
              onChange={(event) => setYear(event.target.value)}
              placeholder="Yıl"
              aria-label="Yıl"
            />
            {/* Hazır tür listesi: yazım hatası yeni tür kategorisi oluşturmasın. */}
            <input
              className={`${inputCls} w-40`}
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
                onClick={() => setKind(value)}
                aria-pressed={kind === value}
                className={`h-7 rounded-full border px-3 text-xs font-bold transition-colors ${
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

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="shrink-0 text-[11px] font-bold text-muted-foreground">
              MAL kimliği
            </span>
            {/*
              ⚠️ SABİT GENİŞLİK İÇİN SARMALAYICI ŞART: `inputCls` içinde `w-full`
              var. `w-28` sınıfını doğrudan eklemek işe YARAMIYOR, çünkü Tailwind'de
              son sözü stil dosyasındaki sıra söyler ve `w-full` kazanıyor — kutu
              satırın tamamını kaplıyor, düğme alt satıra düşüyordu. Genişlik
              sarmalayıcıya verilince giriş kutusu onun içinde %100 olur.
            */}
            <div className="w-28 shrink-0">
              <input
                className={`${inputCls} font-mono text-xs`}
                value={malInput}
                onChange={(event) => setMalInput(event.target.value.replace(/[^0-9]/g, ""))}
                placeholder="ör. 48561"
                inputMode="numeric"
                aria-label="MyAnimeList kimliği"
                title="myanimelist.net adresindeki sayı. Örn. Jujutsu Kaisen 0 = 48561. Katalog (bölüm listesi) bu kimlikle çekilir."
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-10 shrink-0 rounded-full px-3 text-xs"
              onClick={() => void runMalSearch()}
              disabled={malBusy || disabled}
              title="Kutudaki MAL kimliğini doğrular; kutu boşsa seri adına göre arar"
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
              <span className="text-[11px] font-bold text-emerald-500">kayıtlı: {show.mal_id}</span>
            ) : (
              <span className="text-[11px] font-bold text-amber-500">
                yok — katalog bu yüzden çekilemiyor
              </span>
            )}
            {/* Otomatik doldurma KALKTIĞI için (bkz. `searchMal` notu) kimliğin
                ne zaman yazılacağını burada açıkça söylemek gerekiyor; aksi hâlde
                kullanıcı kutu boş kaldı diye "çalışmıyor" sanır. */}
            <span className="text-[11px] text-muted-foreground">
              Sonuçtan bir satıra tıkla — kimlik o zaman kutuya yazılır.
            </span>
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
            <ul className="animate-rise-in mt-1.5 max-h-40 space-y-0.5 overflow-y-auto rounded-xl border border-border p-1">
              {malHits.map((hit) => (
                <li key={hit.malId}>
                  <button
                    type="button"
                    onClick={() => confirmMal(hit.malId, hit.title)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs transition-colors hover:bg-secondary"
                  >
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
                      <span className="shrink-0 text-[10px] text-muted-foreground">{hit.year}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="rounded-full"
              onClick={() => void save()}
              disabled={disabled}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Kaydet
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
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
            {/* Vitrin = ana sayfadaki büyük slider. Tıklayınca anında kaydedilir. */}
            <Button
              size="sm"
              variant={show.is_featured ? "toggleOn" : "outline"}
              className="rounded-full"
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
              variant="ghost"
              className="h-10 w-10 rounded-full sm:h-9 sm:w-9"
              onClick={() => onMove(-1)}
              disabled={first || disabled}
              aria-label="Yukarı taşı"
            >
              <ArrowUp size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-10 w-10 rounded-full sm:h-9 sm:w-9"
              onClick={() => onMove(1)}
              disabled={last || disabled}
              aria-label="Aşağı taşı"
            >
              <ArrowDown size={14} />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full sm:ml-auto"
              onClick={onClose}
              disabled={disabled}
            >
              <X size={14} /> Kapat
            </Button>
          </div>
        </div>
      </div>

      <textarea
        className="mt-3 min-h-24 w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground outline-none focus:border-primary"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Detay sayfası açıklaması"
        aria-label="Açıklama"
      />

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
          onCatalogOpenHandled={() => setCatalogRequest(null)}
          schemaReady={schemaReady}
          onNotice={onReload}
        />
      )}
    </div>
  );
}

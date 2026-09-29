import { ImagePlus, Loader2, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ImageDrop } from "@/components/admin/ImageDrop";
import { toast } from "@/lib/admin-toast";
import { db, inputCls, slugify, uniqueSlug } from "@/lib/admin";
import { uploadImage } from "@/lib/content";
import {
  fetchMalCoverFile,
  malIdMissText,
  mapGenres,
  searchMal,
  type MalHit,
} from "@/lib/mal-search";

/**
 * Yeni kayıt düğmesi — SERİ ya da FİLM.
 *
 * `kind` (kullanıcı isteği, 28.09.2026: "filmler eklemek için ayrı yer ekle,
 * seriler değil de filmler diye"): panelde iki ayrı bölüm var ve her bölümün
 * kendi düğmesi bulunur. Fark yalnızca kayda yazılan `kind` değeri ve
 * etiket değil, DAVRANIŞTA da var:
 *
 *   · DİZİ  → yeni kayda boş bir "1. sezon" açılır ki bölümler hemen eklenebilsin.
 *   · FİLM  → sezon AÇILMAZ. Film tek parçadır; boş bir sezon açmak panelde
 *             "0 bölüm" satırı bırakıp kullanıcıyı gereksiz yere uğraştırırdı.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MAL KİMLİĞİYLE EKLEME (kullanıcı isteği, 29.09.2026)
 *
 * Şikâyet: *"animeleri sadece MAL kimliğini girerek eklemek istiyorum; ad/slug/
 * yıl/tür/kapak ile uğraşmak istemiyorum."* Ölçülen durum: bu formda MAL arama
 * YOKTU ve **kapak dosyası ZORUNLUYDU** — kapak seçilmezse "Kapak görseli seç."
 * uyarısı çıkıp kayıt hiç açılmıyordu.
 *
 * YENİ AKIŞ: MAL kimliği yaz → "MAL'de ara" → çıkan satıra tıkla. Satıra
 * tıklanınca Ad (İngilizce/romaji), Yıl, Tür (AniList genres → Türkçe), adres
 * (slug) ve **kapak** KENDİLİĞİNDEN gelir:
 *   · Kapak AniList'ten indirilip MEVCUT desenle yüklenir
 *     (`uploadImage(file,"posters")` → `images/posters/…` → `shows.image_path`).
 *     İndirme `create()` anında yapılır; kullanıcı vazgeçerse depoda artık dosya
 *     kalmaz.
 *   · Kapak ANILIST'TEN geldiyse "Kapak görseli seç." zorunluluğu KALKAR.
 *     Kullanıcı isterse yine kendi dosyasını seçip değiştirebilir (elle seçim
 *     otomatik kapağın yerine geçer).
 *   · Ne otomatik ne elle kapak yoksa ESKİ hata ("Kapak görseli seç.") aynen durur.
 *
 * AniList'te kayıt yoksa (404) "Düzenle" panelindeki yönlendirici mesajın AYNISI
 * gösterilir — metin ve sorgu artık ortak yardımcıda (`lib/mal-search.ts`).
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function AddShowButton({
  nextOrder,
  takenSlugs,
  schemaReady,
  kind = "series",
  genreOptions = [],
  onAdded,
}: {
  nextOrder: number;
  takenSlugs: (string | null)[];
  schemaReady: boolean;
  /** Kayıt türü: `series` (varsayılan) veya `movie`. */
  kind?: "series" | "movie";
  /**
   * Panelde ZATEN kullanılan türler (`routes/admin.tsx` → `genreOptions`).
   * Otomatik doldurmada AniList türü bu listede varsa VAR OLAN yazım korunur;
   * böylece aynı tür için ikinci bir kategori açılmaz.
   */
  genreOptions?: string[];
  onAdded: (message: string) => void;
}) {
  const isMovie = kind === "movie";
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [year, setYear] = useState("");
  const [genre, setGenre] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  /** MAL kimliği kutusu (yalnız rakam). Boşsa "Anime adı" ile aranır. */
  const [malInput, setMalInput] = useState("");
  const [malBusy, setMalBusy] = useState(false);
  const [malHits, setMalHits] = useState<MalHit[]>([]);
  const [malNotice, setMalNotice] = useState<string | null>(null);
  /** Seçilen kaydın AniList kapak adresi — `create()` anında indirilip yüklenir. */
  const [malCoverUrl, setMalCoverUrl] = useState("");
  /** Elle seçilen dosyanın yerel önizlemesi (otomatik kapaktan ÖNCELİKLİDİR). */
  const [localPreview, setLocalPreview] = useState("");

  /** Önizlemede gösterilecek adres: elle seçim varsa o, yoksa AniList kapağı. */
  const preview = localPreview || malCoverUrl;

  function reset() {
    setTitle("");
    setSubtitle("");
    setYear("");
    setGenre("");
    setSlug("");
    setSlugTouched(false);
    setFile(null);
    setMalInput("");
    setMalBusy(false);
    setMalHits([]);
    setMalNotice(null);
    setMalCoverUrl("");
    setLocalPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return "";
    });
    setOpen(false);
  }

  /** Elle kapak seçimi: otomatik AniList kapağının YERİNE geçer. */
  function handleCoverFile(next: File) {
    setFile(next);
    setMalCoverUrl("");
    setLocalPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(next);
    });
  }

  /**
   * MAL ARAMASI — "Düzenle" paneliyle AYNI davranış (ortak `searchMal`).
   * Kutuda sayı varsa kimlikle, kutu boşsa seri adıyla aranır; sonuç listesi
   * her hâlükârda çizilir ve seçim kullanıcıya bırakılır.
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
      const hits = await searchMal({ malId: byId ? typedId : null, title: query });
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
   * SONUCA TIKLAYINCA FORMU OTOMATİK DOLDUR.
   *
   * · Ad      → İngilizce başlık (yoksa romaji).
   * · Yıl     → AniList `startDate.year`.
   * · Tür     → AniList `genres`, Türkçeye çevrilip panelin tür yazımıyla eşlenir.
   * · Adres   → MEVCUT `slugify` + `uniqueSlug`; slug ZATEN KULLANILIYORSA sonuna
   *             `-2` gibi ek konur (ör. `cyberpunk-edgerunners` varsa `-2`).
   * · MAL     → kutunun kendisi (kayıtta `mal_id` olur).
   * · Kapak   → AniList kapak adresi; `create()` anında Storage'a konur.
   */
  function applyHit(hit: MalHit) {
    setTitle(hit.title);
    setYear(hit.year ? String(hit.year) : "");
    setGenre(mapGenres(hit.genres, genreOptions));
    // Slug ÇAKIŞMASI burada çözülür: kullanıcıya "adres zaten var" diye
    // uğraştırmak yerine kullanılabilir bir adres üretilir.
    setSlug(uniqueSlug(slugify(hit.title), takenSlugs));
    setSlugTouched(true);
    setMalInput(String(hit.malId));
    setFile(null);
    setLocalPreview((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return "";
    });
    setMalCoverUrl(hit.cover);
    setMalHits([]);
    setMalNotice(null);
    toast.success(
      `MAL ${hit.malId} · ${hit.title || "(ad yok)"} — alanlar dolduruldu` +
        (hit.cover ? ", kapak otomatik getirilecek." : "."),
    );
  }

  async function create() {
    if (!title.trim()) {
      toast.error("Başlık gerekli.");
      return;
    }
    /**
     * KAPAK ZORUNLULUĞU — artık OTOMATİK kapak da sayılır.
     * Elle dosya VEYA AniList kapağı yoksa eski mesaj aynen verilir.
     */
    if (!file && !malCoverUrl) {
      toast.error("Kapak görseli seç.");
      return;
    }
    setBusy(true);
    try {
      // KAPAK: elle seçilen dosya ÖNCELİKLİDİR. Yoksa AniList kapağı vekil
      // rotadan indirilip MEVCUT yükleme deseniyle (`images/posters/…`) konur.
      let coverFile = file;
      if (!coverFile && malCoverUrl) coverFile = await fetchMalCoverFile(malCoverUrl);
      if (!coverFile) {
        toast.error("Kapak görseli seç.");
        return;
      }
      const path = await uploadImage(coverFile, "posters");
      const finalSlug = uniqueSlug(slugify(slug.trim() || title), takenSlugs);
      const malIdValue = Number.parseInt(malInput.trim(), 10);
      const fields: Record<string, unknown> = {
        title: title.trim(),
        subtitle: subtitle.trim(),
        description: "",
        year: year.trim(),
        genre: genre.trim(),
        image_path: path,
        sort_order: nextOrder,
        slug: finalSlug,
      };
      // MAL kimliği yalnızca geçerli bir pozitif tam sayıysa yazılır.
      if (Number.isFinite(malIdValue) && malIdValue > 0) fields["mal_id"] = malIdValue;
      let { data, error } = await db
        .from("shows")
        .insert({ ...fields, kind })
        .select("id")
        .single();

      /**
       * KOLON HENÜZ YOKSA da kayıt KAYBOLMASIN.
       *
       * `shows.kind` kolonu bir migration ile eklenir
       * (`supabase/migrations/20260928_show_kind.sql`). Kullanıcı migration'ı
       * henüz çalıştırmadıysa `kind` alanı gönderildiğinde Supabase hata döner.
       * Bu durumda kayıt TAMAMEN başarısız olmasın diye `kind` OLMADAN tekrar
       * denenir ve kullanıcıya migration'ı çalıştırması söylenir. Yani kolon
       * yokken de panel çalışır, yalnızca yeni kayıt "seri" sayılır.
       *
       * Aynı koruma `shows.mal_id` için de geçerli: kolon yoksa yalnızca MAL
       * kimliği düşer, kaydın kendisi (ad/yıl/tür/kapak) yazılır.
       */
      if (error) {
        const message = error.message ?? "";
        const dropKind = /kind/i.test(message);
        const dropMal = /mal_id/i.test(message);
        if (dropKind || dropMal) {
          const retryFields = { ...fields };
          if (dropMal) delete retryFields["mal_id"];
          const retryPayload: Record<string, unknown> = { ...retryFields };
          if (!dropKind) retryPayload["kind"] = kind;
          const retry = await db.from("shows").insert(retryPayload).select("id").single();
          data = retry.data;
          error = retry.error;
          if (!error) {
            toast.error(
              dropKind
                ? "Kayıt eklendi ama TÜR yazılamadı: `shows.kind` kolonu yok.\n" +
                    "Supabase'de supabase/migrations/20260928_show_kind.sql dosyasını çalıştır." +
                    (dropMal
                      ? "\nAyrıca `shows.mal_id` kolonu yok: MAL kimliği kaydedilemedi."
                      : "")
                : "Kayıt eklendi ama MAL kimliği yazılamadı: `shows.mal_id` kolonu yok.",
            );
          }
        }
      }
      if (error) throw error;

      // Yeni DİZİ boş kalmasın: 1. sezonu hazır aç, bölümler doğrudan eklenebilsin.
      // FİLM için sezon açılmaz — film tek parçadır (bkz. bileşen başındaki not).
      const showId = (data as { id: string } | null)?.id;
      if (showId && schemaReady && !isMovie) {
        const { error: seasonError } = await db
          .from("show_seasons")
          .insert({ show_id: showId, number: 1, title: "", sort_order: 1 });
        if (seasonError) {
          toast.error(
            `Kayıt oluşturuldu ama 1. sezon açılamadı: ${seasonError.message}\n\n"Sezonlar ve bölümler" panelinden elle ekleyebilirsin.`,
          );
        }
      }

      onAdded(`"${title.trim()}" eklendi. Adres: /anime/${finalSlug}`);
      reset();
    } catch (error) {
      toast.error(
        (isMovie ? "Film eklenemedi: " : "Seri eklenemedi: ") +
          (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button className="rounded-full" onClick={() => setOpen(true)}>
        <Plus size={16} /> {isMovie ? "Yeni film ekle" : "Yeni seri ekle"}
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-2xl border border-border bg-background p-4">
      {/* MAL KİMLİĞİYLE ARAMA — formun İLK adımı: birincil akış budur. */}
      <div className="rounded-xl border border-dashed border-border bg-secondary/40 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="shrink-0 text-[11px] font-bold text-muted-foreground">MAL kimliği</span>
          {/* Sabit genişlik SARMALAYICIYA verilir: `inputCls` içindeki `w-full`
              doğrudan sınıfla ezilemiyor (bkz. ShowEditor'daki aynı not). */}
          <div className="w-28 shrink-0">
            <input
              className={`${inputCls} font-mono text-xs`}
              value={malInput}
              onChange={(event) => setMalInput(event.target.value.replace(/[^0-9]/g, ""))}
              placeholder="ör. 42310"
              inputMode="numeric"
              aria-label="MyAnimeList kimliği"
              title="myanimelist.net adresindeki sayı (ör. Cyberpunk: Edgerunners = 42310). Kutu boşsa Anime adı ile aranır."
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-10 shrink-0 rounded-full px-3 text-xs"
            onClick={() => void runMalSearch()}
            disabled={malBusy || busy}
            title="Kutudaki MAL kimliğini doğrular; kutu boşsa Anime adına göre arar"
          >
            {malBusy ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}{" "}
            MAL&apos;de ara
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Kimliği yaz, ara, çıkan satıra tıkla — ad · yıl · tür · adres · kapak kendiliğinden
            dolar.
          </span>
        </div>

        {/* ARANIYOR DURUMU */}
        {malBusy ? (
          <p className="animate-rise-in mt-1.5 flex items-center gap-2 text-[11px] font-bold text-muted-foreground">
            <Loader2 size={12} className="animate-spin" />
            AniList&apos;te aranıyor…
          </p>
        ) : null}

        {/* ÖZET SATIRI — liste görünür olduğu hâlde ne yapılacağını söyler. */}
        {!malBusy && malNotice ? (
          <p className="animate-rise-in mt-1.5 text-[11px] font-bold text-muted-foreground">
            {malNotice}
          </p>
        ) : null}

        {/* SONUÇ LİSTESİ — tıklayınca form dolar. Biçim (MOVIE/TV) ve yıl görünür
            ki film ile dizi kayıtları karıştırılmasın. */}
        {!malBusy && malHits.length > 0 ? (
          <ul className="animate-rise-in mt-1.5 max-h-40 space-y-0.5 overflow-y-auto rounded-xl border border-border p-1">
            {malHits.map((hit) => (
              <li key={hit.malId}>
                <button
                  type="button"
                  onClick={() => applyHit(hit)}
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
      </div>

      <input
        className={inputCls}
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
          if (!slugTouched) setSlug(slugify(event.target.value));
        }}
        placeholder={isMovie ? "Film adı *" : "Anime adı *"}
        aria-label="Anime adı"
      />
      <input
        className={inputCls}
        value={subtitle}
        onChange={(event) => setSubtitle(event.target.value)}
        placeholder="Kısa alt başlık (kart altında)"
        aria-label="Alt başlık"
      />
      <div className="flex flex-wrap gap-2">
        <input
          className={`${inputCls} w-28`}
          value={year}
          onChange={(event) => setYear(event.target.value)}
          placeholder="Yıl"
          aria-label="Yıl"
        />
        {/* Hazır tür listesi: yazım hatası yeni tür kategorisi oluşturmasın. */}
        <input
          className={`${inputCls} w-44`}
          list="shows-genre-options"
          value={genre}
          onChange={(event) => setGenre(event.target.value)}
          placeholder="Tür (ör. Aksiyon)"
          aria-label="Tür"
        />
      </div>
      <div className="flex items-center gap-2">
        {/* Panelde gösterilen adres ön eki: seri detayı artık `/anime/<slug>`. */}
        <span className="shrink-0 font-mono text-xs text-muted-foreground">/anime/</span>
        <input
          className={`${inputCls} font-mono text-xs`}
          value={slug}
          onChange={(event) => {
            setSlug(event.target.value);
            setSlugTouched(true);
          }}
          placeholder="url-adresi (boşsa başlıktan üretilir)"
          aria-label="URL adresi (slug)"
        />
      </div>
      <ImageDrop
        label="Kapak görseli"
        onFile={handleCoverFile}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border bg-card px-4 py-3 text-left text-sm"
      >
        {preview ? (
          <img src={preview} alt="" className="h-16 w-12 shrink-0 rounded object-cover" />
        ) : (
          <ImagePlus size={18} className="shrink-0 text-primary" />
        )}
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {file
            ? file.name
            : malCoverUrl
              ? "Kapak: AniList'ten getirildi — değiştirmek için tıkla"
              : "Kapak görseli — tıkla ya da buraya sürükle"}
        </span>
      </ImageDrop>
      <div className="flex gap-2">
        <Button size="sm" className="rounded-full" onClick={() => void create()} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Oluştur
        </Button>
        <Button size="sm" variant="ghost" className="rounded-full" onClick={reset}>
          Vazgeç
        </Button>
      </div>
    </div>
  );
}

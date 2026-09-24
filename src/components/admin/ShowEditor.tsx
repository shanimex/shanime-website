import {
  ArrowDown,
  ArrowUp,
  ImagePlus,
  ListVideo,
  Loader2,
  Save,
  Star,
  Video,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ImageDrop } from "@/components/admin/ImageDrop";
import { SeasonsPanel } from "@/components/admin/SeasonsPanel";
import { db, inputCls, slugify, uniqueSlug } from "@/lib/admin";
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
      alert("Kapak güncellenemedi: " + (error instanceof Error ? error.message : String(error)));
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
      alert("Banner yüklenemedi: " + (error instanceof Error ? error.message : String(error)));
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
      alert("Video yüklenemedi: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!title.trim()) {
      alert("Başlık boş olamaz.");
      return;
    }
    setSaving(true);
    const nextSlug = uniqueSlug(slugify(slugInput.trim() || title), takenSlugs);
    const { error } = await db
      .from("shows")
      .update({
        title: title.trim(),
        subtitle: subtitle.trim(),
        description: description.trim(),
        year: year.trim(),
        genre: genre.trim(),
        slug: nextSlug,
      })
      .eq("id", show.id);
    setSaving(false);
    if (error) {
      alert("Kaydedilemedi: " + error.message);
      return;
    }
    setSlugInput(nextSlug);
    onReload(`"${title.trim()}" güncellendi. Adres: /seri/${nextSlug}`);
  }

  const disabled = busy || saving;

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
              <span className="shrink-0 font-mono text-xs text-muted-foreground">/seri/</span>
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
              variant={episodesOpen ? "toggleOn" : "outline"}
              className="rounded-full"
              onClick={() => setEpisodesOpen((open) => !open)}
              aria-expanded={episodesOpen}
            >
              {/* Telefonda etiket kısalır: uzun etiket butonu tek başına bir
                  satıra düşürüp düğme yığınını dağıtıyordu. */}
              <ListVideo size={14} /> Sezonlar<span className="hidden sm:inline"> ve bölümler</span>
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

      {episodesOpen && (
        <div className="mt-4 border-t border-border pt-4">
          <SeasonsPanel showId={show.id} schemaReady={schemaReady} onNotice={onReload} />
        </div>
      )}
    </div>
  );
}

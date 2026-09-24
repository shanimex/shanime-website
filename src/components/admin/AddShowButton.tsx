import { ImagePlus, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ImageDrop } from "@/components/admin/ImageDrop";
import { db, inputCls, slugify, uniqueSlug } from "@/lib/admin";
import { uploadImage } from "@/lib/content";

export function AddShowButton({
  nextOrder,
  takenSlugs,
  schemaReady,
  onAdded,
}: {
  nextOrder: number;
  takenSlugs: (string | null)[];
  schemaReady: boolean;
  onAdded: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [year, setYear] = useState("");
  const [genre, setGenre] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setTitle("");
    setSubtitle("");
    setYear("");
    setGenre("");
    setSlug("");
    setSlugTouched(false);
    setFile(null);
    setOpen(false);
  }

  async function create() {
    if (!title.trim()) {
      alert("Başlık gerekli.");
      return;
    }
    if (!file) {
      alert("Kapak görseli seç.");
      return;
    }
    setBusy(true);
    try {
      const path = await uploadImage(file, "posters");
      const finalSlug = uniqueSlug(slugify(slug.trim() || title), takenSlugs);
      const { data, error } = await db
        .from("shows")
        .insert({
          title: title.trim(),
          subtitle: subtitle.trim(),
          description: "",
          year: year.trim(),
          genre: genre.trim(),
          image_path: path,
          sort_order: nextOrder,
          slug: finalSlug,
        })
        .select("id")
        .single();
      if (error) throw error;

      // Yeni seri boş kalmasın: 1. sezonu hazır aç, bölümler doğrudan eklenebilsin.
      const showId = (data as { id: string } | null)?.id;
      if (showId && schemaReady) {
        const { error: seasonError } = await db
          .from("show_seasons")
          .insert({ show_id: showId, number: 1, title: "", sort_order: 1 });
        if (seasonError) {
          alert(
            `Seri oluşturuldu ama 1. sezon açılamadı: ${seasonError.message}\n\n"Sezonlar ve bölümler" panelinden elle ekleyebilirsin.`,
          );
        }
      }

      onAdded(`"${title.trim()}" eklendi. Adres: /seri/${finalSlug}`);
      reset();
    } catch (error) {
      alert("Seri eklenemedi: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button className="rounded-full" onClick={() => setOpen(true)}>
        <Plus size={16} /> Yeni seri ekle
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-2xl border border-border bg-background p-4">
      <input
        className={inputCls}
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
          if (!slugTouched) setSlug(slugify(event.target.value));
        }}
        placeholder="Anime adı *"
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
        <input
          className={`${inputCls} w-44`}
          value={genre}
          onChange={(event) => setGenre(event.target.value)}
          placeholder="Tür (ör. Aksiyon)"
          aria-label="Tür"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-mono text-xs text-muted-foreground">/seri/</span>
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
        onFile={setFile}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed border-border bg-card px-4 py-3 text-left text-sm"
      >
        <ImagePlus size={18} className="shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {file ? file.name : "Kapak görseli — tıkla ya da buraya sürükle"}
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

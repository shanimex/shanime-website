import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ImagePlus, Loader2, LogOut, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchHeroImage, fetchShows, isAdmin, signImagePath, uploadImage, type ShowWithImage } from "@/lib/content";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "shanime | Yönetim" },
      { name: "description", content: "shanime içerik yönetim paneli." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

function AdminPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "denied" | "ready">("loading");
  const [shows, setShows] = useState<ShowWithImage[]>([]);
  const [heroUrl, setHeroUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const heroInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const [showsData, hero] = await Promise.all([fetchShows(), fetchHeroImage()]);
    setShows(showsData);
    setHeroUrl(hero);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      if (!userId) {
        navigate({ to: "/auth" });
        return;
      }
      if (!(await isAdmin(userId))) {
        if (!cancelled) setStatus("denied");
        return;
      }
      if (!cancelled) setStatus("ready");
      await reload();
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, reload]);

  async function handleHeroChange(file: File) {
    const path = await uploadImage(file, "site");
    await db.from("site_settings").upsert({ key: "hero_image", value: path });
    setHeroUrl(await signImagePath(path));
    setNotice("Ana görsel güncellendi.");
  }

  if (status === "loading") {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-5">
        <div className="max-w-sm rounded-3xl border border-border bg-card p-8 text-center">
          <h1 className="text-lg font-extrabold text-foreground">Yetki yok</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Bu hesap henüz admin değil. Site sahibinden admin yetkisi istemelisin.
          </p>
          <Button variant="outline" className="mt-5 rounded-full" onClick={() => supabase.auth.signOut().then(() => navigate({ to: "/auth" }))}>
            Çıkış yap
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-5xl items-center justify-between px-5">
          <a href="/" className="flex items-center gap-2 font-display text-xl text-foreground">
            <span className="grid size-8 place-items-center rounded-full border-2 border-accent text-xs text-primary">▶</span>
            shanime <span className="text-sm font-sans font-bold text-muted-foreground">· yönetim</span>
          </a>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            onClick={() => supabase.auth.signOut().then(() => navigate({ to: "/auth" }))}
          >
            <LogOut size={15} /> Çıkış
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-10 px-5 py-10">
        {notice && (
          <p className="rounded-2xl bg-secondary px-5 py-3 text-sm font-bold text-accent">{notice}</p>
        )}

        <section className="rounded-3xl border border-border bg-card p-6 md:p-8">
          <h2 className="font-display text-2xl text-foreground">Ana görsel (hero)</h2>
          <p className="mt-1 text-sm text-muted-foreground">Ana sayfanın en üstündeki büyük görsel.</p>
          <div className="mt-5 flex flex-wrap items-center gap-5">
            {heroUrl && (
              <img src={heroUrl} alt="Mevcut ana görsel" className="h-28 w-48 rounded-2xl object-cover" />
            )}
            <input
              ref={heroInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleHeroChange(file);
                e.target.value = "";
              }}
            />
            <Button className="rounded-full" onClick={() => heroInputRef.current?.click()}>
              <ImagePlus size={16} /> Yeni görsel yükle
            </Button>
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-card p-6 md:p-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-2xl text-foreground">Seriler</h2>
              <p className="mt-1 text-sm text-muted-foreground">Ana sayfadaki kartlar buradan yönetilir.</p>
            </div>
            <AddShowButton
              nextOrder={(shows[shows.length - 1]?.sort_order ?? 0) + 1}
              onAdded={() => {
                setNotice("Yeni seri eklendi.");
                void reload();
              }}
            />
          </div>
          <div className="mt-6 space-y-4">
            {shows.map((show) => (
              <ShowRow
                key={show.id}
                show={show}
                onSaved={() => {
                  setNotice(`"${show.title}" güncellendi.`);
                  void reload();
                }}
                onDeleted={() => {
                  setNotice(`"${show.title}" silindi.`);
                  void reload();
                }}
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function ShowRow({ show, onSaved, onDeleted }: { show: ShowWithImage; onSaved: () => void; onDeleted: () => void }) {
  const [title, setTitle] = useState(show.title);
  const [subtitle, setSubtitle] = useState(show.subtitle);
  const [image, setImage] = useState(show.image);
  const [imagePath, setImagePath] = useState(show.image_path);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    const path = await uploadImage(file, "posters");
    setImagePath(path);
    setImage(await signImagePath(path));
  }

  async function save() {
    setSaving(true);
    await db.from("shows").update({ title, subtitle, image_path: imagePath }).eq("id", show.id);
    setSaving(false);
    onSaved();
  }

  async function remove() {
    if (!window.confirm(`"${show.title}" silinsin mi?`)) return;
    await db.from("shows").delete().eq("id", show.id);
    onDeleted();
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-background p-4 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="group relative shrink-0 overflow-hidden rounded-xl"
        title="Görseli değiştir"
      >
        <img src={image} alt="" className="h-28 w-20 object-cover transition-opacity group-hover:opacity-60" />
        <span className="absolute inset-0 grid place-items-center text-background opacity-0 transition-opacity group-hover:opacity-100">
          <ImagePlus size={20} className="text-white" />
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      <div className="min-w-0 flex-1 space-y-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm font-extrabold text-foreground outline-none focus:border-primary"
          placeholder="Seri adı"
        />
        <input
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-muted-foreground outline-none focus:border-primary"
          placeholder="Kısa açıklama"
        />
      </div>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" className="rounded-full" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Kaydet
        </Button>
        <Button size="sm" variant="destructive" className="rounded-full" onClick={() => void remove()}>
          <Trash2 size={15} />
        </Button>
      </div>
    </div>
  );
}

function AddShowButton({ nextOrder, onAdded }: { nextOrder: number; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function add() {
    if (!title.trim() || !file) return;
    setSaving(true);
    const path = await uploadImage(file, "posters");
    await db.from("shows").insert({ title: title.trim(), subtitle: subtitle.trim(), image_path: path, sort_order: nextOrder });
    setSaving(false);
    setOpen(false);
    setTitle("");
    setSubtitle("");
    setFile(null);
    onAdded();
  }

  if (!open) {
    return (
      <Button className="rounded-full" onClick={() => setOpen(true)}>
        <Plus size={16} /> Seri ekle
      </Button>
    );
  }

  return (
    <div className="mt-2 w-full space-y-3 rounded-2xl border border-border bg-background p-4">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm font-extrabold text-foreground outline-none focus:border-primary"
        placeholder="Seri adı"
      />
      <input
        value={subtitle}
        onChange={(e) => setSubtitle(e.target.value)}
        className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-muted-foreground outline-none focus:border-primary"
        placeholder="Kısa açıklama"
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="rounded-full" onClick={() => fileRef.current?.click()}>
          <ImagePlus size={15} /> {file ? file.name : "Kapak görseli seç"}
        </Button>
        <Button size="sm" className="rounded-full" disabled={!title.trim() || !file || saving} onClick={() => void add()}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Ekle
        </Button>
        <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setOpen(false)}>
          Vazgeç
        </Button>
      </div>
    </div>
  );
}

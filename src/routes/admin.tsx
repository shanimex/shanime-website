import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, ImagePlus, Loader2, LogOut, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchHeroImage,
  fetchShows,
  isAdmin,
  showSlug,
  signImagePath,
  uploadImage,
  type Episode,
  type ShowWithImage,
} from "@/lib/content";
import { AD_SLOTS } from "@/components/AdSlot";
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

const inputCls =
  "h-10 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary";
const areaCls =
  "min-h-24 w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground outline-none focus:border-primary";

function slugify(text: string): string {
  const src = text.trim().toLocaleLowerCase("tr");
  const from = "çğıöşü";
  const to = "cgiosu";
  let out = "";
  for (const ch of src) {
    const i = from.indexOf(ch);
    out += i >= 0 ? to[i] : ch;
  }
  return (
    out
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "anime"
  );
}

function validVideoUrl(url: string): boolean {
  return /^https:\/\/[^\s"'<>]{10,300}$/.test(url);
}

function uniqueSlug(base: string, taken: string[]): string {
  let slug = base;
  let n = 2;
  while (taken.includes(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

function AdminPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "denied" | "ready">("loading");
  const [shows, setShows] = useState<ShowWithImage[]>([]);
  const [heroUrl, setHeroUrl] = useState<string | null>(null);
  const [adCodes, setAdCodes] = useState<Record<string, string>>({});
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

  useEffect(() => {
    if (status !== "ready") return;
    void (async () => {
      const { data } = await db
        .from("site_settings")
        .select("key,value")
        .in(
          "key",
          AD_SLOTS.map((s) => s.key),
        );
      const map: Record<string, string> = {};
      for (const row of (data ?? []) as { key: string; value: string }[]) {
        map[row.key] = (row.value as string) ?? "";
      }
      setAdCodes(map);
    })();
  }, [status]);

  async function saveAd(key: string) {
    const slot = AD_SLOTS.find((s) => s.key === key);
    await db.from("site_settings").upsert({ key, value: (adCodes[key] ?? "").trim() });
    setNotice(`${slot ? slot.label : key} kodu kaydedildi.`);
  }

  async function moveShow(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= shows.length) return;
    const next = [...shows];
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row);
    setShows(next);
    await Promise.all(
      next.map((s, i) => db.from("shows").update({ sort_order: i }).eq("id", s.id)),
    );
    setNotice("Sıralama güncellendi.");
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
            Bu hesap henüz admin değil. user_roles tablosuna kendi mailini "admin" rolüyle ekleyen.
          </p>
          <Button
            variant="outline"
            className="mt-5 rounded-full"
            onClick={() => supabase.auth.signOut().then(() => navigate({ to: "/auth" }))}
          >
            Çıkış yap
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <a href="/admin" className="flex items-center gap-2 font-display text-xl">
            <span className="grid size-8 place-items-center rounded-full border-2 border-accent text-xs text-primary">
              ▶
            </span>
            shanime{" "}
            <span className="text-sm font-sans font-bold text-muted-foreground">· yönetim</span>
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
          <p className="rounded-2xl bg-secondary px-5 py-3 text-sm font-bold text-accent">
            {notice}
          </p>
        )}

        <section className="rounded-3xl border border-border bg-card p-6 md:p-8">
          <h2 className="font-display text-2xl text-foreground">Ana görsel (hero)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ana sayfanın en üstündeki büyük görsel.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-5">
            {heroUrl && (
              <img
                src={heroUrl}
                alt="Mevcut ana görsel"
                className="h-28 w-48 rounded-2xl object-cover"
              />
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

        <AdSection
          adCodes={adCodes}
          onChange={(k, v) => setAdCodes((m) => ({ ...m, [k]: v }))}
          onSave={saveAd}
        />

        <section className="rounded-3xl border border-border bg-card p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl text-foreground">Seriler</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Kartlar, detay sayfaları ve bölümler buradan yönetilir.
              </p>
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
            {shows.map((show, i) => (
              <ShowRow
                key={show.id}
                show={show}
                first={i === 0}
                last={i === shows.length - 1}
                onMove={(dir) => void moveShow(i, dir)}
                onSaved={(msg) => {
                  setNotice(msg);
                  void reload();
                }}
                onDeleted={(msg) => {
                  setNotice(msg);
                  void reload();
                }}
              />
            ))}
            {shows.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Henüz seri yok. "Yeni seri ekle" ile başla.
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function AdSection({
  adCodes,
  onChange,
  onSave,
}: {
  adCodes: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onSave: (key: string) => Promise<void> | void;
}) {
  return (
    <section className="rounded-3xl border border-border bg-card p-6 md:p-8">
      <h2 className="font-display text-2xl text-foreground">Reklam kodları</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Sadece <b>Banner</b> kodlarını yapıştır. Popunder / Social Bar koyma — kullanıcı siteyi terk
        eder.
      </p>
      <div className="mt-5 space-y-5">
        {AD_SLOTS.map((slot) => (
          <div key={slot.key}>
            <label htmlFor={`ad-${slot.key}`} className="text-sm font-bold text-foreground">
              {slot.label}
            </label>
            <textarea
              id={`ad-${slot.key}`}
              className={`${areaCls} mt-2 font-mono text-xs`}
              placeholder={"Adsterra Banner kodu: <script ...> veya <ins ...>"}
              value={adCodes[slot.key] ?? ""}
              onChange={(e) => onChange(slot.key, e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              className="mt-2 rounded-full"
              onClick={() => void onSave(slot.key)}
            >
              <Save size={14} /> Kaydet
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function AddShowButton({ nextOrder, onAdded }: { nextOrder: number; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [year, setYear] = useState("");
  const [genre, setGenre] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

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
      const { error } = await db.from("shows").insert({
        title: title.trim(),
        subtitle: subtitle.trim(),
        description: "",
        year: year.trim(),
        genre: genre.trim(),
        image_path: path,
        sort_order: nextOrder,
        slug: slugify(title),
      });
      if (error) throw error;
      setOpen(false);
      setTitle("");
      setSubtitle("");
      setYear("");
      setGenre("");
      setFile(null);
      onAdded();
    } catch (err) {
      alert("Seri eklenemedi: " + (err instanceof Error ? err.message : String(err)));
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
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Anime adı *"
        aria-label="Anime adı"
      />
      <input
        className={inputCls}
        value={subtitle}
        onChange={(e) => setSubtitle(e.target.value)}
        placeholder="Kısa alt başlık (kart altında)"
        aria-label="Alt başlık"
      />
      <div className="flex flex-wrap gap-2">
        <input
          className={`${inputCls} w-28`}
          value={year}
          onChange={(e) => setYear(e.target.value)}
          placeholder="Yıl"
          aria-label="Yıl"
        />
        <input
          className={`${inputCls} w-44`}
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          placeholder="Tür (ör. Aksiyon)"
          aria-label="Tür"
        />
      </div>
      <input
        type="file"
        accept="image/*"
        className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-secondary file:px-4 file:py-2 file:text-sm file:font-bold file:text-foreground"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        aria-label="Kapak görseli"
      />
      <div className="flex gap-2">
        <Button size="sm" className="rounded-full" onClick={() => void create()} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Oluştur
        </Button>
        <Button size="sm" variant="ghost" className="rounded-full" onClick={() => setOpen(false)}>
          Vazgeç
        </Button>
      </div>
    </div>
  );
}

function ShowRow({
  show,
  first,
  last,
  onMove,
  onSaved,
  onDeleted,
}: {
  show: ShowWithImage;
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => void;
  onSaved: (msg: string) => void;
  onDeleted: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(show.title);
  const [subtitle, setSubtitle] = useState(show.subtitle ?? "");
  const [description, setDescription] = useState(show.description ?? "");
  const [year, setYear] = useState(show.year ?? "");
  const [genre, setGenre] = useState(show.genre ?? "");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    const path = await uploadImage(file, "posters");
    const { error } = await db.from("shows").update({ image_path: path }).eq("id", show.id);
    if (error) {
      alert("Kapak güncellenemedi: " + error.message);
      return;
    }
    onSaved(`"${show.title}" kapağı güncellendi.`);
  }

  async function save() {
    if (!title.trim()) {
      alert("Başlık boş olamaz.");
      return;
    }
    setSaving(true);
    const { error } = await db
      .from("shows")
      .update({
        title: title.trim(),
        subtitle: subtitle.trim(),
        description: description.trim(),
        year: year.trim(),
        genre: genre.trim(),
      })
      .eq("id", show.id);
    setSaving(false);
    if (error) {
      alert("Kaydedilemedi: " + error.message);
      return;
    }
    onSaved(`"${title.trim()}" güncellendi.`);
  }

  async function remove() {
    if (!window.confirm(`"${show.title}" ve tüm bölümleri silinsin mi?`)) return;
    await db.from("show_episodes").delete().eq("show_id", show.id);
    await db.from("show_characters").delete().eq("show_id", show.id);
    await db.from("show_images").delete().eq("show_id", show.id);
    await db.from("shows").delete().eq("id", show.id);
    onDeleted(`"${show.title}" silindi.`);
  }

  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <div className="flex gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="group relative h-28 w-20 shrink-0 overflow-hidden rounded-xl"
          title="Kapağı değiştir"
        >
          <img
            src={show.image}
            alt=""
            className="h-full w-full object-cover transition-opacity group-hover:opacity-60"
          />
          <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
            <ImagePlus size={20} className="text-white" />
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
        <div className="min-w-0 flex-1">
          <input
            className={inputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Başlık"
          />
          <input
            className={`${inputCls} mt-2`}
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="Kısa alt başlık"
            aria-label="Alt başlık"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              className={`${inputCls} w-24`}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="Yıl"
              aria-label="Yıl"
            />
            <input
              className={`${inputCls} w-40`}
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              placeholder="Tür"
              aria-label="Tür"
            />
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              /{showSlug(show)}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="rounded-full"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Kaydet
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => setOpen((o) => !o)}
            >
              {open ? "Bölümleri kapat" : "Bölümler"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full"
              onClick={() => onMove(-1)}
              disabled={first}
              aria-label="Yukarı taşı"
            >
              <ArrowUp size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full"
              onClick={() => onMove(1)}
              disabled={last}
              aria-label="Aşağı taşı"
            >
              <ArrowDown size={14} />
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="ml-auto rounded-full"
              onClick={() => void remove()}
            >
              <Trash2 size={14} /> Sil
            </Button>
          </div>
        </div>
      </div>
      <textarea
        className={`${areaCls} mt-3`}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Detay sayfası açıklaması"
        aria-label="Açıklama"
      />
      {open && <EpisodeList showId={show.id} />}
    </div>
  );
}

/** Kabul edilen video host aileleri: alan adında bu kelimeler geçen linkler geçerlidir.
 *  StreamWish aynaları sık değiştiği için (hgcloud.to, hglink.to, awish.pro…) isim bazlı liste tutuyoruz. */
const VIDEO_HOST_KEYWORDS = [
  "dood",
  "vidmoly",
  "streamwish",
  "awish.",
  "hgcloud",
  "hglink",
  "hgonline",
  "hgwatch",
  "hgplay",
  "khcloud",
  "filemoon",
  "streamtape",
  "mp4upload",
  "vidhide",
  "oneupload",
  "movhide",
];

/** Yapıştırılan metinden video linkini ayıklar:
 *  - <IFRAME ...> embed kodu yapıştırılırsa src="..." içindeki linki döndürür
 *  - düz link yapıştırılırsa aynen döndürür */
function extractEmbedUrl(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  const src = text.match(/src\s*=\s*["']([^"']+)["']/i);
  if (src) return src[1].trim();
  const bare = text.match(/https:\/\/[^\s"'<>]+/i);
  return bare ? bare[0] : text;
}

/** Input'a yapıştırılan tam embed kodunu link'e çevirir (normal yazma davranışı bozulmaz). */
function pasteEmbed(onSet: (v: string) => void) {
  return (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    e.preventDefault();
    onSet(extractEmbedUrl(text));
  };
}

function watchUrlError(url: string): string | null {
  const u = extractEmbedUrl(url);
  if (!u) return null;
  if (u.length > 300) return "Video linki çok uzun.";
  if (/["'<>\s]/.test(u)) return "Link geçersiz karakter içeriyor. Embed kodunun içindeki link otomatik alınır, düz linki yapıştır.";
  if (!u.startsWith("https://")) return "Link https:// ile başlamalı.";
  const host = u.replace(/^https:\/\//i, "").split("/")[0].toLowerCase();
  if (!VIDEO_HOST_KEYWORDS.some((k) => host.includes(k)))
    return "Bu video host tanınmıyor. Doodstream, VidMoly, StreamWish/hgcloud aileleri kabul edilir.";
  const path = u.replace(/^https:\/\/[^/]+/i, "");
  if (!/^\/[\w/.~?=&%-]*$/.test(path)) return "Link yolu geçersiz görünüyor.";
  return null;
}

function EpisodeList({ showId }: { showId: string }) {
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [number, setNumber] = useState("");
  const [title, setTitle] = useState("");
  const [watchUrl, setWatchUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const { data } = await db
      .from("show_episodes")
      .select("*")
      .eq("show_id", showId)
      .order("number", { ascending: true });
    const rows = (data ?? []) as Episode[];
    setEpisodes(rows);
    setNumber((n) =>
      n.trim() === "" ? String(rows.reduce((m, e) => Math.max(m, e.number), 0) + 1) : n,
    );
  }, [showId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function add() {
    const num = parseInt(number, 10);
    if (!Number.isFinite(num) || num < 1) {
      alert("Bölüm numarası 1'den büyük bir sayı olmalı.");
      return;
    }
    if (episodes?.some((e) => e.number === num)) {
      alert(`${num}. bölüm zaten var.`);
      return;
    }
    const err = watchUrlError(watchUrl);
    if (err) {
      alert(err);
      return;
    }
    setBusy(true);
    const { error } = await db.from("show_episodes").insert({
      show_id: showId,
      number: num,
      title: title.trim(),
      watch_url: extractEmbedUrl(watchUrl),
    });
    setBusy(false);
    if (error) {
      alert("Bölüm eklenemedi: " + error.message);
      return;
    }
    setTitle("");
    setWatchUrl("");
    setNumber(String(num + 1));
    await reload();
  }

  if (episodes === null) {
    return <p className="mt-3 text-sm text-muted-foreground">Bölümler yükleniyor…</p>;
  }

  return (
    <div className="mt-4 rounded-2xl border border-border bg-card p-4">
      <h3 className="font-display text-lg text-foreground">Bölümler ({episodes.length})</h3>
      <div className="mt-3 space-y-2">
        {episodes.map((ep) => (
          <EpisodeRow key={ep.id} episode={ep} onChanged={() => void reload()} />
        ))}
        {episodes.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Henüz bölüm yok. Aşağıdan ilk bölümü ekle.
          </p>
        )}
      </div>
      <div className="mt-4 space-y-2 border-t border-border pt-4">
        <div className="flex flex-wrap gap-2">
          <input
            className={`${inputCls} w-20`}
            inputMode="numeric"
            value={number}
            onChange={(e) => setNumber(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="No"
            aria-label="Bölüm numarası"
          />
          <input
            className={`${inputCls} w-52`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Bölüm adı (opsiyonel)"
            aria-label="Bölüm adı"
          />
        </div>
        <input
          className={inputCls}
          value={watchUrl}
          onChange={(e) => setWatchUrl(e.target.value)}
          onPaste={pasteEmbed(setWatchUrl)}
          placeholder="Video linki (StreamWish/hgcloud, Dood, VidMoly — embed kodu da olur)"
          aria-label="Video linki"
        />
        <Button size="sm" className="rounded-full" onClick={() => void add()} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Bölüm ekle
        </Button>
      </div>
    </div>
  );
}

function EpisodeRow({ episode, onChanged }: { episode: Episode; onChanged: () => void }) {
  const [title, setTitle] = useState(episode.title);
  const [watchUrl, setWatchUrl] = useState(episode.watch_url);
  const [busy, setBusy] = useState(false);

  async function save() {
    const err = watchUrlError(watchUrl);
    if (err) {
      alert(err);
      return;
    }
    setBusy(true);
    const { error } = await db
      .from("show_episodes")
      .update({ title: title.trim(), watch_url: extractEmbedUrl(watchUrl) })
      .eq("id", episode.id);
    setBusy(false);
    if (error) {
      alert("Bölüm güncellenemedi: " + error.message);
      return;
    }
    onChanged();
  }

  async function remove() {
    if (!window.confirm(`${episode.number}. bölüm silinsin mi?`)) return;
    setBusy(true);
    const { error } = await db.from("show_episodes").delete().eq("id", episode.id);
    setBusy(false);
    if (error) {
      alert("Bölüm silinemedi: " + error.message);
      return;
    }
    onChanged();
  }

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-sm font-extrabold text-primary">
          {episode.number}
        </span>
        <input
          className={`${inputCls} h-9 min-w-40 flex-1`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Bölüm adı (opsiyonel)"
          aria-label={`${episode.number}. bölüm adı`}
        />
        <Button size="sm" className="rounded-full" onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Kaydet
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="rounded-full"
          onClick={() => void remove()}
          disabled={busy}
        >
          <Trash2 size={14} />
        </Button>
      </div>
      <input
        className={`${inputCls} mt-2`}
        value={watchUrl}
        onChange={(e) => setWatchUrl(e.target.value)}
        onPaste={pasteEmbed(setWatchUrl)}
        placeholder="Video linki (embed kodu da yapıştırılabilir)"
        aria-label={`${episode.number}. bölüm video linki`}
      />
    </div>
  );
}

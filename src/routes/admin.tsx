import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Loader2, Lock, LogOut, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AddShowButton } from "@/components/admin/AddShowButton";
import { ShowEditor } from "@/components/admin/ShowEditor";
import { ShowRow, type ShowCounts } from "@/components/admin/ShowRow";
import { Button } from "@/components/ui/button";
import { AD_SLOTS } from "@/components/AdSlot";
import { defaultAdSource } from "@/lib/ad-defaults";
import { DataHealthPanel } from "@/components/admin/DataHealthPanel";
import { checkSchema, db, moveAndPersist, type SchemaState } from "@/lib/admin";
import { fetchShows, isAdmin, type ShowWithImage } from "@/lib/content";
import { supabase } from "@/integrations/supabase/client";

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

const EMPTY_COUNTS: ShowCounts = { seasons: 0, episodes: 0 };

function AdminPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "denied" | "ready">("loading");
  const [schema, setSchema] = useState<SchemaState>({ ready: true, message: null });
  const [shows, setShows] = useState<ShowWithImage[]>([]);
  const [counts, setCounts] = useState<Record<string, ShowCounts>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [adCodes, setAdCodes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const showsData = await fetchShows();
    setShows(showsData);

    // Sezon/bölüm sayıları seri listesiyle AYNI istekte, veritabanında sayılarak
    // gelir: seri başına ayrı istek yok, 1000+ bölümlü seride de doğru.
    const next: Record<string, ShowCounts> = {};
    for (const show of showsData) {
      next[show.id] = { seasons: show.season_count, episodes: show.episode_count };
    }
    setCounts(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [{ data }, schemaState] = await Promise.all([
        supabase.auth.getSession(),
        checkSchema(),
      ]);
      if (cancelled) return;
      setSchema(schemaState);
      const userId = data.session?.user.id;
      if (!userId) {
        void navigate({ to: "/auth" });
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

  /**
   * Ana sayfa vitrininde (hero) gösterilecek seriyi işaretler/kaldırır.
   * Ayrı bir "Kaydet" gerekmez; tıklar tıklamaz veritabanına yazılır.
   */
  async function toggleFeatured(show: ShowWithImage) {
    const next = !show.is_featured;
    const { error } = await db.from("shows").update({ is_featured: next }).eq("id", show.id);
    if (error) {
      alert("Vitrin ayarı kaydedilemedi: " + error.message);
      return;
    }
    setShows((list) =>
      list.map((item) => (item.id === show.id ? { ...item, is_featured: next } : item)),
    );
    setNotice(
      next
        ? `"${show.title}" ana sayfa vitrinine eklendi.`
        : `"${show.title}" vitrinden çıkarıldı.`,
    );
  }

  useEffect(() => {
    if (status !== "ready") return;
    void (async () => {
      const { data } = await db
        .from("site_settings")
        .select("key,value")
        .in(
          "key",
          AD_SLOTS.map((slot) => slot.key),
        );
      const map: Record<string, string> = {};
      for (const row of (data ?? []) as { key: string; value: string }[]) {
        map[row.key] = row.value ?? "";
      }
      setAdCodes(map);
    })();
  }, [status]);

  const handleReload = useCallback(
    (message: string) => {
      setNotice(message);
      void reload();
    },
    [reload],
  );

  async function moveShow(show: ShowWithImage, dir: -1 | 1) {
    const index = shows.findIndex((item) => item.id === show.id);
    if (index < 0) return;
    const moved = await moveAndPersist("shows", shows, index, dir);
    if (!moved) return;
    setShows(moved);
    setNotice("Sıralama güncellendi.");
  }

  async function deleteShow(show: ShowWithImage) {
    const stats = counts[show.id];
    const detail =
      stats && (stats.episodes > 0 || stats.seasons > 0)
        ? ` (${stats.seasons} sezon, ${stats.episodes} bölüm)`
        : "";
    if (!window.confirm(`"${show.title}"${detail} silinsin mi? Bu işlem geri alınamaz.`)) return;
    try {
      await db.from("show_episodes").delete().eq("show_id", show.id);
      await db.from("show_seasons").delete().eq("show_id", show.id);
      const { error } = await db.from("shows").delete().eq("id", show.id);
      if (error) throw error;
      setExpandedId((current) => (current === show.id ? null : current));
      setNotice(`"${show.title}" silindi.`);
      await reload();
    } catch (error) {
      alert("Silinemedi: " + (error instanceof Error ? error.message : String(error)));
    }
  }

  const filtering = query.trim().length > 0;
  const visibleShows = useMemo(() => {
    if (!filtering) return shows;
    const needle = query.trim().toLocaleLowerCase("tr");
    return shows.filter((show) =>
      `${show.title} ${show.slug ?? ""}`.toLocaleLowerCase("tr").includes(needle),
    );
  }, [shows, query, filtering]);
  const totalEpisodes = shows.reduce((total, show) => total + (counts[show.id]?.episodes ?? 0), 0);
  const featuredCount = shows.filter((show) => show.is_featured).length;

  // Mevcut türler: tür alanına yazarken öneri olarak çıkar. Böylece "Aksiyon"
  // yerine "aksiyon" yazıp ana sayfada ikinci bir tür kategorisi oluşmaz.
  const genreOptions = useMemo(() => {
    const set = new Set<string>();
    for (const show of shows) {
      for (const part of (show.genre ?? "").split(",")) {
        const value = part.trim();
        if (value) set.add(value);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, "tr"));
  }, [shows]);

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
            Bu hesap henüz admin değil. user_roles tablosuna kendi mailini &quot;admin&quot; rolüyle
            ekleyin.
          </p>
          <Button
            variant="outline"
            className="mt-5 rounded-full"
            onClick={() => void supabase.auth.signOut().then(() => navigate({ to: "/auth" }))}
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
          <a href="/admin" aria-label="shanime yönetim" className="flex items-center gap-3">
            <img
              src="/shanime-logo.png"
              alt="shanime logosu"
              width={800}
              height={187}
              loading="eager"
              decoding="async"
              className="h-9 w-auto object-contain"
            />
            <span className="sr-only">shanime</span>
            <span className="text-sm font-sans font-bold text-muted-foreground">· yönetim</span>
          </a>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            onClick={() => void supabase.auth.signOut().then(() => navigate({ to: "/auth" }))}
          >
            <LogOut size={15} /> Çıkış
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-5 py-8">
        <h1 className="sr-only">shanime yönetim paneli</h1>
        {notice && (
          <p className="rounded-2xl bg-secondary px-5 py-3 text-sm font-bold text-accent">
            {notice}
          </p>
        )}

        {!schema.ready && schema.message && (
          <p className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-5 py-4 text-sm font-bold text-destructive">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <span>{schema.message}</span>
          </p>
        )}

        <section className="admin-card admin-card--series">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-3 font-display text-2xl text-foreground">
                <span className="admin-card-label" aria-hidden />
                Seriler
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {shows.length} seri · {totalEpisodes} bölüm. Düzenlemek için satırdaki{" "}
                <b>Düzenle</b>&apos;ye bas.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                <b className="text-foreground">Ana sayfa vitrini:</b>{" "}
                {featuredCount > 0
                  ? `${featuredCount} seri sırayla dönüyor.`
                  : "hiç seri işaretli değil — tüm seriler sırayla döner."}{" "}
                Değiştirmek için <b>Düzenle</b> → <b>Vitrin&apos;de göster</b>.
              </p>
            </div>
            <AddShowButton
              nextOrder={shows.reduce((max, show) => Math.max(max, show.sort_order), 0) + 1}
              takenSlugs={shows.map((show) => show.slug)}
              schemaReady={schema.ready}
              onAdded={handleReload}
            />
          </div>

          {shows.length > 0 && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <div className="flex min-w-56 flex-1 items-center gap-2 rounded-full border border-border bg-background px-4">
                <Search size={15} className="shrink-0 text-muted-foreground" />
                <input
                  className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Seri ara (ad veya adres)"
                  aria-label="Seri ara"
                />
              </div>
              {filtering && (
                <span className="text-xs text-muted-foreground">
                  {visibleShows.length} sonuç · sıralamak için aramayı temizle
                </span>
              )}
            </div>
          )}

          <datalist id="shows-genre-options">
            {genreOptions.map((genre) => (
              <option key={genre} value={genre} />
            ))}
          </datalist>

          <div className="mt-4 space-y-2">
            {visibleShows.map((show) => {
              const index = shows.findIndex((item) => item.id === show.id);
              if (expandedId === show.id) {
                return (
                  <ShowEditor
                    key={show.id}
                    show={show}
                    first={index === 0}
                    last={index === shows.length - 1}
                    takenSlugs={shows
                      .filter((item) => item.id !== show.id)
                      .map((item) => item.slug)}
                    schemaReady={schema.ready}
                    onMove={(dir) => void moveShow(show, dir)}
                    onClose={() => setExpandedId(null)}
                    onToggleFeatured={() => void toggleFeatured(show)}
                    onReload={handleReload}
                  />
                );
              }
              return (
                <ShowRow
                  key={show.id}
                  show={show}
                  counts={counts[show.id] ?? EMPTY_COUNTS}
                  first={filtering || index === 0}
                  last={filtering || index === shows.length - 1}
                  onEdit={() => setExpandedId(show.id)}
                  onMove={(dir) => void moveShow(show, dir)}
                  onDelete={() => deleteShow(show)}
                />
              );
            })}
            {shows.length === 0 && (
              <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Henüz seri yok. &quot;Yeni seri ekle&quot; ile başla.
              </p>
            )}
            {shows.length > 0 && visibleShows.length === 0 && (
              <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Aramaya uyan seri yok.
              </p>
            )}
          </div>
        </section>

        {/* KAYNAK / ALTYAZI AKIŞI.
            Kullanıcının "bölümler nereden geliyor, TR/EN nasıl oluyor, kapaklar
            kaynağa göre değişiyor mu" sorularına panel içinden cevap. Statik metin:
            veri okumaz, bozulma riski yok. */}
        <section className="admin-card">
          <h2 className="flex items-center gap-3 font-display text-2xl text-foreground">
            <span className="admin-card-label" aria-hidden />
            Bölümler nereden geliyor?
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <b className="text-foreground">Bölüm listesi:</b> <code>ani.zip</code> API'si —
              internetten, <b>MAL kimliğiyle</b>. Projeye zip indirilmez; panel tarayıcıdan doğrudan
              çağırır. Seriyi eklerken MAL kimliğini girmen yeterli, sonra her sezon için
              <b> "Katalogdan çek"</b>.
            </li>
            <li>
              <b className="text-foreground">Türkçe altyazı:</b> 1) <b>anizm/puffy</b> kaynağı —
              altyazı videoya gömülü gelir, 1080p, reklamsız; 2) kaydı yoksa <b>bizim dosyamız</b>:{" "}
              <code>public/subs/&lt;slug&gt;-s1b1.tr.vtt</code> (dosya varsa menüde "Türkçe" hapı
              çıkar).
            </li>
            <li>
              <b className="text-foreground">İngilizce:</b> <b>megaplay</b> oynatıcısının kendi CC
              menüsünden seçilir — bizden bir şey gerekmez. İstersen{" "}
              <code>&lt;slug&gt;-s1b1.en.vtt</code> koyarsan "İngilizce" hapı da çıkar.
            </li>
            <li>
              <b className="text-foreground">Kapaklar:</b> önce ani.zip'in gerçek bölüm görseli
              (derleme zamanında gömülü — <code>npm run covers:sync</code>), yoksa oynatıcının kendi
              kapağı, yoksa seri posteri. Yani kaynak değişse bile kapak boşa düşmez.
            </li>
            <li>
              <b className="text-foreground">Anizm kaydı üretmek:</b>{" "}
              <code>node scripts/resolve-anizm-hashes.mjs --slug &lt;slug&gt;</code> (dizinin
              puffytr'daki slug'ı aynı olmalı).
            </li>
          </ul>
        </section>

        <DataHealthPanel onNotice={setNotice} />

        <AdSection adCodes={adCodes} />
      </main>
    </div>
  );
}

function AdSection({ adCodes }: { adCodes: Record<string, string> }) {
  return (
    <section className="admin-card admin-card--ads">
      <h2 className="flex items-center gap-3 font-display text-2xl text-foreground">
        <span className="admin-card-label" aria-hidden />
        Reklam kodları
      </h2>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-bold text-foreground">
          <Lock size={11} /> Kilitli
        </span>
        <span>
          Kodlar burada <b>görünür</b>, panelden <b>değiştirilemez</b>. Kayıt yoksa koddaki
          varsayılan birim çalışır — yani kutu boş görünse de sitede reklam vardır.
        </span>
      </p>
      {/* 6 slot iki kolonda: eskiden alt alta dizilip sayfayı uzatıyordu. */}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {AD_SLOTS.map((slot) => {
          const saved = (adCodes[slot.key] ?? "").trim();
          return (
            <div key={slot.key} className="flex flex-col rounded-2xl bg-background/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-foreground">{slot.label}</span>
                <span
                  className={
                    saved
                      ? "rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary"
                      : "rounded-full border border-border px-2 py-0.5 text-[10px] font-bold text-muted-foreground"
                  }
                >
                  {saved ? "panelden kayıtlı" : "koddaki varsayılan"}
                </span>
              </div>
              {/* Salt okunur: kullanıcı isteğiyle kilitli. Kod görünsün, değişmesin. */}
              <pre className="mt-2 min-h-16 flex-1 overflow-x-auto whitespace-pre-wrap rounded-xl border border-border bg-background p-2 font-mono text-[11px] leading-5 text-muted-foreground">
                {saved || defaultAdSource(slot.key)}
              </pre>
            </div>
          );
        })}
      </div>
    </section>
  );
}

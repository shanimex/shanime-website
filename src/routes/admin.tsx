// /admin — Yönetim paneli: girişten sonra seri, bölüm, görsel ve reklam yönetimi.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Loader2, Lock, LogOut, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AddShowButton } from "@/components/admin/AddShowButton";
import { ShowEditor } from "@/components/admin/ShowEditor";
import { ShowRow, type ShowCounts } from "@/components/admin/ShowRow";
import { AdminToaster } from "@/components/admin/ToastHost";
import { AdminConfirmHost } from "@/components/admin/ConfirmHost";
import { confirmAction } from "@/lib/admin-confirm";
import { toast } from "@/lib/admin-toast";
import { Button } from "@/components/ui/button";
import { AD_SLOTS } from "@/components/site/AdSlot";
import { defaultAdSource } from "@/lib/ad-defaults";
import { fetchTurkishCoverage } from "@/lib/episode-sources";
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
  /**
   * Seri başına CANLI Türkçe kaynak kapsaması (rozetin payı).
   * `episode_sources.language = 'tr'` satırı olan bölüm sayısı — bkz. `fetchTurkishCoverage`.
   */
  const [trCoverage, setTrCoverage] = useState<Record<string, number>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [adCodes, setAdCodes] = useState<Record<string, string>>({});

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

    // TR KAYNAK KAPSAMASI — rozetin payı. Önceden derleme zamanındaki
    // `anizm-hashes.json` dosyasından ön ek sayılıyordu; yanlıştı (bkz.
    // `lib/anizm.ts` notu). Artık CANLI `episode_sources` verisinden gelir ve
    // ek istek sayısı SABİTTİR (seri sayısından bağımsız 2 istek).
    // Tablo/migration henüz kurulmadıysa panel ÇÖKMEZ: kapsama boş kalır (0).
    try {
      const coverage = await fetchTurkishCoverage(showsData.map((show) => show.id));
      const map: Record<string, number> = {};
      for (const [showId, count] of coverage) map[showId] = count;
      setTrCoverage(map);
    } catch {
      setTrCoverage({});
    }
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
      toast.error("Vitrin ayarı kaydedilemedi: " + error.message);
      return;
    }
    setShows((list) =>
      list.map((item) => (item.id === show.id ? { ...item, is_featured: next } : item)),
    );
    toast.success(
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

  /**
   * Alt panellerin "işlem bitti" çağrısı: mesajı BİLDİRİM (toast) olarak gösterir ve
   * listeleri tazeler. Bilinçli olarak tek noktada toplanmıştır ki panelin her
   * yerinde aynı geri bildirim dili olsun. (Eskiden mesaj sayfanın en tepesindeki
   * tek satırlık çubukta kalıyordu; aşağıda bölüm listesinde çalışan kullanıcı
   * işlemin sonucunu göremiyordu.)
   */
  const handleReload = useCallback(
    (message: string) => {
      toast.success(message);
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
    toast.success("Sıralama güncellendi.");
  }

  async function deleteShow(show: ShowWithImage) {
    const stats = counts[show.id];
    const detail =
      stats && (stats.episodes > 0 || stats.seasons > 0)
        ? ` (${stats.seasons} sezon, ${stats.episodes} bölüm)`
        : "";
    // SİTEYE ÖZEL ONAY PENCERESİ (native tarayıcı kutusu DEĞİL) —
    // kullanıcı isteği, 29.09.2026: "asla üstten tarayıcı mesajı çıkmasın."
    const ok = await confirmAction({
      title: `"${show.title}" silinsin mi?`,
      description:
        `${detail.trim() || "Bu kayıt"} kalıcı olarak silinir. ` +
        "Seri, sezonları ve bölümleriyle birlikte gider. Bu işlem geri alınamaz.",
      confirmLabel: "Sil",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await db.from("show_episodes").delete().eq("show_id", show.id);
      await db.from("show_seasons").delete().eq("show_id", show.id);
      const { error } = await db.from("shows").delete().eq("id", show.id);
      if (error) throw error;
      setExpandedId((current) => (current === show.id ? null : current));
      toast.success(`"${show.title}" silindi.`);
      await reload();
    } catch (error) {
      toast.error("Silinemedi: " + (error instanceof Error ? error.message : String(error)));
    }
  }

  const filtering = query.trim().length > 0;
  /**
   * ARAMA — ARTIK **AD, MAL KİMLİĞİ, ADRES ve TÜR** ile.
   *
   * Kullanıcı isteği (28.09.2026): "seriler kısmında da böyle olsun; arama şeyi
   * İSİM veya MAL KİMLİĞİ'yle ara olsun, çok daha temiz olur."
   *
   * ESKİ DAVRANIŞ yalnızca `title` + `slug` içinde geçen metne bakıyordu:
   * kullanıcı MAL kimliğini (ör. `48561`) yazdığında HİÇ sonuç çıkmıyordu —
   * oysa kimlik satır altında görünüyor ve en KESİN arama anahtarıdır.
   *
   * AYRICA "film"/"movie" ya da "seri"/"series" yazınca o tür süzülür: tür ayrımı
   * yeni geldiği için kullanıcı tek kelimeyle liste alabilsin.
   */
  const visibleShows = useMemo(() => {
    if (!filtering) return shows;
    const needle = query.trim().toLocaleLowerCase("tr");
    return shows.filter((show) => {
      const kindWords = (show.kind ?? "series") === "movie" ? "film movie" : "seri dizi series";
      const haystack =
        `${show.title} ${show.slug ?? ""} ${show.mal_id ?? ""} ${kindWords}`.toLocaleLowerCase(
          "tr",
        );
      return haystack.includes(needle);
    });
  }, [shows, query, filtering]);
  const totalEpisodes = shows.reduce((total, show) => total + (counts[show.id]?.episodes ?? 0), 0);
  const featuredCount = shows.filter((show) => show.is_featured).length;

  /**
   * SERİ / FİLM AYRIMI (kullanıcı isteği, 28.09.2026: "filmler eklemek için ayrı
   * yer ekle, seriler değil de filmler diye").
   *
   * Panel iki ayrı bölüm gösterir. Hangi kaydın film olduğu `shows.kind` ile
   * belirlenir; kolon veritabanında yoksa (`undefined`) kayıt **seri** sayılır —
   * bu yüzden `?? "series"` ile varsayılana düşülür ve migration çalıştırılmadan
   * önce de panel bozulmaz (tüm kayıtlar "Seriler" altında kalır).
   *
   * Arama (`visibleShows`) HER İKİ listeyi de süzer: kullanıcı bir film adı
   * yazdığında sonuç yalnızca Filmler bölümünde çıkar.
   */
  const isMovie = (show: ShowWithImage) => (show.kind ?? "series") === "movie";
  const seriesShows = useMemo(() => visibleShows.filter((show) => !isMovie(show)), [visibleShows]);
  const movieShows = useMemo(() => visibleShows.filter((show) => isMovie(show)), [visibleShows]);
  const totalMovies = useMemo(() => shows.filter((show) => isMovie(show)).length, [shows]);

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
      <header className="sticky top-0 z-50 border-b border-border bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <a href="/admin" aria-label="shanime yönetim" className="flex items-center gap-3">
            <img
              src="/shanime-logo.png?v=6"
              alt="shanime logosu"
              width={1060}
              height={856}
              loading="eager"
              decoding="async"
              className="h-11 w-auto object-contain"
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
        {/* İşlem sonuçları artık burada değil, sağ altta beliren bildirimlerde
            (toast) gösterilir — bkz. `components/admin/ToastHost.tsx` + `lib/admin-toast.ts`. */}

        {!schema.ready && schema.message && (
          <p className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-5 py-4 text-sm font-bold text-destructive">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <span>{schema.message}</span>
          </p>
        )}

        {/*
          ARAMA — BÖLÜMLERİN DIŞINDA, İKİSİNİ BİRDEN SÜZER.
          (Kullanıcı isteği: "seriler kısmında da böyle olsun, arama şeyi isim veya
          MAL kimliğiyle ara olsun".)

          Eskiden bu kutu "Seriler" kartının İÇİNDEydi; orada durunca yalnızca
          serileri süzdüğü izlenimi veriyordu, oysa artık `visibleShows` hem
          serileri hem filmleri süzüyor. Kutuyu iki kartın ÜSTÜNE aldım: tek arama,
          iki liste.
        */}
        {shows.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-56 flex-1 items-center gap-2 rounded-full border border-border bg-background px-4">
              <Search size={15} className="shrink-0 text-muted-foreground" />
              <input
                className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Ara: ad · MAL kimliği · adres · tür"
                aria-label="Seri veya film ara"
              />
            </div>
            {filtering && (
              <span className="text-xs text-muted-foreground">
                {visibleShows.length} sonuç ({seriesShows.length} seri · {movieShows.length} film) ·
                sıralamak için aramayı temizle
              </span>
            )}
          </div>
        )}

        <section className="admin-card admin-card--series">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-3 font-display text-2xl text-foreground">
                <span className="admin-card-label" aria-hidden />
                Seriler
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {shows.length - totalMovies} seri · {totalMovies} film · {totalEpisodes} bölüm.
                Düzenlemek için satırdaki <b>Düzenle</b>&apos;ye bas.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                <b className="text-foreground">Ana sayfa vitrini:</b>{" "}
                {/* METİN DÜZELTİLDİ (29.09.2026): eskiden "hiç seri işaretli değil —
                    tüm seriler sırayla döner" yazıyordu. O davranış hata olduğu için
                    kaldırıldı: artık işaretsiz seriler vitrine SIZMAZ, vitrin sitenin
                    kendi statik içeriğine döner (bkz. `routes/index.tsx` → heroShows). */}
                {featuredCount > 0
                  ? `${featuredCount} seri sırayla dönüyor.`
                  : "hiç seri işaretli değil — vitrin sitenin kendi örnek içeriğini gösteriyor; işaretlemediklerin asla vitrine çıkmaz."}{" "}
                Değiştirmek için <b>Düzenle</b> → <b>Vitrin&apos;de göster</b>.
              </p>
            </div>
            <AddShowButton
              nextOrder={shows.reduce((max, show) => Math.max(max, show.sort_order), 0) + 1}
              takenSlugs={shows.map((show) => show.slug)}
              genreOptions={genreOptions}
              schemaReady={schema.ready}
              onAdded={handleReload}
            />
          </div>

          {/* Arama kutusu artık bu kartın DIŞINDA (iki bölümü birden süzer) —
              yukarıya taşındı. `datalist` ise formda kullanıldığı için burada
              kalmalı. */}
          <datalist id="shows-genre-options">
            {genreOptions.map((genre) => (
              <option key={genre} value={genre} />
            ))}
          </datalist>

          <div className="mt-4 space-y-2">
            {seriesShows.map((show) => {
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
                  trCount={trCoverage[show.id] ?? 0}
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
            {shows.length - totalMovies === 0 && !filtering && (
              <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Henüz seri yok. &quot;Yeni seri ekle&quot; ile başla.
              </p>
            )}
            {filtering && seriesShows.length === 0 && (
              <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Aramaya uyan seri yok.
              </p>
            )}
          </div>
        </section>

        {/*
          ═══════════════════════════════════════════════════════════════════════
          FİLMLER — SERİLERDEN AYRI BÖLÜM
          (kullanıcı isteği: "filmler eklemek için ayrı yer ekle, seriler değil de
          filmler diye".)

          NEDEN AYRI: film tek parça içeriktir; sezon/bölüm akışı yoktur. Aynı
          listede durunca (a) panelde "0 bölüm" satırı olarak görünüyor, (b)
          sıralama ve vitrin mantığı dizi akışına göre işliyordu. Ayrı bölüm
          sayesinde "Yeni film ekle" düğmesi kaydı doğrudan `kind: "movie"` ile
          oluşturur ve hiç sezon açmaz (bkz. `AddShowButton`).

          Görsel olarak da ayrı bir kart: aynı renk olsaydı iki liste karışırdı.
          ═══════════════════════════════════════════════════════════════════════
        */}
        <section className="admin-card">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-3 font-display text-2xl text-foreground">
                <span className="admin-card-label" aria-hidden />
                Filmler
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {totalMovies} film. Filmler tek parçadır — sezon/bölüm açılmaz; kaynak seçimi izleme
                sayfasından yapılır.
              </p>
            </div>
            <AddShowButton
              kind="movie"
              nextOrder={shows.reduce((max, show) => Math.max(max, show.sort_order), 0) + 1}
              takenSlugs={shows.map((show) => show.slug)}
              genreOptions={genreOptions}
              schemaReady={schema.ready}
              onAdded={handleReload}
            />
          </div>

          <div className="mt-4 space-y-2">
            {movieShows.map((show) => {
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
                  trCount={trCoverage[show.id] ?? 0}
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
            {totalMovies === 0 && !filtering && (
              <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Henüz film yok. &quot;Yeni film ekle&quot; ile ekle — ör. Jujutsu Kaisen 0 (MAL
                48561).
              </p>
            )}
            {filtering && movieShows.length === 0 && (
              <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Aramaya uyan film yok.
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
              <b className="text-foreground">Türkçe altyazı → KAYNAK: anizm/puffy.</b> Altyazı
              videoya gömülü gelir (1080p, reklamsız); ayrı dosya gerekmez. İzleme sayfasındaki{" "}
              <b>Kaynak</b> düğmesinden seçilir.{" "}
              <span className="text-xs">
                Kayıt üretmek:{" "}
                <code>node scripts/resolve-anizm-hashes.mjs --slug &lt;slug&gt;</code> · puffytr
                slug'ı farklıysa <code>--puffy &lt;slug&gt;</code> (ölçülmüş farklar betikte
                tanımlı: erased → boku-dake-ga-inai-machi, re-zero →
                rezero-kara-hajimeru-isekai-seikatsu, mushoku-tensei →
                mushoku-tensei-isekai-ittara-honki-dasu).
              </span>
            </li>
            <li>
              <b className="text-foreground">İngilizce altyazı → KAYNAK: megaplay.</b> Oynatıcının
              kendi CC menüsünden seçilir; bizden ayar gerekmez.
            </li>
            <li>
              <b className="text-foreground">Yerel altyazı katmanı kullanılmıyor.</b> Eski{" "}
              <code>public/subs/*.vtt</code> dosyaları silindi; sistem yalnızca <b>iki kaynak</b>
              üzerinden çalışır (TR: anizm, EN: megaplay) ve altyazı menüsü artık görünmez.
            </li>
            <li>
              <b className="text-foreground">Kapaklar:</b> önce ani.zip'in gerçek bölüm görseli
              (derleme zamanında gömülü — <code>npm run covers:sync</code>), yoksa oynatıcının kendi
              kapağı, yoksa seri posteri. Yani kaynak değişse bile kapak boşa düşmez.
            </li>
          </ul>
        </section>

        <DataHealthPanel onNotice={handleReload} />

        <AdSection adCodes={adCodes} />
      </main>

      {/* Panelin her yerinden çalışan bildirim katmanı. */}
      <AdminToaster />
      {/* SİTEYE ÖZEL ONAY PENCERESİ — native `window.confirm` yerine. Panelin her
          yerinden `confirmAction()` ile çağrılır (bkz. `lib/admin-confirm.ts`). */}
      <AdminConfirmHost />
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
            // `min-w-0` ŞART: ızgara/flex çocuğu varsayılan olarak içeriğinden
            // küçülemez; reklam kodundaki uzun URL'ler kartı 623px'e genişletip
            // MOBİLDE sayfayı yatay kaydırtıyordu (ölçüm: scrollWidth 667 > 375).
            <div key={slot.key} className="flex min-w-0 flex-col rounded-2xl bg-background/50 p-3">
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
              {/* `overflow-wrap:anywhere`: kod içindeki uzun ve boşluksuz URL'ler
                  alt satıra kırılsın — yoksa kutu taşar (mobil taşmanın kaynağı). */}
              <pre className="mt-2 min-h-16 flex-1 overflow-x-auto rounded-xl border border-border bg-background p-2 font-mono text-[11px] leading-5 break-words text-muted-foreground [overflow-wrap:anywhere]">
                {saved || defaultAdSource(slot.key)}
              </pre>
            </div>
          );
        })}
      </div>
    </section>
  );
}

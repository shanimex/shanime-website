// /admin — Yönetim paneli: girişten sonra seri, bölüm, görsel ve reklam yönetimi.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Loader2, Lock, LogOut, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminTabBar, AdminSidebar, type AdminView } from "@/components/admin/AdminNav";
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
import { ADMIN_LOGO_HEIGHT, ADMIN_LOGO_SRC, ADMIN_LOGO_WIDTH } from "@/lib/brand";

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

/**
 * SAYFA BAŞINA SERİ/FİLM — "Daha fazla göster" bu adımla büyür.
 *
 * NEDEN: panel tek sayfa ve seri sayısı zamanla artıyor (yüzlerce olacak).
 * Tüm listeyi birden çizmek sayfayı kilometrelerce uzatıp DOM'u şişiriyordu.
 * Başlangıçta yalnızca bu kadar satır çizilir; gerisi isteğe bağlı açılır.
 * `12` seçildi: mobilde tek elle birkaç kaydırma, masaüstünde ~tek ekran.
 */
const LIST_PAGE = 12;

function AdminPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "denied" | "ready">("loading");
  const [schema, setSchema] = useState<SchemaState>({ ready: true, message: null });
  const [shows, setShows] = useState<ShowWithImage[]>([]);
  const [counts, setCounts] = useState<Record<string, ShowCounts>>({});
  /**
   * Seri başına CANLI sağlayıcı kaynak kapsaması (sağlayıcı x/x rozetleri).
   * Bölümler normal 1..N aralığında sayılır; Anizm/Puffy tek Anizm grubudur.
   */
  const [sourceCoverage, setSourceCoverage] = useState<Record<string, Record<string, number>>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [repairShowId, setRepairShowId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [adCodes, setAdCodes] = useState<Record<string, string>>({});
  /** Çizilen seri/film sayısı — "Daha fazla göster" ile `LIST_PAGE` kadar artar. */
  const [seriesLimit, setSeriesLimit] = useState(LIST_PAGE);
  const [movieLimit, setMovieLimit] = useState(LIST_PAGE);
  /**
   * MOBİL SEKME GÖRÜNÜMÜ. `md` altında yalnızca seçili bölüm çizilir (diğerleri
   * `max-md:hidden`) — sekme çubuğu artık kaydırmaz, bölüm DEĞİŞTİRİR.
   * PC'de etkisi yoktur: `max-md:hidden` 768 px üstünde devre dışı kalır.
   */
  const [view, setView] = useState<AdminView>("panel-series");

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
      const map: Record<string, Record<string, number>> = {};
      for (const [showId, groups] of coverage) map[showId] = Object.fromEntries(groups);
      setSourceCoverage(map);
    } catch {
      setSourceCoverage({});
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
    try {
      const moved = await moveAndPersist("shows", shows, index, dir);
      if (!moved) return;
      setShows(moved);
      toast.success("Sıralama güncellendi.");
    } catch (error) {
      toast.error(
        "Sıralama kaydedilemedi: " + (error instanceof Error ? error.message : String(error)),
      );
    }
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

  /**
   * GERÇEKTEN ÇİZİLEN LİSTE. Aramada sınır UYGULANMAZ (sonuç zaten az),
   * normal listede ilk `seriesLimit`/`movieLimit` satır çizilir.
   */
  const shownSeries = filtering ? seriesShows : seriesShows.slice(0, seriesLimit);
  const shownMovies = filtering ? movieShows : movieShows.slice(0, movieLimit);

  /**
   * ODAK MODU — bir seri/film düzenlenirken panelde YALNIZCA o satır + editörü
   * kalır. Kullanıcı isteği (03.10.2026): "düzenlemeye basarsam diğer animeler
   * görünmesin, sadece o animenin düzenlemesi; gereksiz yere yük binmesin."
   * Diğer bölümler (Filmler/Veri sağlığı/Reklamlar) ve mobil sekme çubuğu da
   * gizlenir. "Düzenle → Kapat" deyince her şey eski hâline döner.
   */
  const editing = expandedId !== null;

  // Arama değişince sınırı sıfırla: yeni sonuçlar baştan görünsün (eski sınır kalmasın).
  useEffect(() => {
    setSeriesLimit(LIST_PAGE);
    setMovieLimit(LIST_PAGE);
  }, [query]);

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

  // Panel araması başlıktaki büyüteçle açılır (site başlığı deseni).
  // NOT: erken dönüşlerden (loading/denied) ÖNCE durmalı — sonra olursa hook
  // sırası render'dan render'a değişir ve React çöker.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

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
    <div className="admin-root min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
          <a href="/admin" aria-label="shanime yönetim" className="flex items-center gap-3">
            <img
              src={ADMIN_LOGO_SRC}
              alt="shanime logosu"
              width={ADMIN_LOGO_WIDTH}
              height={ADMIN_LOGO_HEIGHT}
              loading="eager"
              decoding="async"
              className="h-11 w-auto object-contain"
            />
            <span className="sr-only">shanime</span>
            <span className="text-sm font-sans font-bold text-muted-foreground">· yönetim</span>
          </a>
          <div className="flex items-center gap-1">
            {/* Büyüteç site başlığıyla AYNI dilde: beyaz, açıkken döner + kızarır. */}
            <button
              type="button"
              className="admin-search-toggle"
              aria-label="Seri veya film ara"
              aria-expanded={searchOpen}
              onClick={() => {
                setSearchOpen((open) => {
                  if (!open) {
                    requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
                  }
                  return !open;
                });
              }}
            >
              <Search size={18} aria-hidden="true" />
            </button>
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => void supabase.auth.signOut().then(() => navigate({ to: "/auth" }))}
            >
              <LogOut size={15} /> Çıkış
            </Button>
          </div>
        </div>
      </header>

      {/* ARAMA — header'ın ALTINDA, header genişliğinde boydan boya.
          Büyüteçle açılır, iki listeyi birden süzer. Sadece konum;
          value/onChange/ref/filtering mantığı aynı. */}
      {shows.length > 0 && searchOpen && (
        <div className="bg-background">
          <div className="admin-search admin-search-drop mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-3 py-3 sm:px-5">
            <div className="flex h-9 w-full min-w-0 items-center gap-2 rounded-full border border-border bg-transparent px-4">
              <Search size={15} className="admin-search-icon shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                className="h-full min-w-0 flex-1 bg-transparent px-1 font-sans text-[13px] font-medium tracking-[0.01em] text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/60"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Dizi, film veya MAL kimliği ara…"
                aria-label="Seri veya film ara"
              />
            </div>
            {filtering && (
              <span className="text-xs text-muted-foreground">
                {visibleShows.length} sonuç ({seriesShows.length} dizi · {movieShows.length} film) ·
                sıralamak için aramayı temizle
              </span>
            )}
          </div>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-7xl items-start gap-6 px-3 py-5 sm:px-5 sm:py-8">
        <AdminSidebar
          view={view}
          onChange={(next) => {
            setView(next);
            window.scrollTo(0, 0);
          }}
        />
        <main
          className={`min-w-0 flex-1 space-y-4 sm:space-y-5 ${editing ? "pb-10" : "pb-24 md:pb-0"}`}
        >
          <h1 className="sr-only">shanime yönetim paneli</h1>
          {/* İşlem sonuçları artık burada değil, sağ altta beliren bildirimlerde
            (toast) gösterilir — bkz. `components/admin/ToastHost.tsx` + `lib/admin-toast.ts`. */}

          {!schema.ready && schema.message && (
            <p className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-5 py-4 text-sm font-bold text-destructive">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <span>{schema.message}</span>
            </p>
          )}

          <section
            id="panel-series"
            className={`admin-card admin-card--series scroll-mt-24 ${
              view === "panel-series" ? "" : "hidden"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-3 font-display text-xl text-foreground">
                  <span className="admin-card-label" aria-hidden />
                  Diziler
                </h2>
                {/* ALT SATIR YALNIZCA SERİ SAYISINI YAZAR.
                    Kullanıcı isteği (03.10.2026): "burada filmin kaç adet olduğundan
                    bize ne; burası seriler kataloğu, filmler kataloğu değil." Film ve
                    bölüm sayıları bu karttan KALDIRILDI — film sayısı kendi kartında,
                    bölüm sayısı satırların altında zaten var. */}
                <p className="mt-1 text-sm text-muted-foreground">
                  {shows.length - totalMovies} dizi.
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

            <div className="mt-3 space-y-2.5 sm:mt-4">
              {shownSeries
                .filter((show) => !editing || show.id === expandedId)
                .map((show) => {
                  const index = shows.findIndex((item) => item.id === show.id);
                  /**
                   * SATIR HER ZAMAN GÖRÜNÜR, DÜZENLEYİCİ ALTINA AÇILIR.
                   * KULLANICI İSTEĞİ (30.09.2026): "Düzenle basınca orası kaybolmasın,
                   * kalsın; aşağı doğru açılsın." Eskiden açıkken `ShowRow` yerine
                   * `ShowEditor` çiziliyordu → satır (kapak, ad, slug, rozetler) ekrandan
                   * kayboluyordu. Artık ikisi birlikte: üstte satır, altında düzenleyici.
                   */
                  const isOpen = expandedId === show.id;
                  return (
                    <div key={show.id} className="space-y-2">
                      <ShowRow
                        sourceCoverage={sourceCoverage[show.id] ?? {}}
                        show={show}
                        counts={counts[show.id] ?? EMPTY_COUNTS}
                        first={editing || filtering || index === 0}
                        last={editing || filtering || index === shows.length - 1}
                        open={isOpen}
                        onEdit={() => setExpandedId(isOpen ? null : show.id)}
                        onMove={(dir) => void moveShow(show, dir)}
                        onDelete={() => deleteShow(show)}
                      />
                      {isOpen ? (
                        <ShowEditor
                          show={show}
                          takenSlugs={shows
                            .filter((item) => item.id !== show.id)
                            .map((item) => item.slug)}
                          schemaReady={schema.ready}
                          onClose={() => setExpandedId(null)}
                          onToggleFeatured={() => void toggleFeatured(show)}
                          onReload={handleReload}
                          autoRepairSources={repairShowId === show.id}
                          onAutoRepairHandled={() => setRepairShowId(null)}
                        />
                      ) : null}
                    </div>
                  );
                })}
              {/* DAHA FAZLA GÖSTER — uzun listeyi parçalar; panel kısa kalır, DOM şişmez. */}
              {!editing && !filtering && seriesShows.length > seriesLimit ? (
                <button
                  type="button"
                  onClick={() => setSeriesLimit((n) => n + LIST_PAGE)}
                  className="w-full rounded-2xl border border-dashed border-border px-4 py-3 text-sm font-bold text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  Daha fazla göster · {seriesShows.length - seriesLimit} dizi kaldı
                </button>
              ) : null}
              {!editing && shows.length - totalMovies === 0 && !filtering && (
                <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Henüz dizi yok. &quot;Yeni dizi ekle&quot; ile başla.
                </p>
              )}
              {filtering && seriesShows.length === 0 && (
                <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Aramaya uyan dizi yok.
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
          <section
            id="panel-movies"
            className={`admin-card scroll-mt-24 ${view === "panel-movies" ? "" : "hidden"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-3 font-display text-xl text-foreground">
                  <span className="admin-card-label" aria-hidden />
                  Filmler
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {totalMovies} film — tek parça, sezon açılmaz.
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

            <div className="mt-3 space-y-2.5 sm:mt-4">
              {shownMovies.map((show) => {
                const index = shows.findIndex((item) => item.id === show.id);
                // FİLMLERDE DE AYNI DAVRANIŞ (kullanıcı isteği: "serilerde de
                // filmlerde de öyle olsun") — satır sabit, düzenleyici altına açılır.
                const isOpen = expandedId === show.id;
                return (
                  <div key={show.id} className="space-y-2">
                    <ShowRow
                      sourceCoverage={sourceCoverage[show.id] ?? {}}
                      show={show}
                      counts={counts[show.id] ?? EMPTY_COUNTS}
                      first={editing || filtering || index === 0}
                      last={editing || filtering || index === shows.length - 1}
                      open={isOpen}
                      onEdit={() => setExpandedId(isOpen ? null : show.id)}
                      onMove={(dir) => void moveShow(show, dir)}
                      onDelete={() => deleteShow(show)}
                    />
                    {isOpen ? (
                      <ShowEditor
                        show={show}
                        takenSlugs={shows
                          .filter((item) => item.id !== show.id)
                          .map((item) => item.slug)}
                        schemaReady={schema.ready}
                        onClose={() => setExpandedId(null)}
                        onToggleFeatured={() => void toggleFeatured(show)}
                        onReload={handleReload}
                        autoRepairSources={repairShowId === show.id}
                        onAutoRepairHandled={() => setRepairShowId(null)}
                      />
                    ) : null}
                  </div>
                );
              })}
              {!filtering && movieShows.length > movieLimit ? (
                <button
                  type="button"
                  onClick={() => setMovieLimit((n) => n + LIST_PAGE)}
                  className="w-full rounded-2xl border border-dashed border-border px-4 py-3 text-sm font-bold text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  Daha fazla göster · {movieShows.length - movieLimit} film kaldı
                </button>
              ) : null}
              {totalMovies === 0 && !filtering && (
                <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Henüz film yok.
                </p>
              )}
              {filtering && movieShows.length === 0 && (
                <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Aramaya uyan film yok.
                </p>
              )}
            </div>
          </section>

          <div
            id="panel-health"
            className={`scroll-mt-24 ${view === "panel-health" ? "" : "hidden"} ${
              editing ? "hidden" : ""
            }`}
          >
            <DataHealthPanel
              onNotice={handleReload}
              genreOptions={genreOptions}
              onOpenShow={(showId) => {
                setExpandedId(showId);
                setView("panel-series");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              onRepairSources={(showId) => {
                setRepairShowId(showId);
                setExpandedId(showId);
                setView("panel-series");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          </div>

          <div className={editing ? "hidden" : undefined}>
            <AdSection adCodes={adCodes} active={view === "panel-ads"} />
          </div>
        </main>
      </div>

      {/* Mobil alt sekme — bölüm DEĞİŞTİRİR (kaydırmaz). Geçişte sayfa başına dön.
          ODAK MODUNDA gizlenir: düzenleme açıkken tek çıkış, satırdaki "Kapat". */}
      {!editing ? (
        <AdminTabBar
          view={view}
          onChange={(next) => {
            setView(next);
            window.scrollTo(0, 0);
          }}
        />
      ) : null}

      {/* Panelin her yerinden çalışan bildirim katmanı. */}
      <AdminToaster />
      {/* SİTEYE ÖZEL ONAY PENCERESİ — native `window.confirm` yerine. Panelin her
          yerinden `confirmAction()` ile çağrılır (bkz. `lib/admin-confirm.ts`). */}
      <AdminConfirmHost />
    </div>
  );
}

function AdSection({ adCodes, active }: { adCodes: Record<string, string>; active: boolean }) {
  /**
   * REKLAM KODLARI — VARSAYILAN KAPALI (03.10.2026).
   *
   * NEDEN: bu bölüm salt-okunur ("Kilitli") ve panelde ~1088 px yer kaplıyordu —
   * uzun sayfanın en büyük iki kalemi olan seri listesiyle birlikte sayfayı yarı
   * yarıya uzatıyordu. Kodlar 6 slotun tam metnini taşıdığı için katlanabilir
   * yapıldı: panel kısa kalır, kodu GÖRMEK isteyen tek dokunuşla açar.
   */
  const [open, setOpen] = useState(false);
  const savedCount = AD_SLOTS.filter((slot) => (adCodes[slot.key] ?? "").trim()).length;
  return (
    <section
      id="panel-ads"
      className={`admin-card admin-card--ads scroll-mt-24 ${active ? "" : "hidden"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-3 font-display text-xl text-foreground">
            <span className="admin-card-label" aria-hidden />
            Reklam kodları
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-bold text-foreground">
              <Lock size={11} /> Kilitli
            </span>
            <span>
              <b>{AD_SLOTS.length}</b> slot · <b>{savedCount}</b> panelden kayıtlı · salt okunur
            </span>
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 rounded-full"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="ad-slots"
        >
          {open ? "Kodları gizle" : "Kodları göster"}
        </Button>
      </div>
      {open ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Kodlar burada <b>görünür</b>, panelden <b>değiştirilemez</b>. Kayıt yoksa koddaki
          varsayılan birim çalışır — yani kutu boş görünse de sitede reklam vardır.
        </p>
      ) : null}
      {/* 6 slot iki kolonda: eskiden alt alta dizilip sayfayı uzatıyordu.
          Kodlar YALNIZCA açıkken çizilir — `hidden` özniteliği Tailwind'in `grid`
          sınıfı tarafından ezildiği için (display:grid) koşullu çizim şart. */}
      {open ? (
        <div id="ad-slots" className="mt-3 grid gap-2.5 md:grid-cols-2">
          {AD_SLOTS.map((slot) => {
            const saved = (adCodes[slot.key] ?? "").trim();
            return (
              // `min-w-0` ŞART: ızgara/flex çocuğu varsayılan olarak içeriğinden
              // küçülemez; reklam kodundaki uzun URL'ler kartı 623px'e genişletip
              // MOBİLDE sayfayı yatay kaydırtıyordu (ölçüm: scrollWidth 667 > 375).
              <div
                key={slot.key}
                className="flex min-w-0 flex-col rounded-2xl bg-background/50 p-2.5"
              >
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
                <pre className="mt-1.5 min-h-10 flex-1 overflow-x-auto rounded-xl border border-border bg-background p-2 font-mono text-[11px] leading-5 break-words text-muted-foreground [overflow-wrap:anywhere]">
                  {saved || defaultAdSource(slot.key)}
                </pre>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

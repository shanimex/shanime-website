import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ListPlus,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  db,
  extractEmbedUrl,
  inputCls,
  moveAndPersist,
  nextSortOrder,
  pasteEmbed,
  watchUrlError,
} from "@/lib/admin";
import type { Episode, Season } from "@/lib/content";
import { syncAllEpisodePosters } from "@/lib/episode-covers";

/** Bir sayfada gösterilen bölüm sayısı. 1000+ bölümlü seriler için sayfalama şart. */
const PAGE_SIZE = 50;

/** Toplu eklemede tek istekte gönderilecek bölüm sayısı. */
const BULK_CHUNK = 100;

/**
 * Toplu ekleme satırını çözer. Kabul edilen biçimler:
 *   https://host/embed-abc.html
 *   42 - https://host/embed-abc.html
 *   https://host/embed-abc.html | 42. Bölüm adı
 */
function parseBulkLine(raw: string): {
  number: number | null;
  url: string;
  title: string;
} {
  const pipe = raw.indexOf("|");
  const urlPart = pipe >= 0 ? raw.slice(0, pipe) : raw;
  const title = pipe >= 0 ? raw.slice(pipe + 1).trim() : "";
  const match = urlPart.match(/^\s*(\d+)\s*[-.)\]]?\s+/);
  const parsedNumber = match?.[1] ? parseInt(match[1], 10) : Number.NaN;
  const withoutNumber = match ? urlPart.slice(match[0].length) : urlPart;
  return {
    number: Number.isFinite(parsedNumber) ? parsedNumber : null,
    url: extractEmbedUrl(withoutNumber),
    title,
  };
}

/** `show_seasons` kaydı olmayan ama bölümü olan sezonlar için üretilen geçici satır. */
const VIRTUAL_PREFIX = "sanal-sezon-";
type SeasonRow = Season & { virtual: boolean };

function virtualSeason(showId: string, number: number): SeasonRow {
  return {
    id: `${VIRTUAL_PREFIX}${showId}-${number}`,
    show_id: showId,
    number,
    title: "",
    sort_order: number,
    virtual: true,
  };
}

/** Sezon kayıtları ile bölümleri birleştirip gösterilecek sezon listesini üretir. */
function buildSeasonRows(seasonRows: Season[], episodes: Episode[], showId: string): SeasonRow[] {
  const map = new Map<number, SeasonRow>();
  for (const row of seasonRows) map.set(row.number, { ...row, virtual: false });
  for (const episode of episodes) {
    if (!map.has(episode.season)) map.set(episode.season, virtualSeason(showId, episode.season));
  }
  return [...map.values()].sort((a, b) => a.sort_order - b.sort_order || a.number - b.number);
}

export function SeasonsPanel({
  showId,
  schemaReady,
  onNotice,
}: {
  showId: string;
  schemaReady: boolean;
  onNotice: (message: string) => void;
}) {
  const [seasons, setSeasons] = useState<Season[] | null>(null);
  const [episodes, setEpisodes] = useState<Episode[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Kapak senkronu: panelde girilen embed adresinden bölüm kapağını çeker
  // (bkz. lib/episode-covers.ts). Elle bir şey yapmaya gerek yok — bölüm
  // eklenip kaydedildiğinde arka planda kendiliğinden çalışır.
  const [coverBusy, setCoverBusy] = useState(false);
  // Aynı anda tek sezon açık kalır ve bölümler sayfalanır: 1000+ bölümlü
  // serilerde (ör. One Piece) liste ve DOM şişmesin.
  const [openSeason, setOpenSeason] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const reload = useCallback(async () => {
    const [seasonRes, episodeRes] = await Promise.all([
      db
        .from("show_seasons")
        .select("*")
        .eq("show_id", showId)
        .order("sort_order", { ascending: true }),
      db
        .from("show_episodes")
        .select("*")
        .eq("show_id", showId)
        .order("number", { ascending: true }),
    ]);
    setSeasons((seasonRes.data ?? []) as Season[]);
    setEpisodes((episodeRes.data ?? []) as Episode[]);
  }, [showId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Elle kapak güncelleme: sağlayıcı tarafında kapak değişmişse yeniden çeker. */
  const syncCovers = useCallback(async () => {
    setCoverBusy(true);
    try {
      // Elle basıldığında TÜMÜ tazelenir (`force`): sağlayıcı kapak adreslerini
      // değiştirdiğinde eskiler geçersiz kalır, eksik taraması onları yakalamaz.
      const { resolved, failed } = await syncAllEpisodePosters(true);
      onNotice(
        resolved > 0
          ? `${resolved} bölüm kapağı tazelendi.`
          : failed > 0
            ? "Bölümler için sağlayıcıda görsel bulunamadı."
            : "Tüm bölüm kapakları güncel.",
      );
    } catch (error) {
      onNotice(
        "Kapaklar güncellenemedi: " + (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setCoverBusy(false);
    }
  }, [onNotice]);

  if (seasons === null || episodes === null) {
    return <p className="mt-3 text-sm text-muted-foreground">Bölümler yükleniyor…</p>;
  }

  const rows = buildSeasonRows(seasons, episodes, showId);
  const toggle = (number: number) => {
    setOpenSeason((current) => (current === number ? null : number));
    setPage(1);
  };

  async function addSeason() {
    if (!seasons || !episodes) return;
    const used = [...seasons.map((s) => s.number), ...episodes.map((e) => e.season)];
    const number = used.reduce((max, value) => Math.max(max, value), 0) + 1;
    setBusy(true);
    const { error } = await db
      .from("show_seasons")
      .insert({ show_id: showId, number, title: "", sort_order: nextSortOrder(seasons) });
    setBusy(false);
    if (error) {
      alert("Sezon eklenemedi: " + error.message);
      return;
    }
    setOpenSeason(number);
    setPage(1);
    onNotice(`${number}. sezon eklendi.`);
    await reload();
  }

  /** Bölümü olan ama sezon kaydı olmayan (migration öncesi) sezonu kalıcı hâle getirir. */
  async function materializeSeason(season: SeasonRow) {
    const { error } = await db
      .from("show_seasons")
      .insert({ show_id: showId, number: season.number, title: "", sort_order: season.number });
    if (error) {
      alert("Sezon oluşturulamadı: " + error.message);
      return;
    }
    onNotice(`${season.number}. sezon kaydı oluşturuldu.`);
    await reload();
  }

  async function removeSeason(season: SeasonRow) {
    const count = episodes?.filter((e) => e.season === season.number).length ?? 0;
    const label = season.title.trim() || `${season.number}. Sezon`;
    const message =
      count > 0
        ? `"${label}" ve içindeki ${count} bölüm silinsin mi? Bu işlem geri alınamaz.`
        : `"${label}" silinsin mi?`;
    if (!window.confirm(message)) return;
    setBusy(true);
    try {
      if (count > 0) {
        const { error } = await db
          .from("show_episodes")
          .delete()
          .eq("show_id", showId)
          .eq("season", season.number);
        if (error) throw error;
      }
      if (!season.virtual) {
        const { error } = await db.from("show_seasons").delete().eq("id", season.id);
        if (error) throw error;
      }
      onNotice(`"${label}" silindi.`);
      await reload();
    } catch (error) {
      alert("Sezon silinemedi: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(false);
    }
  }

  async function moveSeason(index: number, dir: -1 | 1) {
    // Kalıcı olmayan sezon varken sıralama yazılırsa veritabanı ile liste
    // birbirinden kopar; bu yüzden taşımadan önce engelliyoruz.
    if (rows.some((season) => season.virtual)) {
      alert(
        'Sezon kaydı olmayan bir sezon var. Önce "Sezon kaydını oluştur" ile onu kalıcı hâle getir, sonra sırala.',
      );
      return;
    }
    const moved = await moveAndPersist("show_seasons", rows, index, dir);
    if (!moved) return;
    onNotice("Sezon sırası güncellendi.");
    await reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg text-foreground">Sezonlar ve bölümler</h3>
          <p className="text-xs text-muted-foreground">
            Toplam {rows.length} sezon · {episodes.length} bölüm
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() => void syncCovers()}
            disabled={coverBusy || !schemaReady}
            title="Embed adresinden eksik bölüm kapaklarını çeker (yeni bölüm ekleyince gerektirmez)"
          >
            {coverBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Kapakları güncelle
          </Button>
          <Button
            size="sm"
            className="rounded-full"
            onClick={() => void addSeason()}
            disabled={busy || !schemaReady}
            title={schemaReady ? undefined : "Önce veritabanı güncellemesini çalıştır"}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Yeni sezon
            ekle
          </Button>
        </div>
      </div>

      {rows.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          Henüz sezon yok. &quot;Yeni sezon ekle&quot; ile 1. sezonu aç, sonra içine bölüm ekle.
        </p>
      )}

      {rows.map((season, index) => {
        const seasonEpisodes = episodes
          .filter((episode) => episode.season === season.number)
          .sort((a, b) => a.number - b.number);
        const isOpen = openSeason === season.number;
        return (
          <SeasonCard
            key={season.id}
            season={season}
            index={index}
            total={rows.length}
            episodes={seasonEpisodes}
            open={isOpen}
            page={page}
            onPageChange={setPage}
            busy={busy}
            schemaReady={schemaReady}
            onToggle={() => toggle(season.number)}
            onMove={(dir) => void moveSeason(index, dir)}
            onDelete={() => void removeSeason(season)}
            onMaterialize={() => void materializeSeason(season)}
            onChanged={async (message) => {
              onNotice(message);
              await reload();
              // Bölüm eklendi/güncellendi: kapağı eksikse arka planda çekilir.
              // Kasıtlı olarak BEKLENMEZ — kaydetme akışını yavaşlatmasın, hata
              // olsa bile arayüz etkilenmesin. Yalnızca eksikler için istek atar.
              void syncAllEpisodePosters().catch(() => {});
            }}
          />
        );
      })}
    </div>
  );
}

function SeasonCard({
  season,
  index,
  total,
  episodes,
  open,
  page,
  onPageChange,
  busy,
  schemaReady,
  onToggle,
  onMove,
  onDelete,
  onMaterialize,
  onChanged,
}: {
  season: SeasonRow;
  index: number;
  total: number;
  episodes: Episode[];
  open: boolean;
  page: number;
  onPageChange: (page: number) => void;
  busy: boolean;
  schemaReady: boolean;
  onToggle: () => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  onMaterialize: () => void;
  onChanged: (message: string) => Promise<void>;
}) {
  const pageCount = Math.max(1, Math.ceil(episodes.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const pageEpisodes = episodes.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const paginated = episodes.length > PAGE_SIZE;

  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-sm font-extrabold text-primary">
          S{season.number}
        </span>
        {/* Sezon adı her zaman otomatik: "1. Sezon". Düzenlenebilir bir alan yok. */}
        <div className="flex min-w-40 flex-1 items-center gap-2">
          <span className="truncate text-sm font-bold text-foreground">
            {season.title.trim() || `${season.number}. Sezon`}
          </span>
          <span className="shrink-0 text-xs font-bold text-muted-foreground">
            {episodes.length} bölüm
          </span>
        </div>
        {season.virtual && (
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={onMaterialize}
            disabled={busy || !schemaReady}
          >
            Sezon kaydını oluştur
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full"
          onClick={() => onMove(-1)}
          disabled={index === 0 || season.virtual}
          aria-label="Sezonu yukarı taşı"
        >
          <ArrowUp size={14} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full"
          onClick={() => onMove(1)}
          disabled={index === total - 1 || season.virtual}
          aria-label="Sezonu aşağı taşı"
        >
          <ArrowDown size={14} />
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="rounded-full"
          onClick={onDelete}
          disabled={busy}
        >
          <Trash2 size={14} /> Sil
        </Button>
        <Button
          size="sm"
          variant={open ? "toggleOn" : "outline"}
          className="ml-auto rounded-full"
          onClick={onToggle}
          aria-expanded={open}
        >
          <ChevronDown
            size={14}
            className={open ? "rotate-180 transition-transform" : "transition-transform"}
          />
          {open ? "Bölümleri kapat" : "Bölümler"}
        </Button>
      </div>

      {open && (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          {paginated && (
            <EpisodePager episodes={episodes} page={safePage} onPageChange={onPageChange} />
          )}

          {pageEpisodes.map((episode) => (
            <EpisodeRow
              key={episode.id}
              episode={episode}
              seasonNumber={season.number}
              busy={busy}
              onChanged={onChanged}
            />
          ))}

          {episodes.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Bu sezonda bölüm yok. Aşağıdan ilk bölümü ekle.
            </p>
          )}

          {paginated && (
            <EpisodePager episodes={episodes} page={safePage} onPageChange={onPageChange} />
          )}

          <AddEpisodeForm
            showId={season.show_id}
            seasonNumber={season.number}
            nextNumber={episodes.reduce((max, episode) => Math.max(max, episode.number), 0) + 1}
            disabled={busy || !schemaReady}
            onAdded={async (message) => {
              // Yeni bölüm listenin sonuna düşer: son sayfaya geç ki görünsün.
              onPageChange(Math.max(1, Math.ceil((episodes.length + 1) / PAGE_SIZE)));
              await onChanged(message);
            }}
          />

          <BulkAddForm
            showId={season.show_id}
            seasonNumber={season.number}
            startNumber={episodes.reduce((max, episode) => Math.max(max, episode.number), 0) + 1}
            takenNumbers={episodes.map((episode) => episode.number)}
            disabled={busy || !schemaReady}
            onAdded={async (message) => {
              onPageChange(Math.max(1, Math.ceil((episodes.length + 1) / PAGE_SIZE)));
              await onChanged(message);
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Yapıştırılan link listesini sırayla ekler. One Piece gibi 1000+ bölümlü
 * serilerde tek tek uğraşmamak için: her satıra bir link, numaralar otomatik.
 */
function BulkAddForm({
  showId,
  seasonNumber,
  startNumber,
  takenNumbers,
  disabled,
  onAdded,
}: {
  showId: string;
  seasonNumber: number;
  startNumber: number;
  takenNumbers: number[];
  disabled: boolean;
  onAdded: (message: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [start, setStart] = useState(String(startNumber));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStart(String(startNumber));
  }, [startNumber]);

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  async function submit() {
    if (lines.length === 0) {
      alert("En az bir video linki yapıştır.");
      return;
    }
    const parsed = lines.map(parseBulkLine);
    const invalid = parsed.filter((entry) => !entry.url || watchUrlError(entry.url));
    if (invalid.length > 0) {
      alert(
        `${invalid.length} satır geçersiz (tanınmayan video host'u veya bozuk link).\n\n` +
          "Geçerli örnek:\nhttps://vidmoly.to/embed-abc.html\n42 - https://dood.to/e/xyz | 42. Bölüm",
      );
      return;
    }

    const taken = new Set(takenNumbers);
    let cursor = parseInt(start, 10);
    if (!Number.isFinite(cursor) || cursor < 1) cursor = startNumber;
    const rows: {
      show_id: string;
      season: number;
      number: number;
      title: string;
      watch_url: string;
    }[] = [];
    let skipped = 0;
    for (const entry of parsed) {
      if (entry.number !== null) {
        // Numarası elle verilmiş satır: doluysa atlanır.
        if (taken.has(entry.number)) {
          skipped += 1;
          continue;
        }
        rows.push({
          show_id: showId,
          season: seasonNumber,
          number: entry.number,
          title: entry.title,
          watch_url: entry.url,
        });
        taken.add(entry.number);
        continue;
      }
      while (taken.has(cursor)) cursor += 1;
      rows.push({
        show_id: showId,
        season: seasonNumber,
        number: cursor,
        title: entry.title,
        watch_url: entry.url,
      });
      taken.add(cursor);
      cursor += 1;
    }

    if (rows.length === 0) {
      alert("Eklenecek yeni bölüm yok: bu numaraların hepsi dolu.");
      return;
    }

    setBusy(true);
    try {
      for (let i = 0; i < rows.length; i += BULK_CHUNK) {
        const { error } = await db.from("show_episodes").insert(rows.slice(i, i + BULK_CHUNK));
        if (error) throw error;
      }
      setText("");
      await onAdded(
        `${rows.length} bölüm eklendi${skipped > 0 ? ` (${skipped} satır zaten vardı, atlandı)` : ""}.`,
      );
    } catch (error) {
      alert(
        "Toplu ekleme yarıda kaldı: " +
          (error instanceof Error ? error.message : String(error)) +
          "\n\nO ana kadar eklenenler veritabanında kaldı; listeyi kontrol edip tekrar deneyebilirsin.",
      );
      await onAdded("Toplu ekleme yarıda kaldı.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="mt-2 rounded-full"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        <ListPlus size={14} /> Toplu bölüm ekle (link listesi)
      </Button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-dashed border-border p-3">
      <p className="text-sm font-bold text-foreground">Toplu bölüm ekleme</p>
      <p className="text-[11px] leading-5 text-muted-foreground">
        Her satıra bir video linki yaz. Numaralar sırayla atanır. İstersen satırın başına numara (
        <code>42 - link</code>) ya da sonuna <code>| Başlık</code> ekleyebilirsin.
      </p>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">İlk bölüm no</span>
        <input
          className={`${inputCls} w-20`}
          inputMode="numeric"
          value={start}
          onChange={(event) => setStart(event.target.value.replace(/[^0-9]/g, ""))}
          aria-label="İlk bölüm numarası"
        />
      </div>
      <textarea
        className="min-h-40 w-full rounded-xl border border-border bg-card p-3 font-mono text-xs leading-6 text-foreground outline-none focus:border-primary"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={
          "https://vidmoly.to/embed-abc.html\nhttps://earnvids.com/e/xyz\n42 - https://dood.to/e/abc | 42. Bölüm"
        }
        aria-label="Video linkleri"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="rounded-full"
          onClick={() => void submit()}
          disabled={busy || disabled}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <ListPlus size={14} />}{" "}
          {lines.length > 0 ? `${lines.length} satırı ekle` : "Ekle"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full"
          onClick={() => {
            setText("");
            setOpen(false);
          }}
          disabled={busy}
        >
          Kapat
        </Button>
      </div>
    </div>
  );
}

/** Uzun bölüm listeleri için sayfa gezinme çubuğu + "bölüm no ile git" kutusu. */
function EpisodePager({
  episodes,
  page,
  onPageChange,
}: {
  episodes: Episode[];
  page: number;
  onPageChange: (page: number) => void;
}) {
  const [jump, setJump] = useState("");
  const pageCount = Math.max(1, Math.ceil(episodes.length / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(episodes.length, page * PAGE_SIZE);

  function jumpToEpisode() {
    const target = parseInt(jump, 10);
    if (!Number.isFinite(target)) return;
    const index = episodes.findIndex((episode) => episode.number === target);
    if (index < 0) {
      alert(`${target}. bölüm bu sezonda yok.`);
      return;
    }
    onPageChange(Math.floor(index / PAGE_SIZE) + 1);
    setJump("");
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-secondary/60 px-3 py-2">
      <Button
        size="sm"
        variant="outline"
        className="rounded-full"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
      >
        <ChevronLeft size={14} /> Önceki
      </Button>
      <span className="text-xs font-bold text-muted-foreground">
        {start}–{end} / {episodes.length} bölüm · sayfa {page}/{pageCount}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="rounded-full"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pageCount}
      >
        Sonraki <ChevronRight size={14} />
      </Button>
      <span className="ml-auto flex items-center gap-2">
        <input
          className="h-8 w-20 rounded-lg border border-border bg-card px-2 text-xs text-foreground outline-none focus:border-primary"
          inputMode="numeric"
          value={jump}
          onChange={(event) => setJump(event.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(event) => {
            if (event.key === "Enter") jumpToEpisode();
          }}
          placeholder="Bölüm no"
          aria-label="Bölüm numarasına git"
        />
        <Button size="sm" variant="ghost" className="rounded-full" onClick={jumpToEpisode}>
          Git
        </Button>
      </span>
    </div>
  );
}

function AddEpisodeForm({
  showId,
  seasonNumber,
  nextNumber,
  disabled,
  onAdded,
}: {
  showId: string;
  seasonNumber: number;
  nextNumber: number;
  disabled: boolean;
  onAdded: (message: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [watchUrl, setWatchUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    // Numara her zaman otomatik gelir; elle girilmez.
    const num = nextNumber;
    const error = watchUrlError(watchUrl);
    if (error) {
      alert(error);
      return;
    }
    setBusy(true);
    const { error: insertError } = await db.from("show_episodes").insert({
      show_id: showId,
      season: seasonNumber,
      number: num,
      title: title.trim(),
      watch_url: extractEmbedUrl(watchUrl),
    });
    setBusy(false);
    if (insertError) {
      alert(
        insertError.message.includes("duplicate") || insertError.message.includes("unique")
          ? `${seasonNumber}. sezonun ${num}. bölümü zaten var.`
          : "Bölüm eklenemedi: " + insertError.message,
      );
      return;
    }
    setTitle("");
    setWatchUrl("");
    await onAdded(`${seasonNumber}. sezonun ${num}. bölümü eklendi.`);
  }

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-dashed border-border p-3">
      <div className="flex items-center gap-2">
        {/* Numara satırlardaki rozetle aynı yerde (solda) ama daha koyu/soluk ton:
            elle girilmediğini, otomatik atandığını belli eder. */}
        <span
          className="grid size-8 shrink-0 place-items-center rounded-full bg-card text-sm font-extrabold text-muted-foreground"
          title="Numara otomatik atanır"
        >
          {nextNumber}
        </span>
        <input
          className={`${inputCls} flex-1`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Bölüm adı (opsiyonel)"
          aria-label="Bölüm adı"
        />
      </div>
      <input
        className={inputCls}
        value={watchUrl}
        onChange={(event) => setWatchUrl(event.target.value)}
        onPaste={pasteEmbed(setWatchUrl)}
        placeholder="Video linki (Earnvids, VidMoly, Dood, StreamWish — embed kodu da olur)"
        aria-label="Video linki"
      />
      {/* Kırmızı dolu buton "Sil" ile karışıyordu; sakin bir buton yeterli. */}
      <Button
        size="sm"
        variant="outline"
        className="rounded-full"
        onClick={() => void add()}
        disabled={busy || disabled}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {seasonNumber}.
        sezona bölüm ekle
      </Button>
    </div>
  );
}

function EpisodeRow({
  episode,
  seasonNumber,
  busy,
  onChanged,
}: {
  episode: Episode;
  seasonNumber: number;
  busy: boolean;
  onChanged: (message: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(episode.title);
  const [watchUrl, setWatchUrl] = useState(episode.watch_url);
  const [localBusy, setLocalBusy] = useState(false);

  async function save() {
    const error = watchUrlError(watchUrl);
    if (error) {
      alert(error);
      return;
    }
    setLocalBusy(true);
    const { error: updateError } = await db
      .from("show_episodes")
      .update({ title: title.trim(), watch_url: extractEmbedUrl(watchUrl) })
      .eq("id", episode.id);
    setLocalBusy(false);
    if (updateError) {
      alert("Bölüm güncellenemedi: " + updateError.message);
      return;
    }
    await onChanged(`${episode.number}. bölüm güncellendi.`);
  }

  async function remove() {
    if (!window.confirm(`${seasonNumber}. sezonun ${episode.number}. bölümü silinsin mi?`)) return;
    setLocalBusy(true);
    const { error } = await db.from("show_episodes").delete().eq("id", episode.id);
    setLocalBusy(false);
    if (error) {
      alert("Bölüm silinemedi: " + error.message);
      return;
    }
    await onChanged(`${episode.number}. bölüm silindi.`);
  }

  const disabled = busy || localBusy;

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-sm font-extrabold text-primary">
          {episode.number}
        </span>
        <input
          className={`${inputCls} h-9 flex-1`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Bölüm adı (opsiyonel)"
          aria-label={`${episode.number}. bölüm adı`}
        />
      </div>
      <input
        className={`${inputCls} mt-2`}
        value={watchUrl}
        onChange={(event) => setWatchUrl(event.target.value)}
        onPaste={pasteEmbed(setWatchUrl)}
        placeholder="Video linki (Earnvids, VidMoly, Dood, StreamWish — embed kodu da olur)"
        aria-label={`${episode.number}. bölüm video linki`}
      />
      {/* Kaydet / Sil her zaman satırın en sağ altında. */}
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" className="rounded-full" onClick={() => void save()} disabled={disabled}>
          {localBusy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Kaydet
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="rounded-full"
          onClick={() => void remove()}
          disabled={disabled}
        >
          <Trash2 size={14} /> Sil
        </Button>
      </div>
    </div>
  );
}

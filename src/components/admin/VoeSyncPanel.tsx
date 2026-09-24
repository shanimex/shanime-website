import { CloudDownload, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { db, inputCls } from "@/lib/admin";
import { syncAllEpisodePosters } from "@/lib/episode-covers";
import {
  fileMatchesSeries,
  listVoeFiles,
  loadVoeFilter,
  loadVoeKey,
  parseEpisodeName,
  saveVoeFilter,
  saveVoeKey,
  voeEmbedUrl,
  type ParsedEpisodeName,
  type VoeFile,
} from "@/lib/voe";

/** Eklemeleri parça parça yapar: tek istekte yüzlerce satır gönderilmez. */
const CHUNK = 200;

type Row = { file: VoeFile; parsed: ParsedEpisodeName; exists: boolean };

/**
 * Voe hesabındaki videoları dosya adından çözüp bölümleri otomatik ekler.
 *
 * Akış: API anahtarı (tarayıcıda saklanır) → dosya listesi → dosya adı çözümü
 * (`Jujutsu Kaisen S01E05 - Ad` → 1. sezon 5. bölüm) → ÖNİZLEME → onay → kayıt.
 *
 * Önizleme şart: dosya adı çözümü bir tahmindir, kullanıcı onaylamadan hiçbir
 * bölüm eklenmez; zaten var olan sezon/bölüm numaraları atlanır.
 */
export function VoeSyncPanel({
  showId,
  existing,
  onDone,
}: {
  showId: string;
  /** Bu seride kayıtlı bölümlerin sezon/bölüm numaraları (mükerrer eklememek için). */
  existing: { season: number; number: number }[];
  /** Ekleme bittikten sonra çağrılır: bildirimi gösterir ve listeyi tazeler. */
  onDone: (message: string) => Promise<void> | void;
}) {
  const [key, setKey] = useState(loadVoeKey);
  const [filter, setFilter] = useState(() => loadVoeFilter(showId));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const saved = new Set(existing.map((entry) => `${entry.season}-${entry.number}`));

  async function fetchList() {
    if (!key.trim()) {
      setNote("Önce Voe API anahtarını gir (Voe → Ayarlar → Hesap → API Ayrıntıları).");
      return;
    }
    setBusy(true);
    setRows(null);
    setNote("Voe listesi alınıyor…");
    try {
      saveVoeKey(key);
      saveVoeFilter(showId, filter);
      const files = await listVoeFiles(key.trim(), {
        onProgress: (page, lastPage) => setNote(`Voe listesi alınıyor… sayfa ${page}/${lastPage}`),
      });

      const found: Row[] = [];
      for (const file of files) {
        if (!fileMatchesSeries(file, filter)) continue;
        const parsed = parseEpisodeName(file.name || file.title);
        if (!parsed) continue;
        found.push({ file, parsed, exists: saved.has(`${parsed.season}-${parsed.number}`) });
      }
      found.sort((a, b) => a.parsed.season - b.parsed.season || a.parsed.number - b.parsed.number);
      setRows(found);
      setPicked(Object.fromEntries(found.map((row) => [row.file.code, !row.exists])));
      const fresh = found.filter((row) => !row.exists).length;
      setNote(
        found.length > 0
          ? `${files.length} dosya tarandı · ${found.length} bölüm çözüldü (${fresh} yeni, ${found.length - fresh} zaten kayıtlı).`
          : `${files.length} dosya tarandı ama dosya adından sezon/bölüm çözülemedi. Dosya adlarını "Seri S01E05 - Bölüm adı" biçiminde yüklersen otomatik çözülür.`,
      );
    } catch (error) {
      setNote(`Liste alınamadı: ${error instanceof Error ? error.message : "bilinmeyen hata"}`);
    } finally {
      setBusy(false);
    }
  }

  async function importPicked() {
    if (!rows) return;
    const chosen = rows.filter((row) => picked[row.file.code] && !row.exists);
    if (chosen.length === 0) {
      setNote("Eklenecek yeni bölüm seçilmedi.");
      return;
    }
    setBusy(true);
    setNote(`${chosen.length} bölüm ekleniyor…`);
    try {
      const payload = chosen.map((row) => ({
        show_id: showId,
        season: row.parsed.season,
        number: row.parsed.number,
        title: row.parsed.title,
        watch_url: voeEmbedUrl(row.file.code),
      }));
      for (let i = 0; i < payload.length; i += CHUNK) {
        const { error } = await db.from("show_episodes").insert(payload.slice(i, i + CHUNK));
        if (error) throw error;
      }
      // Kapak: Voe'da koddan türetiliyor, senkron tamamlayıcı olarak çalışır
      // (diğer sağlayıcılar için de tutarlı kalsın).
      await syncAllEpisodePosters(false).catch(() => null);
      setRows(null);
      setPicked({});
      setNote(`${payload.length} bölüm eklendi.`);
      await onDone(`${payload.length} bölüm Voe'dan eklendi.`);
    } catch (error) {
      setNote(`Eklenemedi: ${error instanceof Error ? error.message : "bilinmeyen hata"}`);
    } finally {
      setBusy(false);
    }
  }

  const newCount = rows?.filter((row) => !row.exists).length ?? 0;
  const chosenCount = rows?.filter((row) => picked[row.file.code] && !row.exists).length ?? 0;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-secondary/40 p-4">
      <div className="flex flex-col gap-1">
        <strong className="text-sm">Voe'dan otomatik ekle</strong>
        <p className="text-xs text-muted-foreground">
          Voe hesabındaki videoları dosya adından çözer: <code>Seri S01E05 - Bölüm adı</code> → 1.
          sezon 5. bölüm. Anahtar yalnızca bu tarayıcıda saklanır.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-bold text-muted-foreground">
          Voe API anahtarı
          <input
            type="password"
            className={inputCls}
            placeholder="Voe → Ayarlar → Hesap → API Ayrıntıları"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-muted-foreground">
          Dosya adı filtresi
          <input
            className={inputCls}
            placeholder="ör. Jujutsu Kaisen (boş = hepsi)"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="rounded-full"
          onClick={() => void fetchList()}
          disabled={busy}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <CloudDownload size={14} />}
          Voe listesini al
        </Button>
        {rows && rows.length > 0 ? (
          <Button
            size="sm"
            className="rounded-full"
            onClick={() => void importPicked()}
            disabled={busy || chosenCount === 0}
          >
            Seçilen {chosenCount} bölümü ekle
          </Button>
        ) : null}
        {rows && newCount > 0 ? (
          <span className="text-xs text-muted-foreground">
            {newCount} yeni bölüm bulundu — önizlemeyi kontrol edip ekle.
          </span>
        ) : null}
      </div>

      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}

      {rows && rows.length > 0 ? (
        <div className="max-h-72 overflow-y-auto rounded-xl border border-border bg-background">
          {rows.map((row) => (
            <label
              key={row.file.code}
              className="flex items-start gap-3 border-b border-border/60 p-2 text-xs last:border-b-0"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={Boolean(picked[row.file.code])}
                disabled={row.exists}
                onChange={(event) =>
                  setPicked((current) => ({ ...current, [row.file.code]: event.target.checked }))
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block font-bold">
                  S{row.parsed.season} B{row.parsed.number} · {row.parsed.title}
                </span>
                <span className="block truncate text-muted-foreground">
                  {row.file.name || row.file.title}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground/80">
                  {voeEmbedUrl(row.file.code)}
                </span>
              </span>
              <span
                className={row.exists ? "shrink-0 text-muted-foreground" : "shrink-0 text-accent"}
              >
                {row.exists ? "kayıtlı" : "yeni"}
              </span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

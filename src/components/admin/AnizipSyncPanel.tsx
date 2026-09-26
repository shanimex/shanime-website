import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckSquare,
  CloudDownload,
  Loader2,
  RefreshCw,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/admin";
import {
  catalogSeasons,
  fetchCatalogEpisodes,
  isPlaceholderTitle,
  pickSeason,
  type CatalogEpisode,
} from "@/lib/admin-anizip";

/** Tek istekte gönderilecek bölüm sayısı (SeasonsPanel'deki toplu eklemeyle aynı). */
const CHUNK = 100;

/**
 * Yeni bölüm eklemek için varsayılan oynatıcı.
 *
 * `@megaplay` bir **sağlayıcı direktifidir** (`src/lib/embed-provider.ts`): bölüm
 * başına embed adresi yazmak gerekmez, oynatıcı MAL kimliğinden üretilir. Bölümlerin
 * çoğu bu direktifle duruyor; adres girmek istemeyen kullanıcı için doğru varsayılan.
 */
const DEFAULT_WATCH_URL = "@megaplay";

type Existing = { season: number; number: number; title?: string | null };

/**
 * "Bu sezonun TÜM bölümlerini tek basışta çek."
 *
 * Kullanıcı akışı: yeni sezon aç → bu paneli aç → katalogdan gelen listeyi gör →
 * "Seçilen N bölümü ekle". Kaynak `api.ani.zip` (MAL kimliği), tarayıcıdan
 * doğrudan çağrılır (CORS `*` doğrulandı — bkz. `lib/admin-anizip.ts`).
 *
 * Zaten kayıtlı bölümler listede görünür ama **işaretlenemez** (mükerrer ekleme
 * olmaz). Katalogda sezon ayrımı yoksa uyarı gösterilir ve tek liste sunulur —
 * sessizce yanlış sezona ekleme yapılmaz.
 */
export function AnizipSyncPanel({
  showId,
  seasonNumber,
  existing,
  onDone,
}: {
  showId: string;
  seasonNumber: number;
  existing: Existing[];
  onDone: (message: string) => Promise<void>;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [problem, setProblem] = useState<string | null>(null);
  const [list, setList] = useState<CatalogEpisode[]>([]);
  const [malId, setMalId] = useState<number | null>(null);
  const [activeSeason, setActiveSeason] = useState(seasonNumber);
  /**
   * Kullanıcının KAPATTIĞI bölümler (yalnızca seçili sezon için anlamlı).
   *
   * NEDEN "seçili" değil de "hariç" tutuluyor: varsayılanı (eksikler seçili)
   * türetilmiş hâlde bırakmak, sezon değişince state'i effect ile senkronlamayı
   * gerektirirdi; her render'da yeni dizi/küme kimliği üretildiği için o yol
   * sonsuz güncelleme döngüsüne açıktı. Burada yalnızca kullanıcının dokunduğu
   * bilgi saklanır, gerisi `rows` + `taken` üzerinden türetilir.
   */
  const [excluded, setExcluded] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);

  /**
   * Kayıtlı bölümler: `numara → başlık` (seçili sezon için).
   * Hem mükerrer eklemeyi engeller hem de başlık güncellemesi gerekip
   * gerekmediğini anlamayı sağlar.
   */
  const taken = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of existing) {
      if (row.season === activeSeason) map.set(row.number, (row.title ?? "").trim());
    }
    return map;
  }, [existing, activeSeason]);

  const load = useCallback(async () => {
    setStatus("loading");
    setProblem(null);
    try {
      const { data, error } = await db
        .from("shows")
        .select("mal_id,title")
        .eq("id", showId)
        .single();
      if (error) throw new Error(error.message);
      const mal = Number((data as { mal_id: number | null } | null)?.mal_id ?? 0);
      if (!Number.isFinite(mal) || mal <= 0) {
        setMalId(null);
        setList([]);
        setStatus("error");
        setProblem(
          "Bu serinin MAL kimliği yok. Seri ayarlarından MAL kimliğini doldurup tekrar dene.",
        );
        return;
      }
      setMalId(mal);
      const catalog = await fetchCatalogEpisodes(mal);
      if (catalog.length === 0) {
        setList([]);
        setStatus("error");
        setProblem(`ani.zip bu seri için bölüm döndürmedi (MAL ${mal}).`);
        return;
      }
      setList(catalog);
      const seasons = catalogSeasons(catalog);
      setActiveSeason(seasons.includes(seasonNumber) ? seasonNumber : (seasons[0] ?? 1));
      setExcluded({});
      setStatus("ready");
    } catch (err) {
      setList([]);
      setStatus("error");
      setProblem(err instanceof Error ? err.message : String(err));
    }
  }, [showId, seasonNumber]);

  useEffect(() => {
    void load();
  }, [load]);

  const available = useMemo(() => catalogSeasons(list), [list]);
  const { episodes: rows, exact } = useMemo(
    () => pickSeason(list, activeSeason),
    [list, activeSeason],
  );

  /** Kayıtlı olup başlığı BOŞ/JENERİK olan bölümler → başlık güncellemesi önerilir. */
  const renameNumbers = useMemo(
    () =>
      new Set(
        rows
          .filter((ep) => ep.title && isPlaceholderTitle(taken.get(ep.number)))
          .map((ep) => ep.number),
      ),
    [rows, taken],
  );

  const missing = rows.filter((ep) => !taken.has(ep.number));
  /** Panelin yapabileceği iş: eklenecek bölüm + zayıf başlıklı bölüm. */
  const todoCount = missing.length + renameNumbers.size;

  /** Bu satır varsayılan olarak işaretli gelir mi? (eksik ya da zayıf başlık) */
  const needsWork = (number: number) => !taken.has(number) || isPlaceholderTitle(taken.get(number));

  /**
   * Seçim üç durumlu türetilir:
   *   `excluded[n] === true`  → kullanıcı KAPATTI,
   *   `excluded[n] === false` → kullanıcı AÇTI,
   *   tanımsız                → varsayılan (`needsWork`).
   *
   * ⚠️ DİKKAT: burada `??` KULLANILMAZ. `false` değeri nullish olmadığı için
   * `excluded[n] ?? varsayilan` yazıldığında "kullanıcı açtı" durumu `false`
   * dönüyor ve kutu işaretsiz görünüyordu; bu yüzden "Tümünü seç" her şeyi
   * kaldırıyor, tek tek tıklamak da hiçbir şey değiştirmiyordu.
   */
  const isChecked = (number: number) =>
    excluded[number] === undefined ? needsWork(number) : !excluded[number];

  const selected = rows.filter((ep) => isChecked(ep.number));
  const addCount = selected.filter((ep) => !taken.has(ep.number)).length;
  const updCount = selected.length - addCount;

  async function applySelected() {
    if (selected.length === 0) return;
    const toAdd = selected.filter((ep) => !taken.has(ep.number));
    const toRename = selected.filter((ep) => taken.has(ep.number));
    setBusy(true);
    try {
      const payload = toAdd.map((ep) => ({
        show_id: showId,
        season: activeSeason,
        number: ep.number,
        title: ep.title,
        watch_url: DEFAULT_WATCH_URL,
      }));
      for (let i = 0; i < payload.length; i += CHUNK) {
        const { error } = await db.from("show_episodes").insert(payload.slice(i, i + CHUNK));
        if (error) throw error;
      }
      // Başlık güncellemesi bölüm başına tek satır olduğu için tek tek gider.
      for (const ep of toRename) {
        const { error } = await db
          .from("show_episodes")
          .update({ title: ep.title })
          .eq("show_id", showId)
          .eq("season", activeSeason)
          .eq("number", ep.number);
        if (error) throw error;
      }
      const parts: string[] = [];
      if (toAdd.length > 0) parts.push(`${toAdd.length} bölüm eklendi (oynatıcı: megaplay)`);
      if (toRename.length > 0) parts.push(`${toRename.length} başlık güncellendi`);
      await onDone(`S${activeSeason}: ${parts.join(", ")}.`);
    } catch (err) {
      alert("İşlem tamamlanamadı: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-background/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 text-sm font-bold text-foreground">
          <CloudDownload size={15} /> Katalogdan bölüm çek
        </span>
        <span className="text-xs text-muted-foreground">
          {malId ? `ani.zip · MAL ${malId}` : "ani.zip"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto rounded-full"
          onClick={() => void load()}
          disabled={status === "loading" || busy}
          title="Kataloğu yeniden çek"
        >
          <RefreshCw size={14} className={status === "loading" ? "animate-spin" : undefined} />
        </Button>
      </div>

      {status === "loading" && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Bölüm listesi çekiliyor…
        </p>
      )}

      {status === "error" && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {problem}
        </p>
      )}

      {status === "ready" && (
        <>
          {available.length > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Katalogdaki sezon
              </span>
              {available.map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => {
                    setActiveSeason(num);
                    setExcluded({});
                  }}
                  className={
                    num === activeSeason
                      ? "rounded-full border border-primary/60 bg-primary/15 px-2.5 py-0.5 text-xs font-bold text-primary"
                      : "rounded-full border border-border px-2.5 py-0.5 text-xs font-bold text-muted-foreground hover:border-primary/60 hover:text-primary"
                  }
                >
                  S{num}
                </button>
              ))}
            </div>
          )}

          {!exact && (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-foreground">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              Katalogda bu seri sezonlara ayrılmamış; aşağıda <b>tüm bölümler</b> listeleniyor.
              Doğru aralığı kendin seç.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              <b className="text-foreground">{rows.length}</b> bölüm ·{" "}
              <b className="text-foreground">{taken.size}</b> tanesi zaten kayıtlı ·{" "}
              <b className="text-foreground">{missing.length}</b> eklenecek ·{" "}
              <b className="text-foreground">{renameNumbers.size}</b> başlık zayıf (güncellenebilir)
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto rounded-full"
              onClick={() => setExcluded(Object.fromEntries(rows.map((ep) => [ep.number, false])))}
              disabled={busy}
            >
              <CheckSquare size={13} /> Tümünü seç
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="rounded-full"
              onClick={() => setExcluded(Object.fromEntries(rows.map((ep) => [ep.number, true])))}
              disabled={selected.length === 0 || busy}
            >
              <Square size={13} /> Temizle
            </Button>
          </div>

          <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
            {rows.map((ep) => {
              const exists = taken.has(ep.number);
              const rename = renameNumbers.has(ep.number);
              // Tüm satırlar seçilebilir: kayıtlı bir bölümü seçmek ONAYSA başlığını
              // katalogdakiyle günceller, mükerrer ekleme olmaz.
              const on = excluded[ep.number] ?? needsWork(ep.number);
              return (
                <li key={`${activeSeason}-${ep.number}`}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-foreground hover:bg-secondary/60">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={busy}
                      onChange={(event) =>
                        setExcluded((map) => ({ ...map, [ep.number]: !event.target.checked }))
                      }
                      className="size-4 accent-[hsl(var(--primary))]"
                    />
                    <span className="w-14 shrink-0 font-bold">{ep.number}. Bölüm</span>
                    <span className="truncate">{ep.title || "—"}</span>
                    {rename ? (
                      <span className="ml-auto shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                        başlık güncellenecek
                      </span>
                    ) : exists ? (
                      <span className="ml-auto shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold">
                        kayıtlı
                      </span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="rounded-full"
              onClick={() => void applySelected()}
              disabled={busy || selected.length === 0}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <CloudDownload size={14} />}
              {addCount > 0 && updCount > 0
                ? `Ekle (${addCount}) · Başlık güncelle (${updCount})`
                : updCount > 0
                  ? `Seçilen ${updCount} başlığı güncelle`
                  : `Seçilen ${addCount} bölümü ekle`}
            </Button>
            {todoCount === 0 && (
              <span className="text-xs font-bold text-muted-foreground">
                Tüm bölümler kayıtlı ve başlıkları yerinde — eklenecek/güncellenecek bir şey yok.
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

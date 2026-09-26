import { ArrowDown, ArrowUp, Loader2, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { showSlug, type ShowWithImage } from "@/lib/content";

export type ShowCounts = { seasons: number; episodes: number };

/**
 * Seri listesindeki tek satır. Düzenleme alanları kapalı durur; böylece
 * panelde kaç seri olursa olsun liste kısa kalır ve aşağı kaydırma gerekmez.
 */
export function ShowRow({
  show,
  counts,
  anizmCount,
  first,
  last,
  onEdit,
  onMove,
  onDelete,
}: {
  show: ShowWithImage;
  counts: ShowCounts;
  /** Bu dizi için anizm (Türkçe altyazı) kaydı hazır olan bölüm sayısı. */
  anizmCount: number;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    // flex-wrap + asgari metin genisligi: mobilde sabit genislikli butonlar
    // metin alanini 0 px'e sikistiriyordu ve seri adi hic gorunmuyordu. Artik
    // butonlar sigmadiginda alt satira iner, ad/slug her zaman okunur.
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-background p-3">
      <img
        src={show.image}
        alt=""
        className="h-14 w-10 shrink-0 rounded-lg border border-border object-cover"
      />
      <div className="min-w-[9rem] flex-1">
        <p className="truncate text-sm font-extrabold text-foreground">{show.title}</p>
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          /{showSlug(show)} · MAL {show.mal_id ?? "—"}
        </p>
      </div>
      {/* KAYNAK DURUMU — sistem iki kaynak üzerinden çalışır:
          TR: anizm (altyazı videoda), EN: megaplay (oynatıcının CC menüsü). */}
      <span
        className={`hidden shrink-0 rounded-full px-3 py-1 text-[11px] font-bold md:inline ${
          counts.episodes > 0 && anizmCount >= counts.episodes
            ? "bg-primary/15 text-primary"
            : anizmCount > 0
              ? "bg-amber-500/15 text-amber-600"
              : "bg-destructive/15 text-destructive"
        }`}
        title="Türkçe altyazı: anizm kaydı hazır olan bölüm sayısı / toplam bölüm"
      >
        TR {anizmCount}/{counts.episodes}
      </span>
      <span
        className="hidden shrink-0 rounded-full bg-secondary px-3 py-1 text-[11px] font-bold text-foreground md:inline"
        title="İngilizce altyazı: megaplay oynatıcısının kendi CC menüsünden seçilir"
      >
        EN megaplay
      </span>
      {show.is_featured && (
        <span
          className="hidden shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-bold text-primary sm:inline"
          title="Ana sayfa vitrininde (büyük slider) gösteriliyor"
        >
          ★ Vitrin
        </span>
      )}
      <span
        className={`hidden shrink-0 rounded-full px-3 py-1 text-[11px] font-bold sm:inline ${
          counts.episodes === 0
            ? "bg-destructive/15 text-destructive"
            : "bg-secondary text-foreground"
        }`}
      >
        {counts.seasons} sezon · {counts.episodes} bölüm
      </span>
      {/* Butonlar tek kapta: sigmadiginda topluca alt satira iner, metni
          sikistirmaz. Ikon butonlari mobilde 40x40 (parmakla basmak icin),
          masaustunde 36x36 kalir. */}
      <div className="ml-auto flex items-center gap-1">
        <Button size="sm" className="shrink-0 rounded-full" onClick={onEdit}>
          <Pencil size={13} /> Düzenle
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-10 w-10 rounded-full sm:h-9 sm:w-9"
          onClick={() => onMove(-1)}
          disabled={first}
          aria-label="Yukarı taşı"
        >
          <ArrowUp size={14} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-10 w-10 rounded-full sm:h-9 sm:w-9"
          onClick={() => onMove(1)}
          disabled={last}
          aria-label="Aşağı taşı"
        >
          <ArrowDown size={14} />
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="h-10 w-10 shrink-0 rounded-full sm:h-9 sm:w-9"
          onClick={() => {
            setBusy(true);
            void onDelete().finally(() => setBusy(false));
          }}
          disabled={busy}
          aria-label="Seriyi sil"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </Button>
      </div>
    </div>
  );
}

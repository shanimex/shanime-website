import { ArrowDown, ArrowUp, Loader2, Pencil, Star, Trash2, X } from "lucide-react";
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
  trCount,
  first,
  last,
  open,
  onEdit,
  onMove,
  onDelete,
}: {
  show: ShowWithImage;
  counts: ShowCounts;
  /**
   * CANLI Türkçe kapsama: bu dizinin `episode_sources.language='tr'` satırı olan
   * bölüm sayısı (bkz. `lib/episode-sources.ts → fetchTurkishCoverage`). Rozetin
   * PAYI budur; paydası `counts.episodes`tir. Eskiden derleme zamanı dosyasından
   * ön ek sayılırdı — YANLIŞTI, bkz. `lib/anizm.ts` notu.
   */
  trCount: number;
  first: boolean;
  last: boolean;
  /**
   * Satırın altındaki düzenleme alanı AÇIK MI?
   *
   * KULLANICI İSTEĞİ (30.09.2026): "Düzenle basınca orası kaybolmasın, kalsın;
   * aşağı doğru açılsın; Düzenle yazısı Kapat düğmesine dönsün animasyonla."
   * Bu yüzden satır artık her zaman görünür kalır ve düğme ikisi arasında geçiş yapar.
   */
  open: boolean;
  onEdit: () => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  /**
   * KAPSAMA DURUMU — satırda yalnızca EYLEM GEREKTİREN görünür.
   *
   * Kullanıcı bildirimi: "TR 85/85, EN megaplay" hapları her satırda kalabalık
   * yapıyor. Yeni kural: tam kapsamada rozet YOK (temiz satır); eksikse tek
   * amber satır ("TR 79/85 eksik"). "EN megaplay" herkesde aynı olduğu için
   * çöpe çıktı (statik bilgi rozet olmaz). Sezon/bölüm sayısı adres satırına
   * gömüldü.
   */
  const episodeCount = counts.episodes;
  const trMissing = episodeCount > 0 && trCount < episodeCount;

  return (
    // flex-wrap + asgari metin genisligi: mobilde sabit genislikli butonlar
    // metin alanini 0 px'e sikistiriyordu ve seri adi hic gorunmuyordu. Artik
    // butonlar sigmadiginda alt satira iner, ad/slug her zaman okunur.
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-background p-3 transition-colors hover:border-foreground/25">
      <img
        src={show.image}
        alt=""
        className="h-14 w-10 shrink-0 rounded-lg border border-border object-cover"
      />
      <div className="min-w-[9rem] flex-1">
        <p className="truncate text-sm font-extrabold text-foreground">
          {show.title}
          {show.is_featured && (
            /*
              METİN KARAKTERİ (`★`) YERİNE SVG İKON (kullanıcı isteği, 30.09.2026:
              "ikon tercih et, SVG ikon kaliteli şık olan; emoji kesinlikle kullanma").
              Metin karakteri yazı tipine göre bozuk/kalitesiz çizilebiliyordu; ikon
              her tarayıcıda aynı ve `currentColor` ile ton rengini alıyor.
            */
            <Star
              size={11}
              // DOLGULU yıldız: lucide varsayılanı yalnızca çerçeve çiziyordu ve
              // "içi boş yıldız kötü görünüyor" (kullanıcı bildirimi 30.09.2026).
              // `fill` mevcut ton rengini alır, ek renk gelmez.
              fill="currentColor"
              strokeWidth={1}
              className="ml-1.5 inline-block shrink-0 align-[-1px] text-primary"
              aria-label="Vitrinde"
            />
          )}
        </p>
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          /{showSlug(show)} · MAL {show.mal_id ?? "—"} · {counts.seasons} sezon · {episodeCount}{" "}
          bölüm
        </p>
        {trMissing ? (
          <p
            className="mt-0.5 text-[11px] font-bold text-amber-600"
            title="Türkçe kaynak kapsaması: en az bir Türkçe kaynağı (episode_sources · dil 'tr') olan bölüm / toplam bölüm. Panelden kaynak işaretlendikçe CANLI güncellenir."
          >
            TR {trCount}/{episodeCount} eksik
          </p>
        ) : null}
      </div>
      {/* Butonlar tek kapta: sigmadiginda topluca alt satira iner, metni
          sikistirmaz. Ikon butonlari mobilde 40x40 (parmakla basmak icin),
          masaustunde 36x36 kalir. */}
      <div className="ml-auto flex items-center gap-1">
        {/*
          DÜZENLE ↔ KAPAT: tek düğme, iki durum.
          İkon ve yazı ANİMASYONLA değişir (ölçek/opaklık geçişi) — kullanıcı
          isteği: "Düzenle yazısı Kapat düğmesine dönsün animasyonla." Ayrı bir
          "Kapat" düğmesi YOK; düzenleme alanı bu düğmeyle kapanır.
        */}
        <Button
          size="sm"
          variant={open ? "outline" : "default"}
          className="shrink-0 rounded-full"
          onClick={onEdit}
          aria-expanded={open}
          title={open ? "Düzenlemeyi kapat" : "Bu seriyi düzenle"}
        >
          <span className="relative grid h-3.5 w-3.5 place-items-center">
            <Pencil
              size={13}
              className={`col-start-1 row-start-1 transition-all duration-200 ${
                open ? "scale-50 opacity-0" : "scale-100 opacity-100"
              }`}
            />
            <X
              size={13}
              className={`col-start-1 row-start-1 transition-all duration-200 ${
                open ? "scale-100 opacity-100" : "scale-50 opacity-0"
              }`}
            />
          </span>
          <span className="ml-1 inline-block min-w-[3.6rem] text-left">
            {open ? "Kapat" : "Düzenle"}
          </span>
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

import { ArrowDown, ArrowUp, Loader2, Pencil, Star, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ShowWithImage } from "@/lib/content";

export type ShowCounts = { seasons: number; episodes: number };

/**
 * Seri listesindeki tek satır. Düzenleme alanları kapalı durur; böylece
 * panelde kaç seri olursa olsun liste kısa kalır ve aşağı kaydırma gerekmez.
 */
export function ShowRow({
  show,
  counts,
  sourceCoverage,
  first,
  last,
  open,
  onEdit,
  onMove,
  onDelete,
}: {
  show: ShowWithImage;
  counts: ShowCounts;
  /** Sağlayıcı bazında canlı kaynak kapsamı. */
  sourceCoverage: Record<string, number>;
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
  const sourceCoverageEntries = Object.entries(sourceCoverage);

  return (
    // flex-wrap + esnek metin alani: mobilde sabit genislikli butonlar
    // metin alanini 0 px'e sikistiriyordu ve seri adi hic gorunmuyordu. Artik
    // butonlar sigmadiginda alt satira iner, ad/slug her zaman okunur.
    <div className="admin-show-row flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-background p-2.5 transition-colors hover:border-foreground/25 active:border-foreground/40 sm:gap-3 sm:p-3">
      <img
        src={show.image}
        alt=""
        className="h-14 w-10 shrink-0 rounded-lg border border-border object-cover sm:h-14 sm:w-10"
      />
      <div className="min-w-0 flex-1 basis-40 sm:basis-32">
        <p className="truncate font-display text-[15px] font-semibold text-foreground sm:text-sm">
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
        {/* SATIR YALNIZCA SEZON/BÖLÜM SAYISINI TASIYOR (kullanıcı isteği,
            03.10.2026): "/slug · MAL" ikinci satırı gereğinden uzundu. İkisi de
            düzenleyicide duruyor (`/anime/` adres alanı + "MAL kimliği" kutusu).
            Arama etkilenmez: `visibleShows` hâlâ slug ve MAL ile süzer —
            yalnızca satırdaki GÖRÜNÜRLÜK kaldırıldı. */}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {(show.kind ?? "series") === "movie"
            ? "Film"
            : `${counts.seasons} sezon · ${episodeCount} bölüm`}
        </p>
        {sourceCoverageEntries.length > 0 ? (
          <p
            className="mt-0.5 truncate text-[11px] font-bold text-amber-600"
            title="Sağlayıcı bazında kaynak kapsamı: bulunan bölüm / normal bölüm toplamı."
          >
            {sourceCoverageEntries
              .map(([provider, count]) => `${provider} ${count}/${episodeCount}`)
              .join(" · ")}
          </p>
        ) : null}
      </div>
      {/* Butonlar tek kapta: mobilde ince bir ayraçla alt satırda TAM GENİŞLİK —
          "Düzenle" solda, taşı/sil ikonları sağda (justify-between). PC'de hepsi
          aynı satırda sağa yaslanır (sm:justify-end). Sadece hizalama; sıra ve
          onClick mantığı aynı. */}
      <div className="admin-show-actions flex w-full items-center justify-between gap-2 border-t border-border/60 pt-1.5 sm:ml-auto sm:w-auto sm:justify-end sm:gap-1 sm:border-0 sm:pt-0">
        {/*
          DÜZENLE ↔ KAPAT: tek düğme, iki durum.
          İkon ve yazı ANİMASYONLA değişir (ölçek/opaklık geçişi) — kullanıcı
          isteği: "Düzenle yazısı Kapat düğmesine dönsün animasyonla." Ayrı bir
          "Kapat" düğmesi YOK; düzenleme alanı bu düğmeyle kapanır.
        */}
        <Button
          size="sm"
          variant={open ? "outline" : "default"}
          className="h-8 shrink-0 rounded-full px-3 text-xs sm:h-9 sm:px-4 sm:text-sm"
          onClick={onEdit}
          aria-expanded={open}
          aria-label={open ? "Düzenlemeyi kapat" : "Bu seriyi düzenle"}
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
        {/* İkon grubu ayrı kapta: `justify-between` ile mobilde sağa toplu
            yaslanır (yoksa üç ikon "Düzenle" ile satıra dağılırdı). */}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-9 w-9 rounded-full sm:h-9 sm:w-9"
            onClick={() => onMove(-1)}
            disabled={first}
            aria-label="Yukarı taşı"
          >
            <ArrowUp size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-9 w-9 rounded-full sm:h-9 sm:w-9"
            onClick={() => onMove(1)}
            disabled={last}
            aria-label="Aşağı taşı"
          >
            <ArrowDown size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:h-9 sm:w-9"
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
    </div>
  );
}

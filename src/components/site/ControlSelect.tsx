import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * ORTAK AÇILIR SEÇİCİ — sitedeki TÜM "menü" kontrollerinin tek bileşeni.
 *
 * ── NEDEN TEK BİLEŞEN ────────────────────────────────────────────────────────
 * Aynı iş üç yerde farklı görünüyordu: detay sayfasındaki sezon seçici native
 * `<select>`ti (işletim sistemi çizer → koyu temada açık gri bir liste),
 * oynatıcı altındaki Kaynak/Ses menüleri `<details>` + ayrı CSS sınıfıydı.
 * Kullanıcı isteği (04.10.2026): "kaynak/ses kontrollerini ... tek bir tutarlı
 * tasarım diline oturt". Artık sezon, kaynak ve ses seçicileri AYNI bileşendir:
 * aynı yuvarlak hap tetikleyici, aynı kart paneli, aynı animasyon, aynı
 * klavye/erişilebilirlik davranışı.
 *
 * ── ANİMASYON ────────────────────────────────────────────────────────────────
 * Panel kapalıyken DOM'DAN ÇIKARILMAZ; `opacity-0 scale-95 -translate-y-1` +
 * `pointer-events-none` alır. Böylece geçiş hem AÇILIŞTA hem KAPANIŞTA oynar —
 * koşullu çizimde kapanış animasyonu olmazdı.
 *
 * ── KONUM ────────────────────────────────────────────────────────────────────
 * `align="left"` (varsayılan): panel tetikleyicinin sol kenarına hizalı, aşağı
 * açılır. `align="right"`: sağ kenara hizalı. `above`: oynatıcı altı gibi ekranın
 * altına yakın yerlerde paneli YUKARI açar (aşağı açılınca görünmez kalıyordu).
 *
 * ── ERİŞİLEBİLİRLİK ─────────────────────────────────────────────────────────
 * `aria-haspopup="listbox"` + `role="listbox"`/`role="option"` + `aria-selected`;
 * Escape kapatır ve odağı tetikleyiciye verir; dışarı tıklama kapatır; ok tuşları
 * seçimi adım adım değiştirir (native select alışkanlığı).
 */
export type ControlSelectOption = {
  /** Kararlı kimlik — seçim bu değerle bildirilir. */
  key: string;
  /** Görünen metin. */
  label: string;
  /** Seçili mi? (aynı anda tek seçenek `true` olmalı) */
  active: boolean;
  disabled?: boolean | undefined;
  /** Seçenek yükleniyor/seçiliyor (ör. sağlayıcı doğrulanırken). */
  pending?: boolean | undefined;
  /** Etiketin yanındaki küçük işaret (ör. "TR" altyazı rozeti). */
  marker?: string | undefined;
  /** İşaretin rengi; verilmezse vurgu rengi. */
  markerClassName?: string | undefined;
};

export function ControlSelect({
  /** Tetikleyicide solda, soluk yazılan ön etiket (ör. "Kaynak"). */
  label,
  options,
  onSelect,
  ariaLabel,
  className,
  align = "left",
  above = false,
  variant = "pill",
  disabled = false,
}: {
  label?: string | undefined;
  options: ReadonlyArray<ControlSelectOption>;
  onSelect: (key: string) => void;
  ariaLabel: string;
  className?: string | undefined;
  align?: "left" | "right";
  above?: boolean;
  /**
   * `pill`  : kenarlıklı, zeminli yuvarlak hap (detay sayfası sezon seçici).
   * `bare`  : kenarlık/zemin YOK — düz metin + ikon. Oynatıcı altındaki ince
   *           kumanda çubuğu bunu kullanır (kullanıcı: "butonların stroke'ları
   *           olmasın").
   */
  variant?: "pill" | "bare";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  /**
   * Panelin yatay kaydırması (px). Mobilde tetikleyici ekranın sağına yakınsa
   * panel `left-0` ile açılınca görünüm alanının DIŞINA taşıyordu (kullanıcı:
   * "mobilde açınca ekran dışına taşıyor"). Açılış anında ölçüp paneli içeri
   * çekiyoruz — böylece her boyutta tam görünür.
   */
  const [offsetX, setOffsetX] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  /**
   * ÇİFT TIKLAMA KORUMASI — dokunmatik tarayıcılar tek dokunuşta bazen İKİ
   * `click` üretir ("ghost click"). Menü bu yüzden kapanıp anında geri
   * açılıyordu (kullanıcı: "kapanıp geri açıyor, birkaç kere tıklayınca
   * düzeliyor"). 350 ms içindeki yinelenen tıklama yok sayılır.
   */
  const lastToggleRef = useRef(0);

  const current = options.find((option) => option.active) ?? options[0];

  // GÖRÜNÜM ALANINA SIĞDIRMA: panel açıldığında ölç, taşıyorsa içeri kaydır.
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const measure = () => {
      const tr = trigger.getBoundingClientRect();
      const pw = panel.offsetWidth;
      const vw = window.innerWidth;
      const margin = 8;
      const leftEdge = align === "right" ? tr.right - pw : tr.left;
      let shift = 0;
      if (leftEdge + pw > vw - margin) shift = vw - margin - (leftEdge + pw);
      else if (leftEdge < margin) shift = margin - leftEdge;
      setOffsetX(shift);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, align]);

  // DIŞARI TIKLAMA + ESCAPE: panel açıkken pencereye dinleyici takılır.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  /** Ok tuşları: tetikleyici odaktayken listede bir adım ilerle/geri git. */
  const step = (delta: number) => {
    const usable = options.filter((option) => !option.disabled);
    if (usable.length === 0) return;
    const index = usable.findIndex((option) => option.active);
    const next = usable[(index < 0 ? 0 : index) + delta];
    if (next) onSelect(next.key);
  };

  return (
    <div
      ref={rootRef}
      // `pill` (sezon seçici) SABİT kalır; `bare` (oynatıcı altı Kaynak/Ses)
      // daralabilir (`min-w-0`) — şerit tek satıra sığmadığında etiket kırpılır,
      // satır İKİNCİ SATIRA düşmez (kullanıcı geri bildirimi, 05.10.2026).
      className={cn("relative", variant === "pill" ? "shrink-0" : "min-w-0", className)}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          const now = Date.now();
          if (now - lastToggleRef.current < 350) return;
          lastToggleRef.current = now;
          setOpen((isOpen) => !isOpen);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            step(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            step(-1);
          }
        }}
        className={cn(
          "flex items-center font-ui font-semibold transition-colors",
          variant === "pill"
            ? cn(
                "h-9 gap-1.5 rounded-full border border-border bg-secondary/70 px-3 text-[13px] text-foreground",
                "hover:border-accent/60 focus-visible:border-accent focus-visible:outline-none",
                (open || disabled) && "border-accent/60",
              )
            : cn(
                // İNCE + SAYDAM ARKAPLAN. Kullanıcı: "arkaplan olmasın demedim,
                // daha saydam olsun; stroke da ekleme." → zemin var (`bg-secondary/40`),
                // kenarlık YOK, yükseklik h-6 (24 px).
                "h-6 gap-0.5 rounded-md bg-secondary/40 px-1 text-[11.5px] text-muted-foreground",
                "hover:bg-secondary/70 hover:text-foreground focus-visible:bg-secondary/70 focus-visible:text-foreground focus-visible:outline-none",
                open && "bg-secondary/70 text-foreground",
              ),
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        {/* ÖN ETİKET ("Kaynak", "Ses") DAR EKRANDA GİZLENİR: mobilde şerit
            "önceki · sonraki · Kaynak · Ses" derken üç satıra düşüyordu. Etiket
            yalnızca `sm` ve üstünde görünür; seçili değerin kendisi zaten
            anlamlıdır ("Anizm", "TÜRKÇE"). */}
        {label ? (
          <span className="hidden font-medium text-muted-foreground sm:inline">{label}</span>
        ) : null}
        {/* SEÇİLİ DEĞER BEYAZ — YALNIZCA `sm` VE ÜSTÜ. Kullanıcı
            (05.10.2026): "seçili olan değer beyaz olacak" — ön etiket
            ("Kaynak"/"Ses") soluk kalır, ondan sonra gelen değer tam kontrasta
            çıkar; ikisi tek bir gri cümle gibi okunmaz. `pill` zaten tümüyle
            `text-foreground` olduğu için bu yalnızca `bare` (oynatıcı altı)
            görünümünde uygulanır.

            NEDEN `sm:` (KULLANICI DÜZELTMESİ, 05.10.2026): "buradaki sadece
            PC'de değişecekti, mobil aynı kalacaktı; mobil için geri al."
            Beyaz değer, ön etiketin (`sm:inline`) göründüğü genişlikten
            İTİBAREN anlamlıdır — ikisi bir arada okunurken kontrast gerekir.
            Etiketin gizlendiği telefonda değer ESKİ hâlinde (soluk) kalır. */}
        <span className={cn("max-w-[9rem] truncate", variant === "bare" && "sm:text-foreground")}>
          {current?.label ?? ""}
        </span>
        {current?.marker ? (
          <span
            className={cn(
              "shrink-0 text-[10px] font-bold leading-none",
              current.markerClassName ?? "text-primary",
            )}
          >
            {current.marker}
          </span>
        ) : null}
        <ChevronDown
          size={13}
          aria-hidden="true"
          className={cn(
            "shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
            open && "rotate-180",
          )}
        />
      </button>

      <div
        ref={panelRef}
        role="listbox"
        aria-label={ariaLabel}
        style={{ transform: `translateX(${offsetX}px)` }}
        className={cn(
          // KOMPAKT MENÜ (kullanıcı, 05.10.2026): "mobilde çok büyük ekran
          // açıyor, daha modern ve kompakt olsun." Daha küçük köşe, daha sıkı
          // dolgu, uzarsa kaydırma.
          "absolute z-50 max-h-[min(60vh,16rem)] min-w-36 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-2xl",
          "transition-all duration-200 ease-out",
          // Büyüme noktası hizaya göre: sağa hizalıysa sağ üst, sola hizalıysa sol
          // üst. Aksi hâlde açılış yana kayıyor gibi görünür.
          align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left",
          above ? "bottom-full mb-2" : "top-full mt-2",
          open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0",
        )}
      >
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            role="option"
            aria-selected={option.active}
            disabled={option.disabled}
            onClick={() => {
              onSelect(option.key);
              setOpen(false);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-ui text-[12.5px] font-semibold transition-colors",
              option.active
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              option.disabled && "cursor-not-allowed opacity-50",
            )}
          >
            {option.pending ? (
              <Loader2 size={13} className="shrink-0 animate-spin" aria-hidden="true" />
            ) : (
              <Check
                size={13}
                aria-hidden="true"
                className={cn("shrink-0", option.active ? "opacity-100" : "opacity-0")}
              />
            )}
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.marker ? (
              <span
                className={cn(
                  "shrink-0 text-[10px] font-bold leading-none",
                  option.markerClassName ?? "text-primary",
                )}
              >
                {option.marker}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

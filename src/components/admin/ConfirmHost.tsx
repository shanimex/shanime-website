import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { answerConfirm, subscribeConfirm, type ConfirmItem } from "@/lib/admin-confirm";

/**
 * SİTEYE ÖZEL ONAY PENCERESİ — native `window.confirm` yerine.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * KULLANICI BİLDİRİMİ (29.09.2026): "asla şu üstten tarayıcı mesajı çıkmasın;
 * daima kendi siteme özel tasarımlı uyarı çıksın."
 *
 * TASARIM KARARLARI (paneldeki diğer katmanlarla AYNI dil):
 *  · Kart: `rounded-2xl border border-border bg-background` + gölge — panelin
 *    diğer kartlarıyla (katalog paneli, editör kartı) birebir aynı geometri.
 *  · Yıkıcı işlemde başlıkta kırmızı bir uyarı satırı (`AlertTriangle`) ve
 *    kırmızı onay düğmesi; tehlikeli olmayanda nötr görünüm.
 *  · Sağ üstte kapatma düğmesi, dışına tıklama ve `Esc` = VAZGEÇ.
 *  · Bloklamaz: arka plan karartılır ama sayfa donmaz (native kutu gibi değil).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Onay düğmesi varyantı: yıkıcı işlemde temanın `destructive` varyantı. */
const CONFIRM_VARIANT = { danger: "destructive", default: "default" } as const;

export function AdminConfirmHost() {
  const [item, setItem] = useState<ConfirmItem | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => subscribeConfirm(setItem), []);

  const tone = item?.tone ?? "default";

  /**
   * ODAK: yıkıcı işlemde İPTAL'e verilir — `Enter`'a basan kullanıcı yanlışlıkla
   * veri silmesin. Tehlikeli olmayan işlemde onay düğmesine verilir (hızlı akış).
   */
  useEffect(() => {
    if (!item) return;
    const target = tone === "danger" ? cancelRef.current : confirmRef.current;
    target?.focus();
  }, [item, tone]);

  // Klavye: Esc = vazgeç, Enter = onayla. Dinleyici yalnızca pencere açıkken bağlanır.
  useEffect(() => {
    if (!item) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        answerConfirm(false);
      } else if (event.key === "Enter") {
        event.preventDefault();
        answerConfirm(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item]);

  // Arka plan kaydırması kilitlenir; kaydırma çubuğu genişliği telafi edilir ki
  // sayfa yana kaymasın (native kutuda bu olmuyordu çünkü sayfa donuyordu).
  useEffect(() => {
    if (!item) return;
    const previousOverflow = document.body.style.overflow;
    const previousPadding = document.body.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
    };
  }, [item]);

  if (!item) return null;

  return createPortal(
    <div
      className="animate-modal-fade fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={() => answerConfirm(false)}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="admin-confirm-title"
        className="animate-modal-panel w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <p
            id="admin-confirm-title"
            className="min-w-0 flex-1 text-base font-extrabold leading-snug text-foreground"
          >
            {item.title}
          </p>
          <button
            type="button"
            onClick={() => answerConfirm(false)}
            aria-label="Kapat"
            className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {item.description ? (
          <p
            className={`mt-3 flex items-start gap-2 whitespace-pre-line break-words rounded-xl border p-3 text-sm leading-snug ${
              tone === "danger"
                ? "border-destructive/40 bg-destructive/10 text-foreground/85"
                : "border-border bg-secondary/60 text-foreground/85"
            }`}
          >
            {tone === "danger" ? (
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-destructive" />
            ) : null}
            <span className="min-w-0">{item.description}</span>
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => answerConfirm(false)}
          >
            {item.cancelLabel ?? "İptal"}
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            variant={CONFIRM_VARIANT[tone]}
            size="sm"
            className="rounded-full font-bold"
            onClick={() => answerConfirm(true)}
          >
            {item.confirmLabel ?? "Onayla"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

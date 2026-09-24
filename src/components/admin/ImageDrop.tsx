import { useRef, useState, type DragEvent, type ReactNode } from "react";

/**
 * Görsel yükleme alanı.
 *
 * Hem **tıkla-seç** hem **sürükle-bırak** çalışır; dosya sürüklenirken kenarlık
 * vurgulanır. Kendi gizli `<input type="file">`'ını taşır, bu yüzden kullanan
 * tarafta ayrı bir input tutmak gerekmez.
 */
export function ImageDrop({
  onFile,
  label,
  accept = "image/*",
  disabled,
  className,
  children,
}: {
  onFile: (file: File) => void;
  /** Ekran okuyucu ve ipucu metni için alan adı, ör. "Dikey kapak". */
  label: string;
  /** Dosya seçici filtresi, ör. "video/mp4". */
  accept?: string;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setOver(false);
    if (disabled) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) onFile(file);
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-label={`${label} yükle`}
        title={`${label} — tıkla ya da görseli buraya sürükle`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={handleDrop}
        className={`${className ?? ""} ${
          over ? "border-primary ring-2 ring-primary/60" : ""
        } disabled:opacity-60`}
      >
        {children}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
      />
    </>
  );
}

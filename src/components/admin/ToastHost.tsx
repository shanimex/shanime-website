import { AlertTriangle, CheckCircle2, ChevronDown, Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import { subscribeToasts, TOAST_DURATION, type ToastItem, type ToastKind } from "@/lib/admin-toast";

/**
 * PANEL BİLDİRİM KARTLARI.
 *
 * KÖK NEDEN — "yeşil olması gereken mesaj kırmızı görünüyordu":
 * Eskiden başarı görünümü temanın `--primary` rengine bağlıydı (`text-primary`,
 * `border-primary/50`, `bg-primary/10`). Bu temada `--primary` = oklch(0.58 0.23 23),
 * yani hue 23° → KIRMIZI (markanın kırmızısı). Hata görünümü ise `--destructive` =
 * oklch(0.577 0.245 27.325), hue 27° → o da kırmızı. İki ton neredeyse aynı olduğu
 * için "12 bölümün kaynakları güncellendi" gibi BAŞARILI bir mesaj kırmızı çiziliyordu.
 * Yani hata `toast.success`'in yanlış varyanta düşmesi DEĞİLDİ (kind baştan sona doğru
 * taşınıyordu: emit → abone → `STYLES[item.kind]`); hata, başarı varyantının gövde
 * rengini kırmızı olan `primary` jetonuna bağlamasıydı.
 * Çözüm: başarı SABİT yeşil palet (emerald) kullanır. Hata ise yalnızca ince bir
 * kırmızı VURGU taşır; asıl metin nötr/açık kalır, böylece uzun hata listeleri okunur.
 *
 * Geometri (genişlik, dolgu, radius, gölge, kapatma düğmesi, tipografi) üç varyantta
 * AYNI tutulur: amaç "bağıran" değil "sakin" tek bir sistem.
 */

type ToastStyle = {
  icon: typeof Info;
  /** Kart yüzeyi + çerçevesi. `border-l-*` sol kenardaki ince renk şeridini verir. */
  surface: string;
  /** İkon vurgusu. */
  accent: string;
  /** Başlık metni. Hata/bilgide NÖTR kalır ki uzun metin okunabilir olsun. */
  title: string;
};

const TOAST_STYLES: Record<ToastKind, ToastStyle> = {
  // Başarı: yumuşak yeşil zemin + ince yeşil sol şerit + yeşil başlık. Doygun
  // dolu-yeşil blok DEĞİL — sakin bir onay.
  success: {
    icon: CheckCircle2,
    surface: "border-border/60 border-l-emerald-400/80 bg-emerald-500/10",
    accent: "text-emerald-400",
    title: "text-emerald-300",
  },
  // Hata: kırmızı YALNIZCA vurguda (sol şerit, ikon, çok hafif zemin). Metin açık
  // renkte kalır; aksi hâlde uzun hata gövdeleri kırmızı içinde okunmaz oluyordu.
  error: {
    icon: AlertTriangle,
    surface: "border-border/60 border-l-destructive/70 bg-destructive/10",
    accent: "text-destructive",
    title: "text-foreground",
  },
  info: {
    icon: Info,
    surface: "border-border/60 border-l-border bg-secondary/80",
    accent: "text-muted-foreground",
    title: "text-foreground",
  },
};

/** Üç varyantın paylaştığı iskelet: aynı radius, dolgu, kenar kalınlığı, gölge. */
const CARD_BASE =
  "admin-toast pointer-events-auto flex items-start gap-2.5 rounded-xl border border-l-2 py-2.5 pl-3 pr-2 shadow-md backdrop-blur-sm";

/** Katlanmış gövdede görünen azami satır: uzun liste ekranın yarısını kaplamasın. */
const CLAMPED_LINES = 3;
/** Sınıf adı DÜZ METİN olmalı: Tailwind sınıfları kaynak dosyada arayıp üretir,
 *  şablon dizesiyle kurulan adı (ör. `line-clamp-${n}`) tarayıcı göremez. */
const CLAMPED_BODY_CLASS = "line-clamp-3";
/** Genişletilmiş gövde de sınırlıdır (kaydırılabilir) — bildirim asla ekranı kaplamaz. */
const EXPANDED_BODY_CLASS = "max-h-52 overflow-y-auto";
/** Bu karakter sayısından uzun gövde "genişlet" düğmesi alır. */
const LONG_BODY_CHARS = 200;
/** Bu uzunluğun altındaki mesajlar başlık/gövde diye bölünmez; tek satır kalır. */
const SPLIT_MIN_CHARS = 90;

/**
 * Mesajı "kısa başlık + uzun gövde" diye ikiye ayırır.
 * NEDEN: uzun listeler ("Eksik/başarısız kaynaklar: ...") tek blok hâlinde
 * gösterilince başlık kayboluyor ve mesaj okunmaz hâle geliyordu. Kısa mesajlar
 * bölünmez (gereksiz yere iki satır olmasın diye).
 */
function splitToastMessage(raw: string): { title: string; body: string } {
  const text = raw.trim();
  if (text.length <= SPLIT_MIN_CHARS) return { title: text, body: "" };

  // 1) Satır sonu varsa: ilk satır başlık, kalanı liste gövdesi.
  const firstBreak = text.indexOf("\n");
  if (firstBreak > 0) {
    return { title: text.slice(0, firstBreak).trim(), body: text.slice(firstBreak + 1).trim() };
  }

  // 2) "Başlık: ayrıntı" biçimi: iki nokta başlığı ayırır (başlık çok uzamasın).
  const colon = text.indexOf(": ");
  if (colon > 0 && colon < SPLIT_MIN_CHARS) {
    return { title: text.slice(0, colon + 1).trim(), body: text.slice(colon + 1).trim() };
  }

  // 3) Ayıraç yok: tamamı katlanabilir tek parça gövde sayılır.
  return { title: "", body: text };
}

/**
 * Tek bildirim kartı. `role="status"` (başarı/bilgi) / `role="alert"` (hata) —
 * ekran okuyucular kısa onayı bekletmeden, hatayı keserek duyurur.
 */
function ToastCard({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const style = TOAST_STYLES[item.kind];
  const Icon = style.icon;

  const { title, body } = splitToastMessage(item.message);
  // Başlık yoksa (tek parça uzun metin) katlanacak metin doğrudan odur.
  const head = title || body;
  const detail = title ? body : "";
  const clampText = detail || head;
  const canCollapse =
    clampText.length > LONG_BODY_CHARS || clampText.split("\n").length > CLAMPED_LINES;

  // Katlanmış hâlde satır sınırı (line-clamp), açık hâlde yükseklik sınırı uygulanır.
  function clampClass(target: "head" | "detail") {
    if (!canCollapse) return "";
    const isTarget = detail ? target === "detail" : target === "head";
    if (!isTarget) return "";
    return expanded ? EXPANDED_BODY_CLASS : CLAMPED_BODY_CLASS;
  }

  return (
    <div
      role={item.kind === "error" ? "alert" : "status"}
      className={`${CARD_BASE} ${style.surface}`}
    >
      <Icon size={16} className={`mt-[3px] shrink-0 ${style.accent}`} />
      <div className="min-w-0 flex-1">
        <p
          className={`whitespace-pre-line break-words text-sm font-semibold leading-snug ${style.title} ${clampClass("head")}`}
        >
          {head}
        </p>
        {detail && (
          <p
            className={`mt-1 whitespace-pre-line break-words text-sm leading-snug text-foreground/75 ${clampClass("detail")}`}
          >
            {detail}
          </p>
        )}
        {canCollapse && (
          <button
            type="button"
            onClick={() => setExpanded((state) => !state)}
            aria-expanded={expanded}
            className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {expanded ? "Daralt" : "Tümünü göster"}
            <ChevronDown
              size={11}
              className={expanded ? "rotate-180 transition-transform" : "transition-transform"}
            />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Bildirimi kapat"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/**
 * Bildirim katmanı: panelin kökünde bir kez çizilir (`routes/admin.tsx`).
 * Bildirimler sağ altta yığılır; kapat düğmesiyle veya süresi dolunca kaybolur.
 * `pointer-events-none` kapsayıcıda, tek tek kartlarda açık — altta kalan
 * düğmeler tıklanabilir kalır. Yığın sırası ve azami kart sayısı korunur.
 */
export function AdminToaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(
    () =>
      subscribeToasts((item) => {
        setItems((list) => [...list.slice(-4), item]);
        window.setTimeout(
          () => setItems((list) => list.filter((entry) => entry.id !== item.id)),
          TOAST_DURATION[item.kind],
        );
      }),
    [],
  );

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {items.map((item) => (
        <ToastCard
          key={item.id}
          item={item}
          onClose={() => setItems((list) => list.filter((entry) => entry.id !== item.id))}
        />
      ))}
    </div>
  );
}

/**
 * ONAY PENCERESİ — yayın tarafı (imperative API).
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * NEDEN VAR — KULLANICI BİLDİRİMİ (29.09.2026):
 *   "genel olarak bir şeyler yapınca ASLA şu üstten tarayıcı mesajı çıkmasın;
 *    daima web sitesine özel, kendi siteme özel tasarımlı uyarı çıksın."
 *
 * ÖLÇÜLEN DURUM: yıkıcı işlemlerin hepsi `window.confirm` kullanıyordu. O kutu
 * tarayıcının kutusudur: başlığı "localhost:8080 şunu diyor:" olur, site temasını
 * bilmez, mobilde tam ekrandır ve panelin tasarımıyla hiçbir ilgisi yoktur.
 * Ayrıca bloklayıcıdır — sayfa o sırada tamamen donar.
 *
 * ÇÖZÜM: toast sisteminin birebir aynısı iki katmanlı yapı:
 *   · bu dosya  → durum + `confirmAction()` (React bileşeni YOK, Fast Refresh güvenli)
 *   · `components/admin/ConfirmHost.tsx` → `<AdminConfirmHost/>` görsel katman
 *
 * KULLANIM (native `confirm` gibi ama `await` ile):
 *   import { confirmAction } from "@/lib/admin-confirm";
 *   if (!(await confirmAction({ title: "… silinsin mi?", tone: "danger" }))) return;
 *
 * ⚠️ ESKİ `window.confirm` ÇAĞRILARI TAMAMEN DEĞİŞTİRİLDİ; panelde artık native
 * tarayıcı diyaloğu çıkmaz.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** `danger` = geri alınamaz işlem (kırmızı düğme, odak İPTAL'de). */
export type ConfirmTone = "danger" | "default";

export type ConfirmRequest = {
  /** Kısa başlık — pencere başlığı. */
  title: string;
  /** Uzun açıklama; `\n` ile satırlanır. Kırmızı uyarı olarak gösterilir. */
  description?: string | undefined;
  /** Onay düğmesi metni (varsayılan: "Onayla"). */
  confirmLabel?: string | undefined;
  /** Vazgeç düğmesi metni (varsayılan: "İptal"). */
  cancelLabel?: string | undefined;
  /** Varsayılan `default`. */
  tone?: ConfirmTone | undefined;
};

/** Görsel katmanın çizdiği kayıt: istek + çözücü + kimlik. */
export type ConfirmItem = ConfirmRequest & {
  id: number;
  resolve: (ok: boolean) => void;
};

let current: ConfirmItem | null = null;
let nextId = 1;
const listeners = new Set<(item: ConfirmItem | null) => void>();

function emit() {
  for (const listener of listeners) listener(current);
}

/**
 * Kullanıcıdan onay ister.
 *
 * @returns `true` = onaylandı, `false` = iptal (veya pencere yeni bir istekle
 *          değiştirildi).
 *
 * NOT: aynı anda YALNIZCA BİR pencere açık olur. Yeni bir istek gelirse eski
 * istek `false` ile kapanır — üst üste binen kutular olmaz.
 */
export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  if (current) {
    const previous = current;
    current = null;
    previous.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    current = { ...request, id: nextId++, resolve };
    emit();
  });
}

/** Pencereyi sonuçla kapatır. `<AdminConfirmHost/>` kullanır. */
export function answerConfirm(ok: boolean) {
  const item = current;
  current = null;
  emit();
  item?.resolve(ok);
}

/** `<AdminConfirmHost/>` bu aboneliği kullanır (açılışta mevcut isteği de verir). */
export function subscribeConfirm(listener: (item: ConfirmItem | null) => void): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

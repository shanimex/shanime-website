/**
 * PANEL BİLDİRİMLERİ — yayın tarafı.
 *
 * NEDEN VAR: panelde bir işlem yapıldığında sonuç çoğu yerde ya hiç görünmüyordu
 * ya da sayfanın EN ÜSTÜNDEKİ tek satırlık uyarı çubuğuna yazılıyordu. Kullanıcı
 * aşağıda (bölüm listesinde) çalışırken o çubuk ekranın dışında kalıyor,
 * "kaydoldu mu, hata mı verdi" belirsiz kalıyordu. Artık her işlem, yapıldığı yerin
 * yanında sağ altta beliren bir bildirimle sonuçlanıyor: onay için yeşil, hata için
 * kırmızı; hata mesajı doğrudan gösterilir (sessizce yutulmaz).
 *
 * KULLANIM:
 *   import { toast } from "@/lib/admin-toast";
 *   toast.success("3 bölüm eklendi.");
 *   toast.error("Kaydedilemedi: " + error.message);
 *
 * Görsel katman ayrı dosyada: `components/admin/ToastHost.tsx` (`<AdminToaster/>`).
 * Bu ayrım bilinçli — React Fast Refresh yalnızca bileşen dışa aktaran dosyalarda
 * güvenilir çalışıyor.
 */
export type ToastKind = "success" | "error" | "info";

export type ToastItem = { id: number; kind: ToastKind; message: string };

let nextId = 1;
const listeners = new Set<(item: ToastItem) => void>();

/**
 * Otomatik kapanma süresi (ms), varyanta göre.
 * SEÇİM: başarı kısa tutulur (5 sn) — onay mesajının ekranda oyalanmasına gerek yok.
 * Bilgi biraz daha uzun (6 sn). Hata EN uzun (9 sn): kullanıcı hatayı okuyup
 * gerekiyorsa uzun listeyi "Tümünü göster" ile açabilsin diye.
 * (Görsel katman: `components/admin/ToastHost.tsx`.)
 */
export const TOAST_DURATION: Record<ToastKind, number> = {
  success: 5000,
  info: 6000,
  error: 9000,
};

function emit(kind: ToastKind, message: string) {
  const text = message.trim();
  if (!text) return;
  const item: ToastItem = { id: nextId++, kind, message: text };
  for (const listener of listeners) listener(item);
}

export const toast = {
  success: (message: string) => emit("success", message),
  error: (message: string) => emit("error", message),
  info: (message: string) => emit("info", message),
};

/** `<AdminToaster/>` bu aboneliği kullanır. */
export function subscribeToasts(listener: (item: ToastItem) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

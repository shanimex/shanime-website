// BU DOSYA YALNIZCA ESKİ/SEO BAĞLANTILARI İÇİNDİR.
//
// Yeni adres yapısında seri detayı `/anime/<slug>` olur.
// Burada yalnızca ESKİ adresler, kaybolmasın diye yeni yapıya yönlendirilir:
//   · `/seri/<slug>`  →  `/anime/<slug>` (seri detayı)
// Eski detay sayfasının taşınması gereken anlamlı bir sorgu parametresi YOKTU;
// bu yüzden gelen sorgu parametreleri bilerek TAŞINMAZ (hedef adres temiz kalır).
// Eski bağlantılar bugün arama motoru indekslerinde, paylaşılmış adreslerde ve
// yer imlerinde yaşıyor; bu yönlendirme olmadan hepsi 404 olurdu.
//
// MEKANİZMA: `beforeLoad` + `redirect` (arayüz bileşeni YOK). Tek adımlı yönlendirme
// sunucuda (SSR) da çalışır, tarayıcıya hiçbir zaman eski adresin sayfası çizilmez ve
// istemciye ekstra bileşen/JS yüklenmez.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/seri/$slug")({
  beforeLoad: ({ params }) => {
    // Yolun tamamı yeni adrese eşlenir: `/seri/<slug>` → `/anime/<slug>`.
    throw redirect({ to: "/anime/$slug", params: { slug: params.slug } });
  },
});

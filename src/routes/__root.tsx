// Tüm sayfaların üst iskeleti (header/footer/hata ekranı) — ortak çerçeve, menü ve hata/404 ekranı.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { LanguageToggle } from "@/components/site/LanguageToggle";
// `translate`: modül seviyesindeki `t`nin takma adı — kök `<head>` meta'sı
// bileşen dışında (rota `head()` içinde) üretildiği için orada hook çağrılamaz.
// `DEFAULT_LANG`: SSR'de basılan metnin dili; `<html lang>` ile AYNI kaynaktan
// beslenir ki ilk boyamada dil uyuşmazlığı olmasın (bkz. RootShell).
import { DEFAULT_LANG, t as translate, useDocumentTitle, useLang } from "@/lib/i18n";

function NotFoundComponent() {
  const { t } = useLang();
  // Rota bulunamadığında kök başlık ("shanime") kalıyordu; sekmede ne olduğu
  // anlaşılsın diye burada düzeltilir. `useDocumentTitle` KULLANILIR (elle
  // `useEffect` DEĞİL): başlık aktif dile bağlı hazır metin olarak verilir ve dil
  // değişince sekme başlığı yeni dilde yazılır — tek doğruluk kaynağı i18n'de kalır.
  useDocumentTitle(`${t("notFound.title")} | shanime`);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-16">
      {/* SSR başlığı/açıklaması kök `head()`ten gelir (bkz. S5 notu); burada
          yalnızca sekme başlığı aktif dile bağlanır (yukarıdaki `useDocumentTitle`). */}
      <div className="max-w-md text-center">
        <Link to="/" className="mb-8 inline-flex items-center justify-center">
          <img
            src="/shanime-logo.png?v=6"
            alt={t("common.logoAlt")}
            width={1060}
            height={856}
            loading="eager"
            decoding="async"
            className="h-14 w-auto object-contain"
          />
          <span className="sr-only">shanime</span>
        </Link>
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t("notFound.title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("notFound.body")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("common.backHome")}
          </Link>
          {/* Çıkmaz sokak olmasın: serilere tek tıkla dönüş.
              İKİNCİ BAĞLANTI YENİDEN YÖNLENDİRİLDİ: eskiden ana sayfadaki GENRES
              çip şeridine (`/#genres`) gidiyordu; o şerit KULLANICI İSTEĞİYLE
              silindiği için hedefi ölü kalmasın diye `/#series` (seri ızgarası)
              yapıldı. Etiket ("Türler"/"Genres") DEĞİŞMEDİ. */}
          <a
            href="/#series"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("footer.allSeries")}
          </a>
          <a
            href="/#series"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("footer.genres")}
          </a>
        </div>
        {/* Dil değiştirici: 404 de bir site sayfasıdır; kök şeritte başlık yok,
            bu yüzden seçici buraya konur ki her sayfada dil seçilebilsin. */}
        <div className="mt-6 flex justify-center">
          <LanguageToggle />
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const { t } = useLang();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("error.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("error.body")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("error.retry")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("common.home")}
          </a>
        </div>
        {/* Dil değiştirici: hata ekranı da bir site sayfasıdır (bkz. NotFound). */}
        <div className="mt-6 flex justify-center">
          <LanguageToggle />
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: ({ match }) => {
    // Görseller Supabase Storage'dan geliyor: tarayıcı ilk istekten önce
    // bağlantıyı kursun diye host'a preconnect (LCP'yi hızlandırır).
    const supabaseUrl = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
    /**
     * DÜZELTME (S5) — 404 sayfasının SSR başlığı.
     *
     * Kök `head()` her zaman "shanime" başlığını basıyordu; "Sayfa bulunamadı"
     * yalnızca istemcide (`useDocumentTitle`) yazıldığı için sunucu HTML'inde
     * genel başlık kalıyordu. TanStack Router, eşleşmeyen bir adreste kök match'e
     * `globalNotFound: true` işareti koyar (bkz. router-core `load-matches.js`);
     * bu işaret okununca başlık/açıklama SSR'de de doğru metne döner — üstelik
     * tek `<title>` kalır (React 19 `<title>` taşımasıyla ikinci bir başlık
     * doğurmaz).
     */
    const globalNotFound = match.globalNotFound === true;
    const siteTitle = "shanime";
    const pageTitle = globalNotFound ? `${translate("notFound.title")} | shanime` : siteTitle;
    const pageDescription = globalNotFound
      ? translate("notFound.body")
      : translate("meta.siteDescription");
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: pageTitle },
        { name: "description", content: pageDescription },
        { name: "author", content: "shanime" },
        { property: "og:title", content: pageTitle },
        { property: "og:description", content: pageDescription },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: [
        ...(supabaseUrl
          ? [{ rel: "preconnect", href: supabaseUrl, crossOrigin: "anonymous" as const }]
          : []),
        {
          rel: "preconnect",
          href: "https://fonts.googleapis.com",
        },
        {
          rel: "preconnect",
          href: "https://fonts.gstatic.com",
          crossOrigin: "anonymous",
        },
        {
          rel: "stylesheet",
          href: appCss,
        },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Signika+Negative:wght@400;500;600;700&display=swap",
        },
        { rel: "icon", href: "/favicon.ico?v=6", type: "image/x-icon" },
        { rel: "icon", href: "/icon-192.png?v=6", type: "image/png", sizes: "192x192" },
        { rel: "icon", href: "/icon-512.png?v=6", type: "image/png", sizes: "512x512" },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png?v=6", sizes: "180x180" },
      ],
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    // DÜZELTME (S4): `lang` SABİT "tr" yazılıydı ama SSR metinleri varsayılan
    // dile (İngilizce) göre basılıyordu → ilk boyama EN arayüzü `lang="tr"`
    // altında sunuyordu. Artık `lang`, SSR dilinin tek doğruluk kaynağı olan
    // `DEFAULT_LANG`ten gelir; istemcide `applyLang()` bu özniteliği seçili
    // dile göre günceller.
    <html lang={DEFAULT_LANG}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  /**
   * CANLI HATA GÜNLÜĞÜ — yalnızca geliştirmede kurulur.
   *
   * Kullanıcı isteği (28.09.2026): "canlı olarak her yaptığım işlemi takip
   * edebilir misin, log alır mısın; hangi işlemde ne oldu, hatamızı bul."
   *
   * `installDevLog` sayfa geçişlerini, yakalanmayan hataları ve 2xx olmayan
   * istekleri sunucudaki `.dev-log.jsonl` dosyasına yazar; üretimde hiçbir şey
   * yapmaz (bkz. `lib/dev-log.ts`). Gövdesinde `import.meta.env.DEV` kontrolü
   * olduğu için burada koşul yazmaya gerek yok.
   */
  useEffect(() => {
    void import("@/lib/dev-log").then((module) => module.installDevLog());
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}

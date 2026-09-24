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

function NotFoundComponent() {
  // Rota bulunamadığında kök başlık ("shanime") kalıyordu; sekmede ne olduğu
  // anlaşılsın diye burada düzeltilir.
  useEffect(() => {
    document.title = "Sayfa bulunamadı | shanime";
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-16">
      <div className="max-w-md text-center">
        <Link to="/" className="mb-8 inline-flex items-center justify-center">
          <img
            src="/shanime-logo.png"
            alt="shanime logosu"
            width={800}
            height={187}
            loading="eager"
            decoding="async"
            className="h-10 w-auto object-contain"
          />
          <span className="sr-only">shanime</span>
        </Link>
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Sayfa bulunamadı</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Aradığın sayfa yok ya da taşınmış olabilir.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Ana sayfaya dön
          </Link>
          {/* Çıkmaz sokak olmasın: serilere ve türlere tek tıkla dönüş. */}
          <a
            href="/#series"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Tüm seriler
          </a>
          <a
            href="/#genres"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Türler
          </a>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Sayfa yüklenemedi</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Bir şeyler ters gitti. Sayfayı yenilemeyi ya da ana sayfaya dönmeyi deneyebilirsin.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Tekrar dene
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Ana sayfa
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => {
    // Görseller Supabase Storage'dan geliyor: tarayıcı ilk istekten önce
    // bağlantıyı kursun diye host'a preconnect (LCP'yi hızlandırır).
    const supabaseUrl = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "shanime" },
        { name: "description", content: "Yeni anime serilerini keşfet." },
        { name: "author", content: "shanime" },
        { property: "og:title", content: "shanime" },
        { property: "og:description", content: "Yeni anime serilerini keşfet." },
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
        { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
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
    <html lang="tr">
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

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

/**
 * shanime — standart Vite + TanStack Start yapılandırması.
 *
 * Bu dosya bilinçli olarak sade: hiçbir platform sarmalayıcısı kullanmıyor.
 * Derleme tamamen kendi üzerinde durur.
 *
 * NELER VAR:
 * - `tanstackStart` : SSR çatısı. `server.entry` kendi hata yakalayıcımıza
 *   (`src/server.ts`) yönlendirir; h3'ün yuttuğu 500'leri okunur sayfaya çevirir.
 * - `viteReact`     : React derleyicisi.
 * - `tailwindcss`   : Tailwind v4 (CSS'ten yapılandırılır, ayrı config dosyası yok).
 * - `nitro`         : Üretim derlemesini Cloudflare çıktısına çevirir.
 *
 * YAYIN HEDEFİ: `cloudflare-pages` preset'i.
 * Site Cloudflare Pages'te yayınlanıyor ve Pages, çıktı olarak `dist/` klasörünü
 * bekliyor: `dist/_worker.js` (sunucu tarafı), `_routes.json`, `_headers` ve
 * statik dosyalar. Preset sabitlendi — otomatik algılamaya bırakılırsa yerelde
 * `cloudflare-module` seçilip `.output/` üretiliyor ve Pages ayarıyla uyuşmuyor.
 *
 * `@` yol takma adı (`@/lib/...`) tsconfig'deki `paths` üzerinden Vite 8'in
 * yerleşik desteğiyle çözülür (`resolve.tsconfigPaths`) — ayrı eklenti gerekmez.
 */
export default defineConfig({
  // Geliştirme sunucusu sabit portta ve ağa açık: siteyi başka cihazlardan da
  // görebilmek için. `strictPort` port doluysa sessizce başka porta kaymasın.
  server: { port: 8080, strictPort: true, host: true },
  resolve: {
    tsconfigPaths: true,
    // React ve TanStack paketlerinin iki kopyası yüklenirse hooks/güvenlik
    // bağlamı bozulur; tekilleştirme bunu engeller.
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-start"],
  },
  plugins: [
    tanstackStart({ server: { entry: "server" } }),
    viteReact(),
    tailwindcss(),
    nitro({ preset: "cloudflare-pages" }),
  ],
});

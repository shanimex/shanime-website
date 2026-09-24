import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

/**
 * shanime â€” standart Vite + TanStack Start yapÄ±landÄ±rmasÄ±.
 *
 * Bu dosya bilinÃ§li olarak sade: hiÃ§bir platform sarmalayÄ±cÄ±sÄ± kullanmÄ±yor.
 * Proje tamamen kendi Ã¼zerinde durur; yayÄ±n hedefi Nitro'nun
 * `cloudflare-module` preset'i (Cloudflare Workers).
 *
 * NELER VAR:
 * - `tanstackStart` : SSR Ã§atÄ±sÄ±. `server.entry` bizim hata yakalayÄ±cÄ±mÄ±za
 *   (`src/server.ts`) yÃ¶nlendirir; h3'Ã¼n yuttuÄŸu 500'leri okunur sayfaya Ã§evirir.
 * - `viteReact`      : React derleyicisi.
 * - `tailwindcss`    : Tailwind v4 (CSS'ten yapÄ±landÄ±rÄ±lÄ±r, ayrÄ± config dosyasÄ± yok).
 * - `nitro`          : Ãœretim derlemesini Cloudflare Workers Ã§Ä±ktÄ±sÄ±na Ã§evirir
 *   (`.output/server/wrangler.json`).
 *
 * `@` yol takma adÄ± (`@/lib/...`) tsconfig'deki `paths` Ã¼zerinden Vite 8'in
 * yerleÅŸik desteÄŸiyle Ã§Ã¶zÃ¼lÃ¼r (`resolve.tsconfigPaths`) â€” ayrÄ± eklenti gerekmez.
 */
export default defineConfig({
  // GeliÅŸtirme sunucusu sabit portta ve aÄŸa aÃ§Ä±k: siteyi baÅŸka cihazlardan da
  // gÃ¶rebilmek iÃ§in. `strictPort` port doluysa sessizce baÅŸka porta kaymasÄ±n.
  server: { port: 8080, strictPort: true, host: true },
  resolve: {
    tsconfigPaths: true,
    // React ve TanStack paketlerinin iki kopyasÄ± yÃ¼klenirse hooks/gÃ¼venlik
    // baÄŸlamÄ± bozulur; tekilleÅŸtirme bunu engeller.
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-start"],
  },
  plugins: [
    tanstackStart({ server: { entry: "server" } }),
    viteReact(),
    tailwindcss(),
    nitro({ preset: "cloudflare-pages" }),
  ],
});

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { handleAnizmProxy } from "./src/lib/anizm-proxy";

/**
 * GELİŞTİRME yaması (dev-only): `/src/data/*.json?import` istekleri dev
 * sunucusunda SPA-fallback'a düşüp 404 dönüyordu (üretim derlemesi JSON'u
 * gömüp sorunsuz çalışır — bu yüzden yalnızca geliştirmede gerekir).
 *
 * Neden burada: dosya `src/data/` altında durur, içerik derlemede gömülür;
 * yama yalnızca `configureServer` kullandığı için `vite build` sırasında
 * hiç çalışmaz — üretim çıktısı birebir aynı kalır.
 */
function devJsonPlugin(): Plugin {
  return {
    name: "shanime-dev-json",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const raw = (req.url ?? "").split("?")[0] ?? "";
          if (!raw.startsWith("/src/data/") || !raw.endsWith(".json")) {
            next();
            return;
          }
          const file = resolve(server.config.root, `.${raw}`);
          const text = await readFile(file, "utf-8");
          // Geçerlilik denetimi: bozuk JSON sessizce geçilmez, belli olur.
          const data: unknown = JSON.parse(text);
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/javascript");
          res.setHeader("Cache-Control", "no-cache");
          res.end(`export default ${JSON.stringify(data)};`);
        } catch {
          next();
        }
      });
    },
  };
}

/**
 * ANİZM TERS PROXY — DEV yaması (08.10.2026).
 *
 * Üretimde `src/server.ts` TÜM yolları karşılar; ama Vite dev sunucusu,
 * `/player/*.js`, `/player/*.css`, `/player/*.svg` gibi dosya-uzantılı istekleri
 * KENDİ statik/dönüşüm katmanında tutup 404 döndürüyor — bu yüzden oynatıcının
 * alt kaynakları dev'de yüklenmiyordu. Bu middleware, `/api/anizm-player`,
 * `/player/…` ve `/cdn/…` isteklerini Vite'ın iç katmanlarından ÖNCE karşılar.
 *
 * Üretim çıktısı DEĞİŞMEZ: yama yalnızca `apply: "serve"` ile dev'de çalışır.
 */
function anizmProxyDevPlugin(): Plugin {
  return {
    name: "shanime-anizm-proxy-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const raw = req.url ?? "";
        const path = raw.split("?")[0] ?? "";
        if (
          path !== "/api/anizm-player" &&
          path !== "/api/anizm-asset" &&
          !path.startsWith("/player/") &&
          !path.startsWith("/cdn/") &&
          !path.startsWith("/m3/")
        ) {
          next();
          return;
        }
        // Gövdeyi (POST) ve gerçek host'u (origin) koru: oynatıcı medyayı
        // `POST …&do=getVideo` gövdesiyle ister; host ise adres yeniden yazımında
        // kullanılır (player_base_url).
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          const method = (req.method ?? "GET").toUpperCase();
          const host = req.headers.host ?? "localhost:8080";
          const headers: Record<string, string> = { accept: req.headers.accept ?? "*/*" };
          if (req.headers["user-agent"]) headers["user-agent"] = req.headers["user-agent"];
          if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];
          // jQuery `$.ajax` bu başlığı gönderir; olmadan `do=getVideo` HTML döner.
          const xrw = req.headers["x-requested-with"];
          if (typeof xrw === "string") headers["x-requested-with"] = xrw;
          const body = method === "GET" || method === "HEAD" ? null : Buffer.concat(chunks);
          const request = new Request(new URL(raw, `http://${host}`).href, {
            method,
            headers,
            ...(body ? { body } : {}),
          });
          handleAnizmProxy(request)
            .then(async (response) => {
              res.statusCode = response.status;
              response.headers.forEach((value, key) => res.setHeader(key, value));
              res.end(Buffer.from(await response.arrayBuffer()));
            })
            .catch(next);
        });
      });
    },
  };
}

/**
 * Nitro'nun Cloudflare preset'i `inlineDynamicImports: false` ekliyor.
 * Vite 8/Rolldown aynı çıktıda code splitting kullandığı için bu alan gereksiz
 * bir uyarı üretiyor; code splitting'i kapatmadan yalnızca çakışan alanı sileriz.
 */
function nitroRolldownConfigWithoutRedundantInlineImports() {
  return {
    "rollup:before"(_nitro: unknown, config: { output?: unknown }) {
      const output = config.output;
      if (
        output &&
        !Array.isArray(output) &&
        Object.prototype.hasOwnProperty.call(output, "codeSplitting") &&
        Object.prototype.hasOwnProperty.call(output, "inlineDynamicImports")
      ) {
        delete (output as { inlineDynamicImports?: boolean }).inlineDynamicImports;
      }
    },
  };
}

/**
 * shanime — standart Vite + TanStack Start yapılandırması.
 *
 * NELER VAR:
 * - `tanstackStart` : SSR çatısı. `server.entry` kendi hata yakalayıcımıza
 *   (`src/server.ts`) yönlendirir; h3'ün yuttuğu 500'leri okunur sayfaya çevirir.
 * - `viteReact`     : React derleyicisi.
 * - `tailwindcss`   : Tailwind v4 (CSS'ten yapılandırılır, ayrı config dosyası yok).
 * - `nitro`         : Üretim derlemesini Cloudflare Pages çıktısına çevirir
 *   (`cloudflare-pages` preset'i, `dist/` çıktısı).
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
    devJsonPlugin(),
    anizmProxyDevPlugin(),
    tanstackStart({ server: { entry: "server" } }),
    viteReact(),
    tailwindcss(),
    nitro({
      preset: "cloudflare-pages",
      hooks: nitroRolldownConfigWithoutRedundantInlineImports(),
    }),
  ],
});

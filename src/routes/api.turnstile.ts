// /api/turnstile — Turnstile tokenını Cloudflare siteverify API'siyle doğrular.
// Secret key yalnızca sunucu ortamında tutulur; istemciye veya kaynak koda gitmez.
import { createFileRoute } from "@tanstack/react-router";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const Route = createFileRoute("/api/turnstile")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // `NODE_ENV` Cloudflare Pages/Workers tarafında güvenilir bir üretim
        // sinyali değildir; tanımsız kalırsa eski kod üretimde test anahtarını
        // seçiyordu. Gerçek anahtar varsa her ortamda onu kullan, test anahtarını
        // yalnızca Vite geliştirme derlemesinde kullan.
        const configuredSecret = (process.env["TURNSTILE_SECRET_KEY"] ?? "").trim();
        const secret =
          configuredSecret || (import.meta.env.DEV ? "1x0000000000000000000000000000000AA" : "");
        if (!secret) {
          return Response.json(
            { ok: false, reason: "Turnstile sunucu anahtarı eksik" },
            { status: 503 },
          );
        }

        let body: { token?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ ok: false, reason: "Geçersiz doğrulama isteği" }, { status: 400 });
        }

        const token = typeof body.token === "string" ? body.token.trim() : "";
        if (!token || token.length > 4096) {
          return Response.json({ ok: false, reason: "Turnstile tokenı eksik" }, { status: 400 });
        }

        const form = new URLSearchParams({
          secret,
          response: token,
          remoteip: request.headers.get("CF-Connecting-IP") ?? "",
        });
        let response: Response;
        let result: { success?: boolean };
        try {
          response = await fetch(VERIFY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: form,
          });
          result = (await response.json()) as { success?: boolean };
        } catch {
          return Response.json(
            { ok: false, reason: "Turnstile doğrulama servisine ulaşılamadı" },
            { status: 502 },
          );
        }
        const ok = response.ok && result.success === true;

        return Response.json({ ok }, { status: ok ? 200 : 403 });
      },
    },
  },
});

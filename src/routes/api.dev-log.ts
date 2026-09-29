// /api/dev-log — CANLI HATA GÜNLÜĞÜ deposu (YALNIZCA GELİŞTİRME).
//
// İstemci (`lib/dev-log.ts`) sayfa geçişlerini, yakalanmayan hataları ve 2xx
// olmayan istekleri buraya gönderir; burada proje kökündeki `.dev-log.jsonl`
// dosyasına EKLENİR. Asistan dosyayı okuyarak "şu anda ne oldu" sorusunu
// kesin cevaplar — tarayıcı konsolu kaybolsa bile kayıt durur.
//
// ═══════════════════════════════════════════════════════════════════════════
// GÜVENLİK
//
//  · YALNIZCA GELİŞTİRMEDE açılır: `import.meta.env.DEV` false ise rota 404
//    döner. Yani üretim sitesinde bu uç nokta YOK sayılır.
//  · İstek GÖVDESİ kaydedilmez; yalnızca istemcinin açıkça gönderdiği kısa
//    alanlar yazılır. Şifre/oturum bilgisi toplanmaz.
//  · Dosya `.gitignore`'a eklenmelidir (günlük repoya girmesin).
// ═══════════════════════════════════════════════════════════════════════════

import { appendFile, open } from "node:fs/promises";
import { Buffer } from "node:buffer";
import path from "node:path";
import { createFileRoute } from "@tanstack/react-router";

/** Günlük dosyası: proje kökü — asistan `read` ile doğrudan okuyabilir. */
const LOG_FILE = path.join(process.cwd(), ".dev-log.jsonl");

/** Tek istekte kabul edilen en fazla olay (kötüye kullanımı sınırlar). */
const MAX_ENTRIES = 50;

/** Tek satırın en fazla uzunluğu — dosya okunabilir kalsın. */
const MAX_LINE = 2000;

/** Son N kaydı isterken okunacak en fazla bayt (çok büyük dosyada bellek şişmesin). */
const READ_TAIL_BYTES = 256 * 1024;

/**
 * GET — SON KAYITLARI DÖNER. Canlı konsol bunu yoklar.
 *
 * Kullanıcı isteği (28.09.2026): "chat ekranına canlı her şeyi takip eden konsol
 * ekleyeceksin; ben her işlem yaptığımda sürekli güncellenecek, anlık."
 *
 * `?since=N` verilirse yalnızca N. indeksten SONRAKİ kayıtlar döner; konsol böylece
 * her yoklamada tüm dosyayı yeniden çizmez, yalnızca yeni satırları ekler.
 *
 * YANIT: `{ total, entries: [...] }` — `total` her zaman dosyadaki toplam satır
 * sayısıdır (istemci bir sonraki `since` değerini buradan alır).
 *
 * CORS: `Access-Control-Allow-Origin: *` — konsol, uygulamadan FARKLI bir kökenden
 * (sohbet arayüzü) çağırdığı için zorunlu. Yalnızca geliştirmede açıktır ve
 * okunacak veri zaten geliştirme günlüğüdür.
 */
export const Route = createFileRoute("/api/dev-log")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const cors = {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Cache-Control": "no-store",
        } as const;

        if (!import.meta.env.DEV) {
          return new Response("not found", { status: 404, headers: cors });
        }

        const since = Math.max(
          0,
          Number.parseInt(new URL(request.url).searchParams.get("since") ?? "0", 10) || 0,
        );

        let text = "";
        try {
          // Dosyanın KUYRUĞU okunur: günlük uzasa da yanıt hızlı kalır.
          const handle = await open(LOG_FILE, "r");
          try {
            const stat = await handle.stat();
            const start = Math.max(0, stat.size - READ_TAIL_BYTES);
            const buffer = Buffer.alloc(stat.size - start);
            await handle.read(buffer, 0, buffer.length, start);
            text = buffer.toString("utf8");
          } finally {
            await handle.close();
          }
        } catch {
          // Dosya henüz oluşmadı (hiç işlem yapılmadı) — boş liste döner.
          return Response.json({ total: 0, entries: [] }, { headers: cors });
        }

        const lines = text.split("\n").filter((line) => line.trim().length > 0);
        const total = lines.length;
        const fresh = since > 0 ? lines.slice(since) : lines.slice(-40);
        const entries = fresh
          .map((line) => {
            try {
              return JSON.parse(line) as unknown;
            } catch {
              return null;
            }
          })
          .filter((item) => item !== null);

        return Response.json({ total, entries }, { headers: cors });
      },

      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        }),

      POST: async ({ request }) => {
        // Üretimde bu uç nokta yoktur.
        if (!import.meta.env.DEV) {
          return new Response("not found", { status: 404 });
        }
        try {
          const body = (await request.json()) as { entries?: unknown };
          const list = Array.isArray(body.entries) ? body.entries.slice(0, MAX_ENTRIES) : [];
          if (list.length === 0) return Response.json({ ok: true, written: 0 });

          const lines = list
            .map((entry) => {
              try {
                return JSON.stringify(entry).slice(0, MAX_LINE);
              } catch {
                return null;
              }
            })
            .filter((line): line is string => Boolean(line))
            .join("\n");

          await appendFile(LOG_FILE, `${lines}\n`, "utf8");
          return Response.json({ ok: true, written: list.length });
        } catch (error) {
          // Günlük yazılamazsa uygulama ETKİLENMEZ — istemci sessizce devam eder.
          return Response.json(
            { ok: false, reason: error instanceof Error ? error.message : String(error) },
            { status: 200 },
          );
        }
      },
    },
  },
});

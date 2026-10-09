// /api/anilist-cover — AniList kapak görselini SAME-ORIGIN vekil eder.
//
// YALNIZCA "Düzenle" / "Yeni seri ekle" MAL aramasının OTOMATİK KAPAK yolu için
// vardır. `lib/mal-search.ts` → `fetchMalCoverFile` bu rotayı çağırır.
//
// ═══════════════════════════════════════════════════════════════════════════
// NEDEN GEREKLİ (ölçüldü, tahmin değil)
// AniList kapak CDN'i (`s4.anilist.co`) `Access-Control-Allow-Origin` başlığı
// GÖNDERMİYOR. Kapak bu yüzden tarayıcıda `<img src>` ile GÖSTERİLEBİLİR ama
// `fetch` ile İNDİRİLEMEZ (CORS reddi). Poster ise Supabase Storage'a
// yüklenmek zorunda (projedeki desen: `images/posters/…` + `shows.image_path`),
// yani baytlar gerekiyor. Sunucu (Node) tarafında CORS YOKTUR; bu rota görseli
// çekip TARAYICIYA aynı kaynaktan verir.
//
// GÜVENLİK: açık vekil DEĞİLDİR — yalnızca https + `*.anilist.co` alan adları
// kabul edilir; gövde olduğu gibi aktarılır, hiçbir yere YAZILMAZ.
// ═══════════════════════════════════════════════════════════════════════════
import { createFileRoute } from "@tanstack/react-router";

/** İzinli kapak alan adları: AniList CDN'i ve alt alan adları. */
const ALLOWED_HOST = /(^|\.)anilist\.co$/i;

export const Route = createFileRoute("/api/anilist-cover")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const raw = (new URL(request.url).searchParams.get("url") ?? "").trim();
        if (!raw) return new Response("Görsel adresi verilmedi.", { status: 400 });

        let parsed: URL;
        try {
          parsed = new URL(raw);
        } catch {
          return new Response("Görsel adresi geçersiz.", { status: 400 });
        }
        if (parsed.protocol !== "https:" || !ALLOWED_HOST.test(parsed.hostname)) {
          return new Response("Yalnızca AniList görselleri alınabilir.", { status: 400 });
        }

        let upstream: Response;
        try {
          upstream = await fetch(parsed.toString(), { signal: AbortSignal.timeout(15000) });
        } catch {
          return new Response(
            "Kapak sunucusuna ulaşılamadı. Bağlantıyı kontrol edip tekrar dene.",
            { status: 502 },
          );
        }
        if (!upstream.ok || !upstream.body) {
          return new Response(`AniList görseli alınamadı (${upstream.status}).`, { status: 502 });
        }
        return new Response(upstream.body, {
          headers: {
            "Content-Type": upstream.headers.get("content-type") ?? "image/jpeg",
            // Kapak değişmez içeriktir: aynı adres hep aynı görseli verir.
            "Cache-Control": "public, max-age=86400, immutable",
          },
        });
      },
    },
  },
});

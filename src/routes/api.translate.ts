// /api/translate — Sunucu rotası: içerik metinlerini (bölüm adı, özet, açıklama,
// tür) DeepL ile hedef dile çevirir. Anahtar sunucuda kalır (bkz. `lib/deepl.ts`).
//
// ═══════════════════════════════════════════════════════════════════════════
// NEDEN SUNUCU ROTASI, İSTEMCİDE ÇEVİRİ DEĞİL
//
//  1. GÜVENLİK: DeepL anahtarı istemciye gitmez (`VITE_` öneki yok).
//  2. KOTA: çeviri bir kez yapılır. Aynı metni 500 ziyaretçi görse de DeepL'e
//     TEK istek gider; gerisi önbellekten döner. 1.000.000 karakterlik ücretsiz
//     kota bu yüzden rahat yeter (tüm katalog ~150 bin karakter).
//
// ── İKİ KATMANLI ÖNBELLEK ──────────────────────────────────────────────────
//  · L1 — süreç belleği (`Map`): aynı sunucu örneğindeki tüm istekler paylaşır.
//    Geliştirmede de çalışır, bu yüzden panelde değişiklik anında görünür.
//  · L2 — `cachedRead` (bkz. `lib/server-cache.ts`): ÜRETİMDE Cache API'ye yazar,
//    yani örnek yeniden başlasa da çeviriler KALICI olur. Geliştirmede bu katman
//    devre dışıdır (orada L1 zaten yeterli).
//
// ── DAVRANIŞ (ÖNEMLİ) ──────────────────────────────────────────────────────
// Çeviri bir "süs"tür: sayfanın çalışması ona bağlı DEĞİLDİR. DeepL hata verirse
// (kota bitti, ağ, sınır) rota 200 + `ok:false` döner ve İSTEMCİ ORİJİNAL metni
// gösterir. Böylece çeviri katmanı siteyi asla bloklamaz veya boş bırakmaz.
// ═══════════════════════════════════════════════════════════════════════════

import { createFileRoute } from "@tanstack/react-router";
import { cachedRead } from "@/lib/server-cache";
import {
  DEEPL_MAX_TEXTS_PER_REQUEST,
  deepLTarget,
  deepLUsage,
  translateWithDeepL,
} from "@/lib/deepl";

/** Tek istekte çevrilecek en fazla metin (kötüye kullanımı sınırlar). */
const MAX_TEXTS = 60;
/** Tek metnin en fazla uzunluğu. */
// Detay açıklamaları bölüm adlarından daha uzun olabilir. 500 karakterlik
// sınır uzun açıklamaları sessizce özgün dilde bırakıyordu; DeepL'in istek
// sınırları içinde kalacak şekilde tek metni 5000 karaktere çıkarıyoruz.
const MAX_TEXT_LENGTH = 5000;
/** İstek başına toplam karakter sınırı — tek istekle kotayı yakmak imkânsız olsun. */
const MAX_TOTAL_CHARS = 8000;

/** Önbellek ömrü: çeviri değişmez (30 gün). */
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

/** L1 bellek önbelleği — süreç ömrü boyunca yaşar. */
const memory = new Map<string, string>();

/**
 * Deterministik, KISA önbellek anahtarı (FNV-1a 32 bit + uzunluk).
 *
 * NEDEN HASH: metnin kendisi anahtar olsaydı Cache API anahtarları çok uzar ve
 * özetlerde satır sonu/özel karakter sorunları çıkardı. Uzunluk da eklenir ki
 * farklı uzunluktaki çakışmalar ayrışsın.
 */
function hashKey(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(36)}-${text.length}`;
}

export const Route = createFileRoute("/api/translate")({
  server: {
    handlers: {
      /**
       * GET — yalnızca TEŞHİS: anahtar tanımlı mı, hangi plan, kalan kota ne.
       * Panelde "kalan karakter" göstermek için kullanılabilir. Metin çevirmez,
       * bu yüzden kota harcamaz.
       */
      GET: async () => {
        const usage = await deepLUsage();
        return Response.json(
          usage.ok
            ? {
                ok: true,
                provider: "deepl",
                charactersUsed: usage.used,
                characterLimit: usage.limit,
                remaining: usage.limit - usage.used,
                cached: memory.size,
              }
            : { ok: false, provider: "deepl", reason: usage.reason },
          { headers: { "Cache-Control": "no-store" } },
        );
      },

      POST: async ({ request }) => {
        const fail = (reason: string, extra: Record<string, unknown> = {}) =>
          Response.json(
            { ok: false, reason, ...extra },
            { headers: { "Cache-Control": "no-store" } },
          );

        let body: { texts?: unknown; target?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return fail("gövde JSON değil");
        }

        const target = body.target === "en" ? "en" : "tr";
        const raw = Array.isArray(body.texts) ? body.texts : [];
        // Metinler temizlenir ve BOŞ olanlar ELENMEZ — dizinin sırası ve uzunluğu
        // istemcinin gönderdiğiyle birebir aynı kalmalı (istemci sonucu indeksle
        // eşliyor). Boş metin olduğu gibi geri döner.
        const texts = raw.map((item) => (typeof item === "string" ? item : ""));
        const filled = texts.map((item) => item.trim());

        if (filled.filter(Boolean).length === 0) {
          return Response.json(
            { ok: true, translations: texts, cached: true },
            { headers: { "Cache-Control": "no-store" } },
          );
        }
        if (texts.length > MAX_TEXTS) return fail(`en fazla ${MAX_TEXTS} metin çevrilebilir`);
        if (texts.some((item) => item.length > MAX_TEXT_LENGTH))
          return fail(`tek metin en fazla ${MAX_TEXT_LENGTH} karakter olabilir`);
        const total = filled.reduce((sum, item) => sum + item.length, 0);
        if (total > MAX_TOTAL_CHARS)
          return fail(`istek başına en fazla ${MAX_TOTAL_CHARS} karakter`);

        const prefix = `${target}:`;
        const out = [...texts];
        const misses: { index: number; text: string }[] = [];

        // ── 1) L1: süreç belleği ────────────────────────────────────────────
        for (let i = 0; i < filled.length; i += 1) {
          const text = filled[i] as string;
          if (!text) continue;
          const hit = memory.get(prefix + hashKey(text));
          if (hit !== undefined) out[i] = hit;
          else misses.push({ index: i, text });
        }

        // ── 2) L2: kalıcı sunucu önbelleği (üretimde Cache API) ─────────────
        const stillMissing: { index: number; text: string }[] = [];
        for (const miss of misses) {
          const key = `translate:${target}:${hashKey(miss.text)}`;
          try {
            const hit = await cachedRead<string | null>(key, CACHE_TTL_SECONDS, async () => null);
            if (typeof hit === "string" && hit) {
              memory.set(prefix + hashKey(miss.text), hit);
              out[miss.index] = hit;
            } else {
              stillMissing.push(miss);
            }
          } catch {
            stillMissing.push(miss);
          }
        }

        if (stillMissing.length === 0) {
          return Response.json(
            { ok: true, translations: out, cached: true },
            { headers: { "Cache-Control": "no-store" } },
          );
        }

        // ── 3) Gerçekten eksikler: DeepL (parça parça) ──────────────────────
        const targetLang = deepLTarget(target);
        let problem = "";
        for (let i = 0; i < stillMissing.length; i += DEEPL_MAX_TEXTS_PER_REQUEST) {
          const chunk = stillMissing.slice(i, i + DEEPL_MAX_TEXTS_PER_REQUEST);
          const result = await translateWithDeepL(
            chunk.map((item) => item.text),
            targetLang,
          );
          if (!result.ok) {
            problem = result.reason;
            // Yeniden denenebilir bir hata ise (hız sınırı / 5xx) tek tur daha
            // denenir; kalıcı hatada (kota, geçersiz anahtar) boşuna zorlanmaz.
            if (result.retryable && i + DEEPL_MAX_TEXTS_PER_REQUEST < stillMissing.length) {
              await new Promise((resolve) => setTimeout(resolve, 800));
            }
            break;
          }
          for (let j = 0; j < chunk.length; j += 1) {
            const item = chunk[j] as { index: number; text: string };
            const translated = result.translations[j] ?? "";
            if (!translated) continue;
            out[item.index] = translated;
            memory.set(prefix + hashKey(item.text), translated);
          }
        }

        // ── 4) Yeni çevirileri kalıcı önbelleğe yaz (ateşle-unut) ───────────
        // Yazma başarısız olsa da yanıt döner; L1 zaten ısındı. Böylece yavaş
        // bir Cache API yazımı kullanıcıyı bekletmez.
        for (const item of stillMissing) {
          const translated = out[item.index];
          if (!translated || translated === item.text) continue;
          const key = `translate:${target}:${hashKey(item.text)}`;
          void Promise.resolve()
            .then(() => cachedRead<string | null>(key, CACHE_TTL_SECONDS, async () => translated))
            .catch(() => undefined);
        }

        /**
         * Kısmi başarı da `ok:true` döner: elde edilen çeviriler gösterilir,
         * çevrilemeyenlerde İSTEMCİ orijinali kullanır (bkz. dosya başı notu).
         */
        return Response.json(
          { ok: true, translations: out, cached: false, problem: problem || undefined },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});

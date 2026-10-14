// /api/upload — R2 medya yükleme/silme (YALNIZCA ADMİN).
//
// Supabase Storage kotası patladığı için görseller Cloudflare R2'ye taşındı
// (egress ücreti SIFIR). Panelin yükleme deseni aynı kalır:
// `uploadImage(file, "posters")` → `{ key, url }`, `url` DB'ye yazılır.
//
// ═══════════════════════════════════════════════════════════════════════════
// GÜVENLİK
//  · Tarayıcı, oturumunun access_token'ını `Authorization: Bearer` ile gönderir.
//    Sunucu token'dan kullanıcıyı çözer (`getUser`) ve `user_roles`te admin
//    kaydını arar — RLS, kullanıcının kendi satırını okumasına zaten izin verir.
//    Admin değilse 403. Anon anahtar RLS'yi DELMEZ (service key yok, gerekmez).
//  · Klasör beyaz listesi + 8 MB sınır + resim/video MIME denetimi.
//  · R2 gizli anahtarları SADECE sunucuda (process.env) — tarayıcıya gitmez.
//  · Ortam: `.env` / `.dev.vars` (yerel), Pages → Settings → Variables (üretim).
//    R2_PUBLIC_URL: bucket'ın herkese açık adresi (r2.dev ya da özel alan adı).
// ═══════════════════════════════════════════════════════════════════════════
import { AwsClient } from "aws4fetch";
import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";

/**
 * Tek dosya üst sınırı.
 *
 * KULLANICI KARARI (30.09.2026): mp4 sınırı 8 MB idi ve gerçek bir video sığmıyordu
 * ("video yüklerken hata aldım"). 100 MB'a çıkarıldı: kısa bir 1080p klip rahat
 * sığar, R2'nin 10 GB'lık bedava kotası bunu kaldırır (egress zaten ücretsiz).
 * Vitrin videosunu LİNK (YouTube/Vimeo) olarak vermek istersen yükleme hiç
 * gerekmez — bkz. `lib/hero-video.ts`; o yolda sınır yok.
 */
const MAX_BYTES = 100 * 1024 * 1024;
/** Yazılabilir klasörler (anahtar başına eklenir, `..` yasaktır). */
const ALLOWED_FOLDERS = new Set(["posters", "banners", "banner-videos", "covers"]);
/** Kabul edilen içerik türleri. */
const ALLOWED_TYPES = /^(image\/(jpeg|png|webp|gif|svg\+xml)|video\/(mp4|webm))$/i;

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function r2() {
  const account = env("R2_ACCOUNT_ID");
  const accessKeyId = env("R2_ACCESS_KEY_ID");
  const secretAccessKey = env("R2_SECRET_ACCESS_KEY");
  const bucket = env("R2_BUCKET");
  const publicUrl = env("R2_PUBLIC_URL").replace(/\/+$/, "");
  if (!account || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
    throw new Error(
      "R2 yapılandırılmamış (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET / R2_PUBLIC_URL).",
    );
  }
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });
  return { client, endpoint: `https://${account}.r2.cloudflarestorage.com`, bucket, publicUrl };
}

/**
 * Oturum token'ından admin doğrular.
 *
 * DÖNÜŞ: izin verilirse `null`; yoksa **durum + AÇIK SEBEP**.
 *
 * NEDEN SEBEP (ölçüm 30.09.2026): eskiden yalnızca durum kodu dönüyordu ve eksik
 * yapılandırmada gövde "Yetkisiz." yazıyordu. Kullanıcı panelde fotoğraf eklerken
 * **500** aldı ama sebebini göremedi: gerçek neden `SUPABASE_URL` /
 * `SUPABASE_PUBLISHABLE_KEY` değerlerinin sunucu ortamında BULUNMAMASIYDI
 * (yeni Cloudflare emülasyonu bu değerleri `.env`den değil `.dev.vars`tan okur).
 * Artık hangi anahtarın eksik olduğu ve nereye yazılacağı doğrudan yazılıyor.
 */
async function adminProblem(request: Request): Promise<{ status: number; message: string } | null> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return { status: 401, message: "Oturum bulunamadı — panelden yeniden giriş yap." };
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) {
    const missing = [
      ...(!url ? ["SUPABASE_URL"] : []),
      ...(!key ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
    ];
    return {
      status: 500,
      message:
        `Sunucu yapılandırması eksik: ${missing.join(", ")}. ` +
        `Yerelde .dev.vars dosyasına, üretimde Cloudflare Pages → Settings → Variables bölümüne ekle.`,
    };
  }
  try {
    const sb = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.auth.getUser(token);
    const userId = data?.user?.id;
    if (error || !userId) return { status: 401, message: "Oturum geçersiz — yeniden giriş yap." };
    const { data: role } = await sb
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    return role ? null : { status: 403, message: "Bu hesap admin değil." };
  } catch {
    return { status: 503, message: "Kimlik doğrulanamadı (Supabase'e ulaşılamadı)." };
  }
}

/** Sunucu rotalarının ihtiyaç duyduğu ortam değişkenleri (değer DEĞİL, varlık denetimi). */
const REQUIRED_ENV = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_URL",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
] as const;

function extOf(name: string, type: string): string {
  const fromName = (name.split(".").pop() ?? "").toLowerCase().slice(0, 8);
  if (/^[a-z0-9]+$/i.test(fromName) && !/^(php|html|js|exe)$/i.test(fromName)) return fromName;
  if (type.startsWith("video/")) return "mp4";
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  if (type.includes("svg")) return "svg";
  return "jpg";
}

export const Route = createFileRoute("/api/upload")({
  server: {
    handlers: {
      /**
       * YALNIZCA GELİŞTİRME: ortam değişkenleri görünüyor mu? (DEĞER ASLA DÖNMEZ.)
       *
       * NEDEN: "500 aldım ama neden?" sorusu kör noktaydı. Dev'de bu uca bakınca
       * hangi anahtarın eksik olduğu anında görülür; üretimde 405 döner (bilgi
       * sızdırmaz).
       */
      GET: async () => {
        if (!import.meta.env.DEV) return new Response("Yöntem desteklenmiyor.", { status: 405 });
        const present = Object.fromEntries(
          REQUIRED_ENV.map((key) => [key, env(key).length > 0]),
        ) as Record<string, boolean>;
        return Response.json({
          ok: Object.values(present).every(Boolean),
          present,
          note: "Yerelde .dev.vars, üretimde Pages → Settings → Variables okunur.",
        });
      },

      POST: async ({ request }) => {
        const denied = await adminProblem(request);
        if (denied) return new Response(denied.message, { status: denied.status });
        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return new Response("Form okunamadı.", { status: 400 });
        }
        const folder = String(form.get("folder") ?? "").trim();
        const file = form.get("file");
        if (!ALLOWED_FOLDERS.has(folder)) {
          return new Response("Klasör geçersiz.", { status: 400 });
        }
        if (!(file instanceof File) || file.size === 0) {
          return new Response("Dosya yok.", { status: 400 });
        }
        if (file.size > MAX_BYTES) {
          const limitMb = Math.round(MAX_BYTES / (1024 * 1024));
          return new Response(
            `Dosya çok büyük (en fazla ${limitMb} MB). Daha büyük video için YouTube linki kullan.`,
            { status: 413 },
          );
        }
        if (!ALLOWED_TYPES.test(file.type)) {
          return new Response("Dosya türü kabul edilmiyor (resim/video).", { status: 415 });
        }
        let store: ReturnType<typeof r2>;
        try {
          store = r2();
        } catch (error) {
          return new Response(error instanceof Error ? error.message : "R2 hatası.", {
            status: 500,
          });
        }
        const key = `${folder}/${crypto.randomUUID()}.${extOf(file.name, file.type)}`;
        const put = await store.client.fetch(`${store.endpoint}/${store.bucket}/${key}`, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!put.ok) {
          return new Response(`R2 yazılamadı (${put.status}).`, { status: 502 });
        }
        return Response.json({ ok: true, key, url: `${store.publicUrl}/${key}` });
      },

      DELETE: async ({ request }) => {
        const denied = await adminProblem(request);
        if (denied) return new Response(denied.message, { status: denied.status });
        const key = (new URL(request.url).searchParams.get("key") ?? "").trim();
        if (!key || key.includes("..") || key.startsWith("/") || !/^[\w./-]+$/.test(key)) {
          return new Response("Anahtar geçersiz.", { status: 400 });
        }
        let store: ReturnType<typeof r2>;
        try {
          store = r2();
        } catch (error) {
          return new Response(error instanceof Error ? error.message : "R2 hatası.", {
            status: 500,
          });
        }
        // Klasör beyaz listesi silmede de geçerli (başka önek silinemez).
        if (!ALLOWED_FOLDERS.has(key.split("/")[0] ?? "")) {
          return new Response("Klasör geçersiz.", { status: 400 });
        }
        const del = await store.client.fetch(`${store.endpoint}/${store.bucket}/${key}`, {
          method: "DELETE",
        });
        if (!del.ok && del.status !== 404) {
          return new Response(`R2 silinemedi (${del.status}).`, { status: 502 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});

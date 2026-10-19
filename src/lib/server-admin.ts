import { createClient } from "@supabase/supabase-js";

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

/**
 * Verifies the bearer token and the admin role for server-only routes.
 * Returns null when access is allowed; otherwise returns a safe HTTP error.
 */
export async function adminProblem(
  request: Request,
): Promise<{ status: number; message: string } | null> {
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

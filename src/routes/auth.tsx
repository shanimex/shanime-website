import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "shanime | Giriş" },
      { name: "description", content: "shanime yönetim paneli girişi." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (mode === "signin") {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError("Giriş yapılamadı. E-posta veya şifre hatalı olabilir.");
        setLoading(false);
        return;
      }
      navigate({ to: "/admin" });
      return;
    }

    const { error: signUpError } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    setMessage(
      "Hesabın oluşturuldu! E-postana gelen onay bağlantısına tıkla, sonra buradan giriş yap.",
    );
    setMode("signin");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-8 shadow-2xl">
        <a href="/" className="mb-6 flex items-center justify-center">
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
        </a>
        <h1 className="text-center text-lg font-extrabold text-foreground">
          {mode === "signin" ? "Yönetim girişi" : "Hesap oluştur"}
        </h1>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-xs font-bold text-muted-foreground">
              E-posta
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-background px-4 text-base text-foreground outline-none focus:border-primary"
              placeholder="ornek@mail.com"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1 block text-xs font-bold text-muted-foreground"
            >
              Şifre
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-background px-4 text-base text-foreground outline-none focus:border-primary"
              placeholder="••••••••"
            />
          </div>
          {error && (
            <p className="rounded-xl bg-destructive/15 px-4 py-2 text-xs font-bold text-destructive">
              {error}
            </p>
          )}
          {message && (
            <p className="rounded-xl bg-secondary px-4 py-2 text-xs font-bold text-accent">
              {message}
            </p>
          )}
          <Button type="submit" className="w-full rounded-full" disabled={loading}>
            {loading ? "Lütfen bekleyin..." : mode === "signin" ? "Giriş yap" : "Kayıt ol"}
          </Button>
        </form>
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setMessage(null);
          }}
          // py-3: dokunma alani 16 px yuksekligindeydi, mobilde basilamiyordu.
          className="mt-4 w-full py-3 text-center text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
        >
          {mode === "signin" ? "Hesabın yok mu? Kayıt ol" : "Zaten hesabın var mı? Giriş yap"}
        </button>
      </div>
    </div>
  );
}

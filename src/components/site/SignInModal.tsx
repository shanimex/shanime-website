import { useEffect, useRef, useState } from "react";
import { BookOpen, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/i18n";

type SignInModalProps = {
  onClose: () => void;
  isClosing?: boolean;
  onClosed?: () => void;
};

type AuthMode = "signin" | "signup";
type ProviderMark = "google" | "anilist" | "mal";

function ProviderIcon({ provider }: { provider: ProviderMark }) {
  if (provider === "google") {
    return (
      <svg className="auth-provider-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#4285f4"
          d="M21.35 12.23c0-.76-.07-1.49-.22-2.18H12v4.13h5.24a4.48 4.48 0 0 1-1.94 2.94v2.44h3.14c1.84-1.7 2.91-4.2 2.91-7.33Z"
        />
        <path
          fill="#34a853"
          d="M12 21.5c2.63 0 4.84-.87 6.45-2.36l-3.14-2.44c-.87.58-1.98.92-3.31.92-2.54 0-4.7-1.72-5.47-4.03H3.28v2.52A9.74 9.74 0 0 0 12 21.5Z"
        />
        <path
          fill="#fbbc05"
          d="M6.53 13.59A5.85 5.85 0 0 1 6.22 12c0-.55.1-1.09.31-1.59V7.89H3.28A9.5 9.5 0 0 0 2.25 12c0 1.48.35 2.88 1.03 4.11l3.25-2.52Z"
        />
        <path
          fill="#ea4335"
          d="M12 6.38c1.44 0 2.73.5 3.75 1.48l2.81-2.81C16.84 3.48 14.63 2.5 12 2.5a9.74 9.74 0 0 0-8.72 5.39l3.25 2.52C7.3 8.1 9.46 6.38 12 6.38Z"
        />
      </svg>
    );
  }

  if (provider === "anilist") {
    return (
      <svg
        className="auth-provider-icon auth-provider-icon-stroke"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 16 3.5-8 3.5 8m-5.8-2.7h4.6" />
      </svg>
    );
  }

  return (
    <svg
      className="auth-provider-icon auth-provider-icon-stroke"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M7.8 15.8V8.2l4.2 4 4.2-4v7.6M9.8 15.8v-4.2m4.4 0v4.2" />
    </svg>
  );
}

const TURNSTILE_SITE_KEY = import.meta.env.DEV
  ? "1x00000000000000000000AA"
  : import.meta.env["VITE_TURNSTILE_SITE_KEY"] || "0x4AAAAAAFXu2Yjq_vwRR4LU";

type TurnstileApi = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
};

let turnstileScriptPromise: Promise<void> | null = null;

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-shanime-turnstile="true"]',
    );
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Turnstile failed to load")),
        {
          once: true,
        },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset["shanimeTurnstile"] = "true";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Turnstile failed to load")), {
      once: true,
    });
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function SignInModal({ onClose, isClosing = false, onClosed }: SignInModalProps) {
  const { lang, t } = useLang();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const tr = lang === "tr";
  const copy = tr
    ? {
        title: "Tekrar hoş geldin",
        subtitle: "Listen ve izleme geçmişin senkronize olsun.",
        signupTitle: "Hesabını oluştur",
        signupSubtitle: "İzlediklerini takip et, her cihazda kaldığın yerden devam et.",
        signin: "Giriş yap",
        signup: "Hesap oluştur",
        account: "HESAP",
        username: "KULLANICI ADI",
        usernamePlaceholder: "Kullanıcı adı",
        email: "Kullanıcı adı veya e-posta",
        emailLabel: "E-POSTA",
        emailSignupPlaceholder: "E-postan",
        password: "Şifre",
        emailPlaceholder: "Kullanıcı adı veya e-posta",
        passwordPlaceholder: "Şifren",
        passwordSignupPlaceholder: "En az 6 karakter",
        confirmPassword: "ŞİFRE TEKRARI",
        confirmPasswordPlaceholder: "Şifreni tekrar yaz",
        forgot: "Şifreni mi unuttun?",
        verifying: "Doğrulanıyor...",
        signInSubmit: "Giriş yap",
        signUpSubmit: "Hesap oluştur",
        continueWith: "VEYA ŞUNUNLA DEVAM ET",
        newHere: "Yeni misin?",
        createOne: "Hesap oluştur",
        already: "Zaten hesabın var mı?",
        signInHere: "Giriş yap",
        genericError: "Giriş yapılamadı. Bilgilerini kontrol edip tekrar dene.",
        signupError: "Hesap oluşturulamadı. Bilgilerini kontrol edip tekrar dene.",
        passwordMismatch: "Şifreler eşleşmiyor.",
        signupSuccess: "Hesabın oluşturuldu. E-postandaki onay bağlantısını kontrol et.",
        resetSuccess: "Şifre sıfırlama bağlantısı e-postana gönderildi.",
        providerUnavailable: "Bu giriş sağlayıcısı henüz bağlanmadı.",
      }
    : {
        title: "Welcome back",
        subtitle: "Sign in to keep your list and history in sync.",
        signupTitle: "Create your account",
        signupSubtitle: "Track what you watch and pick up on any device.",
        signin: "Sign in",
        signup: "Create account",
        account: "ACCOUNT",
        username: "USERNAME",
        usernamePlaceholder: "Username",
        email: "Username or email",
        emailLabel: "EMAIL",
        emailSignupPlaceholder: "Your email",
        password: "PASSWORD",
        emailPlaceholder: "Username or email",
        passwordPlaceholder: "Your password",
        passwordSignupPlaceholder: "At least 6 characters",
        confirmPassword: "CONFIRM PASSWORD",
        confirmPasswordPlaceholder: "Type it again",
        forgot: "Forgot password?",
        verifying: "Verifying...",
        signInSubmit: "Sign in",
        signUpSubmit: "Create account",
        continueWith: "OR CONTINUE WITH",
        newHere: "New here?",
        createOne: "Create one",
        already: "Already have an account?",
        signInHere: "Sign in",
        genericError: "Sign in failed. Check your details and try again.",
        signupError: "Account creation failed. Check your details and try again.",
        passwordMismatch: "Passwords do not match.",
        signupSuccess: "Your account was created. Check your email for the confirmation link.",
        resetSuccess: "A password reset link was sent to your email.",
        providerUnavailable: "This sign-in provider is not connected yet.",
      };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    if (!isClosing) return;
    const timeout = window.setTimeout(() => onClosed?.(), 220);
    return () => window.clearTimeout(timeout);
  }, [isClosing, onClosed]);

  useEffect(() => {
    let cancelled = false;
    if (mode !== "signup") {
      setCaptchaToken(null);
      return;
    }

    const captchaElement = captchaRef.current;
    const renderWidget = () => {
      if (cancelled || !captchaElement || !window.turnstile || widgetIdRef.current) return;
      captchaElement.replaceChildren();
      widgetIdRef.current = window.turnstile.render(captchaElement, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: "dark",
        size: "flexible",
        callback: (token: string) => setCaptchaToken(token),
        "expired-callback": () => setCaptchaToken(null),
        "error-callback": () => setCaptchaToken(null),
      });
    };

    void loadTurnstileScript()
      .then(renderWidget)
      .catch(() => {
        if (!cancelled) setCaptchaToken(null);
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
      captchaElement?.replaceChildren();
    };
  }, [mode]);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError(null);
    setMessage(null);
  };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    const cleanEmail = email.trim().toLowerCase();

    if (mode === "signup" && !import.meta.env.DEV && !captchaToken) {
      setLoading(false);
      setError(tr ? "Önce doğrulamayı tamamla." : "Complete the verification first.");
      return;
    }

    if (mode === "signup" && captchaToken) {
      const verification = await fetch("/api/turnstile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: captchaToken }),
      });
      const result = (await verification.json()) as { ok?: boolean };
      if (!verification.ok || !result.ok) {
        setLoading(false);
        setCaptchaToken(null);
        setError(copy.genericError);
        return;
      }
    }

    if (mode === "signin") {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      setLoading(false);
      if (signInError) {
        setError(copy.genericError);
        return;
      }
      onClose();
      return;
    }

    if (password !== confirmPassword) {
      setLoading(false);
      setError(copy.passwordMismatch);
      return;
    }

    const { error: signUpError } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: { data: { username: username.trim() } },
    });
    setLoading(false);
    if (signUpError) {
      setError(copy.signupError);
      return;
    }
    setMessage(copy.signupSuccess);
    setMode("signin");
    setPassword("");
  }

  async function handleForgotPassword() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError(tr ? "Önce e-posta adresini yaz." : "Enter your email first.");
      return;
    }
    setError(null);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: window.location.origin,
    });
    setMessage(resetError ? copy.genericError : copy.resetSuccess);
  }

  async function handleGoogle() {
    setError(null);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (oauthError) setError(copy.providerUnavailable);
  }

  return (
    <div
      className={`auth-modal-backdrop${isClosing ? " is-closing" : ""}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`auth-modal ${mode === "signup" ? "is-signup" : "is-signin"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
      >
        <button
          type="button"
          className="auth-modal-close"
          aria-label={t("common.closeMenu")}
          onClick={onClose}
        >
          <X size={17} aria-hidden="true" />
        </button>
        <h2 id="auth-modal-title">{mode === "signin" ? copy.title : copy.signupTitle}</h2>
        <p className="auth-modal-subtitle">
          {mode === "signin" ? copy.subtitle : copy.signupSubtitle}
        </p>

        <form className="auth-modal-form" onSubmit={handleSubmit}>
          {mode === "signup" && (
            <label>
              <span>{copy.username}</span>
              <input
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder={copy.usernamePlaceholder}
                aria-label={copy.username}
              />
            </label>
          )}
          <label>
            <span>{mode === "signin" ? copy.account : copy.emailLabel}</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={mode === "signin" ? copy.emailPlaceholder : copy.emailSignupPlaceholder}
              aria-label={mode === "signin" ? copy.email : copy.emailLabel}
            />
          </label>
          <label>
            <span>{copy.password}</span>
            <input
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={
                mode === "signin" ? copy.passwordPlaceholder : copy.passwordSignupPlaceholder
              }
              aria-label={copy.password}
            />
          </label>
          {mode === "signup" && (
            <label>
              <span>{copy.confirmPassword}</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder={copy.confirmPasswordPlaceholder}
                aria-label={copy.confirmPassword}
              />
            </label>
          )}
          {mode === "signin" && (
            <button
              type="button"
              className="auth-modal-forgot"
              onClick={() => void handleForgotPassword()}
            >
              {copy.forgot}
            </button>
          )}
          {mode === "signup" && (
            <div className="auth-captcha" aria-label={copy.verifying} ref={captchaRef} />
          )}
          {error && <p className="auth-modal-message is-error">{error}</p>}
          {message && <p className="auth-modal-message">{message}</p>}
          <button type="submit" className="auth-modal-submit" disabled={loading}>
            {loading ? copy.verifying : mode === "signin" ? copy.signInSubmit : copy.signUpSubmit}
          </button>
        </form>

        <div className="auth-modal-divider">
          <span>{copy.continueWith}</span>
        </div>
        <div className="auth-modal-providers">
          <button type="button" onClick={() => void handleGoogle()}>
            <ProviderIcon provider="google" /> <span>Google</span>
          </button>
          <button type="button" onClick={() => setError(copy.providerUnavailable)}>
            <ProviderIcon provider="anilist" /> <span>AniList</span>
          </button>
          <button type="button" onClick={() => setError(copy.providerUnavailable)}>
            <BookOpen className="auth-provider-icon" aria-hidden="true" /> <span>MAL</span>
          </button>
        </div>
        <p className="auth-modal-switch">
          {mode === "signin" ? (
            <>
              {copy.newHere}{" "}
              <button type="button" onClick={() => switchMode("signup")}>
                {copy.createOne}
              </button>
            </>
          ) : (
            <>
              {copy.already}{" "}
              <button type="button" onClick={() => switchMode("signin")}>
                {copy.signInHere}
              </button>
            </>
          )}
        </p>
      </section>
    </div>
  );
}

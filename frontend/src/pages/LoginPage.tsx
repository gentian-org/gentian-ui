import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/auth/AuthProvider";
import { loginRedirect } from "@/auth/oidc";
import { defaultBasePath } from "@/lib/device";

type LoginRouteResponse = {
  loginHint: string;
  idpHint: string | null;
  kind: "platform" | "tenant";
};

export function LoginPage() {
  const navigate = useNavigate();
  const { authDisabled, isAuthenticated, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      void navigate({ to: defaultBasePath() });
    }
  }, [isAuthenticated, isLoading, navigate]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage("");

    const trimmed = email.trim();
    if (!trimmed) {
      setErrorMessage("Enter your email address to continue.");
      return;
    }

    if (authDisabled) {
      setIsRedirecting(true);
      void navigate({ to: defaultBasePath() });
      return;
    }

    setIsRedirecting(true);
    try {
      const params = new URLSearchParams({ email: trimmed });
      const response = await fetch(`/api/v1/auth/login-route?${params.toString()}`);
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail ?? "Could not resolve your workspace.");
      }
      const route = (await response.json()) as LoginRouteResponse;
      await loginRedirect({
        returnTo: defaultBasePath(),
        loginHint: route.loginHint,
        idpHint: route.idpHint ?? undefined,
      });
    } catch (error) {
      setIsRedirecting(false);
      setErrorMessage(error instanceof Error ? error.message : "Could not initiate sign-in.");
    }
  }

  return (
    <div className="gentian-login">
      <div className="gentian-login__card" role="main">
        <img
          className="gentian-login__logo"
          src="/branding/logo.png"
          alt=""
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        <h1 className="gentian-login__title">gentian</h1>
        <p className="gentian-login__subtitle">Sign in to your workspace</p>

        <form className="gentian-login__form" onSubmit={(e) => void signIn(e)}>
          <label className="gentian-login__label" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            className="gentian-login__input"
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            placeholder="you@demo.desk.gentian.org"
            value={email}
            disabled={isRedirecting}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <button type="submit" className="gentian-login__btn" disabled={isRedirecting}>
            {isRedirecting && <span className="gentian-login__spinner" aria-hidden="true" />}
            {isRedirecting ? "Signing in…" : "Continue"}
          </button>
        </form>

        {errorMessage && (
          <p className="gentian-login__error" role="alert">
            {errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useAuth } from "@/auth/AuthProvider";
import { setAccessToken, setIdToken } from "@/auth/oidc";
import { bootstrapIdpSession, openIdpBootstrapPopup } from "@/auth/idpSession";
import { resolvePostLoginPath } from "@/lib/postLogin";
import { safeReturnTo } from "@/lib/returnTo";

export function LoginPage() {
  const navigate = useNavigate();
  const { returnTo } = useSearch({ from: "/login" });
  const postLoginPath = safeReturnTo(returnTo);
  const { authDisabled, isAuthenticated, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      void navigate({ to: postLoginPath });
    }
  }, [isAuthenticated, isLoading, navigate, postLoginPath]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage("");

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setErrorMessage("Enter your email and password.");
      return;
    }

    if (authDisabled) {
      setIsSubmitting(true);
      void navigate({ to: postLoginPath });
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, password }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { accessToken?: string; idToken?: string; detail?: string }
        | null;
      if (!response.ok || !payload?.accessToken) {
        throw new Error(payload?.detail ?? "Invalid username or password.");
      }
      setAccessToken(payload.accessToken);
      if (payload.idToken) {
        setIdToken(payload.idToken);
      }
      const idpPopup = openIdpBootstrapPopup();
      await bootstrapIdpSession(idpPopup);
      const target = returnTo
        ? postLoginPath
        : await resolvePostLoginPath(payload.accessToken);
      window.location.assign(target);
    } catch (error) {
      setIsSubmitting(false);
      setErrorMessage(error instanceof Error ? error.message : "Could not sign in.");
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
            disabled={isSubmitting}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <label className="gentian-login__label" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            className="gentian-login__input"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            disabled={isSubmitting}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          <button type="submit" className="gentian-login__btn" disabled={isSubmitting}>
            {isSubmitting && <span className="gentian-login__spinner" aria-hidden="true" />}
            {isSubmitting ? "Signing in…" : "Sign in"}
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

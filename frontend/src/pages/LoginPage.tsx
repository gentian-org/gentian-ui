import { useEffect, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { requestForgotPassword } from "@/api/account";
import { useAuth } from "@/auth/AuthProvider";
import { loginRedirect } from "@/auth/oidc";
import { safeReturnTo } from "@/lib/returnTo";

export function LoginPage() {
  const navigate = useNavigate();
  const { returnTo } = useSearch({ from: "/login" });
  const postLoginPath = safeReturnTo(returnTo);
  const { authDisabled, isAuthenticated, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      void navigate({ to: postLoginPath });
    }
  }, [isAuthenticated, isLoading, navigate, postLoginPath]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage("");

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setErrorMessage("Enter your email.");
      return;
    }

    if (authDisabled) {
      setIsSubmitting(true);
      void navigate({ to: postLoginPath });
      return;
    }

    // Ask which realm this email belongs to, then hand the browser to Keycloak.
    //
    // The password is deliberately not collected here. Posting it to the portal
    // backend, which is what this page used to do, authenticates the user without
    // the browser ever contacting Keycloak — so no SSO session cookie exists and
    // every OIDC app has to prompt again. The redirect is what creates the session
    // that app launches reuse. See gentian-os/docs/login-cleanup.md.
    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/v1/auth/login-route?email=${encodeURIComponent(trimmedEmail)}`,
      );
      const payload = (await response.json().catch(() => null)) as
        | { issuer?: string; loginHint?: string; detail?: string }
        | null;
      if (!response.ok || !payload?.issuer) {
        throw new Error(payload?.detail ?? "We do not recognise that email domain.");
      }
      await loginRedirect({
        returnTo: postLoginPath,
        issuer: payload.issuer,
        loginHint: payload.loginHint ?? trimmedEmail,
      });
    } catch (error) {
      setIsSubmitting(false);
      setErrorMessage(error instanceof Error ? error.message : "Could not sign in.");
    }
  }

  async function sendForgotPassword(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage("");
    setInfoMessage("");
    const trimmed = forgotEmail.trim();
    if (!trimmed) {
      setErrorMessage("Enter your email address.");
      return;
    }
    setIsSubmitting(true);
    try {
      await requestForgotPassword(trimmed);
      setInfoMessage("If an account exists for that email, password reset instructions were sent.");
      setShowForgotPassword(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not send reset email.");
    } finally {
      setIsSubmitting(false);
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

        <form
          className="gentian-login__form"
          onSubmit={(e) => void (showForgotPassword ? sendForgotPassword(e) : signIn(e))}
        >
          {!showForgotPassword ? (
            <>
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

              <button type="submit" className="gentian-login__btn" disabled={isSubmitting}>
                {isSubmitting && <span className="gentian-login__spinner" aria-hidden="true" />}
                {isSubmitting ? "Continuing…" : "Continue"}
              </button>

              {!authDisabled && (
                <button
                  type="button"
                  className="gentian-login__link"
                  disabled={isSubmitting}
                  onClick={() => {
                    setErrorMessage("");
                    setInfoMessage("");
                    setForgotEmail(email);
                    setShowForgotPassword(true);
                  }}
                >
                  Forgot password?
                </button>
              )}
            </>
          ) : (
            <>
              <p className="gentian-login__subtitle" style={{ marginBottom: "0.75rem" }}>
                Enter your email and we will send reset instructions if an account exists.
              </p>
              <label className="gentian-login__label" htmlFor="forgot-email">
                Email
              </label>
              <input
                id="forgot-email"
                className="gentian-login__input"
                type="email"
                autoComplete="username"
                value={forgotEmail}
                disabled={isSubmitting}
                onChange={(event) => setForgotEmail(event.target.value)}
                required
              />
              <button type="submit" className="gentian-login__btn" disabled={isSubmitting}>
                {isSubmitting ? "Sending…" : "Send reset email"}
              </button>
              <button
                type="button"
                className="gentian-login__link"
                disabled={isSubmitting}
                onClick={() => {
                  setShowForgotPassword(false);
                  setErrorMessage("");
                }}
              >
                Back to sign in
              </button>
            </>
          )}
        </form>

        {infoMessage && (
          <p className="gentian-login__info" role="status">
            {infoMessage}
          </p>
        )}

        {errorMessage && (
          <p className="gentian-login__error" role="alert">
            {errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/auth/AuthProvider";
import { defaultBasePath } from "@/lib/device";

export function LoginPage() {
  const navigate = useNavigate();
  const { login, authDisabled, isAuthenticated, isLoading } = useAuth();
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      void navigate({ to: defaultBasePath() });
    }
  }, [isAuthenticated, isLoading, navigate]);

  function signIn() {
    setErrorMessage("");
    if (authDisabled) {
      setIsRedirecting(true);
      void navigate({ to: defaultBasePath() });
      return;
    }
    try {
      setIsRedirecting(true);
      login(defaultBasePath());
    } catch {
      setIsRedirecting(false);
      setErrorMessage("Could not initiate sign-in. Please try again.");
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

        <button
          type="button"
          className="gentian-login__btn"
          disabled={isRedirecting}
          onClick={signIn}
        >
          {isRedirecting && <span className="gentian-login__spinner" aria-hidden="true" />}
          {isRedirecting ? "Signing in…" : "Sign in"}
        </button>

        {errorMessage && (
          <p className="gentian-login__error" role="alert">
            {errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}

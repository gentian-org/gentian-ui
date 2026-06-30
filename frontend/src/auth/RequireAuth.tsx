import { useEffect } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { getOidcConfig } from "@/auth/oidc";
import { loginPathWithReturnTo } from "@/lib/returnTo";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, authDisabled } = useAuth();
  const config = getOidcConfig();
  const oidcConfigured = Boolean(config.issuer && config.clientId);

  useEffect(() => {
    if (isLoading || authDisabled || isAuthenticated || !oidcConfigured) {
      return;
    }
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.replace(loginPathWithReturnTo(returnTo));
  }, [authDisabled, isAuthenticated, isLoading, oidcConfigured]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--gtn-ink-1)]/70">
        Checking session…
      </div>
    );
  }

  if (!authDisabled && !oidcConfigured) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-2 p-8 text-[var(--gtn-ink-1)]/70">
        <p className="font-medium text-[var(--gtn-ink-1)]">OIDC not configured</p>
        <p className="text-sm">
          Set <code className="text-xs">VITE_OIDC_ISSUER</code> and{" "}
          <code className="text-xs">VITE_OIDC_CLIENT_ID</code> at build time, or{" "}
          <code className="text-xs">VITE_AUTH_DISABLED=true</code> for local dev.
        </p>
      </div>
    );
  }

  if (!isAuthenticated && !authDisabled) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--gtn-ink-1)]/70">
        Redirecting to sign in…
      </div>
    );
  }

  return <>{children}</>;
}

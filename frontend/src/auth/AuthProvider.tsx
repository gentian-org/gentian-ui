import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import {
  getOidcConfig,
  handleOAuthCallback,
  isAuthenticated,
  logoutRedirect,
  nonCanonicalRedirectTarget,
} from "@/auth/oidc";
import { useSessionWatchdog } from "@/auth/useSessionWatchdog";
import { loginPathWithReturnTo } from "@/lib/returnTo";

type AuthContextValue = {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (returnTo?: string) => void;
  logout: () => void;
  authDisabled: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const config = getOidcConfig();
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    void (async () => {
      const fromCallback = await handleOAuthCallback();
      const authed = fromCallback || isAuthenticated();
      // A tenant session found on a host other than its own is walked over to
      // the right one before anything else renders — see
      // nonCanonicalRedirectTarget. Skipped right after handleOAuthCallback,
      // since that path just finished putting the token on its own canonical
      // host and the check would always be a no-op there.
      if (authed && !fromCallback) {
        const target = nonCanonicalRedirectTarget();
        if (target) {
          window.location.replace(target);
          return;
        }
      }
      setAuthenticated(authed);
      setIsLoading(false);
      if (authed) {
        await queryClient.invalidateQueries({ queryKey: ["me"] });
      }
      if (fromCallback) {
        // Fire-and-forget: the code exchange just finished entirely
        // browser-to-Keycloak (handleOAuthCallback), so this is the backend's
        // one chance to notice "a login just happened" — see backend
        // app/api/routes/auth.py, session_started().
        void apiFetch("/auth/session-started", { method: "POST" }).catch(() => {});
      }
    })();
  }, [queryClient]);

  const handleSessionExpired = useCallback(() => {
    setAuthenticated(false);
  }, []);
  useSessionWatchdog(authenticated, isLoading, handleSessionExpired);

  const login = useCallback((returnTo?: string) => {
    window.location.assign(loginPathWithReturnTo(returnTo));
  }, []);
  const logout = useCallback(() => {
    // Full-page navigation only — do not clear React auth state here or RequireAuth
    // on /desktop will immediately start a new OIDC login before Keycloak logout runs.
    logoutRedirect();
  }, []);

  const value = useMemo(
    () => ({
      isAuthenticated: authenticated,
      isLoading,
      login,
      logout,
      authDisabled: config.authDisabled,
    }),
    [authenticated, config.authDisabled, isLoading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

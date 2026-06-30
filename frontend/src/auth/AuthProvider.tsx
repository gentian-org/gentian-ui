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
import {
  getOidcConfig,
  handleOAuthCallback,
  isAuthenticated,
  logoutRedirect,
} from "@/auth/oidc";
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
      setAuthenticated(authed);
      setIsLoading(false);
      if (authed) {
        await queryClient.invalidateQueries({ queryKey: ["me"] });
      }
    })();
  }, [queryClient]);

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

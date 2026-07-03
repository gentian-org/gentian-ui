import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getAccessTokenExpiryMs,
  getOidcConfig,
  isAccessTokenExpired,
  redirectToLoginForExpiredSession,
} from "@/auth/oidc";

const TOKEN_STORAGE_KEY = "gentian.access_token";
const WATCH_INTERVAL_MS = 60_000;

/**
 * End the portal session when the access token expires and redirect to login.
 * Keeps React auth state aligned with sessionStorage so the desktop is not shown
 * with a stale session.
 */
export function useSessionWatchdog(
  authenticated: boolean,
  isLoading: boolean,
  onExpired: () => void,
): void {
  const queryClient = useQueryClient();
  const config = getOidcConfig();

  useEffect(() => {
    if (config.authDisabled || isLoading || !authenticated) {
      return;
    }

    const expire = () => {
      onExpired();
      queryClient.clear();
      redirectToLoginForExpiredSession();
    };

    const verify = (): boolean => {
      const token = sessionStorage.getItem(TOKEN_STORAGE_KEY);
      if (!token || isAccessTokenExpired(token)) {
        expire();
        return false;
      }
      return true;
    };

    if (!verify()) {
      return;
    }

    const token = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (!token) {
      return;
    }

    const expiryMs = getAccessTokenExpiryMs(token);
    let timeoutId: number | undefined;
    if (expiryMs !== null) {
      const msUntilExpiry = expiryMs - Date.now();
      if (msUntilExpiry <= 0) {
        expire();
        return;
      }
      timeoutId = window.setTimeout(expire, msUntilExpiry);
    }

    const intervalId = window.setInterval(verify, WATCH_INTERVAL_MS);
    const recheck = () => {
      verify();
    };
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("focus", recheck);

    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("focus", recheck);
    };
  }, [authenticated, config.authDisabled, isLoading, onExpired, queryClient]);
}

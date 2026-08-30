import { getAccessToken, redirectToLoginForExpiredSession } from "@/auth/oidc";

export async function fetchPortalBridgeTicket(): Promise<string | null> {
  const token = getAccessToken();
  if (!token) {
    // getAccessToken() clears an expired token and returns null, so this is
    // reached without any request being made. Returning null alone left the
    // caller to report a dead end ("Try signing in again") while the user had
    // no way to act on it but reload by hand. Send them to login, as the
    // OpenProject bridge already does.
    redirectToLoginForExpiredSession();
    return null;
  }

  const response = await fetch("/api/v1/session/bridge/ticket", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401) {
    // The token was live enough to send but the session is gone server-side.
    redirectToLoginForExpiredSession();
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as { ticket?: string } | null;
  return payload?.ticket ?? null;
}

export function portalBridgeLaunchUrl(
  appOrigin: string,
  ticket: string,
  open?: string | null,
  app?: string | null,
): string {
  const url = new URL("/portal-sso.html", appOrigin);
  url.searchParams.set("t", ticket);
  if (open) {
    url.searchParams.set("open", open);
  }
  if (app) {
    url.searchParams.set("app", app);
  }
  return url.toString();
}

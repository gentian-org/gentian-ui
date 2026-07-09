import { getAccessToken } from "@/auth/oidc";

export async function fetchPortalBridgeTicket(): Promise<string | null> {
  const token = getAccessToken();
  if (!token) {
    return null;
  }

  const response = await fetch("/api/v1/session/bridge/ticket", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

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

import { getAccessToken } from "@/auth/oidc";

export async function fetchOpenprojectBridgeTicket(): Promise<string | null> {
  const token = getAccessToken();
  if (!token) {
    return null;
  }

  const response = await fetch("/api/v1/session/openproject-bridge/ticket", {
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

export function openprojectBridgeLaunchUrl(projectsOrigin: string, ticket: string): string {
  const url = new URL("/openproject-portal-sso.html", projectsOrigin);
  url.searchParams.set("t", ticket);
  return url.toString();
}

import { getAccessToken, redirectToLoginForExpiredSession } from "@/auth/oidc";

export async function fetchOpenprojectBridgeTicket(): Promise<string | null> {
  const token = getAccessToken();
  if (!token) {
    redirectToLoginForExpiredSession();
    return null;
  }

  const response = await fetch("/api/v1/session/openproject-bridge/ticket", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401) {
    redirectToLoginForExpiredSession();
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as { ticket?: string } | null;
  return payload?.ticket ?? null;
}

export function openprojectBridgeLaunchUrl(projectsOrigin: string, ticket: string): string {
  const url = new URL("/gentian-portal-bridge", projectsOrigin);
  url.searchParams.set("t", ticket);
  return url.toString();
}

import { getAccessToken } from "@/auth/oidc";

export async function fetchNextcloudBridgeTicket(): Promise<string | null> {
  const token = getAccessToken();
  if (!token) {
    return null;
  }

  const response = await fetch("/api/v1/session/nextcloud-bridge/ticket", {
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

export function nextcloudBridgeLaunchUrl(
  cloudOrigin: string,
  ticket: string,
  open?: string | null,
): string {
  const url = new URL("/nextcloud-portal-sso.html", cloudOrigin);
  url.searchParams.set("t", ticket);
  // Document-type intent (document|spreadsheet|presentation) from the tile's
  // linkSuffix; the bridge opens the matching Collabora file instead of Files.
  if (open) {
    url.searchParams.set("open", open);
  }
  return url.toString();
}

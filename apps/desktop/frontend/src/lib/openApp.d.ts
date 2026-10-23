/** The types of `openApp.js`; the reasons are written there. */

export const OPEN_APP: string;
export const OPENED: string;
export function openAppRequest<A extends { id: string; title: string; launchUrl?: string | null }>(
  event: { origin: string; data: unknown },
  apps: A[],
): { app: A; url: string } | null;

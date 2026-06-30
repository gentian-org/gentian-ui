import type { MeResponse } from "@/api/client";
import { defaultBasePath } from "@/lib/device";

/** Resolve shell entry path after password login (admins always use desktop Admin Console). */
export async function resolvePostLoginPath(accessToken: string): Promise<"/desktop" | "/mobile"> {
  try {
    const response = await fetch("/api/v1/session/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      return defaultBasePath();
    }
    const me = (await response.json()) as MeResponse;
    if (me.isTenantAdmin || me.isPlatformAdmin) {
      return "/desktop";
    }
  } catch {
    // Fall back to device-based routing.
  }
  return defaultBasePath();
}

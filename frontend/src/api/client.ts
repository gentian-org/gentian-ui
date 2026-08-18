import { getAccessToken, redirectToLoginForExpiredSession } from "@/auth/oidc";

const API_BASE = "/api/v1";

/**
 * Paths whose 401 means "the upstream refused this token", not "your portal
 * session expired".
 *
 * The credential manager exchanges the caller's token with OpenBao and answers
 * 401 when that exchange fails — a wrong audience, a group matching no role, an
 * auth backend that does not exist yet. Treating that as an expired session
 * logged the operator out mid-click and destroyed the one message that said
 * what was actually wrong.
 */
const UPSTREAM_AUTH_PATHS = ["/credentials"];

function isUpstreamAuth(path: string): boolean {
  return UPSTREAM_AUTH_PATHS.some(
    (p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`),
  );
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail) {
        detail = `: ${body.detail}`;
      }
    } catch {
      // Response body is not JSON.
    }
    if (response.status === 401 && isUpstreamAuth(path)) {
      throw new Error(
        `Not authorised by the credential manager${detail}. Your portal session is fine — ` +
          `OpenBao refused the token. Check that you are in the cluster-admin group, and that ` +
          `this cluster's OIDC auth backend exists.`,
      );
    }
    if (response.status === 401 && token) {
      redirectToLoginForExpiredSession();
    }
    throw new Error(`API ${path} failed: ${response.status}${detail}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

export type MeResponse = {
  sub: string;
  username: string;
  name?: string;
  email?: string;
  tenant?: string;
  groups?: string[];
  isPlatformAdmin?: boolean;
  isTenantAdmin?: boolean;
  shellApps?: ShellApp[];
};

export type ShellApp = {
  id: string;
  title: string;
  icon: string;
  launchUrl: string | null;
  linkTarget?: string | null;
  authMode?: string | null;
  builtin?: boolean;
};

export type AppsResponse = {
  apps: ShellApp[];
};

export type PrefsResponse = {
  base: string | null;
  theme: unknown;
  hasBackground: boolean;
  backgroundUrl: string | null;
  customPrefs?: Record<string, any>;
};

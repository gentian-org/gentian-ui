import { getAccessToken, isEdgeSession, redirectToLoginForExpiredSession } from "@/auth/oidc";

const API_BASE = "/api/v1";

/** Thrown by apiFetch on any non-2xx response. */
export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
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
      const body = (await response.json()) as { detail?: unknown; error?: unknown };
      if (typeof body.detail === "string" && body.detail) {
        detail = `: ${body.detail}`;
      } else if (typeof body.error === "string" && body.error) {
        // A service's own answer, relayed verbatim rather than translated
        // into FastAPI's {"detail": ...}: the usher writes its errors under
        // this key.
        detail = `: ${body.error}`;
      }
    } catch {
      // Response body is not JSON.
    }
    if (response.status === 401 && (token || isEdgeSession())) {
      redirectToLoginForExpiredSession();
    }
    throw new ApiError(`API ${path} failed: ${response.status}${detail}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  if (isEdgeSession() && (response.headers.get("content-type") ?? "").includes("text/html")) {
    // The edge session ended between two requests: what came back is the
    // sign-in page, not an answer. Reload, and the edge signs in silently.
    redirectToLoginForExpiredSession();
    throw new ApiError(`API ${path}: the edge session has ended`);
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
  /** The app asks to be opened hidden at desktop mount; see gentianos.io/portal-preopen. */
  preopen?: boolean;
  builtin?: boolean;
};

/** A tile this person may open, as the usher answered for them. */
export type ClusterTile = {
  name: string;
  /** The label, and the fallback for a locale that has no translation. */
  displayName: string;
  /**
   * Translations of the label, keyed by locale ("de_DE"). Optional: a
   * catalogue with none renders from displayName alone.
   */
  displayNames?: Record<string, string>;
  description: string;
  url: string;
  icon: string;
};

export type ClusterTilesResponse = {
  tiles: ClusterTile[];
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
  /**
   * The tenant's own language, ISO 639-1. What this person sees until they
   * choose one, or until a settings template chooses for them — a template
   * carries `language` in customPrefs like any other preference, so applying
   * one wins over this by simply being present.
   */
  tenantLanguage?: string | null;
};

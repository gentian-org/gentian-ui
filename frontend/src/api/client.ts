import { getAccessToken } from "@/auth/oidc";

const API_BASE = "/api/v1";

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
    throw new Error(`API ${path} failed: ${response.status}`);
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
};

export type ShellApp = {
  id: string;
  title: string;
  icon: string;
  launchUrl: string | null;
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
};

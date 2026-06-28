const API_BASE = "/api/v1";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`API ${path} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export type MeResponse = {
  sub: string;
  username: string;
  name?: string;
  email?: string;
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

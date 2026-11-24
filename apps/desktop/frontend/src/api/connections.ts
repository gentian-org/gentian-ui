import { getAccessToken } from "@/auth/oidc";

const API_BASE = "/api/v1/account/connections";

/** A service outside the workspace the person can sign in to. */
export type Connection = {
  name: string;
  service: string;
  connected: boolean;
};

export type Connections = {
  /** False where the workspace has no liaison: no app names such a service. */
  available: boolean;
  connections: Connection[];
};

async function connectionsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers, cache: "no-store" });
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: string; detail?: string };
      detail = body.error ?? body.detail ?? "";
    } catch {
      // ignore
    }
    throw new Error(detail || `Request failed (${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function fetchConnections() {
  return connectionsFetch<Connections>("");
}

/** Starts the sign-in at the service: answers where to send the person. */
export function startConnection(name: string) {
  return connectionsFetch<{ url: string }>(`/${encodeURIComponent(name)}/connect`, {
    method: "POST",
  });
}

export function endConnection(name: string) {
  return connectionsFetch<void>(`/${encodeURIComponent(name)}/disconnect`, { method: "POST" });
}

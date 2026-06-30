import { getAccessToken } from "@/auth/oidc";

const API_BASE = "/api/v1";

export type AccountProfile = {
  email: string | null;
  firstName: string;
  lastName: string;
  username: string | null;
  totpConfigured: boolean;
  totpPending: boolean;
};

export type AccountSession = {
  id: string | null;
  ipAddress: string | null;
  started: number | null;
  lastAccess: number | null;
  current: boolean;
  clients: Array<{ clientName?: string }>;
};

async function accountFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (init?.body && !(init.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) {
        detail = `: ${body.detail}`;
      }
    } catch {
      // ignore
    }
    throw new Error(`Account request failed${detail}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export function fetchAccountProfile() {
  return accountFetch<AccountProfile>("/account/");
}

export function updateAccountProfile(body: { firstName?: string; lastName?: string }) {
  return accountFetch<AccountProfile>("/account/profile", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function changeAccountPassword(currentPassword: string, newPassword: string) {
  return accountFetch<void>("/account/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export function fetchAccountSessions() {
  return accountFetch<AccountSession[]>("/account/sessions");
}

export function revokeAccountSession(sessionId: string) {
  return accountFetch<void>(`/account/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}

export function revokeAllAccountSessions() {
  return accountFetch<void>("/account/sessions/revoke-all", { method: "POST" });
}

export function requestAccountTotp() {
  return accountFetch<void>("/account/totp/request", { method: "POST" });
}

export async function requestForgotPassword(email: string) {
  const response = await fetch(`${API_BASE}/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok && response.status !== 204) {
    throw new Error("Could not send password reset email");
  }
}

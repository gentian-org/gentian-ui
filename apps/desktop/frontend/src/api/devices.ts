import { getAccessToken } from "@/auth/oidc";

const API_BASE = "/api/v1/account/devices";

/** A way at the tenant's door a device password may be made for. */
export type DoorWay = {
  bridge: string;
  name: string;
  protocol: string;
  app: string;
};

export type Door = {
  host: string;
  ways: DoorWay[];
};

export type DevicePassword = {
  id: string;
  name: string;
  ways: string[];
  createdAt: string;
  lastUsedAt?: string;
};

export type NewDevicePassword = DevicePassword & {
  username: string;
  password: string;
};

/**
 * A refusal, with whether it asks for a fresh sign-in: the registrar makes a
 * device password only shortly after one, and says so with the step-up
 * challenge of RFC 9470.
 */
export class DevicesError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly signInAgain: boolean,
  ) {
    super(message);
  }
}

async function devicesFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body) {
    headers["Content-Type"] = "application/json";
  }
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
    const challenge = response.headers.get("WWW-Authenticate") ?? "";
    throw new DevicesError(
      detail || `Request failed (${response.status})`,
      response.status,
      response.status === 401 && challenge.includes("insufficient_user_authentication"),
    );
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function fetchDoor() {
  return devicesFetch<Door>("/door");
}

export async function fetchDevicePasswords() {
  const body = await devicesFetch<{ devicePasswords: DevicePassword[] }>("");
  return body.devicePasswords ?? [];
}

export function createDevicePassword(name: string, ways: string[]) {
  return devicesFetch<NewDevicePassword>("", {
    method: "POST",
    body: JSON.stringify({ name, ways }),
  });
}

export function revokeDevicePassword(id: string) {
  return devicesFetch<void>(`/${encodeURIComponent(id)}`, { method: "DELETE" });
}

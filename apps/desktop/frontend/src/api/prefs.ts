import { getAccessToken } from "@/auth/oidc";
import { apiFetch, type PrefsResponse } from "@/api/client";
import { personTilePath } from "@/lib/tiles";

const API_BASE = "/api/v1";

export function fetchPrefs() {
  return apiFetch<PrefsResponse>("/prefs/");
}

export async function uploadBackground(file: File): Promise<void> {
  const token = getAccessToken();
  const form = new FormData();
  form.append("file", file);
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${API_BASE}/prefs/background`, {
    method: "PUT",
    headers,
    body: form,
  });
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
    throw new Error(`Upload failed${detail}`);
  }
}

/**
 * Keeps a picture this person chose for one of their tiles, and answers the
 * address the desktop draws it from. The bytes go as they are, under their
 * own type; the API takes a PNG, JPEG or WebP of at most 1 MiB and refuses
 * anything else, an SVG included.
 */
export async function uploadPersonTile(tileId: string, file: File): Promise<string> {
  const token = getAccessToken();
  const headers: Record<string, string> = { "Content-Type": file.type };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${API_BASE}${personTilePath(tileId)}`, {
    method: "PUT",
    headers,
    body: file,
  });
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
    throw new Error(`Upload failed${detail}`);
  }
  const body = (await response.json()) as { url: string };
  return body.url;
}

export async function deletePersonTile(tileId: string): Promise<void> {
  await apiFetch<void>(personTilePath(tileId), { method: "DELETE" });
}

export async function deleteBackground(): Promise<void> {
  await apiFetch<void>("/prefs/background", { method: "DELETE" });
}

export async function fetchBackgroundBlob(): Promise<Blob> {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${API_BASE}/prefs/background`, { headers });
  if (!response.ok) {
    throw new Error("Could not load background image");
  }
  return response.blob();
}

export async function savePrefs(data: Record<string, any>): Promise<void> {
  await apiFetch<void>("/prefs/", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export type SettingsTemplate = {
  id: string;
  name: string;
  hasBackground: boolean;
  prefs_json: Record<string, any>;
};

export function fetchTemplates() {
  return apiFetch<SettingsTemplate[]>("/prefs/templates");
}

export function createTemplate(name: string, sourceUserSub: string) {
  return apiFetch<SettingsTemplate>("/prefs/templates", {
    method: "POST",
    body: JSON.stringify({ name, source_user_sub: sourceUserSub }),
  });
}

export function deleteTemplate(id: string) {
  return apiFetch<void>(`/prefs/templates/${id}`, {
    method: "DELETE",
  });
}

export function applyTemplate(templateId: string, targetUserSub: string) {
  return apiFetch<void>(`/prefs/templates/${templateId}/apply`, {
    method: "POST",
    body: JSON.stringify({ target_user_sub: targetUserSub }),
  });
}

export function checkIframeEmbeddable(url: string) {
  return apiFetch<{ embeddable: boolean }>(`/prefs/check-iframe?url=${encodeURIComponent(url)}`);
}

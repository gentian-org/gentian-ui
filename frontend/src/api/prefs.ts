import { getAccessToken } from "@/auth/oidc";
import { apiFetch, type PrefsResponse } from "@/api/client";

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

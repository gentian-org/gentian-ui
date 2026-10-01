import { apiFetch } from "@/api/client";

export type NotificationSeverity = "info" | "warning" | "critical";

export type NotificationAudience = {
  scope: "platform" | "tenant";
  tenant?: string | null;
  groups: string[];
};

export type AdminNotification = {
  id: string;
  publishedAt: number;
  title: string;
  body: string;
  severity: NotificationSeverity;
  audience: NotificationAudience;
  publisher: string;
  tenant: string;
  linkUrl?: string | null;
  linkLabel?: string | null;
  expiresAt?: number | null;
  cloudEvent: Record<string, unknown>;
};

export type InboxNotification = Omit<AdminNotification, "cloudEvent">;

export function fetchNotificationInbox() {
  return apiFetch<InboxNotification[]>("/notifications/inbox");
}

export function dismissInboxNotification(id: string) {
  return apiFetch<void>(`/notifications/${id}/dismiss`, { method: "POST" });
}

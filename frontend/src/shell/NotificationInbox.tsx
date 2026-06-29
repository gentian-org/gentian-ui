import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { dismissInboxNotification, fetchNotificationInbox, type InboxNotification } from "@/api/notifications";
import { BellIcon, TrayButton } from "@/shell/TrayButton";

function severityClass(severity: InboxNotification["severity"]) {
  if (severity === "critical") {
    return "notification-inbox__item--critical";
  }
  if (severity === "warning") {
    return "notification-inbox__item--warning";
  }
  return "";
}

function formatTime(epochMs: number) {
  return new Date(epochMs).toLocaleString();
}

export function NotificationInbox() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const inboxQuery = useQuery({
    queryKey: ["notifications", "inbox"],
    queryFn: () => fetchNotificationInbox(),
    refetchInterval: 60_000,
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => dismissInboxNotification(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notifications", "inbox"] });
    },
  });

  const items = inboxQuery.data ?? [];
  const count = items.length;

  return (
    <div className="notification-inbox">
      <TrayButton
        label={count ? `Notifications (${count} unread)` : "Notifications"}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="notification-inbox__bell">
          <BellIcon />
          {count > 0 && <span className="notification-inbox__badge">{count > 9 ? "9+" : count}</span>}
        </span>
      </TrayButton>

      {open && (
        <div className="notification-inbox__panel" role="dialog" aria-label="Notifications">
          <div className="notification-inbox__header">
            <strong>Notifications</strong>
            <button
              type="button"
              className="notification-inbox__refresh"
              onClick={() => inboxQuery.refetch()}
            >
              Refresh
            </button>
          </div>
          {inboxQuery.isLoading ? (
            <p className="notification-inbox__empty">Loading…</p>
          ) : items.length === 0 ? (
            <p className="notification-inbox__empty">No notifications.</p>
          ) : (
            <ul className="notification-inbox__list">
              {items.map((item) => (
                <li key={item.id} className={`notification-inbox__item ${severityClass(item.severity)}`}>
                  <div className="notification-inbox__meta">
                    <span>{item.severity}</span>
                    <span>{formatTime(item.publishedAt)}</span>
                  </div>
                  <p className="notification-inbox__title">{item.title}</p>
                  <p className="notification-inbox__body">{item.body}</p>
                  {item.linkUrl && (
                    <a
                      className="notification-inbox__link"
                      href={item.linkUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.linkLabel || "Open link"}
                    </a>
                  )}
                  <button
                    type="button"
                    className="notification-inbox__dismiss"
                    onClick={() => dismissMutation.mutate(item.id)}
                    disabled={dismissMutation.isPending}
                  >
                    Dismiss
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

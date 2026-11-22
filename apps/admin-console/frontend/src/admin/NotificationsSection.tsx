import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  fetchNotifications,
  fetchPositions,
  publishNotification,
  SHIPPED_POSITIONS,
  type NotificationAudience,
  type NotificationSeverity,
  type TenantPosition,
} from "@/api/admin";
import { positionLabel } from "./positionLabels";
import "./admin.css";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "@/lib/format";

type NotificationsSectionProps = {
  tenant: string;
  isPlatformAdmin: boolean;
};

const SEVERITY_OPTIONS: Array<{ value: NotificationSeverity; label: string }> = [
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "critical", label: "Critical" },
];

function formatPublishedAt(epochMs: number) {
  if (!epochMs) {
    return "—";
  }
  return formatDateTime(epochMs);
}

/**
 * Who a published notice was for. A notice that names no position is for
 * every person of the tenant; one that names positions is for their holders.
 */
export function audienceLabel(audience: NotificationAudience, own: TenantPosition[], t: TFunction) {
  if (audience.scope === "platform") {
    return t("notifications.platformAllUsers");
  }
  const positions = audience.positions ?? [];
  if (positions.length === 0) {
    return t("notifications.everyPerson");
  }
  return positions.map((name) => positionLabel(t, name, own)).join(", ");
}

export function NotificationsSection({ tenant, isPlatformAdmin }: NotificationsSectionProps) {
  const { t } = useTranslation();

  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState<NotificationSeverity>("info");
  const [scope, setScope] = useState<"tenant" | "platform">("tenant");
  const [selected, setSelected] = useState<string[]>([]);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const positionsQuery = useQuery({
    queryKey: ["admin", "positions"],
    queryFn: () => fetchPositions(),
  });

  const notificationsQuery = useQuery({
    queryKey: ["admin", "notifications", tenant],
    queryFn: () => fetchNotifications(tenant),
  });

  const publishMutation = useMutation({
    mutationFn: () =>
      publishNotification(
        {
          title,
          body,
          severity,
          audience: {
            scope,
            tenant: scope === "tenant" ? tenant : undefined,
            positions: scope === "tenant" ? selected : [],
          },
          linkUrl: linkUrl || undefined,
          linkLabel: linkLabel || undefined,
        },
        tenant,
      ),
    onSuccess: async () => {
      setError(null);
      setSuccess(t("notifications.published"));
      setTitle("");
      setBody("");
      setLinkUrl("");
      setLinkLabel("");
      setSelected([]);
      await queryClient.invalidateQueries({ queryKey: ["admin", "notifications", tenant] });
      await queryClient.invalidateQueries({ queryKey: ["notifications", "inbox"] });
    },
    onError: (err: Error) => {
      setSuccess(null);
      setError(err.message);
    },
  });

  const own = positionsQuery.data?.positions ?? [];
  // The three every tenant has, then the tenant's own.
  const choices = [...SHIPPED_POSITIONS, ...own.map((p) => p.name)];
  const notifications = notificationsQuery.data ?? [];
  // A list that could not be read is said to be unreadable. Drawn as empty it
  // would say nothing was ever published, or that the tenant has no positions
  // of its own.
  const loadError = notificationsQuery.isError
    ? t("notifications.couldNotLoad", { reason: (notificationsQuery.error as Error).message })
    : positionsQuery.isError
      ? t("notifications.positionsCouldNotLoad", { reason: (positionsQuery.error as Error).message })
      : null;

  const toggle = (name: string) => {
    setSelected((current) => (current.includes(name) ? current.filter((n) => n !== name) : [...current, name]));
  };

  return (
    <section>
      <div className="admin-console__toolbar">
        <h2 className="admin-console__section-title">
          {t("notifications.notifications")}</h2>
        <button
          type="button"
          className="admin-console__btn"
          onClick={() => notificationsQuery.refetch()}
        >
          {t("notifications.refresh")}</button>
      </div>

      <p className="admin-console__hint" style={{ marginBottom: "1rem" }}>
        {t("notifications.publishScopedBroadcastsToWorkspace")}</p>

      {error && <p className="admin-console__error">{error}</p>}
      {loadError && <p className="admin-console__error">{loadError}</p>}
      {success && <p className="admin-console__success">{success}</p>}

      <form
        className="admin-console__form"
        onSubmit={(event) => {
          event.preventDefault();
          publishMutation.mutate();
        }}
      >
        <label className="admin-console__field">
          <span>{t("notifications.title")}</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={512}
          />
        </label>

        <label className="admin-console__field">
          <span>{t("notifications.message")}</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            required
            maxLength={4000}
            rows={4}
          />
        </label>

        <div className="admin-console__field-row">
          <label className="admin-console__field">
            <span>{t("notifications.severity")}</span>
            <select
              value={severity}
              onChange={(event) => setSeverity(event.target.value as NotificationSeverity)}
            >
              {SEVERITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="admin-console__field">
            <span>{t("notifications.audience")}</span>
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as "tenant" | "platform")}
            >
              <option value="tenant">{t("notifications.tenantPositions")}</option>
              {isPlatformAdmin && <option value="platform">{t("notifications.platformAllUsers")}</option>}
            </select>
          </label>
        </div>

        {scope === "tenant" && (
          <fieldset className="admin-console__fieldset">
            <legend>{t("notifications.targetPositionsEmptyAllTenant")}</legend>
            <div className="admin-console__checkbox-grid">
              {choices.map((name) => (
                <label key={name} className="admin-console__checkbox">
                  <input type="checkbox" checked={selected.includes(name)} onChange={() => toggle(name)} />
                  <span>{positionLabel(t, name, own)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="admin-console__field-row">
          <label className="admin-console__field">
            <span>{t("notifications.linkUrlOptional")}</span>
            <input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} />
          </label>
          <label className="admin-console__field">
            <span>{t("notifications.linkLabelOptional")}</span>
            <input value={linkLabel} onChange={(event) => setLinkLabel(event.target.value)} />
          </label>
        </div>

        <button
          type="submit"
          className="admin-console__btn admin-console__btn--primary"
          disabled={publishMutation.isPending || !title.trim() || !body.trim()}
        >
          {publishMutation.isPending ? "Publishing…" : t("notifications.publishNotification")}
        </button>
      </form>

      <h3 className="admin-console__subtitle" style={{ marginTop: "2rem" }}>
        {t("notifications.published")}</h3>
      {notifications.length === 0 ? (
        <p className="admin-console__hint">{t("notifications.noNotificationsPublishedForThis")}</p>
      ) : (
        <table className="admin-console__table">
          <thead>
            <tr>
              <th>{t("notifications.published2")}</th>
              <th>{t("notifications.title2")}</th>
              <th>{t("notifications.severity2")}</th>
              <th>{t("notifications.audience2")}</th>
              <th>{t("notifications.publisher")}</th>
            </tr>
          </thead>
          <tbody>
            {notifications.map((notification) => (
              <tr key={notification.id}>
                <td>{formatPublishedAt(notification.publishedAt)}</td>
                <td>
                  <strong>{notification.title}</strong>
                  <div className="admin-console__mono" style={{ marginTop: "0.25rem" }}>
                    {notification.body}
                  </div>
                </td>
                <td>{notification.severity}</td>
                <td>{audienceLabel(notification.audience, own, t)}</td>
                <td>{notification.publisher}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

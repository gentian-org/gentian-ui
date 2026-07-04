import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  inviteMember,
  type AdminGroup,
} from "@/api/admin";
import { apiFetch, type MeResponse, type ShellApp } from "@/api/client";
import "./admin.css";

type InvitationsSectionProps = {
  tenant: string;
  privilegeGroups: AdminGroup[];
  appEntitlementGroups: AdminGroup[];
  customGroups: AdminGroup[];
};

/** Extract the app-id slug from a group name like `...:app:xwiki` → `xwiki` */
function appIdFromGroup(name: string): string | null {
  const m = name.match(/:app:([^:]+)$/);
  return m ? m[1] : null;
}

/** Human-readable label from a full group name. */
function groupLabel(name: string): string {
  if (name.endsWith(":app-admins")) return "App Admin";
  const appMatch = name.match(/:app:([^:]+)$/);
  if (appMatch) return appMatch[1];
  return name;
}

/** A single labelled section block inside the invite form. */
function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="admin-console__invite-section">
      <div className="admin-console__invite-section-label">{title}</div>
      <div className="admin-console__invite-section-body">{children}</div>
    </div>
  );
}

/** One toggle pill with an optional tooltip shown on hover. */
function TogglePill({
  label,
  active,
  onToggle,
  tooltip,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
  tooltip?: string;
}) {
  return (
    <button
      type="button"
      title={tooltip}
      className={`admin-console__toggle${active ? " admin-console__toggle--on" : ""}`}
      onClick={onToggle}
    >
      {label}
    </button>
  );
}

export function InvitationsSection({
  tenant,
  privilegeGroups,
  appEntitlementGroups,
  customGroups,
}: InvitationsSectionProps) {
  const queryClient = useQueryClient();

  // ── Derive installed app IDs ──────────────────────────────────────────────
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<MeResponse>("/session/me"),
    staleTime: Infinity,
  });
  const shellApps: ShellApp[] = meQuery.data?.shellApps ?? [];
  const installedAppIds: Set<string> | null =
    shellApps.length > 0 ? new Set(shellApps.map((a) => a.id)) : null;

  // Only show entitlement groups for currently installed apps.
  const visibleAppGroups =
    installedAppIds !== null
      ? appEntitlementGroups.filter((g) => {
          const appId = appIdFromGroup(g.name);
          return appId !== null && installedAppIds.has(appId);
        })
      : appEntitlementGroups;

  // ── Default group selection: all app entitlement groups ON, others OFF ────
  const defaultAppGroupIds = () => visibleAppGroups.map((g) => g.id);

  const [form, setForm] = useState({
    email: "",
    inviteEmail: "",
    firstName: "",
    lastName: "",
    appGroupIds: defaultAppGroupIds(),   // installed-app toggles (default ON)
    adminGroupIds: [] as string[],        // privilege toggles (default OFF)
    requireTotp: false,                   // requirements (default OFF)
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Re-sync app defaults once shellApps load.
  useEffect(() => {
    setForm((prev) => ({ ...prev, appGroupIds: defaultAppGroupIds() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installedAppIds]);

  const toggleId = (ids: string[], id: string) =>
    ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

  const inviteMutation = useMutation({
    mutationFn: () =>
      inviteMember(
        {
          email: form.email,
          inviteEmail: form.inviteEmail || undefined,
          firstName: form.firstName || undefined,
          lastName: form.lastName || undefined,
          groupIds: [...form.appGroupIds, ...form.adminGroupIds],
          requireTotp: form.requireTotp,
        },
        tenant,
      ),
    onSuccess: async () => {
      setForm({
        email: "",
        inviteEmail: "",
        firstName: "",
        lastName: "",
        appGroupIds: defaultAppGroupIds(),
        adminGroupIds: [],
        requireTotp: false,
      });
      setError(null);
      setSuccess("Invite sent.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
    },
    onError: (err: Error) => {
      setSuccess(null);
      setError(err.message);
    },
  });

  return (
    <section>
      <div className="admin-console__toolbar">
        <h2 className="admin-console__title" style={{ fontSize: "1.125rem" }}>
          Invite member
        </h2>
      </div>

      <form
        className="admin-console__form admin-console__form--invite"
        onSubmit={(e) => {
          e.preventDefault();
          setSuccess(null);
          inviteMutation.mutate();
        }}
      >
        {/* ── Identity fields ──────────────────────────────────────────── */}
        <div className="admin-console__field-row">
          <div className="admin-console__field">
            <label htmlFor="inv-email">Login email</label>
            <input
              id="inv-email"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
            />
          </div>
          <div className="admin-console__field">
            <label htmlFor="inv-invite-email">Invite email (optional)</label>
            <input
              id="inv-invite-email"
              type="email"
              value={form.inviteEmail}
              onChange={(e) => setForm((p) => ({ ...p, inviteEmail: e.target.value }))}
              placeholder="Personal inbox for the invite link"
            />
          </div>
          <div className="admin-console__field">
            <label htmlFor="inv-first">First name</label>
            <input
              id="inv-first"
              value={form.firstName}
              onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))}
            />
          </div>
          <div className="admin-console__field">
            <label htmlFor="inv-last">Last name</label>
            <input
              id="inv-last"
              value={form.lastName}
              onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))}
            />
          </div>
        </div>

        {/* ── Rights ───────────────────────────────────────────────────── */}
        <FormSection title="Rights">
          {privilegeGroups.map((g) => (
            <TogglePill
              key={g.id}
              label="App Admin"
              active={form.adminGroupIds.includes(g.id)}
              onToggle={() =>
                setForm((p) => ({ ...p, adminGroupIds: toggleId(p.adminGroupIds, g.id) }))
              }
              tooltip="Grants administrator access to a specific application. App admins can manage app-level settings and users within that app."
            />
          ))}
          {privilegeGroups.length === 0 && (
            <span style={{ fontSize: "0.8125rem", color: "var(--gtn-ink-4)" }}>
              No privilege groups defined.
            </span>
          )}
        </FormSection>

        {/* ── Apps ─────────────────────────────────────────────────────── */}
        <FormSection title="Apps">
          {visibleAppGroups.length === 0 ? (
            <span style={{ fontSize: "0.8125rem", color: "var(--gtn-ink-4)" }}>
              {installedAppIds === null ? "Loading apps…" : "No installed apps found."}
            </span>
          ) : (
            visibleAppGroups.map((g) => {
              const appId = appIdFromGroup(g.name) ?? groupLabel(g.name);
              return (
                <TogglePill
                  key={g.id}
                  label={appId}
                  active={form.appGroupIds.includes(g.id)}
                  onToggle={() =>
                    setForm((p) => ({ ...p, appGroupIds: toggleId(p.appGroupIds, g.id) }))
                  }
                  tooltip={`Grant access to the "${appId}" application. When active, the member will be added to the app's entitlement group and can sign in to ${appId}.`}
                />
              );
            })
          )}
        </FormSection>

        {/* ── Custom groups (if any) ────────────────────────────────────── */}
        {customGroups.length > 0 && (
          <FormSection title="Custom groups">
            {customGroups.map((g) => (
              <TogglePill
                key={g.id}
                label={groupLabel(g.name)}
                active={form.adminGroupIds.includes(g.id)}
                onToggle={() =>
                  setForm((p) => ({ ...p, adminGroupIds: toggleId(p.adminGroupIds, g.id) }))
                }
                tooltip={`Add the member to the custom group "${g.name}".`}
              />
            ))}
          </FormSection>
        )}

        {/* ── Requirements ─────────────────────────────────────────────── */}
        <FormSection title="Requirements">
          <TogglePill
            label="Require TOTP"
            active={form.requireTotp}
            onToggle={() => setForm((p) => ({ ...p, requireTotp: !p.requireTotp }))}
            tooltip="Force the member to enrol a TOTP authenticator app (e.g. Google Authenticator) on their very first login before they can access anything."
          />
        </FormSection>

        {error && <p className="admin-console__error">{error}</p>}
        {success && <p className="admin-console__success">{success}</p>}

        <div>
          <button
            className="admin-console__btn admin-console__btn--primary"
            type="submit"
            disabled={inviteMutation.isPending}
          >
            {inviteMutation.isPending ? "Sending invite…" : "Send invite"}
          </button>
        </div>
      </form>
    </section>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  deleteMember,
  enableMemberTotp,
  fetchMembers,
  removeMemberTotp,
  resetMemberPassword,
  updateMember,
  updateMemberGroups,
  type AdminGroup,
  type AdminMember,
} from "@/api/admin";
import "./admin.css";

type MembersSectionProps = {
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

function groupLabel(name: string): string {
  if (name.endsWith(":app-admins")) return "App Admin";
  const appMatch = name.match(/:app:([^:]+)$/);
  if (appMatch) return appMatch[1];
  return name;
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

// ─── Member edit panel ────────────────────────────────────────────────────────

type MemberEditProps = {
  member: AdminMember;
  tenant: string;
  privilegeGroups: AdminGroup[];
  appEntitlementGroups: AdminGroup[];
  customGroups: AdminGroup[];
  assignableGroups: AdminGroup[];
  onClose: () => void;
  setGlobalSuccess: (msg: string | null) => void;
  setGlobalError: (msg: string | null) => void;
};

function MemberEditPanel({
  member,
  tenant,
  privilegeGroups,
  appEntitlementGroups,
  customGroups,
  assignableGroups,
  onClose,
  setGlobalSuccess,
  setGlobalError,
}: MemberEditProps) {
  const queryClient = useQueryClient();

  const currentIds = assignableGroups
    .filter((g) => member.groups.includes(g.name))
    .map((g) => g.id);

  const [draftGroupIds, setDraftGroupIds] = useState<string[]>(currentIds);
  const [inviteEmailDraft, setInviteEmailDraft] = useState(member.inviteEmail ?? "");

  const toggleId = (ids: string[], id: string) =>
    ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

  // Filter out admin-only app IDs from the visible entitlement groups
  const visibleAppGroups = appEntitlementGroups.filter((g) => {
    const appId = appIdFromGroup(g.name);
    if (appId === null) return false;
    const adminAppIds = ["app-store", "subscriptions", "gentian-subscriptions", "admin"];
    return !adminAppIds.includes(appId);
  });

  const recoveryMutation = useMutation({
    mutationFn: () =>
      updateMember(member.id, { inviteEmail: inviteEmailDraft.trim() || null }, tenant),
    onSuccess: async () => {
      setGlobalError(null);
      setGlobalSuccess("Recovery email updated.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
    },
    onError: (err: Error) => {
      setGlobalSuccess(null);
      setGlobalError(err.message);
    },
  });

  const groupsMutation = useMutation({
    mutationFn: () => updateMemberGroups(member.id, draftGroupIds, tenant),
    onSuccess: async () => {
      setGlobalError(null);
      setGlobalSuccess("Groups updated.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
    },
    onError: (err: Error) => {
      setGlobalSuccess(null);
      setGlobalError(err.message);
    },
  });

  const totpMutation = useMutation({
    mutationFn: (action: "enable" | "remove") =>
      action === "enable"
        ? enableMemberTotp(member.id, true, tenant)
        : removeMemberTotp(member.id, tenant),
    onSuccess: async () => {
      setGlobalError(null);
      setGlobalSuccess("TOTP settings updated.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
    },
    onError: (err: Error) => {
      setGlobalSuccess(null);
      setGlobalError(err.message);
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => resetMemberPassword(member.id, tenant),
    onSuccess: (data) => {
      setGlobalError(null);
      const workspaceOnly =
        !member.inviteEmail &&
        (member.email === data.deliveryEmail || member.username === data.deliveryEmail);
      let message = `Password reset link sent to ${data.deliveryEmail}.`;
      if (workspaceOnly) {
        message += " That is the workspace address only — set a recovery email, then reset again.";
      }
      setGlobalSuccess(message);
    },
    onError: (err: Error) => {
      setGlobalSuccess(null);
      setGlobalError(err.message);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: () => updateMember(member.id, { enabled: !member.enabled }, tenant),
    onSuccess: async () => {
      setGlobalError(null);
      if (member.enabled) {
        setGlobalSuccess("Member disabled. All active sessions were signed out.");
      }
      await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "sessions", tenant] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMember(member.id, tenant),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
      onClose();
    },
  });

  return (
    <div className="admin-console__edit-panel">
      <div className="admin-console__edit-panel-header">
        <div>
          <div className="admin-console__mono" style={{ fontSize: "0.9375rem" }}>
            {member.email ?? member.username}
          </div>
          <div style={{ fontSize: "0.8125rem", color: "var(--gtn-ink-4)" }}>
            {[member.firstName, member.lastName].filter(Boolean).join(" ") || "—"}
          </div>
        </div>
        <button type="button" className="admin-console__btn" onClick={onClose}>
          ✕ Close
        </button>
      </div>

      <div className="admin-console__edit-panel-body">
        {/* Recovery email */}
        <div className="admin-console__edit-row">
          <div className="admin-console__edit-row-label">Recovery email</div>
          <div className="admin-console__edit-row-value">
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="email"
                value={inviteEmailDraft}
                onChange={(e) => setInviteEmailDraft(e.target.value)}
                placeholder="personal@example.com"
                style={{ flex: "1", minWidth: "12rem" }}
                title="Personal inbox used to deliver invite links and password-reset emails. Set this when the member's login email is a workspace address."
              />
              <button
                type="button"
                className="admin-console__btn"
                disabled={recoveryMutation.isPending}
                onClick={() => recoveryMutation.mutate()}
              >
                Save
              </button>
            </div>
          </div>
        </div>

        {/* Rights */}
        <div className="admin-console__edit-row">
          <div className="admin-console__edit-row-label">Rights</div>
          <div className="admin-console__edit-row-value">
            <div className="admin-console__toggle-group">
              {privilegeGroups.map((g) => (
                <TogglePill
                  key={g.id}
                  label="App Admin"
                  active={draftGroupIds.includes(g.id)}
                  onToggle={() => setDraftGroupIds((cur) => toggleId(cur, g.id))}
                  tooltip="Grants administrator access to a specific application. App admins can manage app-level settings and users within that app."
                />
              ))}
            </div>
          </div>
        </div>

        {/* App access */}
        <div className="admin-console__edit-row">
          <div className="admin-console__edit-row-label">Apps</div>
          <div className="admin-console__edit-row-value">
            <div className="admin-console__toggle-group">
              {visibleAppGroups.map((g) => {
                const appId = appIdFromGroup(g.name) ?? groupLabel(g.name);
                return (
                  <TogglePill
                    key={g.id}
                    label={appId}
                    active={draftGroupIds.includes(g.id)}
                    onToggle={() => setDraftGroupIds((cur) => toggleId(cur, g.id))}
                    tooltip={`Grant or revoke access to the "${appId}" application. When active, the member belongs to the app's entitlement group and can sign in to ${appId}.`}
                  />
                );
              })}
            </div>
            {customGroups.length > 0 && (
              <div className="admin-console__toggle-group" style={{ marginTop: "0.5rem" }}>
                {customGroups.map((g) => (
                  <TogglePill
                    key={g.id}
                    label={groupLabel(g.name)}
                    active={draftGroupIds.includes(g.id)}
                    onToggle={() => setDraftGroupIds((cur) => toggleId(cur, g.id))}
                    tooltip={`Add or remove the member from the custom group "${g.name}".`}
                  />
                ))}
              </div>
            )}
            <div style={{ marginTop: "0.5rem" }}>
              <button
                type="button"
                className="admin-console__btn admin-console__btn--primary"
                style={{ marginRight: "0.5rem" }}
                disabled={groupsMutation.isPending}
                onClick={() => groupsMutation.mutate()}
              >
                {groupsMutation.isPending ? "Saving…" : "Save groups"}
              </button>
              <button
                type="button"
                className="admin-console__btn"
                onClick={() => setDraftGroupIds(currentIds)}
                title="Discard unsaved changes and restore the current group memberships."
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* Account actions */}
        <div className="admin-console__edit-row">
          <div className="admin-console__edit-row-label">Account actions</div>
          <div className="admin-console__edit-row-value admin-console__edit-actions">
            {!member.totpConfigured && (
              <button
                type="button"
                className="admin-console__btn"
                disabled={totpMutation.isPending}
                onClick={() => totpMutation.mutate("enable")}
                title="Require the member to set up a TOTP authenticator (e.g. Google Authenticator) on next login."
              >
                Require TOTP
              </button>
            )}
            {(member.totpConfigured || member.totpPending) && (
              <button
                type="button"
                className="admin-console__btn"
                disabled={totpMutation.isPending}
                onClick={() => totpMutation.mutate("remove")}
                title="Remove the member's existing TOTP configuration so they can log in with password only."
              >
                Remove TOTP
              </button>
            )}
            <button
              type="button"
              className="admin-console__btn"
              disabled={resetMutation.isPending}
              title="Invalidates the member's current password, signs them out everywhere, and emails a link to set a new password."
              onClick={() => resetMutation.mutate()}
            >
              Reset password
            </button>
            <button
              type="button"
              className="admin-console__btn"
              onClick={() => toggleMutation.mutate()}
              title={
                member.enabled
                  ? "Disable this account. All active sessions are revoked immediately."
                  : "Re-enable this account so the member can sign in again."
              }
            >
              {member.enabled ? "Disable" : "Enable"}
            </button>
            <button
              type="button"
              className="admin-console__btn admin-console__btn--danger"
              title="Permanently delete this member and all their sessions. This cannot be undone."
              onClick={() => {
                if (
                  window.confirm(
                    `Delete member ${member.email ?? member.username}? This cannot be undone.`,
                  )
                ) {
                  deleteMutation.mutate();
                }
              }}
            >
              Delete member
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Top-level export ─────────────────────────────────────────────────────────

export function MembersSection({
  tenant,
  privilegeGroups,
  appEntitlementGroups,
  customGroups,
}: MembersSectionProps) {
  const assignableGroups = [...privilegeGroups, ...appEntitlementGroups, ...customGroups];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [globalSuccess, setGlobalSuccess] = useState<string | null>(null);

  const membersQuery = useQuery({
    queryKey: ["admin", "members", tenant],
    queryFn: () => fetchMembers(tenant),
  });
  const members = membersQuery.data ?? [];

  const editingMember = editingId ? members.find((m) => m.id === editingId) ?? null : null;

  return (
    <section>
      <div className="admin-console__toolbar">
        <h2 className="admin-console__title" style={{ fontSize: "1.125rem" }}>
          Members
        </h2>
      </div>

      {globalError && <p className="admin-console__error">{globalError}</p>}
      {globalSuccess && <p className="admin-console__success">{globalSuccess}</p>}

      {editingMember && (
        <MemberEditPanel
          member={editingMember}
          tenant={tenant}
          privilegeGroups={privilegeGroups}
          appEntitlementGroups={appEntitlementGroups}
          customGroups={customGroups}
          assignableGroups={assignableGroups}
          onClose={() => setEditingId(null)}
          setGlobalSuccess={setGlobalSuccess}
          setGlobalError={setGlobalError}
        />
      )}

      <table className="admin-console__table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Name</th>
            <th>Status</th>
            <th>MFA</th>
            <th>Groups</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr
              key={member.id}
              className={editingId === member.id ? "admin-console__row--editing" : ""}
            >
              <td className="admin-console__mono">{member.email ?? member.username}</td>
              <td>{[member.firstName, member.lastName].filter(Boolean).join(" ") || "—"}</td>
              <td>{member.enabled ? "Enabled" : "Disabled"}</td>
              <td>
                {member.totpConfigured
                  ? "TOTP active"
                  : member.totpPending
                    ? "Setup pending"
                    : "—"}
              </td>
              <td>
                {member.groups.length === 0
                  ? "—"
                  : member.groups.map((group) => (
                      <span key={group} className="admin-console__chip">
                        {groupLabel(group)}
                      </span>
                    ))}
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button
                  type="button"
                  className={`admin-console__btn${editingId === member.id ? " admin-console__btn--primary" : ""}`}
                  onClick={() => setEditingId(editingId === member.id ? null : member.id)}
                >
                  {editingId === member.id ? "Close" : "Edit"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  deleteMember,
  enableMemberTotp,
  fetchMembers,
  inviteMember,
  removeMemberTotp,
  resetMemberPassword,
  updateMember,
  updateMemberGroups,
  type AdminGroup,
  type AdminMember,
} from "@/api/admin";
import { apiFetch, type MeResponse, type ShellApp } from "@/api/client";
import "./admin.css";

type MembersSectionProps = {
  tenant: string;
  privilegeGroups: AdminGroup[];
  appEntitlementGroups: AdminGroup[];
  customGroups: AdminGroup[];
};

function groupLabel(name: string): string {
  if (name.endsWith(":app-admins")) {
    return "App administrator";
  }
  const appMatch = name.match(/:app:([^:]+)$/);
  if (appMatch) {
    return appMatch[1];
  }
  return name;
}

/** Extract the app-id slug from a group name like `...:app:xwiki` → `xwiki` */
function appIdFromGroup(name: string): string | null {
  const m = name.match(/:app:([^:]+)$/);
  return m ? m[1] : null;
}

/** Toggle-button list for app entitlement groups, organised per installed app. */
function AppToggleList({
  title,
  groups,
  selectedIds,
  onToggle,
  installedAppIds,
}: {
  title: string;
  groups: AdminGroup[];
  selectedIds: string[];
  onToggle: (groupId: string, selected: boolean) => void;
  installedAppIds: Set<string> | null;
}) {
  // Filter to only installed apps when we know the list.
  const visible =
    installedAppIds !== null
      ? groups.filter((g) => {
          const appId = appIdFromGroup(g.name);
          return appId !== null && installedAppIds.has(appId);
        })
      : groups;

  if (visible.length === 0) return null;

  return (
    <div className="admin-console__field">
      <span>{title}</span>
      <div className="admin-console__toggle-group">
        {visible.map((group) => {
          const selected = selectedIds.includes(group.id);
          return (
            <button
              key={group.id}
              type="button"
              className={`admin-console__toggle${selected ? " admin-console__toggle--on" : ""}`}
              onClick={() => onToggle(group.id, selected)}
            >
              {groupLabel(group.name)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Toggle-button list for privilege / custom groups (no app-id filter needed). */
function GroupToggleList({
  title,
  groups,
  selectedIds,
  onToggle,
}: {
  title: string;
  groups: AdminGroup[];
  selectedIds: string[];
  onToggle: (groupId: string, selected: boolean) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="admin-console__field">
      <span>{title}</span>
      <div className="admin-console__toggle-group">
        {groups.map((group) => {
          const selected = selectedIds.includes(group.id);
          return (
            <button
              key={group.id}
              type="button"
              className={`admin-console__toggle${selected ? " admin-console__toggle--on" : ""}`}
              onClick={() => onToggle(group.id, selected)}
            >
              {groupLabel(group.name)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Invitation sub-section ──────────────────────────────────────────────────

type InvitationProps = {
  tenant: string;
  privilegeGroups: AdminGroup[];
  appEntitlementGroups: AdminGroup[];
  customGroups: AdminGroup[];
  installedAppIds: Set<string> | null;
  onSuccess: () => void;
};

function InvitationSection({
  tenant,
  privilegeGroups,
  appEntitlementGroups,
  customGroups,
  installedAppIds,
  onSuccess,
}: InvitationProps) {
  // Default: all app entitlement groups for installed apps selected.
  const defaultGroupIds = (installedAppIds: Set<string> | null, groups: AdminGroup[]) =>
    groups
      .filter((g) => {
        if (installedAppIds === null) return true;
        const appId = appIdFromGroup(g.name);
        return appId !== null && installedAppIds.has(appId);
      })
      .map((g) => g.id);

  const [form, setForm] = useState({
    email: "",
    inviteEmail: "",
    firstName: "",
    lastName: "",
    groupIds: defaultGroupIds(installedAppIds, appEntitlementGroups),
    requireTotp: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Re-sync defaults when installed apps become known.
  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      groupIds: defaultGroupIds(installedAppIds, appEntitlementGroups),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installedAppIds]);

  const toggleGroupId = (groupIds: string[], groupId: string, selected: boolean) =>
    selected ? groupIds.filter((id) => id !== groupId) : [...groupIds, groupId];

  const inviteMutation = useMutation({
    mutationFn: () =>
      inviteMember(
        {
          email: form.email,
          inviteEmail: form.inviteEmail || undefined,
          firstName: form.firstName || undefined,
          lastName: form.lastName || undefined,
          groupIds: form.groupIds,
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
        groupIds: defaultGroupIds(installedAppIds, appEntitlementGroups),
        requireTotp: false,
      });
      setError(null);
      setSuccess("Invite sent.");
      onSuccess();
    },
    onError: (err: Error) => {
      setSuccess(null);
      setError(err.message);
    },
  });

  const handleToggle = (groupId: string, selected: boolean) =>
    setForm((prev) => ({ ...prev, groupIds: toggleGroupId(prev.groupIds, groupId, selected) }));

  return (
    <section>
      <div className="admin-console__toolbar">
        <h2 className="admin-console__title" style={{ fontSize: "1.125rem" }}>
          Invite member
        </h2>
      </div>

      <form
        className="admin-console__form admin-console__form--invite"
        onSubmit={(event) => {
          event.preventDefault();
          setSuccess(null);
          inviteMutation.mutate();
        }}
      >
        <div className="admin-console__field-row">
          <div className="admin-console__field">
            <label htmlFor="member-email">Login email</label>
            <input
              id="member-email"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
            />
          </div>
          <div className="admin-console__field">
            <label htmlFor="member-invite-email">Invite email (optional)</label>
            <input
              id="member-invite-email"
              type="email"
              value={form.inviteEmail}
              onChange={(e) => setForm((prev) => ({ ...prev, inviteEmail: e.target.value }))}
              placeholder="Recovery / invite copy"
            />
          </div>
          <div className="admin-console__field">
            <label htmlFor="member-first">First name</label>
            <input
              id="member-first"
              value={form.firstName}
              onChange={(e) => setForm((prev) => ({ ...prev, firstName: e.target.value }))}
            />
          </div>
          <div className="admin-console__field">
            <label htmlFor="member-last">Last name</label>
            <input
              id="member-last"
              value={form.lastName}
              onChange={(e) => setForm((prev) => ({ ...prev, lastName: e.target.value }))}
            />
          </div>
        </div>

        <AppToggleList
          title="App entitlements"
          groups={appEntitlementGroups}
          selectedIds={form.groupIds}
          onToggle={handleToggle}
          installedAppIds={installedAppIds}
        />
        <GroupToggleList
          title="App administrators"
          groups={privilegeGroups}
          selectedIds={form.groupIds}
          onToggle={handleToggle}
        />
        <GroupToggleList
          title="Custom groups"
          groups={customGroups}
          selectedIds={form.groupIds}
          onToggle={handleToggle}
        />

        <div className="admin-console__field">
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={form.requireTotp}
              onChange={(e) => setForm((prev) => ({ ...prev, requireTotp: e.target.checked }))}
            />
            Require TOTP setup on first login
          </label>
        </div>

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

// ─── Member edit drawer ───────────────────────────────────────────────────────

type MemberEditProps = {
  member: AdminMember;
  tenant: string;
  privilegeGroups: AdminGroup[];
  appEntitlementGroups: AdminGroup[];
  customGroups: AdminGroup[];
  assignableGroups: AdminGroup[];
  installedAppIds: Set<string> | null;
  onClose: () => void;
  onUpdate: () => void;
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
  installedAppIds,
  onClose,
  onUpdate,
  setGlobalSuccess,
  setGlobalError,
}: MemberEditProps) {
  const queryClient = useQueryClient();

  const currentIds = assignableGroups
    .filter((g) => member.groups.includes(g.name))
    .map((g) => g.id);

  const [draftGroupIds, setDraftGroupIds] = useState<string[]>(currentIds);
  const [inviteEmailDraft, setInviteEmailDraft] = useState(member.inviteEmail ?? "");

  const toggleGroupId = (groupIds: string[], groupId: string, selected: boolean) =>
    selected ? groupIds.filter((id) => id !== groupId) : [...groupIds, groupId];

  const handleToggle = (groupId: string, selected: boolean) =>
    setDraftGroupIds((current) => toggleGroupId(current, groupId, selected));

  const recoveryMutation = useMutation({
    mutationFn: () =>
      updateMember(member.id, { inviteEmail: inviteEmailDraft.trim() || null }, tenant),
    onSuccess: async () => {
      setGlobalError(null);
      setGlobalSuccess("Recovery email updated.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
      onUpdate();
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
      onUpdate();
    },
    onError: (err: Error) => {
      setGlobalSuccess(null);
      setGlobalError(err.message);
    },
  });

  const totpMutation = useMutation({
    mutationFn: (action: "enable" | "remove") =>
      action === "enable" ? enableMemberTotp(member.id, true, tenant) : removeMemberTotp(member.id, tenant),
    onSuccess: async () => {
      setGlobalError(null);
      setGlobalSuccess("TOTP settings updated.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
      onUpdate();
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
      onUpdate();
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

        {/* App entitlements */}
        <div className="admin-console__edit-row">
          <div className="admin-console__edit-row-label">App entitlements</div>
          <div className="admin-console__edit-row-value">
            <AppToggleList
              title=""
              groups={appEntitlementGroups}
              selectedIds={draftGroupIds}
              onToggle={handleToggle}
              installedAppIds={installedAppIds}
            />
            <GroupToggleList
              title="App administrators"
              groups={privilegeGroups}
              selectedIds={draftGroupIds}
              onToggle={handleToggle}
            />
            <GroupToggleList
              title="Custom groups"
              groups={customGroups}
              selectedIds={draftGroupIds}
              onToggle={handleToggle}
            />
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
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="admin-console__edit-row">
          <div className="admin-console__edit-row-label">Account actions</div>
          <div className="admin-console__edit-row-value admin-console__edit-actions">
            {!member.totpConfigured && (
              <button
                type="button"
                className="admin-console__btn"
                disabled={totpMutation.isPending}
                onClick={() => totpMutation.mutate("enable")}
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
            >
              {member.enabled ? "Disable" : "Enable"}
            </button>
            <button
              type="button"
              className="admin-console__btn admin-console__btn--danger"
              onClick={() => {
                if (window.confirm(`Delete member ${member.email ?? member.username}? This cannot be undone.`)) {
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

// ─── Members list sub-section ─────────────────────────────────────────────────

type MembersListProps = {
  tenant: string;
  privilegeGroups: AdminGroup[];
  appEntitlementGroups: AdminGroup[];
  customGroups: AdminGroup[];
  assignableGroups: AdminGroup[];
  installedAppIds: Set<string> | null;
  globalError: string | null;
  globalSuccess: string | null;
  setGlobalError: (msg: string | null) => void;
  setGlobalSuccess: (msg: string | null) => void;
};

function MembersList({
  tenant,
  privilegeGroups,
  appEntitlementGroups,
  customGroups,
  assignableGroups,
  installedAppIds,
  globalError,
  globalSuccess,
  setGlobalError,
  setGlobalSuccess,
}: MembersListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const membersQuery = useQuery({
    queryKey: ["admin", "members", tenant],
    queryFn: () => fetchMembers(tenant),
  });
  const members = membersQuery.data ?? [];

  const editingMember = editingId ? members.find((m) => m.id === editingId) ?? null : null;

  return (
    <section style={{ marginTop: "2rem" }}>
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
          installedAppIds={installedAppIds}
          onClose={() => setEditingId(null)}
          onUpdate={() => {
            /* keep panel open, data refreshes via query invalidation */
          }}
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
            <tr key={member.id} className={editingId === member.id ? "admin-console__row--editing" : ""}>
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
                {member.groups.length === 0 ? (
                  "—"
                ) : (
                  member.groups.map((group) => (
                    <span key={group} className="admin-console__chip">
                      {groupLabel(group)}
                    </span>
                  ))
                )}
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

// ─── Top-level export ─────────────────────────────────────────────────────────

export function MembersSection({
  tenant,
  privilegeGroups,
  appEntitlementGroups,
  customGroups,
}: MembersSectionProps) {
  const queryClient = useQueryClient();
  const assignableGroups = [...privilegeGroups, ...appEntitlementGroups, ...customGroups];
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [globalSuccess, setGlobalSuccess] = useState<string | null>(null);

  // Derive installed app IDs from the cached /session/me response.
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<MeResponse>("/session/me"),
    staleTime: Infinity, // already fresh from shell bootstrap
  });
  const shellApps: ShellApp[] = meQuery.data?.shellApps ?? [];
  const installedAppIds: Set<string> | null =
    shellApps.length > 0 ? new Set(shellApps.map((a) => a.id)) : null;

  const invalidateMembers = async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
  };

  return (
    <div>
      <InvitationSection
        tenant={tenant}
        privilegeGroups={privilegeGroups}
        appEntitlementGroups={appEntitlementGroups}
        customGroups={customGroups}
        installedAppIds={installedAppIds}
        onSuccess={invalidateMembers}
      />
      <MembersList
        tenant={tenant}
        privilegeGroups={privilegeGroups}
        appEntitlementGroups={appEntitlementGroups}
        customGroups={customGroups}
        assignableGroups={assignableGroups}
        installedAppIds={installedAppIds}
        globalError={globalError}
        globalSuccess={globalSuccess}
        setGlobalError={setGlobalError}
        setGlobalSuccess={setGlobalSuccess}
      />
    </div>
  );
}

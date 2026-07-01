import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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

function GroupCheckboxList({
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
  if (groups.length === 0) {
    return null;
  }
  return (
    <div className="admin-console__field">
      <span>{title}</span>
      {groups.map((group) => {
        const selected = selectedIds.includes(group.id);
        return (
          <label key={group.id} style={{ display: "block", fontSize: "0.875rem" }}>
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggle(group.id, selected)}
            />{" "}
            {groupLabel(group.name)}
          </label>
        );
      })}
    </div>
  );
}

export function MembersSection({
  tenant,
  privilegeGroups,
  appEntitlementGroups,
  customGroups,
}: MembersSectionProps) {
  const assignableGroups = [...privilegeGroups, ...appEntitlementGroups, ...customGroups];
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftGroupIds, setDraftGroupIds] = useState<string[]>([]);
  const [form, setForm] = useState({
    email: "",
    inviteEmail: "",
    firstName: "",
    lastName: "",
    groupIds: [] as string[],
    requireTotp: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const toggleGroupId = (groupIds: string[], groupId: string, selected: boolean) =>
    selected ? groupIds.filter((id) => id !== groupId) : [...groupIds, groupId];

  const membersQuery = useQuery({
    queryKey: ["admin", "members", tenant],
    queryFn: () => fetchMembers(tenant),
  });

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
      setForm({ email: "", inviteEmail: "", firstName: "", lastName: "", groupIds: [], requireTotp: false });
      setError(null);
      setSuccess("Invite sent.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
    },
    onError: (err: Error) => {
      setSuccess(null);
      setError(err.message);
    },
  });

  const totpMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "enable" | "remove" }) =>
      action === "enable" ? enableMemberTotp(id, true, tenant) : removeMemberTotp(id, tenant),
    onSuccess: async () => {
      setError(null);
      setSuccess("TOTP settings updated.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
    },
    onError: (err: Error) => {
      setSuccess(null);
      setError(err.message);
    },
  });

  const resetMutation = useMutation({
    mutationFn: (id: string) => resetMemberPassword(id, tenant),
    onSuccess: () => {
      setError(null);
      setSuccess(
        "Password reset initiated. The member will set a new password on next sign-in.",
      );
    },
    onError: (err: Error) => {
      setSuccess(null);
      setError(err.message);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (member: AdminMember) =>
      updateMember(member.id, { enabled: !member.enabled }, tenant),
    onSuccess: async (_data, member) => {
      setError(null);
      if (member.enabled) {
        setSuccess("Member disabled. All active sessions were signed out.");
      } else {
        setSuccess(null);
      }
      await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "sessions", tenant] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteMember(id, tenant),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
    },
  });

  const groupsMutation = useMutation({
    mutationFn: ({ memberId, groupIds }: { memberId: string; groupIds: string[] }) =>
      updateMemberGroups(memberId, groupIds, tenant),
    onSuccess: async () => {
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
    },
  });

  const members = membersQuery.data ?? [];

  return (
    <section>
      <div className="admin-console__toolbar">
        <h2 className="admin-console__title" style={{ fontSize: "1.125rem" }}>
          Members
        </h2>
      </div>

      <form
        className="admin-console__form"
        onSubmit={(event) => {
          event.preventDefault();
          setSuccess(null);
          inviteMutation.mutate();
        }}
      >
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
        <GroupCheckboxList
          title="App administrators"
          groups={privilegeGroups}
          selectedIds={form.groupIds}
          onToggle={(groupId, selected) =>
            setForm((prev) => ({
              ...prev,
              groupIds: toggleGroupId(prev.groupIds, groupId, selected),
            }))
          }
        />
        <GroupCheckboxList
          title="App entitlements"
          groups={appEntitlementGroups}
          selectedIds={form.groupIds}
          onToggle={(groupId, selected) =>
            setForm((prev) => ({
              ...prev,
              groupIds: toggleGroupId(prev.groupIds, groupId, selected),
            }))
          }
        />
        <GroupCheckboxList
          title="Custom groups"
          groups={customGroups}
          selectedIds={form.groupIds}
          onToggle={(groupId, selected) =>
            setForm((prev) => ({
              ...prev,
              groupIds: toggleGroupId(prev.groupIds, groupId, selected),
            }))
          }
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
        <button
          className="admin-console__btn admin-console__btn--primary"
          type="submit"
          disabled={inviteMutation.isPending}
        >
          {inviteMutation.isPending ? "Sending invite…" : "Invite member"}
        </button>
      </form>

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
            <tr key={member.id}>
              <td className="admin-console__mono">
                {member.email ?? member.username}
                {member.inviteEmail && member.inviteEmail !== member.email && (
                  <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>
                    invite: {member.inviteEmail}
                  </div>
                )}
              </td>
              <td>
                {[member.firstName, member.lastName].filter(Boolean).join(" ") || "—"}
              </td>
              <td>{member.enabled ? "Enabled" : "Disabled"}</td>
              <td>
                {member.totpConfigured ? (
                  "TOTP active"
                ) : member.totpPending ? (
                  "Setup pending"
                ) : (
                  "—"
                )}
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
                {editingId === member.id ? (
                  <div style={{ marginTop: "0.5rem" }}>
                    <GroupCheckboxList
                      title="App administrators"
                      groups={privilegeGroups}
                      selectedIds={draftGroupIds}
                      onToggle={(groupId, selected) =>
                        setDraftGroupIds((current) => toggleGroupId(current, groupId, selected))
                      }
                    />
                    <GroupCheckboxList
                      title="App entitlements"
                      groups={appEntitlementGroups}
                      selectedIds={draftGroupIds}
                      onToggle={(groupId, selected) =>
                        setDraftGroupIds((current) => toggleGroupId(current, groupId, selected))
                      }
                    />
                    <GroupCheckboxList
                      title="Custom groups"
                      groups={customGroups}
                      selectedIds={draftGroupIds}
                      onToggle={(groupId, selected) =>
                        setDraftGroupIds((current) => toggleGroupId(current, groupId, selected))
                      }
                    />
                    <button
                      type="button"
                      className="admin-console__btn admin-console__btn--primary"
                      style={{ marginTop: "0.5rem", marginRight: "0.5rem" }}
                      onClick={() =>
                        groupsMutation.mutate({ memberId: member.id, groupIds: draftGroupIds })
                      }
                    >
                      Save groups
                    </button>
                    <button
                      type="button"
                      className="admin-console__btn"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="admin-console__btn"
                    style={{ marginLeft: "0.5rem" }}
                    onClick={() => {
                      const currentIds = assignableGroups
                        .filter((g) => member.groups.includes(g.name))
                        .map((g) => g.id);
                      setDraftGroupIds(currentIds);
                      setEditingId(member.id);
                    }}
                  >
                    Edit groups
                  </button>
                )}
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                {!member.totpConfigured && (
                  <button
                    type="button"
                    className="admin-console__btn"
                    disabled={totpMutation.isPending}
                    onClick={() => {
                      setSuccess(null);
                      totpMutation.mutate({ id: member.id, action: "enable" });
                    }}
                  >
                    Require TOTP
                  </button>
                )}{" "}
                {(member.totpConfigured || member.totpPending) && (
                  <button
                    type="button"
                    className="admin-console__btn"
                    disabled={totpMutation.isPending}
                    onClick={() => {
                      setSuccess(null);
                      totpMutation.mutate({ id: member.id, action: "remove" });
                    }}
                  >
                    Remove TOTP
                  </button>
                )}{" "}
                <button
                  type="button"
                  className="admin-console__btn"
                  disabled={resetMutation.isPending}
                  onClick={() => {
                    setSuccess(null);
                    resetMutation.mutate(member.id);
                  }}
                >
                  Reset password
                </button>{" "}
                <button
                  type="button"
                  className="admin-console__btn"
                  onClick={() => toggleMutation.mutate(member)}
                >
                  {member.enabled ? "Disable" : "Enable"}
                </button>{" "}
                <button
                  type="button"
                  className="admin-console__btn admin-console__btn--danger"
                  onClick={() => deleteMutation.mutate(member.id)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

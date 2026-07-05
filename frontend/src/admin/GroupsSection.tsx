import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  createGroup,
  deleteGroup,
  fetchGroups,
  updateGroup,
  fetchMembers,
  updateMemberGroups,
  type AdminGroup,
  type AdminMember,
} from "@/api/admin";
import "./admin.css";

type GroupsSectionProps = {
  tenant: string;
};

type GroupEditProps = {
  group: AdminGroup;
  tenant: string;
  members: AdminMember[];
  onClose: () => void;
};

function GroupEditPanel({ group, tenant, members, onClose }: GroupEditProps) {
  const queryClient = useQueryClient();
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Group members are those whose `groups` array contains the group's name.
  const currentMembers = members.filter((m) => m.groups.includes(group.name));

  const toggleMemberMutation = useMutation({
    mutationFn: async ({ member, add }: { member: AdminMember; add: boolean }) => {
      // Fetch all groups to resolve group paths/IDs
      const allGroups = queryClient.getQueryData<AdminGroup[]>(["admin", "groups", tenant]) ?? [];
      
      // Resolve member's current groups as IDs
      const currentGroupIds = allGroups
        .filter((g) => member.groups.includes(g.name))
        .map((g) => g.id);

      const nextGroupIds = add
        ? [...currentGroupIds, group.id]
        : currentGroupIds.filter((id) => id !== group.id);

      await updateMemberGroups(member.id, nextGroupIds, tenant);
    },
    onSuccess: async () => {
      setSuccess("Group membership updated.");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "groups", tenant] });
    },
    onError: (err: Error) => {
      setSuccess(null);
      setError(err.message);
    },
  });

  return (
    <div className="admin-console__edit-panel" style={{ marginTop: "1rem", marginBottom: "1.5rem" }}>
      <div className="admin-console__edit-panel-header">
        <div>
          <div style={{ fontWeight: 600, fontSize: "0.9375rem" }}>
            Edit Members for Group
          </div>
          <div className="admin-console__mono" style={{ fontSize: "0.8125rem", color: "var(--gtn-ink-4)" }}>
            {group.name}
          </div>
        </div>
        <button type="button" className="admin-console__btn" onClick={onClose}>
          ✕ Close
        </button>
      </div>

      <div className="admin-console__edit-panel-body" style={{ padding: "1rem" }}>
        <div style={{ fontSize: "0.875rem", marginBottom: "1rem", color: "var(--gtn-ink-3)" }}>
          Select the members who belong to this group:
        </div>

        {success && <p className="admin-console__success">{success}</p>}
        {error && <p className="admin-console__error">{error}</p>}

        <div className="admin-console__toggle-group" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(14rem, 1fr))", gap: "0.5rem" }}>
          {members.map((member) => {
            const isMember = currentMembers.some((m) => m.id === member.id);
            const shortName = member.username.split("@")[0];
            return (
              <label
                key={member.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.4rem 0.6rem",
                  border: "1px solid var(--gtn-border, rgba(14, 18, 38, 0.12))",
                  borderRadius: "2px",
                  background: isMember ? "var(--gtn-paper-1, #ece8df)" : "#fff",
                  cursor: "pointer",
                  userSelect: "none"
                }}
              >
                <input
                  type="checkbox"
                  checked={isMember}
                  disabled={toggleMemberMutation.isPending}
                  onChange={(e) => {
                    setSuccess(null);
                    toggleMemberMutation.mutate({ member, add: e.target.checked });
                  }}
                />
                <span className="admin-console__mono" style={{ fontSize: "0.8125rem" }}>
                  {shortName}
                </span>
              </label>
            );
          })}
          {members.length === 0 && (
            <span style={{ fontSize: "0.8125rem", color: "var(--gtn-ink-4)" }}>
              No members found in this tenant.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function GroupsSection({ tenant }: GroupsSectionProps) {
  const queryClient = useQueryClient();
  const defaultGroupPrefix =
    tenant === "kernel" ? "gentian:platform:" : `gentian:tenant:${tenant}:app:`;
  const [name, setName] = useState(`${defaultGroupPrefix}`);
  const [error, setError] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  const groupsQuery = useQuery({
    queryKey: ["admin", "groups", tenant],
    queryFn: () => fetchGroups(tenant),
  });

  const membersQuery = useQuery({
    queryKey: ["admin", "members", tenant],
    queryFn: () => fetchMembers(tenant),
  });

  const createMutation = useMutation({
    mutationFn: () => createGroup(name, tenant),
    onSuccess: async () => {
      setName(`${defaultGroupPrefix}`);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "groups", tenant] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteGroup(id, tenant),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "groups", tenant] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, nextName }: { id: string; nextName: string }) =>
      updateGroup(id, nextName, tenant),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "groups", tenant] });
    },
  });

  const groups = groupsQuery.data ?? [];
  const members = membersQuery.data ?? [];

  const isSystemGroup = (groupName: string) =>
    groupName.endsWith(":members") || groupName.endsWith(":app-admins");

  const editingGroup = editingGroupId ? groups.find((g) => g.id === editingGroupId) ?? null : null;

  return (
    <section>
      <div className="admin-console__toolbar">
        <h2 className="admin-console__title" style={{ fontSize: "1.125rem" }}>
          Groups
        </h2>
      </div>

      <form
        className="admin-console__form"
        onSubmit={(event) => {
          event.preventDefault();
          createMutation.mutate();
        }}
      >
        <div className="admin-console__field">
          <label htmlFor="group-name">Group name</label>
          <input
            id="group-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="admin-console__mono"
          />
        </div>
        {error && <p className="admin-console__error">{error}</p>}
        <button className="admin-console__btn admin-console__btn--primary" type="submit">
          Create group
        </button>
      </form>

      {editingGroup && (
        <GroupEditPanel
          group={editingGroup}
          tenant={tenant}
          members={members}
          onClose={() => setEditingGroupId(null)}
        />
      )}

      <table className="admin-console__table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Members</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const groupMembers = members.filter((m) => m.groups.includes(group.name));
            return (
              <tr key={group.id} className={editingGroupId === group.id ? "admin-console__row--editing" : ""}>
                <td className="admin-console__mono">{group.name}</td>
                <td>
                  {groupMembers.length === 0 ? (
                    <span style={{ color: "var(--gtn-ink-4)", fontSize: "0.8125rem" }}>—</span>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                      {groupMembers.map((m) => {
                        const shortName = m.username.split("@")[0];
                        return (
                          <span
                            key={m.id}
                            className="admin-console__chip"
                            style={{ margin: 0, padding: "0.15rem 0.35rem" }}
                          >
                            {shortName}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                  <button
                    type="button"
                    className={`admin-console__btn${editingGroupId === group.id ? " admin-console__btn--primary" : ""}`}
                    style={{ marginRight: "0.35rem" }}
                    onClick={() => setEditingGroupId(editingGroupId === group.id ? null : group.id)}
                  >
                    {editingGroupId === group.id ? "Close" : "Edit Members"}
                  </button>

                  {!isSystemGroup(group.name) && (
                    <>
                      <button
                        type="button"
                        className="admin-console__btn"
                        style={{ marginRight: "0.35rem" }}
                        onClick={() => {
                          const nextName = window.prompt("Rename group", group.name);
                          if (nextName && nextName !== group.name) {
                            renameMutation.mutate({ id: group.id, nextName });
                          }
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="admin-console__btn admin-console__btn--danger"
                        onClick={() => {
                          if (window.confirm(`Delete group ${group.name}?`)) {
                            deleteMutation.mutate(group.id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </>
                  )}
                  {isSystemGroup(group.name) && (
                    <span style={{ fontSize: "0.75rem", opacity: 0.7, padding: "0 0.5rem" }}>System group</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

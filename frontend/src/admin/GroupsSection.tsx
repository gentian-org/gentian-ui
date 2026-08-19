import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  createGroup,
  deleteGroup,
  fetchGroups,
  updateGroup,
  fetchMembers,
  updateMemberGroups,
  fetchGrantableAddons,
  type AdminGroup,
  type AdminMember,
  type GrantableAddon,
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
  const [activeTab, setActiveTab] = useState<"members" | "odoo_apps" | "odoo_roles">("members");

  // Group members are those whose `groups` array contains the group's name.
  const initialMembers = members.filter((m) => m.groups.includes(group.name)).map((m) => m.id);
  const [draftMemberIds, setDraftMemberIds] = useState<string[]>(initialMembers);
  const [draftModules, setDraftModules] = useState<string[]>(group.gentianOdooModules ?? []);
  // Offer exactly what the tenant has installed. The list used to be a hardcoded
  // crm/contacts/calendar, which both offered modules that were not installed and
  // hid the ones that were — so their tiles could never be granted to anyone.
  const [grantableAddons, setGrantableAddons] = useState<GrantableAddon[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchGrantableAddons(tenant)
      .then((a) => !cancelled && setGrantableAddons(a))
      .catch(() => !cancelled && setGrantableAddons([]));
    return () => {
      cancelled = true;
    };
  }, [tenant]);
  const [draftRoles, setDraftRoles] = useState<string[]>(group.gentianOdooGroupRoles ?? []);
  const [newRoleInput, setNewRoleInput] = useState("");

  const saveMutation = useMutation({
    mutationFn: async () => {
      // 1. Update Group Attributes
      await updateGroup(group.id, group.name, draftModules, draftRoles, tenant);

      // 2. Fetch all groups to resolve group paths/IDs
      const allGroups = queryClient.getQueryData<AdminGroup[]>(["admin", "groups", tenant]) ?? [];
      
      const promises = members.map(async (member) => {
        const wasInGroup = member.groups.includes(group.name);
        const shouldBeInGroup = draftMemberIds.includes(member.id);

        if (wasInGroup === shouldBeInGroup) return;

        const currentGroupIds = allGroups
          .filter((g) => member.groups.includes(g.name))
          .map((g) => g.id);

        const nextGroupIds = shouldBeInGroup
          ? [...currentGroupIds, group.id]
          : currentGroupIds.filter((id) => id !== group.id);

        await updateMemberGroups(member.id, nextGroupIds, tenant);
      });

      await Promise.all(promises);
    },
    onSuccess: async () => {
      setSuccess("Group settings saved successfully.");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "groups", tenant] });
    },
    onError: (err: Error) => {
      setSuccess(null);
      setError(err.message);
    },
  });

  const toggleMemberId = (id: string) => {
    setDraftMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleReset = () => {
    setDraftMemberIds(initialMembers);
    setDraftModules(group.gentianOdooModules ?? []);
    setDraftRoles(group.gentianOdooGroupRoles ?? []);
    setNewRoleInput("");
  };

  return (
    <div className="admin-console__edit-panel" style={{ marginTop: "1rem", marginBottom: "1.5rem" }}>
      <div className="admin-console__edit-panel-header">
        <div>
          <div style={{ fontWeight: 600, fontSize: "0.9375rem" }}>
            Edit Group Settings
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
        <div className="admin-console__tabs" style={{ display: "flex", gap: "0.5rem", borderBottom: "1px solid var(--gtn-border, rgba(14, 18, 38, 0.12))", marginBottom: "1rem" }}>
          <button
            type="button"
            className={`admin-console__tab${activeTab === "members" ? " admin-console__tab--active" : ""}`}
            style={{
              padding: "0.5rem 1rem",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "members" ? "2px solid var(--gtn-ink-1, #0e1226)" : "none",
              fontWeight: activeTab === "members" ? 600 : 400,
              cursor: "pointer"
            }}
            onClick={() => setActiveTab("members")}
          >
            Members
          </button>
          <button
            type="button"
            className={`admin-console__tab${activeTab === "odoo_apps" ? " admin-console__tab--active" : ""}`}
            style={{
              padding: "0.5rem 1rem",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "odoo_apps" ? "2px solid var(--gtn-ink-1, #0e1226)" : "none",
              fontWeight: activeTab === "odoo_apps" ? 600 : 400,
              cursor: "pointer"
            }}
            onClick={() => setActiveTab("odoo_apps")}
          >
            Odoo Apps
          </button>
          <button
            type="button"
            className={`admin-console__tab${activeTab === "odoo_roles" ? " admin-console__tab--active" : ""}`}
            style={{
              padding: "0.5rem 1rem",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === "odoo_roles" ? "2px solid var(--gtn-ink-1, #0e1226)" : "none",
              fontWeight: activeTab === "odoo_roles" ? 600 : 400,
              cursor: "pointer"
            }}
            onClick={() => setActiveTab("odoo_roles")}
          >
            Odoo Roles
          </button>
        </div>

        {success && <p className="admin-console__success">{success}</p>}
        {error && <p className="admin-console__error">{error}</p>}

        {activeTab === "members" && (
          <>
            <div style={{ fontSize: "0.875rem", marginBottom: "1rem", color: "var(--gtn-ink-3)" }}>
              Select the members who belong to this group:
            </div>
            <div className="admin-console__toggle-group" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(14rem, 1fr))", gap: "0.5rem", marginBottom: "1rem" }}>
              {members.map((member) => {
                const isChecked = draftMemberIds.includes(member.id);
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
                      background: isChecked ? "var(--gtn-paper-1, #ece8df)" : "#fff",
                      cursor: "pointer",
                      userSelect: "none"
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={saveMutation.isPending}
                      onChange={() => {
                        setSuccess(null);
                        toggleMemberId(member.id);
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
          </>
        )}

        {activeTab === "odoo_apps" && (
          <>
            <div style={{ fontSize: "0.875rem", marginBottom: "1rem", color: "var(--gtn-ink-3)" }}>
              Select which Odoo apps are visible to members of this group in the portal:
            </div>
            {grantableAddons.length === 0 && (
              <div style={{ fontSize: "0.8125rem", marginBottom: "1rem", color: "var(--gtn-ink-3)" }}>
                No Odoo apps are installed for this tenant yet. Install them from the App
                Store first — only installed apps can be granted.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1rem" }}>
              {grantableAddons.map((mod) => {
                const isChecked = draftModules.includes(mod.id);
                return (
                  <label
                    key={mod.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.4rem 0.6rem",
                      border: "1px solid var(--gtn-border, rgba(14, 18, 38, 0.12))",
                      borderRadius: "2px",
                      background: isChecked ? "var(--gtn-paper-1, #ece8df)" : "#fff",
                      cursor: "pointer",
                      userSelect: "none"
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={saveMutation.isPending}
                      onChange={() => {
                        setSuccess(null);
                        setDraftModules((prev) =>
                          prev.includes(mod.id)
                            ? prev.filter((x) => x !== mod.id)
                            : [...prev, mod.id]
                        );
                      }}
                    />
                    <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>
                      {mod.label}
                    </span>
                    <span className="admin-console__mono" style={{ fontSize: "0.8125rem", color: "var(--gtn-ink-4)", marginLeft: "auto" }}>
                      {mod.id}
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {activeTab === "odoo_roles" && (
          <>
            <div style={{ fontSize: "0.875rem", marginBottom: "1rem", color: "var(--gtn-ink-3)" }}>
              Configure fine-grained Odoo access roles (res.groups external IDs) assigned to members of this group in Odoo:
            </div>
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", marginBottom: "1rem", minHeight: "2.5rem", padding: "0.5rem", border: "1px dashed var(--gtn-border)", borderRadius: "2px", background: "#fff" }}>
                {draftRoles.length === 0 && (
                  <span style={{ fontSize: "0.8125rem", color: "var(--gtn-ink-4)", alignSelf: "center" }}>
                    No Odoo roles configured for this group.
                  </span>
                )}
                {draftRoles.map((role) => (
                  <span
                    key={role}
                    className="admin-console__chip"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.25rem",
                      margin: 0,
                      padding: "0.2rem 0.5rem",
                      background: "#e3e8f4",
                      borderColor: "#abbce5",
                      borderWidth: "1px",
                      borderStyle: "solid",
                      borderRadius: "2px",
                      color: "#1a2a58"
                    }}
                  >
                    <span className="admin-console__mono" style={{ fontSize: "0.75rem" }}>{role}</span>
                    <button
                      type="button"
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "#9b2d2d",
                        cursor: "pointer",
                        padding: 0,
                        fontWeight: 600,
                        fontSize: "0.75rem"
                      }}
                      onClick={() => {
                        setSuccess(null);
                        setDraftRoles((prev) => prev.filter((x) => x !== role));
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>

              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                <input
                  type="text"
                  placeholder="e.g. crm.group_crm_user"
                  value={newRoleInput}
                  disabled={saveMutation.isPending}
                  onChange={(e) => setNewRoleInput(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "0.45rem 0.6rem",
                    border: "1px solid var(--gtn-border, rgba(14, 18, 38, 0.12))",
                    borderRadius: "2px",
                    fontFamily: "Commit Mono",
                    fontSize: "0.8125rem"
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const trimmed = newRoleInput.trim();
                      if (trimmed && !draftRoles.includes(trimmed)) {
                        setDraftRoles((prev) => [...prev, trimmed]);
                        setNewRoleInput("");
                        setSuccess(null);
                      }
                    }
                  }}
                />
                <button
                  type="button"
                  className="admin-console__btn"
                  disabled={saveMutation.isPending}
                  onClick={() => {
                    const trimmed = newRoleInput.trim();
                    if (trimmed && !draftRoles.includes(trimmed)) {
                      setDraftRoles((prev) => [...prev, trimmed]);
                      setNewRoleInput("");
                      setSuccess(null);
                    }
                  }}
                >
                  + Add Role
                </button>
              </div>

              <div>
                <div style={{ fontSize: "0.75rem", fontWeight: 600, textTransform: "uppercase", color: "var(--gtn-ink-4)", marginBottom: "0.5rem" }}>
                  Suggested Roles:
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                  {[
                    { id: "crm.group_crm_user", label: "CRM User" },
                    { id: "crm.group_crm_manager", label: "CRM Manager" },
                    { id: "base.group_partner_manager", label: "Contacts Manager" },
                    { id: "calendar.group_calendar_user", label: "Calendar User" },
                    { id: "base.group_user", label: "Internal User" }
                  ].map((sug) => {
                    const alreadyAdded = draftRoles.includes(sug.id);
                    return (
                      <button
                        key={sug.id}
                        type="button"
                        className="admin-console__btn"
                        disabled={alreadyAdded || saveMutation.isPending}
                        style={{ opacity: alreadyAdded ? 0.5 : 1, fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                        onClick={() => {
                          setSuccess(null);
                          if (!draftRoles.includes(sug.id)) {
                            setDraftRoles((prev) => [...prev, sug.id]);
                          }
                        }}
                      >
                        + {sug.label} ({sug.id})
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="admin-console__form-footer">
          <button
            type="button"
            className="admin-console__btn admin-console__btn--primary"
            style={{ marginRight: "0.5rem" }}
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? "Saving..." : "Save changes"}
          </button>
          <button
            type="button"
            className="admin-console__btn"
            disabled={saveMutation.isPending}
            onClick={handleReset}
          >
            Reset
          </button>
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
      updateGroup(id, nextName, undefined, undefined, tenant),
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
        <h2 className="admin-console__section-title">
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

/* SPDX-License-Identifier: Apache-2.0 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  addRoleHolder,
  fetchGrantedPrivileges,
  fetchPlatformRoleMembers,
  fetchRoleCandidates,
  fetchRoleHolders,
  removeRoleHolder,
  type ClusterRole,
  type PlatformRoleMembers,
  type RoleCandidates,
  type RoleHolder,
} from "@/api/cluster";
import "./admin.css";
import { formatDateTime } from "@/lib/format";

const ROLES: ClusterRole[] = ["securityOfficer", "auditor", "perimeterApprover", "serviceAdmin", "sharedAppsAdmin"];
/** The roles a non-platform tenant's administrator may hold; the rest are the platform tenant's people's. */
const TENANT_ADMIN_ROLES: ClusterRole[] = ["securityOfficer", "auditor", "perimeterApprover"];

/** Where a holder's role applies, as the director decides it. */
function scopeOf(role: ClusterRole, entry: RoleCandidates) {
  return role === "perimeterApprover" && !entry.platform ? `tenant:${entry.tenant}` : "cluster";
}

/**
 * Who holds a cluster role by name: an account of a tenant's realm, declared
 * on the Cluster claim with a reason and an optional expiry. The holder signs
 * in to their own tenant and works in its admin console. The director answers
 * the list (can_audit) and commits a change (can_configure); the picker is the
 * registrar's list: the platform tenant's people, and every other tenant's
 * administrators for the roles they may hold. `canEdit` only decides which
 * buttons are shown.
 *
 * Beside them, read only: who holds each role through its kernel Keycloak
 * group (the registrar's answer; the groups are managed in Keycloak), and
 * every tenant's granted privilege exceptions (the director's answer).
 */
export function RoleHoldersSection({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const holdersQuery = useQuery({
    queryKey: ["admin", "platform", "role-holders"],
    queryFn: () => fetchRoleHolders(),
  });
  const candidatesQuery = useQuery({
    queryKey: ["admin", "platform", "role-candidates"],
    queryFn: () => fetchRoleCandidates(),
    enabled: canEdit,
    retry: false,
  });
  const membersQuery = useQuery({
    queryKey: ["admin", "platform", "role-members"],
    queryFn: () => fetchPlatformRoleMembers(),
    retry: false,
  });
  const grantsQuery = useQuery({
    queryKey: ["admin", "platform", "granted-privileges"],
    queryFn: () => fetchGrantedPrivileges(),
    retry: false,
  });
  const [role, setRole] = useState<ClusterRole>("securityOfficer");
  const [choice, setChoice] = useState("");
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "platform", "role-holders"] });
  const fail = (err: Error) => {
    setNotice(null);
    setError(err.message);
  };

  const addMutation = useMutation({
    mutationFn: (pick: Parameters<typeof addRoleHolder>[0]) => addRoleHolder(pick),
    onSuccess: async (result, pick) => {
      setError(null);
      setChoice("");
      setReason("");
      setExpires("");
      const values = { login: pick.username, tenant: pick.tenant };
      setNotice(t(result.changed ? "clusterRoles.addedCommitted" : "clusterRoles.addedAlready", values));
      await refresh();
    },
    onError: fail,
  });
  const removeMutation = useMutation({
    mutationFn: (holder: RoleHolder) => removeRoleHolder(holder),
    onSuccess: async (_result, holder) => {
      setError(null);
      setNotice(t("clusterRoles.removedCommitted", { login: holder.username, tenant: holder.tenant }));
      await refresh();
    },
    onError: fail,
  });

  if (holdersQuery.isLoading) {
    return <p className="admin-console__loading">{t("clusterRoles.loading")}</p>;
  }
  if (holdersQuery.isError || !holdersQuery.data) {
    return <p className="admin-console__error">{t("clusterRoles.unavailable")}</p>;
  }

  const holders = holdersQuery.data.roleHolders ?? [];
  const held = new Set(holders.filter((h) => h.role === role).map((h) => `${h.tenant}/${h.subject}`));
  const tenants: RoleCandidates[] = (candidatesQuery.data?.tenants ?? []).filter(
    (entry) => entry.platform || TENANT_ADMIN_ROLES.includes(role),
  );
  const candidates = tenants.flatMap((entry) =>
    (entry.people ?? [])
      .filter((a) => !held.has(`${entry.tenant}/${a.id}`))
      .map((a) => ({ key: `${entry.tenant}/${a.id}`, tenant: entry.tenant, scope: scopeOf(role, entry), admin: a })),
  );
  const picked = candidates.find((c) => c.key === choice);
  const unreadable = tenants.filter((entry) => entry.unavailable).map((entry) => entry.tenant);
  const groups: PlatformRoleMembers[] = membersQuery.data?.roles ?? [];
  const shownRoles: string[] = [...ROLES, ...groups.map((g) => g.role).filter((r) => !(ROLES as string[]).includes(r))];
  const roleOrder = shownRoles.filter((r, i) => shownRoles.indexOf(r) === i);
  const grants = grantsQuery.data?.privileges ?? [];

  return (
    <section>
      <header className="admin-console__section-head">
        <div>
          <h2 className="admin-console__section-title">{t("clusterRoles.title")}</h2>
          <p className="admin-console__lead">{t("clusterRoles.lead")}</p>
        </div>
      </header>

      {error ? <p className="admin-console__error">{error}</p> : null}
      {notice ? <p className="admin-console__success">{notice}</p> : null}

      {membersQuery.isError ? <p className="admin-console__hint">{t("clusterRoles.membersUnavailable")}</p> : null}
      {roleOrder.map((r) => {
        const ofRole = holders.filter((h) => h.role === r);
        const named = (ROLES as string[]).includes(r);
        return (
          <div key={r}>
            <h3 className="admin-console__subsection-title">{t(`clusterRoles.role_${r}`, { defaultValue: r })}</h3>
            {!named ? null : ofRole.length === 0 ? (
              <p className="admin-console__empty">{t("clusterRoles.nobodyYet")}</p>
            ) : (
              <div className="admin-console__table-wrap">
                <table className="admin-console__table">
                  <thead>
                    <tr>
                      <th>{t("clusterRoles.tenant")}</th>
                      <th>{t("clusterRoles.login")}</th>
                      <th>{t("clusterRoles.email")}</th>
                      <th>{t("clusterRoles.scope")}</th>
                      <th>{t("clusterRoles.reason")}</th>
                      <th>{t("clusterRoles.expires")}</th>
                      {canEdit ? <th /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {ofRole.map((holder) => (
                      <tr key={`${holder.tenant}/${holder.subject}`}>
                        <td className="admin-console__mono">{holder.tenant}</td>
                        <td>
                          {holder.username}
                          <div className="admin-console__card-meta admin-console__mono">{holder.subject}</div>
                          {holder.notInEffect && holder.notInEffect !== "expired" ? (
                            <span className="admin-console__badge admin-console__badge--warn">
                              {t("clusterRoles.notAdministrator", { tenant: holder.tenant })}
                            </span>
                          ) : null}
                        </td>
                        <td>{holder.email || "—"}</td>
                        <td className="admin-console__mono">{holder.scope || "cluster"}</td>
                        <td>{holder.reason || "—"}</td>
                        <td>
                          {holder.expiresAt ? formatDateTime(holder.expiresAt) : "—"}
                          {holder.expiresAt && new Date(holder.expiresAt).getTime() < Date.now() ? (
                            <>
                              {" "}
                              <span className="admin-console__badge admin-console__badge--warn">
                                {t("clusterRoles.expired")}
                              </span>
                            </>
                          ) : null}
                        </td>
                        {canEdit ? (
                          <td>
                            <button
                              type="button"
                              className="admin-console__btn admin-console__btn--danger"
                              disabled={removeMutation.isPending}
                              onClick={() => removeMutation.mutate(holder)}
                            >
                              {t("clusterRoles.remove")}
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {groups
              .filter((g) => g.role === r)
              .map((g) => (
                <div key={g.group}>
                  <p className="admin-console__card-meta">
                    {t("clusterRoles.throughGroup", { group: g.group })}{" "}
                    {g.unavailable
                      ? t("clusterRoles.groupUnavailable")
                      : (g.members ?? []).length === 0
                        ? t("clusterRoles.groupEmpty")
                        : (g.members ?? []).map((m) => m.username + (m.email && m.email !== m.username ? ` <${m.email}>` : "")).join(", ")}
                  </p>
                </div>
              ))}
          </div>
        );
      })}
      {groups.length > 0 ? <p className="admin-console__hint">{t("clusterRoles.groupManaged")}</p> : null}

      <h3 className="admin-console__subsection-title">{t("clusterRoles.grantedTitle")}</h3>
      {grantsQuery.isLoading ? (
        <p className="admin-console__loading">{t("clusterRoles.grantedLoading")}</p>
      ) : grantsQuery.isError ? (
        <p className="admin-console__empty">{t("clusterRoles.grantedUnavailable")}</p>
      ) : grants.length === 0 ? (
        <p className="admin-console__empty">{t("clusterRoles.grantedNone")}</p>
      ) : (
        <div className="admin-console__table-wrap">
          <table className="admin-console__table">
            <thead>
              <tr>
                <th>{t("clusterRoles.tenant")}</th>
                <th>{t("clusterRoles.app")}</th>
                <th>{t("clusterRoles.exception")}</th>
                <th>{t("clusterRoles.reason")}</th>
                <th>{t("clusterRoles.approvedBy")}</th>
                <th>{t("clusterRoles.approvedAt")}</th>
                <th>{t("clusterRoles.expires")}</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={`${g.tenant}/${g.install}/${g.privilege}`}>
                  <td className="admin-console__mono">{g.tenant}</td>
                  <td className="admin-console__mono">{g.install}</td>
                  <td className="admin-console__mono">{g.privilege}</td>
                  <td>{g.reason}</td>
                  <td className="admin-console__mono">{g.approver}</td>
                  <td>{g.approvedAt ? formatDateTime(g.approvedAt) : "—"}</td>
                  <td>{g.expiresAt ? formatDateTime(g.expiresAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit ? (
        <>
          <h3 className="admin-console__subsection-title">{t("clusterRoles.add")}</h3>
          {candidatesQuery.isLoading ? (
            <p className="admin-console__loading">{t("clusterRoles.loadingCandidates")}</p>
          ) : candidatesQuery.isError ? (
            <p className="admin-console__empty">{t("clusterRoles.candidatesUnavailable")}</p>
          ) : (
            <form
              className="admin-console__form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!picked || !reason.trim()) return;
                addMutation.mutate({
                  role,
                  tenant: picked.tenant,
                  subject: picked.admin.id,
                  username: picked.admin.username,
                  email: picked.admin.email ?? "",
                  reason: reason.trim(),
                  ...(expires ? { expiresAt: new Date(expires).toISOString() } : {}),
                });
              }}
            >
              <div className="admin-console__field">
                <label htmlFor="role-holder-role">{t("clusterRoles.role")}</label>
                <select
                  id="role-holder-role"
                  value={role}
                  onChange={(e) => {
                    setRole(e.target.value as ClusterRole);
                    setChoice("");
                  }}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`clusterRoles.role_${r}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="admin-console__field">
                <label htmlFor="role-holder-pick">{t("clusterRoles.person")}</label>
                <select id="role-holder-pick" value={choice} onChange={(e) => setChoice(e.target.value)}>
                  <option value="">{t("clusterRoles.choose")}</option>
                  {tenants
                    .filter((entry) => candidates.some((c) => c.tenant === entry.tenant))
                    .map((entry) => (
                      <optgroup
                        key={entry.tenant}
                        label={
                          entry.displayName && entry.displayName !== entry.tenant
                            ? `${entry.displayName} (${entry.tenant})`
                            : entry.tenant
                        }
                      >
                        {candidates
                          .filter((c) => c.tenant === entry.tenant)
                          .map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.admin.username}
                              {c.admin.name ? ` — ${c.admin.name}` : ""}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                </select>
              </div>
              {picked ? (
                <p className="admin-console__hint">
                  {t("clusterRoles.scopeIs")} <span className="admin-console__mono">{picked.scope}</span>
                </p>
              ) : null}
              <div className="admin-console__field">
                <label htmlFor="role-holder-reason">{t("clusterRoles.reason")}</label>
                <textarea
                  id="role-holder-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  maxLength={1000}
                  rows={2}
                />
              </div>
              <div className="admin-console__field">
                <label htmlFor="role-holder-expires">{t("clusterRoles.expiresOptional")}</label>
                <input id="role-holder-expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
              </div>
              {candidates.length === 0 ? <p className="admin-console__empty">{t("clusterRoles.noCandidates")}</p> : null}
              {unreadable.length > 0 ? (
                <p className="admin-console__hint">
                  {t("clusterRoles.someRealmsUnread", { tenants: unreadable.join(", ") })}
                </p>
              ) : null}
              <div className="admin-console__actions">
                <button
                  type="submit"
                  className="admin-console__btn admin-console__btn--primary"
                  disabled={!picked || !reason.trim() || addMutation.isPending}
                >
                  {t("clusterRoles.addButton")}
                </button>
              </div>
            </form>
          )}
        </>
      ) : null}
    </section>
  );
}

/* SPDX-License-Identifier: Apache-2.0 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  addRoleHolder,
  fetchRoleHolders,
  fetchTenantAdministrators,
  removeRoleHolder,
  type ClusterRole,
  type RoleHolder,
  type TenantAdministrators,
} from "@/api/cluster";
import "./admin.css";

const ROLES: ClusterRole[] = ["securityOfficer", "auditor"];

/**
 * Who holds a cluster role by name: an account of a tenant's realm, declared
 * on the Cluster claim. The holder signs in to their own tenant and works in
 * its admin console. The director answers the list (can_audit) and commits a
 * change (can_configure); the picker is the registrar's list of each tenant's
 * administrators. `canEdit` only decides which buttons are shown.
 */
export function RoleHoldersSection({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const holdersQuery = useQuery({
    queryKey: ["admin", "platform", "role-holders"],
    queryFn: () => fetchRoleHolders(),
  });
  const candidatesQuery = useQuery({
    queryKey: ["admin", "platform", "tenant-administrators"],
    queryFn: () => fetchTenantAdministrators(),
    enabled: canEdit,
    retry: false,
  });
  const [role, setRole] = useState<ClusterRole>("securityOfficer");
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "platform", "role-holders"] });
  const fail = (err: Error) => {
    setNotice(null);
    setError(err.message);
  };

  const addMutation = useMutation({
    mutationFn: (pick: { role: ClusterRole; tenant: string; id: string; username: string; email: string }) =>
      addRoleHolder(pick.role, pick.tenant, pick.id, pick.username, pick.email),
    onSuccess: async (result, pick) => {
      setError(null);
      setChoice("");
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
  const tenants: TenantAdministrators[] = candidatesQuery.data?.tenants ?? [];
  const candidates = tenants.flatMap((entry) =>
    (entry.administrators ?? [])
      .filter((a) => !held.has(`${entry.tenant}/${a.id}`))
      .map((a) => ({ key: `${entry.tenant}/${a.id}`, tenant: entry.tenant, admin: a })),
  );
  const picked = candidates.find((c) => c.key === choice);
  const unreadable = tenants.filter((entry) => entry.unavailable).map((entry) => entry.tenant);

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

      {ROLES.map((r) => {
        const ofRole = holders.filter((h) => h.role === r);
        return (
          <div key={r}>
            <h3 className="admin-console__subsection-title">{t(`clusterRoles.role_${r}`)}</h3>
            {ofRole.length === 0 ? (
              <p className="admin-console__empty">{t("clusterRoles.nobodyYet")}</p>
            ) : (
              <div className="admin-console__table-wrap">
                <table className="admin-console__table">
                  <thead>
                    <tr>
                      <th>{t("clusterRoles.tenant")}</th>
                      <th>{t("clusterRoles.login")}</th>
                      <th>{t("clusterRoles.email")}</th>
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
                        </td>
                        <td>{holder.email || "—"}</td>
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
          </div>
        );
      })}

      {canEdit ? (
        <>
          <h3 className="admin-console__subsection-title">{t("clusterRoles.add")}</h3>
          {candidatesQuery.isLoading ? (
            <p className="admin-console__loading">{t("clusterRoles.loadingAdministrators")}</p>
          ) : candidatesQuery.isError ? (
            <p className="admin-console__empty">{t("clusterRoles.administratorsUnavailable")}</p>
          ) : (
            <form
              className="admin-console__form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!picked) return;
                addMutation.mutate({
                  role,
                  tenant: picked.tenant,
                  id: picked.admin.id,
                  username: picked.admin.username,
                  email: picked.admin.email ?? "",
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
                <label htmlFor="role-holder-pick">{t("clusterRoles.administrator")}</label>
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
                  disabled={!picked || addMutation.isPending}
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

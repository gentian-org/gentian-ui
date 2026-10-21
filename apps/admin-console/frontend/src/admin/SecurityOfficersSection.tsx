/* SPDX-License-Identifier: Apache-2.0 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  addSecurityOfficer,
  fetchSecurityOfficers,
  fetchTenantAdministrators,
  removeSecurityOfficer,
  type SecurityOfficer,
  type TenantAdministrators,
} from "@/api/cluster";
import "./admin.css";

/**
 * Who holds cluster#security_officer: the administrators of the cluster's
 * tenants the cluster's administrator picks, declared on the Cluster claim.
 *
 * Nothing here touches Keycloak or the authorization graph. The picker is the
 * registrar's list of each tenant's administrators; the choice is one commit
 * by the director; the platform tenant's composition then renders the
 * person's linked account in the kernel realm and its one membership, and
 * Keycloak's events carry the membership to the graph. The person signs in at
 * the platform's address with their own tenant account, through the kernel
 * realm's identity provider for that tenant, and enrols an authenticator the
 * kernel realm keeps for them.
 */
export function SecurityOfficersSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const holdersQuery = useQuery({
    queryKey: ["admin", "platform", "security-officers"],
    queryFn: () => fetchSecurityOfficers(),
  });
  const candidatesQuery = useQuery({
    queryKey: ["admin", "platform", "tenant-administrators"],
    queryFn: () => fetchTenantAdministrators(),
    retry: false,
  });
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "platform", "security-officers"] });

  const addMutation = useMutation({
    mutationFn: (pick: { tenant: string; id: string; username: string; email: string }) =>
      addSecurityOfficer(pick.tenant, pick.id, pick.username, pick.email),
    onSuccess: async (result, pick) => {
      setError(null);
      setChoice("");
      setNotice(
        result.changed
          ? t("securityOfficers.namedCommitted", { login: pick.username, tenant: pick.tenant })
          : t("securityOfficers.namedAlready", { login: pick.username, tenant: pick.tenant }),
      );
      await refresh();
    },
    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
    },
  });
  const removeMutation = useMutation({
    mutationFn: (holder: SecurityOfficer) => removeSecurityOfficer(holder.tenant, holder.subject),
    onSuccess: async (_result, holder) => {
      setError(null);
      setNotice(t("securityOfficers.removedCommitted", { login: holder.username, tenant: holder.tenant }));
      await refresh();
    },
    onError: (err: Error) => {
      setNotice(null);
      setError(err.message);
    },
  });

  if (holdersQuery.isLoading) {
    return <p className="admin-console__loading">{t("securityOfficers.loading")}</p>;
  }
  if (holdersQuery.isError || !holdersQuery.data) {
    return <p className="admin-console__error">{t("securityOfficers.unavailable")}</p>;
  }

  const holders = holdersQuery.data.securityOfficers;
  const held = new Set(holders.map((h) => `${h.tenant}/${h.subject}`));
  const tenants: TenantAdministrators[] = candidatesQuery.data?.tenants ?? [];
  // The picker's entries: every administrator of every tenant who is not a
  // holder yet, keyed the way the claim keys them.
  const candidates = tenants.flatMap((entry) =>
    (entry.administrators ?? [])
      .filter((a) => !held.has(`${entry.tenant}/${a.id}`))
      .map((a) => ({ key: `${entry.tenant}/${a.id}`, tenant: entry.tenant, displayName: entry.displayName, admin: a })),
  );
  const picked = candidates.find((c) => c.key === choice);
  const unreadable = tenants.filter((entry) => entry.unavailable).map((entry) => entry.tenant);

  return (
    <section>
      <header className="admin-console__section-head">
        <div>
          <h2 className="admin-console__section-title">{t("securityOfficers.title")}</h2>
          <p className="admin-console__lead">{t("securityOfficers.lead")}</p>
        </div>
      </header>

      {error ? <p className="admin-console__error">{error}</p> : null}
      {notice ? <p className="admin-console__success">{notice}</p> : null}

      <h3 className="admin-console__subsection-title">{t("securityOfficers.whoHoldsIt")}</h3>
      {holders.length === 0 ? (
        <p className="admin-console__empty">{t("securityOfficers.nobodyYet")}</p>
      ) : (
        <div className="admin-console__table-wrap">
          <table className="admin-console__table">
            <thead>
              <tr>
                <th>{t("securityOfficers.tenant")}</th>
                <th>{t("securityOfficers.login")}</th>
                <th>{t("securityOfficers.email")}</th>
                <th>{t("securityOfficers.signsInAt")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {holders.map((holder) => (
                <tr key={`${holder.tenant}/${holder.subject}`}>
                  <td className="admin-console__mono">{holder.tenant}</td>
                  <td>
                    {holder.username}
                    <div className="admin-console__card-meta admin-console__mono">{holder.subject}</div>
                  </td>
                  <td>{holder.email || "—"}</td>
                  <td>
                    {holder.signIn ? (
                      <a className="admin-console__mono" href={holder.signIn} target="_blank" rel="noreferrer">
                        {holder.signIn}
                      </a>
                    ) : (
                      <span className="admin-console__mono">{holder.identityProvider}</span>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="admin-console__btn admin-console__btn--danger"
                      disabled={removeMutation.isPending}
                      onClick={() => removeMutation.mutate(holder)}
                    >
                      {t("securityOfficers.remove")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="admin-console__subsection-title">{t("securityOfficers.nameOne")}</h3>
      <p className="admin-console__hint">{t("securityOfficers.pickerHint")}</p>
      {candidatesQuery.isLoading ? (
        <p className="admin-console__loading">{t("securityOfficers.loadingAdministrators")}</p>
      ) : candidatesQuery.isError ? (
        <p className="admin-console__empty">
          <Trans i18nKey="securityOfficers.administratorsUnavailable" components={{ code: <code /> }} />
        </p>
      ) : (
        <form
          className="admin-console__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!picked) return;
            addMutation.mutate({
              tenant: picked.tenant,
              id: picked.admin.id,
              username: picked.admin.username,
              email: picked.admin.email ?? "",
            });
          }}
        >
          <div className="admin-console__field">
            <label htmlFor="security-officer-pick">{t("securityOfficers.administrator")}</label>
            <select id="security-officer-pick" value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">{t("securityOfficers.choose")}</option>
              {tenants
                .filter((entry) => candidates.some((c) => c.tenant === entry.tenant))
                .map((entry) => (
                  <optgroup key={entry.tenant} label={entry.displayName && entry.displayName !== entry.tenant ? `${entry.displayName} (${entry.tenant})` : entry.tenant}>
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
          {candidates.length === 0 ? (
            <p className="admin-console__empty">{t("securityOfficers.noCandidates")}</p>
          ) : null}
          {unreadable.length > 0 ? (
            <p className="admin-console__hint">
              {t("securityOfficers.someRealmsUnread", { tenants: unreadable.join(", ") })}
            </p>
          ) : null}
          <div className="admin-console__actions">
            <button
              type="submit"
              className="admin-console__btn admin-console__btn--primary"
              disabled={!picked || addMutation.isPending}
            >
              {t("securityOfficers.makeSecurityOfficer")}
            </button>
          </div>
        </form>
      )}

      <h3 className="admin-console__subsection-title">{t("securityOfficers.howItWorks")}</h3>
      <p className="admin-console__hint">{t("securityOfficers.howItWorksBody")}</p>
      <p className="admin-console__hint">
        <Trans i18nKey="securityOfficers.secondFactorHint" components={{ code: <code /> }} />
      </p>
    </section>
  );
}

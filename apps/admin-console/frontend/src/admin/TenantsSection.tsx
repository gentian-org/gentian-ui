import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  createClusterTenant,
  fetchClusterTenants,
  purgeClusterTenant,
  retireClusterTenant,
} from "@/api/cluster";
import { AdminActivationPanel } from "./AdminActivationPanel";
import { RetireTenantDialog, type RetireMode } from "./RetireTenantDialog";
import { ImportTenantCard } from "./ImportTenantCard";
import "./admin.css";
import { Trans, useTranslation } from "react-i18next";

/**
 * The customers this cluster carries.
 *
 * This is the errand the console exists for. An MSP employee takes a customer
 * on, and what that means here is one commit to the deployments repository:
 * Argo CD syncs it, the operator provisions the realm, the namespaces, the
 * database and the desktop, and the tenant exists. Nothing on this screen
 * touches the cluster.
 *
 * A name is asked for once and cannot be changed, because it becomes a
 * namespace, a Keycloak realm, a database prefix and a hostname, and none of
 * those can be renamed afterwards without moving data. The screen says so
 * before the field rather than after the refusal.
 */
export function TenantsSection() {
  const { t } = useTranslation();

  const queryClient = useQueryClient();
  const tenantsQuery = useQuery({
    queryKey: ["cluster", "tenants"],
    queryFn: () => fetchClusterTenants(),
  });
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [requireMFA, setRequireMFA] = useState(true);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  // The administrator account being handed over: right after creating a
  // tenant (waiting out its provisioning), or for an existing one on request.
  const [activating, setActivating] = useState<{ tenant: string; email: string; auto: boolean } | null>(null);
  const [lastCommit, setLastCommit] = useState<string | null>(null);
  // Retiring or purging asks in a dialog, behind the tenant's name typed out.
  const [confirming, setConfirming] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["cluster", "tenants"] });

  const createMutation = useMutation({
    mutationFn: () => createClusterTenant(name.trim(), displayName.trim(), requireMFA),
    onSuccess: (result) => {
      setActivating({ tenant: name.trim(), email: recoveryEmail.trim(), auto: true });
      setName("");
      setDisplayName("");
      setRecoveryEmail("");
      setRequireMFA(true);
      setLastCommit(result.commit ?? null);
      void invalidate();
    },
  });
  const retireMutation = useMutation({
    mutationFn: ({ tenant, mode, keepBundles }: { tenant: string; mode: RetireMode; keepBundles: boolean }) =>
      mode === "purge" ? purgeClusterTenant(tenant, keepBundles) : retireClusterTenant(tenant),
    onSuccess: (result) => {
      setConfirming(null);
      setLastCommit(result.commit ?? null);
      void invalidate();
    },
  });

  // The same rule the director enforces, checked here so the field can say
  // what is wrong while it is being typed rather than after a round trip.
  const nameIsValid = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name.trim());
  const nameTouched = name.length > 0;

  if (tenantsQuery.isLoading) {
    return <p className="admin-console__loading">{t("tenants.loadingTenants")}</p>;
  }
  if (tenantsQuery.isError || !tenantsQuery.data) {
    return (
      <p className="admin-console__error">
        {t("tenants.tenantsAreUnavailableThisNeeds")}</p>
    );
  }

  const { tenants } = tenantsQuery.data;

  return (
    <section>
      <header className="admin-console__section-head">
        <div>
          <h2 className="admin-console__section-title">{t("tenants.tenants")}</h2>
          <p className="admin-console__lead">
            {t("tenants.eachTenantIsAManifest")}</p>
        </div>
      </header>

      {lastCommit ? (
        <p className="admin-console__success">
          <Trans
            i18nKey="tenants.committedAs"
            values={{ commit: lastCommit.slice(0, 8) }}
            components={{ mono: <span className="admin-console__mono" /> }}
          />
        </p>
      ) : null}
      {createMutation.isError ? (
        <p className="admin-console__error">
          {(createMutation.error as Error).message || t("tenants.couldNotCreate")}
        </p>
      ) : null}

      {activating && (
        <AdminActivationPanel
          key={activating.tenant}
          tenant={activating.tenant}
          initialEmail={activating.email}
          auto={activating.auto}
          onClose={() => setActivating(null)}
        />
      )}

      <div className="admin-console__table-wrap">
        <table className="admin-console__table">
          <thead>
            <tr>
              <th>{t("tenants.tenant")}</th>
              <th>{t("tenants.realm")}</th>
              <th>{t("tenants.apps")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tenants.length === 0 ? (
              <tr>
                <td colSpan={4} className="admin-console__empty">
                  {t("tenants.noTenantsYet")}</td>
              </tr>
            ) : null}
            {tenants.map((tenant) => (
              <tr key={tenant.name}>
                <td>
                  <span className="admin-console__mono">{tenant.name}</span>
                  {tenant.displayName && tenant.displayName !== tenant.name ? (
                    <div className="admin-console__card-meta">{tenant.displayName}</div>
                  ) : null}
                </td>
                <td className="admin-console__mono">{tenant.realm ?? "—"}</td>
                <td>{tenant.apps.length === 0 ? "—" : tenant.apps.join(", ")}</td>
                <td>
                  <span className="admin-console__actions">
                    {tenant.purging ? null : (
                      <button
                        type="button"
                        className="admin-console__btn admin-console__btn--quiet"
                        onClick={() => setActivating({ tenant: tenant.name, email: "", auto: false })}
                      >
                        {t("tenants.activateAdmin")}
                      </button>
                    )}
                    {tenant.protected ? (
                      <span
                        className="admin-console__badge admin-console__badge--info"
                        title={t("tenants.thisTenantCarriesTheRealm")}
                      >
                        {t("tenants.protected")}</span>
                    ) : tenant.purging ? (
                      <span
                        className="admin-console__badge admin-console__badge--warn"
                        title={t("tenants.purgingHint")}
                      >
                        {t("tenants.purging")}</span>
                    ) : (
                      <button
                        type="button"
                        className="admin-console__btn admin-console__btn--danger"
                        onClick={() => {
                          retireMutation.reset();
                          setConfirming(tenant.name);
                        }}
                      >
                        {t("tenants.retire")}</button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirming ? (
        <RetireTenantDialog
          tenant={confirming}
          pending={retireMutation.isPending}
          error={
            retireMutation.isError
              ? (retireMutation.error as Error).message || t("tenants.couldNotRetire")
              : undefined
          }
          onConfirm={(mode, { keepBundles }) => retireMutation.mutate({ tenant: confirming, mode, keepBundles })}
          onClose={() => setConfirming(null)}
        />
      ) : null}

      <div className="admin-console__subsection">
        <h3 className="admin-console__subsection-title">{t("tenants.bringATenantOn")}</h3>
        <form
          className="admin-console__form admin-console__form--plain"
          onSubmit={(event) => {
            event.preventDefault();
            setLastCommit(null);
            createMutation.mutate();
          }}
        >
          <div className="admin-console__field">
            <label className="admin-console__label" htmlFor="tenant-name">
              <span className="admin-console__label-text">{t("tenants.name")}</span>
              <input
                id="tenant-name"
                type="text"
                value={name}
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <p className={nameTouched && !nameIsValid ? "admin-console__field-error" : "admin-console__hint"}>
              {t("tenants.lowerCaseLettersDigitsAnd")}</p>
          </div>
          <div className="admin-console__field">
            <label className="admin-console__label" htmlFor="tenant-display">
              <span className="admin-console__label-text">{t("tenants.displayName")}</span>
              <input
                id="tenant-display"
                type="text"
                value={displayName}
                autoComplete="off"
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <p className="admin-console__hint">
              {t("tenants.whatPeopleCallThisCustomer")}</p>
          </div>
          <div className="admin-console__field">
            <label className="admin-console__label" htmlFor="tenant-admin-email">
              <span className="admin-console__label-text">{t("tenants.recoveryEmail")}</span>
              <input
                id="tenant-admin-email"
                type="email"
                value={recoveryEmail}
                autoComplete="off"
                placeholder={t("tenants.recoveryEmailPlaceholder")}
                onChange={(event) => setRecoveryEmail(event.target.value)}
              />
            </label>
            <p className="admin-console__hint">{t("tenants.recoveryEmailHint")}</p>
          </div>
          <label className="admin-console__checkbox">
            <input type="checkbox" checked={requireMFA} onChange={(e) => setRequireMFA(e.target.checked)} />
            <span>{t("tenants.requireMFA")}</span>
          </label>
          <div className="admin-console__form-footer">
            <button
              type="submit"
              className="admin-console__btn admin-console__btn--primary"
              disabled={!nameIsValid || createMutation.isPending}
            >
              {createMutation.isPending ? "Committing…" : t("tenants.commitNewTenant")}
            </button>
          </div>
        </form>
      </div>

      <ImportTenantCard />
    </section>
  );
}

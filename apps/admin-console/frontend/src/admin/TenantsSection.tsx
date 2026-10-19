import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  createClusterTenant,
  fetchClusterTenants,
  fetchPendingAdminInvitations,
  purgeClusterTenant,
  requestAdminInvitation,
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
/** A country's name in a language, or null where the browser knows none. */
function regionName(language: string, code: string): string | null {
  try {
    const name = new Intl.DisplayNames([language], { type: "region", fallback: "none" }).of(code);
    return name ?? null;
  } catch {
    return null;
  }
}

export function TenantsSection() {
  const { t, i18n } = useTranslation();

  const queryClient = useQueryClient();
  const tenantsQuery = useQuery({
    queryKey: ["cluster", "tenants"],
    queryFn: () => fetchClusterTenants(),
  });
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [requireMFA, setRequireMFA] = useState(true);
  // ISO 3166-1 alpha-2, or empty for none.
  const [country, setCountry] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  // The administrator account being handed over: right after creating a
  // tenant (waiting out its provisioning), or for an existing one on request.
  // `invited` is a tenant whose invitation the registrar has taken: it is
  // sent from there, and the panel only reports. `notKept` is why the
  // registrar did not take it, when the panel has to send it after all.
  const [activating, setActivating] = useState<{
    tenant: string;
    email: string;
    auto: boolean;
    invited?: boolean;
    notKept?: string;
  } | null>(null);
  // The tenants whose administrator's invitation the registrar holds. A
  // person who may not ask for one is not told, and the screen is as before.
  const invitationsQuery = useQuery({
    queryKey: ["cluster", "admin-invitations"],
    queryFn: () => fetchPendingAdminInvitations(),
    refetchInterval: 30 * 1000,
    retry: false,
  });
  const invitationPending = new Set(invitationsQuery.data ?? []);
  const invalidateInvitations = () =>
    queryClient.invalidateQueries({ queryKey: ["cluster", "admin-invitations"] });
  // The tenant the cluster does not have yet, as the open panel learned by
  // asking: its activation is not offered a second time in its row.
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const [lastCommit, setLastCommit] = useState<string | null>(null);
  // Retiring or purging asks in a dialog, behind the tenant's name typed out.
  const [confirming, setConfirming] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["cluster", "tenants"] });

  const createMutation = useMutation({
    mutationFn: async () => {
      const tenant = name.trim();
      const email = recoveryEmail.trim();
      const result = await createClusterTenant(tenant, displayName.trim(), requireMFA, country.trim());
      // The tenant is committed. With an address, the invitation is handed to
      // the registrar now: it keeps the request and mails the invitation when
      // the tenant is ready, whether or not this page is still open. Without
      // one the link has to be shown to somebody, so the panel waits for it.
      // A registrar that does not take the request is not a tenant that
      // failed: the panel then sends the invitation itself, as it used to.
      let invited = false;
      let notKept: string | undefined;
      if (email) {
        try {
          await requestAdminInvitation(tenant, email);
          invited = true;
        } catch (err) {
          notKept = (err as Error).message || t("tenants.couldNotCreate");
        }
      }
      return { result, tenant, email, invited, notKept };
    },
    onSuccess: ({ result, tenant, email, invited, notKept }) => {
      setActivating({ tenant, email, auto: !invited, invited, notKept });
      void invalidateInvitations();
      setName("");
      setDisplayName("");
      setRecoveryEmail("");
      setRequireMFA(true);
      setCountry("");
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
  // A country is optional: two letters, ISO 3166-1 alpha-2, named back in
  // the reader's language by the browser.
  const countryIsValid = country === "" || /^[A-Z]{2}$/.test(country);
  const countryName = /^[A-Z]{2}$/.test(country) ? regionName(i18n.resolvedLanguage ?? "en", country) : null;

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
          invited={activating.invited}
          notKept={activating.notKept}
          onInvitationSettled={() => void invalidateInvitations()}
          onWaiting={(waiting) => setWaitingFor(waiting ? activating.tenant : null)}
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
                    {tenant.purging ? null : invitationPending.has(tenant.name) ? (
                      <span
                        className="admin-console__badge admin-console__badge--info"
                        title={t("tenants.invitationPendingHint")}
                      >
                        {t("tenants.invitationPending")}</span>
                    ) : waitingFor === tenant.name ? (
                      <span
                        className="admin-console__badge admin-console__badge--info"
                        title={t("tenants.beingCreatedHint")}
                      >
                        {t("tenants.beingCreated")}</span>
                    ) : (
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
            <label className="admin-console__label" htmlFor="tenant-country">
              <span className="admin-console__label-text">{t("tenants.country")}</span>
              <input
                id="tenant-country"
                type="text"
                value={country}
                autoComplete="off"
                maxLength={2}
                placeholder={t("tenants.countryPlaceholder")}
                onChange={(event) => setCountry(event.target.value.toUpperCase())}
              />
            </label>
            <p className={countryIsValid ? "admin-console__hint" : "admin-console__field-error"}>
              {countryName ? t("tenants.countryNamed", { country: countryName }) : t("tenants.countryHint")}
            </p>
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
              disabled={!nameIsValid || !countryIsValid || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating…" : t("tenants.commitNewTenant")}
            </button>
          </div>
        </form>
      </div>

      <ImportTenantCard />
    </section>
  );
}

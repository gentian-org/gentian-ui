import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchAdminContext } from "@/api/admin";
import { AuditSection } from "@/admin/AuditSection";
import { BackupPolicySection } from "@/admin/BackupPolicySection";
import { BackupSchedulesSection } from "@/admin/BackupSchedulesSection";
import { BackupSection } from "@/admin/BackupSection";
import { CredentialsSection } from "@/admin/CredentialsSection";
import { CustomizationDebtSection } from "@/admin/CustomizationDebtSection";
import { ClusterSettingsSection } from "@/admin/ClusterSettingsSection";
import { IdentitySection } from "@/admin/IdentitySection";
import { IntegrationsSection } from "@/admin/IntegrationsSection";
import { NotificationsSection } from "@/admin/NotificationsSection";
import { ResourcesSection } from "@/admin/ResourcesSection";
import { PlatformSecuritySection } from "@/admin/PlatformSecuritySection";
import { SecurityPoliciesSection } from "@/admin/SecurityPoliciesSection";
import { TenantsSection } from "@/admin/TenantsSection";
import "./admin.css";

/**
 * The console has two scopes, and which one you are in is the first thing the
 * screen tells you.
 *
 * A TENANT scope: you are working on one customer, and everything you see
 * belongs to them. A CLUSTER scope: you are working on the platform itself.
 * That split is the whole reorganisation. Before it, every tab took a tenant
 * selector, so working on one customer meant re-choosing them in each of
 * fourteen places and hoping you had chosen the same one each time. A tenant
 * is a place you are in, not a filter you keep reapplying.
 *
 * A platform administrator starts on the tenant list and enters one. A tenant
 * administrator has exactly one and starts inside it, never seeing the list,
 * because which other customers exist is not theirs to know.
 */
type Scope = "tenants" | "tenant" | "cluster";

type TenantTab = "people" | "resources" | "backup" | "security" | "integrations" | "notifications";

type ClusterTab = "settings" | "platform" | "customization" | "credentials" | "audit";

/**
 * What you do to one customer, in the order the jobs usually come: who is in
 * it, what it runs and consumes, what protects it, what it connects to, and
 * what it tells people.
 */
const TENANT_TABS: { id: TenantTab; label: string }[] = [
  { id: "people", label: "People" },
  { id: "resources", label: "Apps and resources" },
  { id: "backup", label: "Backup" },
  { id: "security", label: "Security" },
  { id: "integrations", label: "Integrations" },
  { id: "notifications", label: "Notifications" },
];

/**
 * What belongs to the platform rather than to any one customer. Only a
 * platform administrator sees any of it.
 *
 * Four tabs are gone from the console entirely: Members, Groups, Invitations
 * and Sessions. They needed a Keycloak administrator credential this console
 * must not hold, and Keycloak's own console already does that job properly.
 * Templates went with them, because it copied one member's shell preferences
 * onto another, which is a member screen wearing a different name.
 */
const CLUSTER_TABS: { id: ClusterTab; label: string }[] = [
  { id: "settings", label: "Cluster settings" },
  { id: "credentials", label: "Credentials" },
  { id: "platform", label: "Platform security" },
  { id: "customization", label: "Customization" },
  { id: "audit", label: "Audit" },
];

type AdminConsoleProps = {
  /** Render inside a desktop shell window instead of full-viewport overlay. */
  embedded?: boolean;
};

export function AdminConsole({ embedded = false }: AdminConsoleProps) {
  // Which tenant you are working on. A platform administrator picks one and
  // it stays picked until they leave; a tenant administrator only ever has
  // their own, which the context names.
  const [openTenant, setOpenTenant] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [tenantTab, setTenantTab] = useState<TenantTab>("people");
  const [clusterTab, setClusterTab] = useState<ClusterTab>("settings");
  const contextQuery = useQuery({
    queryKey: ["admin", "context"],
    queryFn: () => fetchAdminContext(),
  });
  // No tenant literal as a fallback. Hooks must be declared before the early
  // returns below, so this runs before the loading and error guards -- but the
  // groups query is gated on the context having loaded, and every consumer of
  // `tenant` sits after those guards, so the empty string is never used. It used
  // to read `?? "demo"`, which would have queried a real, unrelated tenant the
  // moment someone reordered any of that.
  const tenant = contextQuery.data?.tenant ?? "";

  if (contextQuery.isLoading) {
    return (
      <div className={`admin-console${embedded ? " admin-console--embedded" : ""}`}>
        <div className="admin-console__frame">
          <div className="admin-console__body">
            <p className="admin-console__loading">Loading admin console…</p>
          </div>
        </div>
      </div>
    );
  }

  if (contextQuery.isError || !contextQuery.data) {
    return (
      <div className={`admin-console${embedded ? " admin-console--embedded" : ""}`}>
        <div className="admin-console__frame">
          <div className="admin-console__body admin-console__error">
            Admin Console is not available for this account.
          </div>
        </div>
      </div>
    );
  }

  const { realm, isPlatformAdmin } = contextQuery.data;

  // Where you land. A platform administrator is here to work across customers,
  // so they start on the list. Anyone else has exactly one tenant and starts
  // inside it, and never sees that a list exists.
  const activeScope: Scope = scope ?? (isPlatformAdmin ? "tenants" : "tenant");
  const activeTenant = openTenant ?? tenant;

  const enterTenant = (name: string) => {
    setOpenTenant(name);
    setScope("tenant");
    setTenantTab("people");
  };

  return (
    <div className={`admin-console${embedded ? " admin-console--embedded" : ""}`}>
      <div className="admin-console__frame">
        <header className="admin-console__header">
          <div className="admin-console__identity">
            {activeScope === "tenant" ? (
              <>
                tenant <span className="admin-console__mono">{activeTenant}</span>
              </>
            ) : activeScope === "tenants" ? (
              "all tenants"
            ) : (
              "cluster"
            )}
          </div>
          <div className="admin-console__identity admin-console__identity--muted">
            realm/{realm}
          </div>
        </header>

        {/* The scope switch, above the tabs, because which scope you are in
            changes what every tab below means. Only a platform administrator
            has more than one, so for everybody else this is not rendered at
            all rather than rendered disabled. */}
        {isPlatformAdmin ? (
          <nav className="admin-console__tabs" aria-label="Scope">
            <button
              type="button"
              aria-current={activeScope === "tenants" || activeScope === "tenant" ? "page" : undefined}
              className={`admin-console__tab${
                activeScope !== "cluster" ? " admin-console__tab--active" : ""
              }`}
              onClick={() => setScope("tenants")}
            >
              Tenants
            </button>
            <button
              type="button"
              aria-current={activeScope === "cluster" ? "page" : undefined}
              className={`admin-console__tab${
                activeScope === "cluster" ? " admin-console__tab--active" : ""
              }`}
              onClick={() => setScope("cluster")}
            >
              Platform
            </button>
          </nav>
        ) : null}

        {activeScope === "tenant" ? (
          <nav className="admin-console__tabs" aria-label="Tenant sections">
            {isPlatformAdmin ? (
              <button
                type="button"
                className="admin-console__btn admin-console__btn--quiet"
                onClick={() => setScope("tenants")}
              >
                ← All tenants
              </button>
            ) : null}
            {TENANT_TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-current={tenantTab === entry.id ? "page" : undefined}
                className={`admin-console__tab${
                  tenantTab === entry.id ? " admin-console__tab--active" : ""
                }`}
                onClick={() => setTenantTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>
        ) : activeScope === "cluster" ? (
          <nav className="admin-console__tabs" aria-label="Platform sections">
            {CLUSTER_TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-current={clusterTab === entry.id ? "page" : undefined}
                className={`admin-console__tab${
                  clusterTab === entry.id ? " admin-console__tab--active" : ""
                }`}
                onClick={() => setClusterTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>
        ) : null}

        <div className="admin-console__body">
          {activeScope === "tenants" ? (
            <TenantsSection onOpen={enterTenant} />
          ) : activeScope === "tenant" ? (
            tenantTab === "people" ? (
              <IdentitySection realm={realm} kernelDomain={contextQuery.data.kernelDomain} />
            ) : tenantTab === "resources" ? (
              <ResourcesSection tenant={activeTenant} isPlatformAdmin={isPlatformAdmin} />
            ) : tenantTab === "backup" ? (
              <>
                <BackupSchedulesSection tenant={activeTenant} isPlatformAdmin={isPlatformAdmin} />
                <BackupPolicySection tenant={activeTenant} isPlatformAdmin={isPlatformAdmin} />
                <BackupSection tenant={activeTenant} />
              </>
            ) : tenantTab === "security" ? (
              <SecurityPoliciesSection tenant={activeTenant} />
            ) : tenantTab === "integrations" ? (
              <IntegrationsSection tenant={activeTenant} />
            ) : (
              <NotificationsSection tenant={activeTenant} isPlatformAdmin={isPlatformAdmin} />
            )
          ) : clusterTab === "settings" ? (
            <ClusterSettingsSection />
          ) : clusterTab === "credentials" ? (
            <CredentialsSection />
          ) : clusterTab === "platform" ? (
            <PlatformSecuritySection />
          ) : clusterTab === "customization" ? (
            <CustomizationDebtSection />
          ) : (
            <AuditSection tenant={activeTenant} />
          )}
        </div>
      </div>
    </div>
  );
}

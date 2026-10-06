/* SPDX-License-Identifier: Apache-2.0 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchAdminContext } from "@/api/admin";
import { AppsSection } from "@/admin/AppsSection";
import { AuditSection } from "@/admin/AuditSection";
import { ExportSection } from "@/admin/ExportSection";
import { OperationsPromo } from "@/admin/OperationsPromo";
import { CatalogueSection } from "@/admin/CatalogueSection";
import { CredentialsSection } from "@/admin/CredentialsSection";
import { CustomizationDebtSection } from "@/admin/CustomizationDebtSection";
import { ClusterSettingsSection } from "@/admin/ClusterSettingsSection";
import { GroupsSection } from "@/admin/GroupsSection";
import { MembersSection } from "@/admin/MembersSection";
import { IntegrationsSection } from "@/admin/IntegrationsSection";
import { LicenceReportSection } from "@/admin/LicenceReportSection";
import { NotificationsSection } from "@/admin/NotificationsSection";
import { ResourcesSection } from "@/admin/ResourcesSection";
import { PlatformSecuritySection } from "@/admin/PlatformSecuritySection";
import { SecurityPoliciesSection } from "@/admin/SecurityPoliciesSection";
import { TenantsSection } from "@/admin/TenantsSection";
import "./admin.css";
import { useTranslation } from "react-i18next";

type AdminTab =
  | "tenants"
  | "members"
  | "groups"
  | "apps"
  | "resources"
  | "export"
  | "security"
  | "integrations"
  | "catalogue"
  | "credentials"
  | "notifications"
  | "audit"
  | "settings"
  | "platform"
  | "customization"
  | "licenceReport";

/**
 * The tab strip, in display order. Kept as data so a new section is one entry
 * rather than another copy of the same button — the copies are how Backup and
 * Credentials ended up looking unlike the rest of the console.
 *
 * Ordered by what someone came here to do, not by the systems underneath.
 * People first because it is the most common errand, then what the tenant runs
 * and consumes, then what protects it, then the record, then the cluster's own
 * configuration for whoever administers the platform.
 *
 * Members and Groups go through the director, which holds a credential per
 * realm and asks OpenFGA about the caller before using it; this console holds
 * none. Inviting somebody happens on Members, with the settings template the
 * desktop applies before they first sign in.
 */

/**
 * Whether the Catalogues tab is shown. It is not, for now.
 *
 * The cluster renders no catalogue of its own: apps are installed from the
 * App Store, and where no store is available by command
 * (`kubectl gentian apps install`). The screen, its routes and its tests are
 * kept as they are, and with them the Install action that lives in it; this
 * switch only takes the tab out of the strip. Set it to true to show it again.
 */
const SHOW_CATALOGUES = false;

const TABS: { id: AdminTab; labelKey: string; platformOnly?: boolean; hidden?: boolean }[] = [
  // First, and platform-only, because bringing a customer on is what an MSP
  // employee opens this console to do. A tenant administrator sees their own
  // tenant's screens and has no business listing the others.
  { id: "tenants", labelKey: "tabTenants", platformOnly: true },
  { id: "members", labelKey: "tabMembers" },
  { id: "groups", labelKey: "tabGroups" },
  // What the tenant has installed, and everything done to an app after it is
  // installed: who may open it, what it exchanges with other apps, what it
  // asked of the platform, taking it away. Nothing is installed from here.
  { id: "apps", labelKey: "tabApps" },
  { id: "resources", labelKey: "tabResources" },
  { id: "export", labelKey: "tabExport" },
  { id: "security", labelKey: "tabSecurity" },
  { id: "integrations", labelKey: "tabIntegrations" },
  // Near the end on purpose. Apps come from the App Store; this tab is the
  // plain fallback for when the store is not the answer, and putting it where
  // a shop would go would make it look like a rival to the one that is
  // maintained. Hidden at present: see SHOW_CATALOGUES.
  { id: "catalogue", labelKey: "tabCatalogues", hidden: !SHOW_CATALOGUES },
  { id: "credentials", labelKey: "tabCredentials" },
  { id: "notifications", labelKey: "tabNotifications" },
  { id: "audit", labelKey: "tabAudit" },
  { id: "settings", labelKey: "tabClusterSettings", platformOnly: true },
  { id: "platform", labelKey: "tabPlatform", platformOnly: true },
  { id: "customization", labelKey: "tabCustomization", platformOnly: true },
  // What the cluster reports about itself. Read-only, and the usher decides
  // who may read it: this entry only keeps it out of a tenant's own console.
  { id: "licenceReport", labelKey: "tabLicenceReport", platformOnly: true },
];

type AdminConsoleProps = {
  /** Render inside a desktop shell window instead of full-viewport overlay. */
  embedded?: boolean;
};

export function AdminConsole({ embedded = false }: AdminConsoleProps) {
  const { t } = useTranslation();

  const [tab, setTab] = useState<AdminTab>("members");
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
            <p className="admin-console__loading">{t("adminConsole.loadingAdminConsole")}</p>
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
            {t("adminConsole.adminConsoleIsNotAvailable")}</div>
        </div>
      </div>
    );
  }

  const { realm, isPlatformAdmin } = contextQuery.data;

  return (
    <div className={`admin-console${embedded ? " admin-console--embedded" : ""}`}>
      <div className="admin-console__frame">
        <header className="admin-console__header">
          <div className="admin-console__identity">
            {t("adminConsole.tenant")}{tenant}
            {isPlatformAdmin ? t("adminConsole.platformScope") : ""}
          </div>
          <div className="admin-console__identity admin-console__identity--muted">
            {t("adminConsole.realm")}{realm}
          </div>
        </header>

        <nav className="admin-console__tabs" aria-label={t("adminConsole.adminSections")}>
          {TABS.filter((entry) => !entry.hidden && (!entry.platformOnly || isPlatformAdmin)).map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-current={tab === entry.id ? "page" : undefined}
              className={`admin-console__tab${
                tab === entry.id ? " admin-console__tab--active" : ""
              }`}
              onClick={() => setTab(entry.id)}
            >
              {t(`adminConsole.${entry.labelKey}`)}
            </button>
          ))}
        </nav>

        <div className="admin-console__body">
          {tab === "tenants" ? (
            <TenantsSection />
          ) : tab === "members" ? (
            <MembersSection tenant={tenant} />
          ) : tab === "groups" ? (
            <GroupsSection tenant={tenant} />
          ) : tab === "apps" ? (
            <AppsSection tenant={tenant} onOpenIntegrations={() => setTab("integrations")} />
          ) : tab === "security" ? (
            <SecurityPoliciesSection tenant={tenant} />
          ) : tab === "integrations" ? (
            <IntegrationsSection tenant={tenant} />
          ) : tab === "catalogue" ? (
            <CatalogueSection tenant={tenant} />
          ) : tab === "resources" ? (
            <ResourcesSection tenant={tenant} isPlatformAdmin={isPlatformAdmin} />
          ) : tab === "settings" ? (
            <ClusterSettingsSection />
          ) : tab === "platform" ? (
            <PlatformSecuritySection />
          ) : tab === "customization" ? (
            <CustomizationDebtSection />
          ) : tab === "licenceReport" ? (
            <LicenceReportSection />
          ) : tab === "credentials" ? (
            <CredentialsSection />
          ) : tab === "notifications" ? (
            <NotificationsSection tenant={tenant} isPlatformAdmin={isPlatformAdmin} />
          ) : tab === "export" ? (
            <>
              <ExportSection tenant={tenant} />
              <OperationsPromo />
            </>
          ) : (
            <AuditSection tenant={tenant} />
          )}
        </div>
      </div>
    </div>
  );
}

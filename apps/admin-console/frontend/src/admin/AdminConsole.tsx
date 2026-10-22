/* SPDX-License-Identifier: Apache-2.0 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchAdminContext } from "@/api/admin";
import { AppsSection } from "@/admin/AppsSection";
import { ApprovalsSection } from "@/admin/ApprovalsSection";
import { AuditSection } from "@/admin/AuditSection";
import { ExportSection } from "@/admin/ExportSection";
import { OperationsPromo } from "@/admin/OperationsPromo";
import { CatalogueSection } from "@/admin/CatalogueSection";
import { CredentialsSection } from "@/admin/CredentialsSection";
import { CustomizationDebtSection } from "@/admin/CustomizationDebtSection";
import { UpdatesSection } from "@/admin/UpdatesSection";
import { ClusterSettingsSection } from "@/admin/ClusterSettingsSection";
import { GroupsSection } from "@/admin/GroupsSection";
import { MembersSection } from "@/admin/MembersSection";
import { ModelsSection } from "@/admin/ModelsSection";
import { IntegrationsSection } from "@/admin/IntegrationsSection";
import { UsageStatisticsSection } from "@/admin/UsageStatisticsSection";
import { NotificationsSection } from "@/admin/NotificationsSection";
import { ResourcesSection } from "@/admin/ResourcesSection";
import { PerimeterSection } from "@/admin/PerimeterSection";
import { PlatformSecuritySection } from "@/admin/PlatformSecuritySection";
import { RoleHoldersSection } from "@/admin/RoleHoldersSection";
import { SecurityPoliciesSection } from "@/admin/SecurityPoliciesSection";
import { TenantsSection } from "@/admin/TenantsSection";
import "./admin.css";
import { useTranslation } from "react-i18next";

type AdminTab =
  | "approvals"
  | "updates"
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
  | "perimeter"
  | "notifications"
  | "audit"
  | "settings"
  | "models"
  | "platform"
  | "clusterRoles"
  | "customization"
  | "usageStatistics";

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

const TABS: {
  id: AdminTab;
  labelKey: string;
  platformOnly?: boolean;
  /** Shown only to those the director says may publish for the tenant. */
  approverOnly?: boolean;
  /**
   * Shown only to the cluster's security officer (cluster can_approve), its
   * perimeter approver (can_approve_perimeter) and its administrator, and
   * the one tab a person who does not administer the tenant is shown: the
   * console lets them in for this screen alone (/admin/context).
   */
  officerOnly?: boolean;
  /** Shown only to those who may read the cluster's roles (cluster can_audit). */
  auditorOnly?: boolean;
  hidden?: boolean;
}[] = [
  // First, and platform-only, because bringing a customer on is what an MSP
  // employee opens this console to do. A tenant administrator sees their own
  // tenant's screens and has no business listing the others.
  { id: "tenants", labelKey: "tabTenants", platformOnly: true },
  // What every tenant's apps ask of the platform, for the security officer
  // and the perimeter approver who answer it, in the console of their own tenant; the usher decides who
  // reads the list and the director decides each approval.
  { id: "approvals", labelKey: "tabApprovals", officerOnly: true },
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
  // What the tenant has on the internet and what asks to be, for those who
  // answer for it (can_expose); the director guards the reads the same way.
  { id: "perimeter", labelKey: "tabPerimeter", approverOnly: true },
  { id: "notifications", labelKey: "tabNotifications" },
  { id: "audit", labelKey: "tabAudit" },
  { id: "settings", labelKey: "tabClusterSettings", platformOnly: true },
  // The models the gateway offers. They spend the cluster's GPUs or a
  // provider's account for every tenant, so they are the cluster
  // administrator's, beside the cluster's other settings; the director
  // refuses anybody else whatever this strip shows.
  { id: "models", labelKey: "tabModels", platformOnly: true },
  { id: "platform", labelKey: "tabPlatform", platformOnly: true },
  // Who holds a cluster role by name: the tenants' administrators the
  // cluster's administrator picks, declared on the Cluster claim. Read-only
  // for an auditor; the director refuses anybody else whatever this shows.
  { id: "clusterRoles", labelKey: "tabClusterRoles", auditorOnly: true },
  { id: "customization", labelKey: "tabCustomization", platformOnly: true },
  { id: "updates", labelKey: "tabUpdates", platformOnly: true },
  // What the cluster reports about itself. Read-only, and the usher decides
  // who may read it: this entry only keeps it out of a tenant's own console.
  { id: "usageStatistics", labelKey: "tabUsageStatistics", platformOnly: true },
];

type AdminConsoleProps = {
  /** Render inside a desktop shell window instead of full-viewport overlay. */
  embedded?: boolean;
};

/** The tab a link names (?tab=approvals), when it is one. */
function linkedTab(): AdminTab | null {
  if (typeof window === "undefined") return null;
  const wanted = new URLSearchParams(window.location.search).get("tab");
  const entry = TABS.find((candidate) => candidate.id === wanted && !candidate.hidden);
  return entry ? entry.id : null;
}

export function AdminConsole({ embedded = false }: AdminConsoleProps) {
  const { t } = useTranslation();

  const [tab, setTab] = useState<AdminTab | null>(linkedTab);
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

  const { realm, isPlatformAdmin, canExpose, canApproveNodePrivilege, canApprovePerimeter, canAuditCluster } =
    contextQuery.data;
  // False only for the approver let in for the Approvals screen; a
  // backend older than that field answered nobody who did not administer.
  const administers = contextQuery.data.isTenantAdmin !== false;
  const shown = TABS.filter(
    (entry) =>
      !entry.hidden &&
      (administers || entry.officerOnly) &&
      (!entry.platformOnly || isPlatformAdmin) &&
      (!entry.approverOnly || canExpose === true) &&
      (!entry.officerOnly || canApproveNodePrivilege === true || canApprovePerimeter === true || isPlatformAdmin) &&
      (!entry.auditorOnly || canAuditCluster === true),
  );
  // Members first, as it always was, for whoever has it; the officer let in
  // for one screen lands on it.
  const isShown = (id: AdminTab) => shown.some((entry) => entry.id === id);
  const current: AdminTab = tab && isShown(tab) ? tab : isShown("members") ? "members" : (shown[0]?.id ?? "members");

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
          {shown.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-current={current === entry.id ? "page" : undefined}
              className={`admin-console__tab${
                current === entry.id ? " admin-console__tab--active" : ""
              }`}
              onClick={() => setTab(entry.id)}
            >
              {t(`adminConsole.${entry.labelKey}`)}
            </button>
          ))}
        </nav>

        <div className="admin-console__body">
          {!administers && current !== "approvals" ? null : current === "approvals" ? (
            <ApprovalsSection />
          ) : current === "tenants" ? (
            <TenantsSection />
          ) : current === "members" ? (
            <MembersSection tenant={tenant} />
          ) : current === "groups" ? (
            <GroupsSection tenant={tenant} />
          ) : current === "apps" ? (
            <AppsSection tenant={tenant} onOpenIntegrations={() => setTab("integrations")} />
          ) : current === "security" ? (
            <SecurityPoliciesSection tenant={tenant} />
          ) : current === "integrations" ? (
            <IntegrationsSection tenant={tenant} />
          ) : current === "catalogue" ? (
            <CatalogueSection tenant={tenant} />
          ) : current === "resources" ? (
            <ResourcesSection tenant={tenant} isPlatformAdmin={isPlatformAdmin} />
          ) : current === "settings" ? (
            <ClusterSettingsSection />
          ) : current === "models" ? (
            <ModelsSection />
          ) : current === "platform" ? (
            <PlatformSecuritySection />
          ) : current === "clusterRoles" ? (
            <RoleHoldersSection canEdit={isPlatformAdmin} />
          ) : current === "customization" ? (
            <CustomizationDebtSection />
          ) : current === "updates" ? (
            <UpdatesSection />
          ) : current === "usageStatistics" ? (
            <UsageStatisticsSection />
          ) : current === "credentials" ? (
            <CredentialsSection />
          ) : current === "perimeter" ? (
            <PerimeterSection />
          ) : current === "notifications" ? (
            <NotificationsSection tenant={tenant} isPlatformAdmin={isPlatformAdmin} />
          ) : current === "export" ? (
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

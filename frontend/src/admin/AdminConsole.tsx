import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchAdminContext, fetchGroups } from "@/api/admin";
import { AuditSection } from "@/admin/AuditSection";
import { BackupSection } from "@/admin/BackupSection";
import { CredentialsSection } from "@/admin/CredentialsSection";
import { CustomizationDebtSection } from "@/admin/CustomizationDebtSection";
import { GroupsSection } from "@/admin/GroupsSection";
import { IntegrationsSection } from "@/admin/IntegrationsSection";
import { InvitationsSection } from "@/admin/InvitationsSection";
import { MembersSection } from "@/admin/MembersSection";
import { NotificationsSection } from "@/admin/NotificationsSection";
import { ResourcesSection } from "@/admin/ResourcesSection";
import { PlatformSecuritySection } from "@/admin/PlatformSecuritySection";
import { SecurityPoliciesSection } from "@/admin/SecurityPoliciesSection";
import { SessionsSection } from "@/admin/SessionsSection";
import { TemplatesSection } from "@/admin/TemplatesSection";
import "./admin.css";

type AdminTab =
  | "members"
  | "invitations"
  | "groups"
  | "templates"
  | "security"
  | "integrations"
  | "resources"
  | "platform"
  | "customization"
  | "credentials"
  | "sessions"
  | "audit"
  | "notifications"
  | "backup";

/**
 * The tab strip, in display order. Kept as data so a new section is one entry
 * rather than another copy of the same button — the copies are how Backup and
 * Credentials ended up looking unlike the rest of the console.
 */
const TABS: { id: AdminTab; label: string; platformOnly?: boolean }[] = [
  { id: "invitations", label: "Invitations" },
  { id: "members", label: "Members" },
  { id: "groups", label: "Groups" },
  { id: "templates", label: "Templates" },
  { id: "security", label: "Security" },
  { id: "integrations", label: "Integrations" },
  { id: "resources", label: "Resources" },
  { id: "platform", label: "Platform", platformOnly: true },
  { id: "customization", label: "Customization", platformOnly: true },
  { id: "credentials", label: "Credentials" },
  { id: "sessions", label: "Sessions" },
  { id: "audit", label: "Audit" },
  { id: "notifications", label: "Notifications" },
  { id: "backup", label: "Backup" },
];

type AdminConsoleProps = {
  /** Render inside a desktop shell window instead of full-viewport overlay. */
  embedded?: boolean;
};

export function AdminConsole({ embedded = false }: AdminConsoleProps) {
  const [tab, setTab] = useState<AdminTab>("invitations");
  const contextQuery = useQuery({
    queryKey: ["admin", "context"],
    queryFn: () => fetchAdminContext(),
  });
  const tenant = contextQuery.data?.tenant ?? "demo";

  const groupsQuery = useQuery({
    queryKey: ["admin", "groups", tenant],
    queryFn: () => fetchGroups(tenant),
    enabled: Boolean(contextQuery.data),
  });

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
  const allGroups = groupsQuery.data ?? [];
  const privilegeGroups = allGroups.filter((group) => group.name.endsWith(":app-admins"));
  const appEntitlementGroups = allGroups.filter(
    (group) => group.name.includes(":app:") && !group.name.endsWith(":app-admins"),
  );
  const customGroups = allGroups.filter(
    (group) =>
      !group.name.endsWith(":members") &&
      !group.name.endsWith(":app-admins") &&
      !group.name.includes(":app:"),
  );

  return (
    <div className={`admin-console${embedded ? " admin-console--embedded" : ""}`}>
      <div className="admin-console__frame">
        <header className="admin-console__header">
          <div className="admin-console__identity">
            tenant {tenant}
            {isPlatformAdmin ? " · platform scope" : ""}
          </div>
          <div className="admin-console__identity admin-console__identity--muted">
            realm/{realm}
          </div>
        </header>

        <nav className="admin-console__tabs" aria-label="Admin sections">
          {TABS.filter((entry) => !entry.platformOnly || isPlatformAdmin).map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-current={tab === entry.id ? "page" : undefined}
              className={`admin-console__tab${
                tab === entry.id ? " admin-console__tab--active" : ""
              }`}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="admin-console__body">
          {tab === "members" ? (
            <MembersSection
              tenant={tenant}
              privilegeGroups={privilegeGroups}
              appEntitlementGroups={appEntitlementGroups}
              customGroups={customGroups}
            />
          ) : tab === "invitations" ? (
            <InvitationsSection
              tenant={tenant}
              kernelDomain={contextQuery.data.kernelDomain}
              privilegeGroups={privilegeGroups}
              appEntitlementGroups={appEntitlementGroups}
              customGroups={customGroups}
            />
          ) : tab === "groups" ? (
            <GroupsSection tenant={tenant} />
          ) : tab === "templates" ? (
            <TemplatesSection tenant={tenant} />
          ) : tab === "security" ? (
            <SecurityPoliciesSection tenant={tenant} />
          ) : tab === "integrations" ? (
            <IntegrationsSection tenant={tenant} />
          ) : tab === "resources" ? (
            <ResourcesSection tenant={tenant} isPlatformAdmin={isPlatformAdmin} />
          ) : tab === "platform" ? (
            <PlatformSecuritySection />
          ) : tab === "customization" ? (
            <CustomizationDebtSection />
          ) : tab === "credentials" ? (
            <CredentialsSection />
          ) : tab === "sessions" ? (
            <SessionsSection tenant={tenant} />
          ) : tab === "notifications" ? (
            <NotificationsSection tenant={tenant} isPlatformAdmin={isPlatformAdmin} />
          ) : tab === "backup" ? (
            <BackupSection tenant={tenant} />
          ) : (
            <AuditSection tenant={tenant} />
          )}
        </div>
      </div>
    </div>
  );
}

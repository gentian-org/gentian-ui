import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchAdminContext, fetchGroups } from "@/api/admin";
import { AuditSection } from "@/admin/AuditSection";
import { GroupsSection } from "@/admin/GroupsSection";
import { MembersSection } from "@/admin/MembersSection";
import { NotificationsSection } from "@/admin/NotificationsSection";
import { SecurityPoliciesSection } from "@/admin/SecurityPoliciesSection";
import { SessionsSection } from "@/admin/SessionsSection";
import "./admin.css";

type AdminTab = "members" | "groups" | "security" | "sessions" | "audit" | "notifications";

type AdminConsoleProps = {
  /** Render inside a desktop shell window instead of full-viewport overlay. */
  embedded?: boolean;
};

export function AdminConsole({ embedded = false }: AdminConsoleProps) {
  const [tab, setTab] = useState<AdminTab>("members");
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
          <div className="admin-console__body">Loading admin console…</div>
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
          <div>
            <div className="admin-console__eyebrow">
              Gentian admin · tenant {tenant}
              {isPlatformAdmin ? " · platform scope" : ""}
            </div>
            <h1 className="admin-console__title">Workspace access</h1>
          </div>
          <div className="admin-console__mono" style={{ color: "var(--gtn-ink-4)" }}>
            realm/{realm}
          </div>
        </header>

        <nav className="admin-console__tabs">
          <button
            type="button"
            className={`admin-console__tab${tab === "members" ? " admin-console__tab--active" : ""}`}
            onClick={() => setTab("members")}
          >
            Members
          </button>
          <button
            type="button"
            className={`admin-console__tab${tab === "groups" ? " admin-console__tab--active" : ""}`}
            onClick={() => setTab("groups")}
          >
            Groups
          </button>
          <button
            type="button"
            className={`admin-console__tab${tab === "security" ? " admin-console__tab--active" : ""}`}
            onClick={() => setTab("security")}
          >
            Security
          </button>
          <button
            type="button"
            className={`admin-console__tab${tab === "sessions" ? " admin-console__tab--active" : ""}`}
            onClick={() => setTab("sessions")}
          >
            Sessions
          </button>
          <button
            type="button"
            className={`admin-console__tab${tab === "audit" ? " admin-console__tab--active" : ""}`}
            onClick={() => setTab("audit")}
          >
            Audit
          </button>
          <button
            type="button"
            className={`admin-console__tab${tab === "notifications" ? " admin-console__tab--active" : ""}`}
            onClick={() => setTab("notifications")}
          >
            Notifications
          </button>
        </nav>

        <div className="admin-console__body">
          {tab === "members" ? (
            <MembersSection
              tenant={tenant}
              privilegeGroups={privilegeGroups}
              appEntitlementGroups={appEntitlementGroups}
              customGroups={customGroups}
            />
          ) : tab === "groups" ? (
            <GroupsSection tenant={tenant} />
          ) : tab === "security" ? (
            <SecurityPoliciesSection tenant={tenant} />
          ) : tab === "sessions" ? (
            <SessionsSection tenant={tenant} />
          ) : tab === "notifications" ? (
            <NotificationsSection tenant={tenant} isPlatformAdmin={isPlatformAdmin} />
          ) : (
            <AuditSection tenant={tenant} />
          )}
        </div>
      </div>
    </div>
  );
}

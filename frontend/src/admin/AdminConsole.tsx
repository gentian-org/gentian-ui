import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchAdminContext, fetchGroups } from "@/api/admin";
import { GroupsSection } from "@/admin/GroupsSection";
import { MembersSection } from "@/admin/MembersSection";
import { SecurityPoliciesSection } from "@/admin/SecurityPoliciesSection";
import "./admin.css";

type AdminTab = "members" | "groups" | "security";

export function AdminConsole() {
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
      <div className="admin-console">
        <div className="admin-console__frame">
          <div className="admin-console__body">Loading admin console…</div>
        </div>
      </div>
    );
  }

  if (contextQuery.isError || !contextQuery.data) {
    return (
      <div className="admin-console">
        <div className="admin-console__frame">
          <div className="admin-console__body admin-console__error">
            Admin Console is not available for this account.
          </div>
        </div>
      </div>
    );
  }

  const { realm, isPlatformAdmin } = contextQuery.data;

  return (
    <div className="admin-console">
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
        </nav>

        <div className="admin-console__body">
          {tab === "members" ? (
            <MembersSection tenant={tenant} groups={groupsQuery.data ?? []} />
          ) : tab === "groups" ? (
            <GroupsSection tenant={tenant} />
          ) : (
            <SecurityPoliciesSection tenant={tenant} />
          )}
        </div>
      </div>
    </div>
  );
}

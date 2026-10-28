import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import type { AdminContext, TenantSettings } from "@/api/admin";
import { AdminConsole } from "./AdminConsole";

const base: AdminContext = {
  tenant: "platform",
  realm: "kernel",
  isPlatformAdmin: false,
  isTenantAdmin: true,
  availableTenants: ["platform"],
  storeConfigured: true,
  kernelDomain: "example",
};

const complete: TenantSettings = {
  displayName: "Platform",
  country: "CH",
  locales: ["de"],
  organization: { legalName: "Platform AG", currency: "CHF", timeZone: "Europe/Zurich" },
  missing: [],
};

function render(context: AdminContext, settings: TenantSettings = complete): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["admin", "context"], context);
  client.setQueryData(["admin", "approvals"], { approvals: [] });
  client.setQueryData(["admin", "tenant-settings", context.tenant], settings);
  return renderToString(
    <QueryClientProvider client={client}>
      <AdminConsole embedded />
    </QueryClientProvider>,
  );
}

function tabs(context: AdminContext): string[] {
  return [...render(context).matchAll(/class="admin-console__tab[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1]);
}

function activeTab(context: AdminContext, settings?: TenantSettings): string | undefined {
  return render(context, settings).match(/class="admin-console__tab admin-console__tab--active"[^>]*>([^<]+)</)?.[1];
}

describe("AdminConsole", () => {
  it("opens on Tenant Settings while a required fact is missing, and on Members once none is", () => {
    expect(activeTab(base, { ...complete, missing: ["organization.legalName"] })).toBe("Tenant Settings");
    expect(activeTab(base)).toBe("Members");
  });

  it("shows the Approvals tab to the security officer, the perimeter approver and the cluster's administrator", () => {
    expect(tabs({ ...base, canApproveNodePrivilege: true })).toContain("Approvals");
    expect(tabs({ ...base, canApprovePerimeter: true })).toContain("Approvals");
    expect(tabs({ ...base, isPlatformAdmin: true })).toContain("Approvals");
    expect(tabs(base)).not.toContain("Approvals");
  });

  it("shows a perimeter approver who does not administer the tenant the Approvals tab alone", () => {
    expect(tabs({ ...base, isTenantAdmin: false, canApprovePerimeter: true })).toEqual(["Approvals"]);
  });

  it("shows a security officer who does not administer the tenant the Approvals tab alone", () => {
    expect(tabs({ ...base, isTenantAdmin: false, canApproveNodePrivilege: true })).toEqual(["Approvals"]);
  });

  it("shows the Approvals tab in a tenant's own console to its security officer", () => {
    const tenant = { ...base, tenant: "acme", realm: "acme", availableTenants: ["acme"] };
    expect(tabs({ ...tenant, canApproveNodePrivilege: true })).toContain("Approvals");
  });

  it("shows the Cluster roles tab to whoever may read them", () => {
    expect(tabs({ ...base, canAuditCluster: true })).toContain("Cluster roles");
    expect(tabs(base)).not.toContain("Cluster roles");
  });

  it("shows a person a backend older than isTenantAdmin let in every tenant tab, as before", () => {
    const { isTenantAdmin: _omitted, ...older } = base;
    const shown = tabs(older as AdminContext);
    expect(shown).toContain("Members");
    expect(shown).toContain("Apps");
  });
});

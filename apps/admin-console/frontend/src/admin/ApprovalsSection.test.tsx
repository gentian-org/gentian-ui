import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import type { AdminContext } from "@/api/admin";
import type { Approval } from "@/api/approvals";
import { ApprovalsSection } from "./ApprovalsSection";

// The cluster's list as the usher serves it (gentian-os
// internal/applifecycle/privilege_requests.go).
const approvals: Approval[] = [
  {
    tenant: "acme",
    profile: "crm",
    install: "crm",
    privilege: "podSecurity/run-as-root",
    approvedBy: "security-officer",
    reason: "the vendor image writes its cache as root",
    requestedBy: "tom@acme.example",
    requestedAt: "2026-10-21T09:12:00Z",
    note: "needed for the pilot",
  },
  {
    tenant: "other",
    profile: "wiki",
    install: "wiki",
    privilege: "clusterRoles/node-reader",
    approvedBy: "security-officer",
    expiredAt: "2026-10-20T00:00:00Z",
  },
];

function render(list: Approval[], context: Partial<AdminContext>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["admin", "approvals"], { approvals: list });
  client.setQueryData(["admin", "context"], context);
  return renderToString(
    <QueryClientProvider client={client}>
      <ApprovalsSection />
    </QueryClientProvider>,
  );
}

describe("ApprovalsSection", () => {
  it("lists every tenant's request with the profile's reason and who asked", () => {
    const html = render(approvals, { canApproveNodePrivilege: true });
    expect(html).toContain("acme");
    expect(html).toContain("podSecurity/run-as-root");
    expect(html).toContain("the vendor image writes its cache as root");
    expect(html).toContain("tom@acme.example");
    expect(html).toContain("needed for the pilot");
    expect(html).toContain("clusterRoles/node-reader");
    expect(html).toContain("Nobody has asked for it yet");
    expect(html).toContain("A previous approval ran out");
  });

  it("offers the security officer the button, and tells anybody else whose it is", () => {
    expect(render(approvals, { canApproveNodePrivilege: true })).toContain("Approve…");
    const administrator = render(approvals, { canApproveNodePrivilege: false, isPlatformAdmin: true });
    expect(administrator).not.toContain("Approve…");
    expect(administrator).toContain("security officer");
  });

  it("says so when nothing waits", () => {
    expect(render([], { canApproveNodePrivilege: true })).toContain("Nothing is waiting for the security officer.");
  });
});

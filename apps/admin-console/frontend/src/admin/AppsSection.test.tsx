import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import type { AdminContext, AppState } from "@/api/admin";
import { PrivilegesPart } from "./AppsSection";

// The operator's app state as it is served (gentian-os
// internal/applifecycle/apps.go): each pending request with who answers it.
const state: AppState = {
  profile: "crm",
  name: "crm",
  ready: false,
  phase: "installing",
  pendingPrivileges: ["egress/smtp-relay", "podSecurity/run-as-root"],
  pendingPrivilegeApprovals: [
    { privilege: "egress/smtp-relay", approvedBy: "perimeter-approver" },
    { privilege: "podSecurity/run-as-root", approvedBy: "security-officer" },
  ],
};

const perimeterApprover: Partial<AdminContext> = { canApprovePrivilege: true, canApproveNodePrivilege: false };
const securityOfficer: Partial<AdminContext> = { canApprovePrivilege: false, canApproveNodePrivilege: true };

const approve = "Approve…";
const notYours = "A perimeter approver approves this.";
const securityOfficersHint = "Approving it is the cluster&#x27;s security officer&#x27;s";

function render(appState: AppState, context: Partial<AdminContext>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["admin", "apps", "privileges"], { tenant: "acme", privileges: [] });
  client.setQueryData(["admin", "context"], context);
  return renderToString(
    <QueryClientProvider client={client}>
      <PrivilegesPart row={{ profile: appState.profile, state: appState }} />
    </QueryClientProvider>,
  );
}

/** The detail cell of the pending row for one privilege. */
function rowOf(html: string, privilege: string): string {
  const start = html.indexOf(`>${privilege}</td>`);
  expect(start).toBeGreaterThan(-1);
  const end = html.indexOf("</tr>", start);
  return html.slice(start, end);
}

describe("PrivilegesPart", () => {
  it("offers the security officer the button on a podSecurity request", () => {
    const html = render(state, securityOfficer);
    expect(rowOf(html, "podSecurity/run-as-root")).toContain(approve);
    expect(rowOf(html, "egress/smtp-relay")).not.toContain(approve);
    expect(rowOf(html, "egress/smtp-relay")).toContain(notYours);
  });

  it("does not offer a perimeter approver the button on a podSecurity request", () => {
    const html = render(state, perimeterApprover);
    const row = rowOf(html, "podSecurity/run-as-root");
    expect(row).not.toContain(approve);
    expect(row).toContain(securityOfficersHint);
  });

  it("offers egress to the tenant's perimeter approver", () => {
    expect(rowOf(render(state, perimeterApprover), "egress/smtp-relay")).toContain(approve);
    const neither = render(state, {});
    expect(rowOf(neither, "egress/smtp-relay")).not.toContain(approve);
    expect(rowOf(neither, "egress/smtp-relay")).toContain(notYours);
  });

  it("shows a declined request as declined, by whom and why, and still waiting", () => {
    const refused: AppState = {
      ...state,
      pendingPrivilegeApprovals: [
        { privilege: "egress/smtp-relay", approvedBy: "perimeter-approver" },
        {
          privilege: "podSecurity/run-as-root",
          approvedBy: "security-officer",
          declinedBy: "sam@example.com",
          declinedAt: "2026-10-21T10:00:00Z",
          declineReason: "no root on shared nodes; use the rootless image",
        },
      ],
    };
    const html = render(refused, perimeterApprover);
    const row = rowOf(html, "podSecurity/run-as-root");
    expect(row).toContain("Declined by");
    expect(row).toContain("sam@example.com");
    expect(row).toContain("no root on shared nodes; use the rootless image");
    expect(row).toContain("The app keeps waiting");
    expect(row).not.toContain(approve);
    expect(rowOf(html, "egress/smtp-relay")).not.toContain("Declined by");
  });

  it("offers nothing when an older operator does not say who answers", () => {
    const older: AppState = { ...state, pendingPrivilegeApprovals: undefined };
    const html = render(older, { canApprovePrivilege: true, canApproveNodePrivilege: true });
    expect(rowOf(html, "egress/smtp-relay")).not.toContain(approve);
    expect(rowOf(html, "egress/smtp-relay")).toContain(notYours);
    expect(rowOf(html, "podSecurity/run-as-root")).not.toContain(approve);
    expect(rowOf(html, "podSecurity/run-as-root")).toContain(securityOfficersHint);
  });
});

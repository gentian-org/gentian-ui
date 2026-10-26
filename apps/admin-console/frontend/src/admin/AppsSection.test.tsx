import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import type { AdminContext, AppState } from "@/api/admin";
import { AccessPart, joinApps, linkedApp, PrivilegesPart, PurgeDialog, RetainedSection } from "./AppsSection";

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

describe("linkedApp", () => {
  it("opens the app a link names, and nothing that is not an app's name", () => {
    expect(linkedApp("?tab=apps&app=nextcloud-base-ce")).toBe("nextcloud-base-ce");
    expect(linkedApp("?tab=apps&app=../../x")).toBeNull();
    expect(linkedApp("?tab=apps")).toBeNull();
  });
});

describe("joinApps", () => {
  const running: AppState = { profile: "operations-console", name: "operations-console", ready: true, phase: "ready" };

  it("gives a declared app the standing of a default component that runs it", () => {
    const rows = joinApps([{ profile: "operations-console" }], [{ ...running, origin: "default" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].declared).toBeDefined();
    expect(rows[0].state?.ready).toBe(true);
  });

  it("lists no row for a default component git does not declare", () => {
    expect(joinApps([], [{ ...running, profile: "desktop", name: "desktop", origin: "default" }])).toEqual([]);
  });

  it("still lists an installed component git no longer declares", () => {
    const rows = joinApps([], [{ ...state, origin: "install" }, state]);
    expect(rows.map((row) => row.profile)).toEqual(["crm"]);
    expect(rows[0].declared).toBeUndefined();
  });
});

describe("AccessPart", () => {
  function renderAccess(appState: AppState) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["admin", "people", "groups"], { groups: [] });
    return renderToString(
      <QueryClientProvider client={client}>
        <AccessPart
          row={{ profile: appState.profile, declared: { profile: appState.profile }, state: appState }}
          tenant="acme"
          onOutcome={() => {}}
        />
      </QueryClientProvider>,
    );
  }

  it("offers no access management for a default component", () => {
    const html = renderAccess({ ...state, origin: "default" });
    expect(html).toContain("The platform places and manages this app");
    expect(html).not.toContain("Make it for everyone");
    expect(html).not.toContain("People with access");
  });

  it("offers it for an installed app", () => {
    const html = renderAccess({ ...state, origin: "install" });
    expect(html).toContain("Make it for everyone");
    expect(html).toContain("People with access");
  });

  it("lists each add-on with its own access", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["admin", "people", "groups"], {
      groups: [
        { id: "g1", path: "gentian:tenant:acme:app:cloud", name: "app:cloud" },
        { id: "g2", path: "gentian:tenant:acme:app:cloud-calendar", name: "app:cloud-calendar" },
      ],
    });
    const html = renderToString(
      <QueryClientProvider client={client}>
        <AccessPart
          row={{
            profile: "cloud",
            declared: {
              profile: "cloud",
              defaultGrant: true,
              addons: ["cloud-calendar", "cloud-deck"],
              addonGrants: [{ name: "cloud-calendar", defaultGrant: true }],
            },
            state: { ...state, profile: "cloud", origin: "install" },
          }}
          tenant="acme"
          onOutcome={() => {}}
        />
      </QueryClientProvider>,
    );
    expect(html).toContain("Each add-on has its own access");
    const calendar = html.slice(html.indexOf('data-addon="cloud-calendar"'), html.indexOf('data-addon="cloud-deck"'));
    const deck = html.slice(html.indexOf('data-addon="cloud-deck"'));
    expect(calendar).toContain("This add-on is for everyone");
    expect(calendar).not.toContain("has no group yet");
    expect(deck).toContain("This add-on is not for everyone");
    expect(deck).toContain("This add-on has no group yet");
  });
});

describe("RetainedSection", () => {
  function renderRetained() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["admin", "apps", "retained"], {
      apps: [
        { profile: "crm", profileAvailable: true, kinds: { files: "present" } },
        { profile: "crm-mail", profileAvailable: true, kinds: { database: "present" } },
        { profile: "orphan", profileAvailable: false, kinds: { files: "present" } },
      ],
    });
    return renderToString(
      <QueryClientProvider client={client}>
        <RetainedSection tenant="acme" />
      </QueryClientProvider>,
    );
  }

  it("offers a checkbox per row, one for all, and purging the selection", () => {
    const html = renderRetained();
    expect(html).toContain('aria-label="Select all"');
    expect(html).toContain('aria-label="Select crm"');
    expect(html).toContain('aria-label="Select crm-mail"');
    // Nothing selected yet: the batch purge waits for a selection.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Purge selected \(0\)…<\/button>/);
  });

  it("does not let an app without its profile be selected", () => {
    const html = renderRetained();
    expect(html).toMatch(/<input type="checkbox" aria-label="Select orphan"[^>]*disabled=""/);
  });
});

describe("PurgeDialog", () => {
  const noop = () => {};

  it("lists every selected app and asks for their number", () => {
    const html = renderToString(
      <PurgeDialog apps={["crm", "crm-mail"]} tenant="acme" done={null} onConfirm={noop} onClose={noop} />,
    );
    expect(html).toContain("Permanently destroy the data of 2 apps?");
    expect(html).toContain(">crm</li>");
    expect(html).toContain(">crm-mail</li>");
    expect(html).toContain("the number of apps, to confirm");
  });

  it("shows how far a run is and how each finished purge ended", () => {
    const html = renderToString(
      <PurgeDialog
        apps={["crm", "crm-mail", "crm-chat"]}
        tenant="acme"
        done={[{ app: "crm", result: { status: "Purged", complete: true } }]}
        onConfirm={noop}
        onClose={noop}
      />,
    );
    expect(html).toContain("1 of 3 finished.");
    expect(html).toMatch(/crm<\/span> <span[^>]*>complete</);
    expect(html).toMatch(/crm-mail<\/span> <span[^>]*>purging</);
    expect(html).toMatch(/crm-chat<\/span> <span[^>]*>waiting</);
  });

  it("keeps the single-app confirmation by name", () => {
    const html = renderToString(<PurgeDialog apps={["crm"]} tenant="acme" done={null} onConfirm={noop} onClose={noop} />);
    expect(html).toContain("Type <span class=\"admin-console__mono\">crm</span> to confirm");
  });
});

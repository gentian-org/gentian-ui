/* SPDX-License-Identifier: Apache-2.0 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import type { AskedEgress, AskedIntegration } from "@/api/catalogue";
import { InstallAsks, InstallDialog, InstallIntegrations } from "./CatalogueSection";

const asks: AskedEgress[] = [
  {
    install: "recorder",
    privilege: "egress/recordings",
    reason: "Reads the recordings people connected.",
    hosts: ["api.recorder.example"],
  },
  { install: "relay", privilege: "egress/upstream", cameWith: "recorder" },
];

const render = (props: { asks: AskedEgress[]; mayApprove: boolean; approving: boolean }) =>
  renderToString(<InstallAsks {...props} pending={false} onApproving={() => {}} />);

describe("InstallAsks", () => {
  it("shows nothing for an app that asks for nothing", () => {
    expect(render({ asks: [], mayApprove: true, approving: false })).toBe("");
  });

  it("lists each request with its app, its hosts and the profile's reason", () => {
    const html = render({ asks, mayApprove: true, approving: false });
    expect(html).toContain("recorder");
    expect(html).toContain("api.recorder.example");
    expect(html).toContain("Reads the recordings people connected.");
    expect(html).toContain("relay");
    expect(html).toContain("addresses outside the tenant");
  });

  it("offers the approval to the perimeter approver", () => {
    const html = render({ asks, mayApprove: true, approving: true });
    expect(html).toContain("Approve these requests with the install");
  });

  it("says the app waits once the approver unticks the approval", () => {
    const html = render({ asks, mayApprove: true, approving: false });
    expect(html).not.toContain("checked");
    expect(html).toContain("Without your approval the app is installed and waits");
  });

  it("drops the waiting note once the approver chose to approve", () => {
    const html = render({ asks, mayApprove: true, approving: true });
    expect(html).toContain("checked");
    expect(html).not.toContain("Without your approval");
  });

  it("tells anybody else that the app waits for the approver, and offers no approval", () => {
    const html = render({ asks, mayApprove: false, approving: false });
    expect(html).not.toContain("checkbox");
    expect(html).toContain("perimeter approver approves them");
  });
});

const integrations: AskedIntegration[] = [
  { install: "recorder", contract: "file-store", capabilities: ["webdav:read", "webdav:write"], asPerson: true },
  { install: "relay", contract: "calendar-store", provider: "groupware", capabilities: ["caldav:read"], cameWith: "recorder" },
];

const renderIntegrations = (props: { integrations: AskedIntegration[]; mayGrant: boolean; granting: boolean }) =>
  renderToString(<InstallIntegrations {...props} pending={false} onGranting={() => {}} />);

describe("InstallIntegrations", () => {
  it("shows nothing for an app that consumes nothing", () => {
    expect(renderIntegrations({ integrations: [], mayGrant: true, granting: true })).toBe("");
  });

  it("lists each contract with its app, its capabilities and its provider", () => {
    const html = renderIntegrations({ integrations, mayGrant: true, granting: true });
    expect(html).toContain("file-store");
    expect(html).toContain("webdav:read, webdav:write");
    expect(html).toContain("As the person using it");
    expect(html).toContain("groupware");
    expect(html).toContain("caldav:read");
  });

  it("offers the grant, ticked, to whoever may grant", () => {
    const html = renderIntegrations({ integrations, mayGrant: true, granting: true });
    expect(html).toContain("Grant these with the install");
    expect(html).toContain("checked");
    expect(html).not.toContain("Without your grant");
  });

  it("says the app will not reach them once the grant is unticked", () => {
    const html = renderIntegrations({ integrations, mayGrant: true, granting: false });
    expect(html).not.toContain("checked");
    expect(html).toContain("Without your grant the app is installed and does not reach them");
  });

  it("tells anybody else that they wait for a grant, and offers none", () => {
    const html = renderIntegrations({ integrations, mayGrant: false, granting: true });
    expect(html).not.toContain("checkbox");
    expect(html).toContain("until somebody who may grant grants them");
  });
});

describe("InstallDialog", () => {
  it("starts with no position ticked but the ones that have every app", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["admin", "positions"], {
      tenant: "acme",
      shipped: ["user", "all-apps", "app-administrator", "tenant-administrator"],
      positions: [{ name: "sales", title: "Sales" }],
    });
    const entry = {
      coordinate: "in-house/timesheets",
      name: "timesheets",
      edition: "ce",
      digest: "sha256:" + "a".repeat(64),
      installable: true,
    };
    client.setQueryData(["catalogue", "asks", entry.coordinate, entry.digest], { egress: [], mayApprove: false });
    const html = renderToString(
      <QueryClientProvider client={client}>
        <InstallDialog entry={entry} pending={false} onConfirm={() => {}} onClose={() => {}} />
      </QueryClientProvider>,
    );
    const body = html.slice(html.indexOf("<tbody"));
    const rows = [...body.matchAll(/<input type="checkbox"([^>]*)\/><span>([^<]+)</g)].map((m) => [
      m[2],
      m[1].includes("checked"),
    ]);
    expect(rows).toEqual([
      ["All apps", true],
      ["App administrator", true],
      ["Tenant administrator", false],
      ["Sales", false],
    ]);
  });
});

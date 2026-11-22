/* SPDX-License-Identifier: Apache-2.0 */
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import type { AskedEgress } from "@/api/catalogue";
import { InstallAsks } from "./CatalogueSection";

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

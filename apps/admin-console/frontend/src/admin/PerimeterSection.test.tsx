/* SPDX-License-Identifier: Apache-2.0 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import type { PrivilegeGrant } from "@/api/apps";
import { TrustedDomainsView, WithdrawGrant } from "./PerimeterSection";

const grant: PrivilegeGrant = {
  install: "odoo-base-ce",
  privilege: "egress/module-source",
  approver: "ada@acme.example",
  approvedAt: "2026-11-21T08:42:52Z",
  reason: "",
};

describe("WithdrawGrant", () => {
  it("offers taking a grant back, and says nothing of an outcome before it is asked", () => {
    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <WithdrawGrant grant={grant} />
      </QueryClientProvider>,
    );
    expect(html).toContain("Withdraw");
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("Withdrawn.");
    expect(html).not.toContain("Not withdrawn");
  });
});

describe("TrustedDomainsView", () => {
  const render = (props: { delegated: boolean; domains: string[]; mayChange: boolean }) =>
    renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <TrustedDomainsView {...props} />
      </QueryClientProvider>,
    );

  it("lets the perimeter approver add and remove while the list is delegated", () => {
    const html = render({ delegated: true, domains: ["example.org"], mayChange: true });
    expect(html).toContain("example.org");
    expect(html).toContain("Remove");
    expect(html).toContain("Trust a domain");
  });

  it("warns, beside the field, that a trusted domain opens all of it to every app", () => {
    const html = render({ delegated: true, domains: [], mayChange: true });
    expect(html).toContain("admin-console__warning");
    expect(html).toContain("never the path");
    expect(html).toContain("unasked");
  });

  it("shows the list without a way to change it to anybody else", () => {
    const html = render({ delegated: true, domains: ["example.org"], mayChange: false });
    expect(html).toContain("example.org");
    expect(html).not.toContain("Remove");
    expect(html).not.toContain("Trust a domain");
    expect(html).not.toContain("never the path");
    expect(html).toContain("perimeter approver");
  });

  it("says a list that is not delegated answers nothing, and offers no change", () => {
    const html = render({ delegated: false, domains: [], mayChange: true });
    expect(html).toContain("has not delegated trusted domains");
    expect(html).toContain("no trusted domains of its own");
    expect(html).not.toContain("Trust a domain");
  });
});

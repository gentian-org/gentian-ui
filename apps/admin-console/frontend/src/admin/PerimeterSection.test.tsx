/* SPDX-License-Identifier: Apache-2.0 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import type { PrivilegeGrant } from "@/api/apps";
import { WithdrawGrant } from "./PerimeterSection";

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

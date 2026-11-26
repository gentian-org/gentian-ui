import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import type { ClusterTenant } from "@/api/cluster";
import { TenantsSection } from "./TenantsSection";

function render(tenants: ClusterTenant[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["cluster", "tenants"], { cluster: "demo", tenants });
  client.setQueryData(["cluster", "admin-invitations"], []);
  return renderToString(
    <QueryClientProvider client={client}>
      <TenantsSection />
    </QueryClientProvider>,
  );
}

/** The table row of one tenant, so a claim about it is not met by another's. */
function row(html: string, name: string) {
  const found = html.split("<tr").find((part) => part.includes(`>${name}</span>`));
  expect(found).toBeDefined();
  return found as string;
}

describe("TenantsSection", () => {
  it("offers sleep to a tenant that is awake, and no wake", () => {
    const acme = row(render([{ name: "acme", apps: [], protected: false }]), "acme");
    expect(acme).toContain("Put to sleep");
    expect(acme).not.toContain("Wake…");
    expect(acme).not.toContain("asleep</span>");
  });

  it("shows a sleeping tenant as asleep and offers to wake it for days or for good", () => {
    const acme = row(render([{ name: "acme", apps: [], protected: false, asleep: true }]), "acme");
    expect(acme).toContain("asleep</span>");
    expect(acme).toContain("Wake…");
    expect(acme).toContain("for 1 day");
    expect(acme).toContain("for 7 days");
    expect(acme).toContain("until it is put to sleep");
    expect(acme).not.toContain("Put to sleep");
  });

  it("shows until when a tenant is kept awake and offers both", () => {
    const acme = row(
      render([{ name: "acme", apps: [], protected: false, asleep: false, awakeUntil: "2026-12-01T10:00:00Z" }]),
      "acme",
    );
    expect(acme).toContain("awake until");
    expect(acme).toContain("Put to sleep");
    expect(acme).toContain("Wake…");
  });

  it("offers neither to the platform tenant nor to one being purged", () => {
    const html = render([
      { name: "platform", apps: [], protected: true },
      { name: "gone", apps: [], protected: false, purging: true },
    ]);
    for (const name of ["platform", "gone"]) {
      expect(row(html, name)).not.toContain("Put to sleep");
      expect(row(html, name)).not.toContain("Wake…");
    }
  });
});

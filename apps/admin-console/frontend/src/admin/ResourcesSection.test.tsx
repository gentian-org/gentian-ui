import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import type { ResourcePlan, ResourceState } from "@/api/admin";
import { ResourcesSection } from "./ResourcesSection";

// The plans as the usher serves them for one tenant (gentian-os
// internal/director/lifecycle): one current, one it fits, one it does not.
const plans: ResourcePlan[] = [
  {
    name: "base",
    displayName: "Base",
    description: "",
    tier: 0,
    productSku: "",
    quotas: { cpu: "16" },
    current: true,
    selectable: true,
    blocked: "",
  },
  {
    name: "nodes-2",
    displayName: "Two nodes",
    description: "",
    tier: 1,
    productSku: "",
    quotas: { cpu: "32" },
    current: false,
    selectable: true,
    blocked: "",
  },
  {
    name: "tiny",
    displayName: "Tiny",
    description: "",
    tier: 0,
    productSku: "",
    quotas: { cpu: "2" },
    current: false,
    selectable: false,
    blocked: "limits.cpu: using 15.8, plan allows 2",
  },
];

function render(isPlatformAdmin: boolean, state: Partial<ResourceState> = { plan: "base" }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["admin", "resources", "plans", "team"], plans);
  client.setQueryData(["admin", "resources", "state", "team"], state);
  return renderToString(
    <QueryClientProvider client={client}>
      <ResourcesSection tenant="team" isPlatformAdmin={isPlatformAdmin} />
    </QueryClientProvider>,
  );
}

describe("ResourcesSection", () => {
  it("lets a cluster administrator move the tenant, and force only a plan it does not fit", () => {
    const html = render(true);
    expect(html.match(/Move to this plan/g)?.length).toBe(1);
    expect(html.match(/>Force</g)?.length).toBe(1);
  });

  it("offers a tenant administrator no move, only where to ask", () => {
    const html = render(false);
    expect(html).not.toContain("Move to this plan");
    expect(html).not.toContain(">Force<");
    expect(html).toContain("ask the administrators of this cluster");
  });

  it("lets a tenant administrator request a plan it is not on", () => {
    const html = render(false);
    // nodes-2 and tiny: a smaller plan may be asked for too.
    expect(html.match(/Request this plan/g)?.length).toBe(2);
  });

  const request = {
    plan: "nodes-2",
    by: "tom@team.example",
    at: "2026-11-16T14:00:00Z",
    reason: "Odoo needs room",
  };

  it("shows the tenant administrator their pending request, to withdraw", () => {
    const html = render(false, { plan: "base", request });
    expect(html).toContain("You asked for nodes-2");
    expect(html).toContain("Odoo needs room");
    expect(html).toContain("Withdraw");
    expect(html).toContain(">Requested<");
    expect(html.match(/Request this plan/g)?.length).toBe(1);
    expect(html).not.toContain(">Approve<");
  });

  it("shows the cluster administrator the request, to approve or decline", () => {
    const html = render(true, { plan: "base", request });
    expect(html).toContain("tom@team.example asked for nodes-2");
    expect(html).toContain(">Approve<");
    expect(html).toContain(">Decline<");
    expect(html).not.toContain("Withdraw");
  });
});

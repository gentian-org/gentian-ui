import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import type { IntegrationsOverview } from "@/api/admin";
import { IntegrationsSection } from "./IntegrationsSection";

// The director's integrations answer exactly as it serves it
// (gentian-os internal/applifecycle/platform.go), nothing more: a row the
// screen reads a field from that is not here is a row that crashes or lies.
const overview: IntegrationsOverview = {
  bindings: [
    {
      name: "chat-files",
      contract: "files",
      provider: "files",
      consumer: "chat",
      capabilities: ["read", "write"],
      state: "Active",
    },
  ],
  grants: [
    {
      name: "chat",
      app: "chat",
      consume: [{ contract: "files", granted: ["read"] }],
      allowConsumers: [],
      phase: "Ready",
    },
  ],
  summary: { bindingCount: 1, grantCount: 1, grantReadyCount: 1 },
  effectiveAccess: [
    {
      contract: "files",
      consumer: "chat",
      provider: "files",
      bindingCapabilities: ["read", "write"],
      grantedCapabilities: ["read"],
      grantPhase: "Ready",
      ungranted: ["write"],
    },
  ],
};

function render(data: IntegrationsOverview) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["admin", "integrations", "acme"], data);
  client.setQueryData(["admin", "context"], { canGrant: true });
  return renderToString(
    <QueryClientProvider client={client}>
      <IntegrationsSection tenant="acme" />
    </QueryClientProvider>,
  );
}

describe("IntegrationsSection", () => {
  it("renders a granted integration from the director's answer", () => {
    const html = render(overview);
    expect(html).toContain("Withdraw");
    expect(html).toContain("<td>read, write</td><td>read</td><td>Ready</td>");
    expect(html).toContain("Asked for and not granted: write");
    expect(html).not.toContain("MAC egress");
    expect(html).not.toContain("OpenFGA-synced");
    expect(html).not.toContain(">denied<");
  });

  it("renders a binding that waits for approval", () => {
    const html = render({
      ...overview,
      grants: [],
      summary: { bindingCount: 1, grantCount: 0, grantReadyCount: 0 },
      effectiveAccess: [{ ...overview.effectiveAccess[0], grantedCapabilities: [], grantPhase: "", ungranted: ["read", "write"] }],
    });
    expect(html).toContain("No integration has been approved");
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { RoleHoldersSection } from "./RoleHoldersSection";

// The director's and the registrar's answers as they are served.
const holders = {
  cluster: "demo",
  roles: ["auditor", "securityOfficer"],
  roleHolders: [
    {
      role: "securityOfficer",
      tenant: "acme",
      subject: "7d0f3c2e",
      username: "it@acme.example",
      email: "it@acme.example",
      scope: "cluster",
      reason: "named in the security policy",
    },
    {
      role: "auditor",
      scope: "cluster",
      tenant: "acme",
      subject: "9e8f",
      username: "former@acme.example",
      reason: "the old auditor",
      notInEffect: "no longer an administrator of acme",
    },
    {
      role: "perimeterApprover",
      scope: "tenant:acme",
      tenant: "acme",
      subject: "0a1b2c3d",
      username: "ciso@acme.example",
      reason: "publishes for acme",
      expiresAt: "2020-01-01T00:00:00Z",
    },
  ],
};
const candidates = {
  cluster: "demo",
  complete: false,
  tenants: [
    {
      tenant: "platform",
      realm: "kernel",
      platform: true,
      people: [{ id: "p1", username: "ops@k.example", enabled: true }],
    },
    {
      tenant: "acme",
      displayName: "Acme AG",
      realm: "acme",
      people: [
        { id: "7d0f3c2e", username: "it@acme.example", email: "it@acme.example", enabled: true },
        { id: "0a1b2c3d", username: "ciso@acme.example", enabled: true },
      ],
    },
    { tenant: "globex", realm: "globex", unavailable: true },
  ],
};

const members = {
  cluster: "demo",
  complete: false,
  roles: [
    {
      role: "admin",
      group: "gentian:platform:admin",
      members: [{ id: "u1", username: "ops@k.example", email: "ops@k.example", enabled: true }],
    },
    { role: "securityOfficer", group: "gentian:platform:security", members: [] },
    { role: "auditor", group: "gentian:platform:auditor", members: null, unavailable: true },
  ],
};
const grants = {
  cluster: "demo",
  privileges: [
    {
      tenant: "acme",
      install: "wiki",
      privilege: "podSecurity/run-as-root",
      approver: "sam",
      approvedAt: "2026-10-21T09:00:00Z",
      reason: "reviewed by the officer",
      expiresAt: "2027-01-01T00:00:00Z",
    },
  ],
};

function render(canEdit = true, withHolders: unknown = holders) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["admin", "platform", "role-holders"], withHolders);
  client.setQueryData(["admin", "platform", "role-candidates"], candidates);
  client.setQueryData(["admin", "platform", "role-members"], members);
  client.setQueryData(["admin", "platform", "granted-privileges"], grants);
  return renderToString(
    <QueryClientProvider client={client}>
      <RoleHoldersSection canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

describe("RoleHoldersSection", () => {
  it("lists the holders by role", () => {
    const html = render();
    expect(html).toContain("Security officer");
    expect(html).toContain("Auditor");
    expect(html).toContain("it@acme.example");
    expect(html).toContain("7d0f3c2e");
    expect(html).toContain("Perimeter approver");
    expect(html).toContain("tenant:acme");
    expect(html).toContain("named in the security policy");
    expect(html).toContain("Expired");
    expect(html).toContain("Not in effect: no longer an administrator of acme");
    expect(html).toContain("Nobody holds this role by name");
  });

  it("offers only the administrators who do not hold the picked role yet", () => {
    const html = render();
    const start = html.indexOf('id="role-holder-pick"');
    const picker = html.slice(start, html.indexOf("</select>", start));
    expect(picker).toContain("ciso@acme.example");
    expect(picker).not.toContain("it@acme.example");
    expect(picker).toContain("Acme AG (acme)");
    expect(picker).toContain("ops@k.example");
  });

  it("asks for a reason and an optional expiry", () => {
    const html = render();
    expect(html).toContain('id="role-holder-reason"');
    expect(html).toContain('id="role-holder-expires"');
  });

  it("says which realms could not be read", () => {
    expect(render()).toContain("globex");
  });

  it("lists who holds each role through its group, read only", () => {
    const html = render(false);
    expect(html).toContain("Administrator");
    expect(html).toContain("Through the group gentian:platform:admin:");
    expect(html).toContain("ops@k.example");
    expect(html).toContain("Through the group gentian:platform:security:");
    expect(html).toContain("nobody.");
    expect(html).toContain("the group could not be read.");
    expect(html).toContain("managed in Keycloak");
  });

  it("lists every tenant's granted exceptions", () => {
    const html = render(false);
    expect(html).toContain("Granted exceptions");
    expect(html).toContain("podSecurity/run-as-root");
    expect(html).toContain("reviewed by the officer");
    expect(html).toContain("sam");
  });

  it("is read-only without can_configure", () => {
    const html = render(false);
    expect(html).toContain("it@acme.example");
    expect(html).not.toContain("Remove");
    expect(html).not.toContain("<select");
  });
});

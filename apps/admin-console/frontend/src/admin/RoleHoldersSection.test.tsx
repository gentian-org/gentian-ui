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
    },
  ],
};
const candidates = {
  cluster: "demo",
  complete: false,
  tenants: [
    {
      tenant: "acme",
      displayName: "Acme AG",
      realm: "acme",
      administrators: [
        { id: "7d0f3c2e", username: "it@acme.example", email: "it@acme.example", enabled: true },
        { id: "0a1b2c3d", username: "ciso@acme.example", enabled: true },
      ],
    },
    { tenant: "globex", realm: "globex", unavailable: true },
  ],
};

function render(canEdit = true, withHolders: unknown = holders) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["admin", "platform", "role-holders"], withHolders);
  client.setQueryData(["admin", "platform", "tenant-administrators"], candidates);
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
    expect(html).toContain("Nobody holds this role by name");
  });

  it("offers only the administrators who do not hold the picked role yet", () => {
    const html = render();
    const start = html.indexOf('id="role-holder-pick"');
    const picker = html.slice(start, html.indexOf("</select>", start));
    expect(picker).toContain("ciso@acme.example");
    expect(picker).not.toContain("it@acme.example");
    expect(picker).toContain("Acme AG (acme)");
  });

  it("says which realms could not be read", () => {
    expect(render()).toContain("globex");
  });

  it("is read-only without can_configure", () => {
    const html = render(false);
    expect(html).toContain("it@acme.example");
    expect(html).not.toContain("Remove");
    expect(html).not.toContain("<select");
  });
});

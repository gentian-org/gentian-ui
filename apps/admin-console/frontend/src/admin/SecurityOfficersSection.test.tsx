import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { SecurityOfficersSection } from "./SecurityOfficersSection";

// The director's and the registrar's answers as they are served: who holds
// the role, and who could.
const holders = {
  cluster: "demo",
  securityOfficers: [
    {
      tenant: "acme",
      subject: "7d0f3c2e",
      username: "it@acme.example",
      email: "it@acme.example",
      identityProvider: "tenant-acme",
      signIn: "https://platform.k.example/?kc_idp_hint=tenant-acme",
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

function render(withHolders = holders, withCandidates: unknown = candidates) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["admin", "platform", "security-officers"], withHolders);
  client.setQueryData(["admin", "platform", "tenant-administrators"], withCandidates);
  return renderToString(
    <QueryClientProvider client={client}>
      <SecurityOfficersSection />
    </QueryClientProvider>,
  );
}

describe("SecurityOfficersSection", () => {
  it("lists the holders with where each signs in", () => {
    const html = render();
    expect(html).toContain("it@acme.example");
    expect(html).toContain("7d0f3c2e");
    expect(html).toContain("https://platform.k.example/?kc_idp_hint=tenant-acme");
  });

  it("offers only the administrators who do not hold the role yet", () => {
    const html = render();
    const picker = html.slice(html.indexOf("<select"), html.indexOf("</select>"));
    expect(picker).toContain("ciso@acme.example");
    expect(picker).not.toContain("it@acme.example");
    expect(picker).toContain("Acme AG (acme)");
  });

  it("says which realms could not be read", () => {
    expect(render()).toContain("globex");
  });

  it("says so when nobody holds the role", () => {
    const html = render({ cluster: "demo", securityOfficers: [] });
    expect(html).toContain("Nobody holds the role yet");
  });
});

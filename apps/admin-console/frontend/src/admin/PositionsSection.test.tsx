import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import i18n from "@/lib/i18n";
import type { Person, TenantPositions } from "@/api/admin";
import { allPositions, isShipped, positionLabel, roleLabel } from "./positionLabels";
import { notHolding, PositionsSection, sameRole, withRole } from "./PositionsSection";

function render(node: ReactElement, seed: [unknown[], unknown][]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const [key, data] of seed) client.setQueryData(key, data);
  return renderToString(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/** The text as a person reads it: no markup, and no markers between the pieces. */
function text(html: string) {
  return html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

const positions: TenantPositions = {
  tenant: "acme",
  shipped: ["user", "all-apps", "app-administrator", "tenant-administrator"],
  positions: [
    { name: "sales-manager", title: "Sales manager" },
    { name: "interns" },
    { name: "executive", title: "Executive", includes: ["sales-manager"] },
  ],
};

const t = i18n.t.bind(i18n);

describe("PositionsSection", () => {
  it("lists the positions every tenant has before the tenant's own, each by what people call it", () => {
    const html = text(render(<PositionsSection />, [[["admin", "positions"], positions]]));
    expect(html).toContain("A position is a named set of roles");
    // The four every tenant has, in the platform's words and marked as such.
    for (const label of ["User", "All apps", "App administrator", "Tenant administrator"]) expect(html).toContain(label);
    expect(html.match(/Every tenant has it/g)).toHaveLength(4);
    // The tenant's own by their titles, and by the name where none was given.
    const order = ["Tenant administrator", "Executive", "interns", "Sales manager"].map((label) => html.indexOf(label));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(html).toContain("Who holds a position changes at once.");
  });

  it("says so when the positions cannot be read", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = text(
      renderToString(
        <QueryClientProvider client={client}>
          <PositionsSection />
        </QueryClientProvider>,
      ),
    );
    expect(html).toContain("Reading…");
  });
});

describe("position labels", () => {
  it("names the ones every tenant has in the platform's words and a tenant's own by its title", () => {
    expect(isShipped("user")).toBe(true);
    expect(isShipped("all-apps")).toBe(true);
    expect(positionLabel(t, "user")).toBe("User");
    expect(positionLabel(t, "all-apps")).toBe("All apps");
    expect(isShipped("sales-manager")).toBe(false);
    expect(positionLabel(t, "tenant-administrator")).toBe("Tenant administrator");
    expect(positionLabel(t, "sales-manager", positions.positions)).toBe("Sales manager");
    expect(positionLabel(t, "interns", positions.positions)).toBe("interns");
    // One the list does not have keeps its name: it may have been removed since.
    expect(positionLabel(t, "ghost", positions.positions)).toBe("ghost");
    expect(allPositions(t, positions.shipped, positions.positions).map((p) => p.name)).toEqual([
      "user",
      "all-apps",
      "app-administrator",
      "tenant-administrator",
      "executive",
      "interns",
      "sales-manager",
    ]);
  });

  it("says what User and All apps give, in English and German", () => {
    const de = i18n.getFixedT("de");
    expect(de("positions.shipped_all-apps")).toBe("Alle Apps");
    expect(t("positions.shippedHint_user")).toMatch(/^Enters the tenant: its desktop, no apps\./);
    expect(t("positions.shippedHint_all-apps")).toMatch(/^Uses every app installed in the tenant/);
    expect(de("positions.shippedHint_all-apps")).toMatch(/^Nutzt jede im Mandanten installierte App/);
  });

  it("names a role in words, and leaves one an app declares as the app named it", () => {
    expect(roleLabel(t, "app", "admin")).toBe("Administrator of the app");
    expect(roleLabel(t, "tenant", "user")).toBe("User of the tenant");
    expect(roleLabel(t, "app", "sales-manager")).toBe("sales-manager");
  });
});

describe("a position's roles and holders", () => {
  it("holds a role once, told apart by the thing it is on", () => {
    const roles = [{ role: "user" }, { app: "shop", role: "user" }];
    expect(sameRole({ role: "user" }, { role: "user" })).toBe(true);
    expect(sameRole({ role: "user" }, { app: "shop", role: "user" })).toBe(false);
    expect(withRole(roles, { app: "shop", role: "user" })).toBe(roles);
    expect(withRole(roles, { app: "shop", role: "admin" })).toHaveLength(3);
  });

  it("offers a position only to the people who do not hold it", () => {
    const people: Person[] = [
      { id: "u2", username: "zoe@acme.example" } as Person,
      { id: "u1", username: "ada@acme.example", name: "Ada" } as Person,
      { id: "u3", username: "ben@acme.example" } as Person,
    ];
    expect(notHolding(people, ["u3"]).map((p) => p.id)).toEqual(["u1", "u2"]);
    expect(notHolding(people, [])).toHaveLength(3);
  });
});

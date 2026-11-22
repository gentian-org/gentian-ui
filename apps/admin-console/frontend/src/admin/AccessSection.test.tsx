import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import type { AppState, AuthorizationView, ObjectAccess, PersonAccess, PositionAccess, TenantPositions } from "@/api/admin";
import {
  AccessSection,
  AppAccessView,
  holdsAnything,
  inEffectFrom,
  PersonAccessView,
  PositionAccessView,
  rolesThatFollow,
} from "./AccessSection";

// The usher's answers as they are served.
const tenantPermissions = (inEffect: string[], elsewhere: string[] = []) =>
  ["can_administer", "can_enter", "can_install_app", "can_manage_users", "can_view"].map((name) => ({
    name,
    inEffect: inEffect.includes(name) || elsewhere.includes(name),
    ...(inEffect.includes(name) ? { from: "role" } : elsewhere.includes(name) ? { from: "elsewhere" } : {}),
  }));

const positions: TenantPositions = {
  tenant: "acme",
  shipped: ["user", "app-administrator", "tenant-administrator"],
  positions: [
    { name: "sales-manager", title: "Sales manager", description: "Runs the sales team." },
    { name: "executive", title: "Executive", includes: ["sales-manager"] },
  ],
};

const people = { tenant: "acme", people: [{ id: "u1", username: "ada@acme.example", name: "Ada" }] };

// An executive: the position includes Sales manager, which holds a role the
// sales add-on declares; and one role given beside the positions.
const executive: PersonAccess = {
  tenant: "acme",
  subject: "u1",
  positions: [{ name: "executive" }, { name: "sales-manager", through: "executive" }],
  onTenant: {
    object: "tenant:acme",
    held: [{ role: "user", position: "sales-manager", carries: ["can_enter", "can_view"] }],
    roles: ["user"],
    permissions: tenantPermissions(["can_enter", "can_view"]),
  },
  apps: [
    {
      object: "app:acme/shop-sales",
      app: "shop-sales",
      held: [{ role: "manager", declared: true, position: "sales-manager", carries: ["can_launch", "can_use"] }],
      roles: ["manager", "salesman", "user"],
      permissions: [
        { name: "can_administer", inEffect: false },
        { name: "can_use", inEffect: true, from: "role" },
      ],
    },
    {
      object: "app:acme/shop",
      app: "shop",
      held: [],
      roles: ["user"],
      permissions: [
        { name: "can_administer", inEffect: false },
        { name: "can_use", inEffect: true, from: "app" },
      ],
    },
    {
      object: "app:acme/notes",
      app: "notes",
      held: [{ role: "admin", direct: true, carries: ["can_administer", "can_launch", "can_use"] }],
      roles: ["admin", "user"],
      permissions: [
        { name: "can_administer", inEffect: true, from: "role" },
        { name: "can_use", inEffect: true, from: "role" },
      ],
    },
    {
      object: "app:acme/wiki",
      app: "wiki",
      held: [],
      roles: [],
      permissions: [{ name: "can_use", inEffect: false }],
    },
  ],
};

const nothing = (object: string, app?: string): ObjectAccess => ({
  object,
  ...(app ? { app } : {}),
  held: [],
  roles: [],
  permissions: [{ name: "can_use", inEffect: false }],
});

function render(node: ReactElement, seed: [unknown[], unknown][] = []) {
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

describe("AccessSection", () => {
  it("asks whose access to show before it shows any", () => {
    const html = text(
      render(<AccessSection />, [
        [["admin", "people", ""], people],
        [["admin", "positions"], positions],
        [["admin", "apps", "status"], { tenant: "acme", apps: [] }],
      ]),
    );
    expect(html).toContain("Who may do what in this tenant, and why.");
    expect(html).toContain("Ada (ada@acme.example)");
    expect(html).toContain("Choose a person to see what they hold");
  });

  it("tells what is held from what follows", () => {
    expect(holdsAnything(executive.onTenant)).toBe(true);
    expect(holdsAnything(nothing("app:acme/wiki", "wiki"))).toBe(false);
    // On the base nothing was given; its use follows from the add-on.
    const shop = executive.apps[1];
    expect(holdsAnything(shop)).toBe(true);
    expect(inEffectFrom(shop, "app").map((p) => p.name)).toEqual(["can_use"]);
    expect(rolesThatFollow(shop)).toEqual(["user"]);
    // Holding manager brings salesman and user with it.
    expect(rolesThatFollow(executive.apps[0])).toEqual(["salesman", "user"]);
    expect(rolesThatFollow(executive.apps[2])).toEqual(["user"]);
  });

  it("traces each role to the position it comes through, and marks one given directly", () => {
    const html = text(
      render(<PersonAccessView id="u1" />, [
        [["admin", "access", "person", "u1"], executive],
        [["admin", "positions"], positions],
      ]),
    );
    // The positions: the one given, and the one it includes, by their titles.
    expect(html).toContain("Executive");
    expect(html).toContain("Sales manager included by Executive");
    // A role held through a position names it.
    expect(html).toContain("User of the tenant through the position Sales manager");
    // A role the app declares keeps its own name and says where it is from.
    expect(html).toMatch(/manager\s+Declared by the app\s+through the position Sales manager/);
    expect(html).toContain("Also in effect, following from what is held here or beside it: salesman User of the app");
    // A role given beside the positions is marked as the exception it is.
    expect(html).toMatch(/Administrator of the app\s+given to this person directly\s+Beside their positions/);
    // What follows from the add-on is said on the base.
    expect(html).toContain("Follows from what they hold on the app this one belongs to, or on one of its add-ons:");
    // And the app they hold nothing on is named, not listed.
    expect(html).toContain("No access to: wiki");
    expect(html).not.toContain("group");
  });

  it("says so when a person holds nothing", () => {
    const empty: PersonAccess = {
      tenant: "acme",
      subject: "u2",
      positions: [],
      onTenant: nothing("tenant:acme"),
      apps: [nothing("app:acme/wiki", "wiki")],
    };
    const html = text(
      render(<PersonAccessView id="u2" />, [
        [["admin", "access", "person", "u2"], empty],
        [["admin", "positions"], positions],
      ]),
    );
    expect(html).toContain("Holds no position.");
    expect(html).toContain("Holds nothing in the tenant.");
    expect(html).toContain("Holds nothing in any app.");
  });

  it("says where something in effect comes from when nothing in the tenant accounts for it", () => {
    const auditor: PersonAccess = {
      tenant: "acme",
      subject: "u3",
      positions: [],
      onTenant: {
        object: "tenant:acme",
        held: [],
        roles: [],
        permissions: tenantPermissions([], ["can_view"]),
      },
      apps: [],
    };
    const html = text(
      render(<PersonAccessView id="u3" />, [
        [["admin", "access", "person", "u3"], auditor],
        [["admin", "positions"], positions],
      ]),
    );
    expect(html).toContain("From outside the tenant");
    expect(html).toContain("It follows from a role on the cluster.");
  });

  it("shows what a position holds, what it includes and who was given it", () => {
    const access: PositionAccess = {
      tenant: "acme",
      position: "sales-manager",
      holds: [
        { object: "app:acme/shop-sales", app: "shop-sales", role: "manager", declared: true, carries: ["can_use"] },
        { object: "tenant:acme", role: "user", carries: ["can_enter", "can_view"] },
      ],
      includes: ["user"],
      includedIn: ["executive"],
      holders: ["u1", "u-gone"],
    };
    const seed: [unknown[], unknown][] = [
      [["admin", "access", "position", "sales-manager"], access],
      [["admin", "positions"], positions],
      [["admin", "people", ""], people],
    ];
    const html = text(render(<PositionAccessView name="sales-manager" />, seed));
    expect(html).toContain("Runs the sales team.");
    expect(html).toMatch(/manager\s+Declared by the app\s+on the app\s+shop-sales/);
    expect(html).toContain("User of the tenant on the tenant");
    expect(html).toContain("Includes: User");
    expect(html).toContain("Included by: Executive");
    expect(html).toContain("Ada (ada@acme.example)");
    // An account the list of people does not have is shown by its id.
    expect(html).toContain("u-gone");
    expect(html).toContain("Whoever holds a position that includes this one holds it too");

    // A screen that lists the holders itself leaves them out here.
    const without = text(render(<PositionAccessView name="sales-manager" withoutHolders />, seed));
    expect(without).not.toContain("Who was given it");
    expect(without).not.toContain("Ada (ada@acme.example)");
  });

  it("shows the roles a position inherits, colored apart, each naming where it comes from", () => {
    const access: PositionAccess = {
      tenant: "acme",
      position: "executive",
      holds: [],
      inherited: [
        {
          object: "app:acme/shop-sales",
          app: "shop-sales",
          role: "manager",
          declared: true,
          carries: ["can_use"],
          through: ["sales-manager"],
        },
        { object: "tenant:acme", role: "user", carries: ["can_enter"], through: ["sales-manager", "user"] },
      ],
      includes: ["sales-manager"],
      includedIn: [],
      holders: [],
    };
    const seed: [unknown[], unknown][] = [
      [["admin", "access", "position", "executive"], access],
      [["admin", "positions"], positions],
      [["admin", "people", ""], people],
    ];
    const markup = render(<PositionAccessView name="executive" />, seed);
    const html = text(markup);
    // Holding nothing itself is not holding nothing.
    expect(html).not.toContain("This position holds no role itself");
    expect(html).toContain("Inherited from an included position");
    expect(markup).toContain("admin-console__access-role--inherited");
    expect(markup).not.toContain("admin-console__access-role--own");
    expect(html).toMatch(/manager\s+Declared by the app\s+on the app\s+shop-sales\s+· from Sales manager/);
    expect(html).toContain("· from User, through Sales manager");
    expect(markup).toContain('title="from User, through Sales manager"');
  });

  it("shows who holds which role on an app and what it may do", () => {
    const view: AuthorizationView = {
      object: "app:acme/shop-sales",
      bindings: [
        { relation: "admin", holders: [], grants: ["can_administer", "can_launch", "can_use"] },
        {
          relation: "user",
          holders: [
            { kind: "position", name: "user" },
            { kind: "person", name: "u1" },
            { kind: "person", name: "u-gone" },
          ],
          grants: ["can_launch", "can_use"],
        },
        { relation: "manager", declared: true, holders: [{ kind: "position", name: "sales-manager" }], grants: ["can_use"] },
      ],
      unheld: 1,
    };
    const state: AppState = {
      profile: "shop-sales",
      name: "shop-sales",
      ready: true,
      phase: "ready",
      trustTier: "certified",
      holds: [
        { kind: "app-token", presence: "present", names: ["web"] },
        { kind: "own-store", names: ["groups"] },
        { kind: "something-new", names: ["x"] },
      ],
      addons: [{ profile: "shop-ai", name: "shop-ai", trustTier: "experimental" }],
    };
    const html = text(
      render(<AppAccessView profile="shop-sales" />, [
        [["admin", "access", "app", "shop-sales"], view],
        [["admin", "apps", "status"], { tenant: "acme", apps: [state] }],
        [["admin", "positions"], positions],
        [["admin", "people", ""], people],
      ]),
    );
    // A role nobody holds is a row that says so.
    expect(html).toMatch(/Administrator of the app\s+nobody/);
    // Positions by their names, people by theirs, an unknown account by its id.
    expect(html).toMatch(/User of the app\s+User\s+Ada \(ada@acme.example\)\s+u-gone/);
    expect(html).toMatch(/manager\s+Declared by the app\s+Sales manager/);
    expect(html).not.toContain("app-admins");
    expect(html).toContain("Trust tier: certified");
    expect(html).toContain("valid at this app and nowhere else");
    expect(html).toContain("It keeps rights of its own, which this page does not show.");
    // A hold this console does not know is named as it came.
    expect(html).toContain("something-new: x");
    expect(html).toContain("shop-ai");
  });

  it("says when an app holds nothing on people's behalf", () => {
    const view: AuthorizationView = { object: "app:acme/wiki", bindings: [], unheld: 0 };
    const state: AppState = { profile: "wiki", name: "wiki", ready: true, phase: "ready" };
    const html = text(
      render(<AppAccessView profile="wiki" />, [
        [["admin", "access", "app", "wiki"], view],
        [["admin", "apps", "status"], { tenant: "acme", apps: [state] }],
        [["admin", "positions"], positions],
      ]),
    );
    expect(html).toContain("Holds nothing on people's behalf.");
  });
});

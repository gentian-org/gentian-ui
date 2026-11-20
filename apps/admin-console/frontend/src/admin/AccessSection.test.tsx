import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import type { AppState, AuthorizationView, GroupAccess, PersonAccess } from "@/api/admin";
import {
  AccessSection,
  AppAccessView,
  GroupAccessView,
  holdsAnything,
  inEffectFrom,
  PersonAccessView,
} from "./AccessSection";

// The usher's answers as they are served.
const tenantPermissions = (inEffect: string[], elsewhere: string[] = []) =>
  ["can_administer", "can_enter", "can_install_app", "can_manage_users", "can_view"].map((name) => ({
    name,
    inEffect: inEffect.includes(name) || elsewhere.includes(name),
    ...(inEffect.includes(name) ? { from: "role" } : elsewhere.includes(name) ? { from: "elsewhere" } : {}),
  }));

const admin: PersonAccess = {
  tenant: "acme",
  subject: "u1",
  groups: ["gentian:tenant:acme:admins", "gentian:tenant:acme:app:notes", "gentian:tenant:acme:sales"],
  onTenant: {
    object: "tenant:acme",
    held: [
      {
        role: "admin",
        group: "gentian:tenant:acme:admins",
        carries: ["can_administer", "can_enter", "can_install_app", "can_manage_users", "can_view"],
      },
    ],
    permissions: tenantPermissions(["can_administer", "can_enter", "can_install_app", "can_manage_users", "can_view"]),
  },
  apps: [
    {
      object: "app:acme/notes",
      app: "notes",
      held: [{ role: "entitled", group: "gentian:tenant:acme:app:notes", carries: ["can_launch", "can_use"] }],
      permissions: [
        { name: "can_administer", inEffect: false },
        { name: "can_launch", inEffect: false, from: "role" },
        { name: "can_read_credential", inEffect: true, from: "tenant" },
        { name: "can_use", inEffect: false, from: "role" },
        { name: "can_write_credential", inEffect: true, from: "tenant" },
      ],
    },
    {
      object: "app:acme/wiki",
      app: "wiki",
      held: [],
      permissions: [
        { name: "can_administer", inEffect: false },
        { name: "can_use", inEffect: false },
      ],
    },
  ],
};

const visitor: PersonAccess = {
  tenant: "acme",
  subject: "u2",
  groups: [],
  onTenant: { object: "tenant:acme", held: [], permissions: tenantPermissions([], ["can_enter", "can_view"]) },
  apps: [{ object: "app:acme/wiki", app: "wiki", held: [], permissions: [{ name: "can_use", inEffect: false }] }],
};

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
      render(<AccessSection tenant="acme" />, [
        [["admin", "people", ""], { tenant: "acme", people: [{ id: "u1", username: "ada@acme.example", name: "Ada" }] }],
        [["admin", "people", "groups"], { tenant: "acme", groups: [] }],
        [["admin", "apps", "status"], { tenant: "acme", apps: [] }],
      ]),
    );
    expect(html).toContain("Who may do what in this tenant, and why.");
    expect(html).toContain("Ada (ada@acme.example)");
    expect(html).toContain("Choose a person to see what they hold");
  });

  it("names the group each of a person's roles is held through, in words", () => {
    const html = text(render(<PersonAccessView id="u1" tenant="acme" />, [[["admin", "access", "person", "u1"], admin]]));
    expect(html).toContain("Administrator of the tenant");
    expect(html).toContain("through the group admins");
    expect(html).toContain("Install and remove apps");
    expect(html).toContain("Manage people and groups");
    // The model's own names are for the model.
    expect(html).not.toContain("can_install_app");
    // The groups are listed without the tenant's prefix.
    expect(html).toContain("sales");
    expect(html).not.toContain("gentian:tenant:acme:");
  });

  it("says what a group carries and is withheld, and what follows from the tenant", () => {
    const html = text(render(<PersonAccessView id="u1" tenant="acme" />, [[["admin", "access", "person", "u1"], admin]]));
    expect(html).toContain("User of the app");
    expect(html).toContain("through the group app:notes");
    expect(html).toContain("Not in effect");
    expect(html).toContain("an administrator of the tenant does not use its apps through an app's group");
    expect(html).toContain("Follows from what they hold in the tenant:");
    expect(html).toContain("Set the app's credentials");
    // An app the person holds nothing on is named once, not given a row.
    expect(html).toContain("No access to: wiki");
  });

  it("says when a right comes from outside the tenant", () => {
    const html = text(render(<PersonAccessView id="u2" tenant="acme" />, [[["admin", "access", "person", "u2"], visitor]]));
    expect(html).toContain("From outside the tenant");
    expect(html).toContain("Sign in to the tenant");
    expect(html).toContain("Holds nothing in any app.");
    expect(html).toContain("In no group.");
  });

  it("shows what a group gives and who is in it", () => {
    const group = "gentian:tenant:acme:app:notes";
    const access: GroupAccess = {
      tenant: "acme",
      group,
      holds: [{ object: "app:acme/notes", app: "notes", role: "entitled", carries: ["can_launch", "can_use"] }],
    };
    const seed: [unknown[], unknown][] = [
      [["admin", "access", "group", group], access],
      [["admin", "people", "group-members", group], { group, people: [{ id: "u1", username: "ada@acme.example" }] }],
    ];
    const html = text(render(<GroupAccessView group={group} />, seed));
    expect(html).toContain("User of the app");
    expect(html).toContain("on the app notes");
    expect(html).toContain("Use the app");
    expect(html).toContain("ada@acme.example");

    const empty: GroupAccess = { tenant: "acme", group: "gentian:tenant:acme:sales", holds: [] };
    const none = text(
      render(<GroupAccessView group={empty.group} />, [
        [["admin", "access", "group", empty.group], empty],
        [["admin", "people", "group-members", empty.group], { group: empty.group, people: [] }],
      ]),
    );
    expect(none).toContain("Being in this group gives nothing by itself.");
    expect(none).toContain("nobody");
  });

  it("shows who holds what on an app and what the app may do for people", () => {
    const view: AuthorizationView = {
      object: "app:acme/notes",
      bindings: [
        { relation: "admin", groups: [], grants: ["can_administer"] },
        { relation: "entitled", groups: ["gentian:tenant:acme:app:notes"], grants: ["can_launch", "can_use"] },
      ],
      unheld: 1,
    };
    const state: AppState = {
      profile: "notes",
      name: "notes",
      ready: true,
      phase: "ready",
      trustTier: "certified",
      holds: [
        { kind: "app-token", presence: "present", names: ["web"] },
        { kind: "home", presence: "present", names: ["calendar-store", "file-store"] },
        { kind: "own-store", names: ["groups"] },
        { kind: "something-new", names: ["x"] },
      ],
      addons: [{ profile: "notes-ai", name: "notes-ai", trustTier: "experimental" }],
    };
    const html = text(
      render(<AppAccessView profile="notes" tenant="acme" />, [
        [["admin", "access", "app", "notes"], view],
        [["admin", "apps", "status"], { tenant: "acme", apps: [state] }],
      ]),
    );
    expect(html).toContain("Administrator of the app");
    expect(html).toContain("nobody");
    expect(html).toContain("app:notes");
    expect(html).toContain("Trust tier: certified");
    expect(html).toContain("valid at this app and nowhere else");
    expect(html).toContain("while that person is using it. For: calendar-store, file-store.");
    expect(html).toContain("is given the tenant's group memberships");
    // A kind this console does not know is named as it came, not dropped.
    expect(html).toContain("something-new: x");
    // An add-on that holds nothing says so.
    expect(html).toContain("Add-on notes-ai");
    expect(html).toContain("Holds nothing on people's behalf.");
  });

  it("tells what is in effect from where", () => {
    expect(inEffectFrom(admin.apps[0], "tenant").map((p) => p.name)).toEqual([
      "can_read_credential",
      "can_write_credential",
    ]);
    expect(inEffectFrom(admin.apps[0], "role")).toEqual([]);
    expect(holdsAnything(admin.apps[1])).toBe(false);
    expect(holdsAnything(visitor.onTenant)).toBe(true);
  });
});

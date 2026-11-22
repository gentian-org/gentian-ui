import { describe, expect, it } from "vitest";
import type { PersonAccess } from "@/api/admin";
import { accessOn, personCell } from "./personMatrix";

const access: PersonAccess = {
  tenant: "acme",
  subject: "u1",
  positions: [{ name: "core-team" }],
  onTenant: {
    object: "tenant:acme",
    held: [{ role: "user", position: "user", carries: [] }],
    roles: ["user"],
    permissions: [],
  },
  apps: [
    {
      object: "app:acme/wiki",
      app: "wiki",
      held: [
        { role: "admin", position: "core-team", carries: [] },
        { role: "admin", position: "manager", carries: [] },
      ],
      roles: ["admin", "user", "editor"],
      permissions: [],
    },
    {
      object: "app:acme/shop",
      app: "shop",
      held: [
        { role: "user", position: "user", carries: [] },
        { role: "user", direct: true, carries: [] },
      ],
      roles: ["user"],
      permissions: [],
    },
  ],
};

describe("what a person holds, cell by cell", () => {
  it("finds the tenant and each app", () => {
    expect(accessOn(access, "")?.object).toBe("tenant:acme");
    expect(accessOn(access, "wiki")?.object).toBe("app:acme/wiki");
    expect(accessOn(access, "gone")).toBeUndefined();
    expect(accessOn(undefined, "wiki")).toBeUndefined();
  });

  it("tells a role given to the person from one through positions, one that follows, and one not held", () => {
    // Given to the person themselves wins over the same role through a position.
    expect(personCell(access, "shop", "user")).toEqual({ kind: "own", positions: [] });
    expect(personCell(access, "wiki", "admin")).toEqual({ kind: "inherited", positions: ["core-team", "manager"] });
    expect(personCell(access, "", "user")).toEqual({ kind: "inherited", positions: ["user"] });
    // Admin includes the others.
    expect(personCell(access, "wiki", "user")).toEqual({ kind: "implied", positions: [] });
    expect(personCell(access, "wiki", "editor")).toEqual({ kind: "implied", positions: [] });
    expect(personCell(access, "shop", "admin")).toEqual({ kind: "free", positions: [] });
    expect(personCell(access, "gone", "user")).toEqual({ kind: "free", positions: [] });
    expect(personCell(undefined, "", "user")).toEqual({ kind: "free", positions: [] });
  });
});

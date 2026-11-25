import { describe, expect, it } from "vitest";
import type { PersonAccess, PositionAccess } from "@/api/admin";
import { accessOn, draftGains, draftLosses, pendingCell, personCell } from "./personMatrix";

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

function position(name: string, holds: { app?: string; role: string }[], inherited: typeof holds = []): PositionAccess {
  const hold = (h: { app?: string; role: string }) => ({
    object: h.app ? `app:acme/${h.app}` : "tenant:acme",
    ...h,
    carries: [],
  });
  return {
    tenant: "acme",
    position: name,
    holds: holds.map(hold),
    inherited: inherited.map((h) => ({ ...hold(h), through: ["included"] })),
    includes: [],
    includedIn: [],
    holders: [],
  };
}

describe("what the positions not saved yet would change", () => {
  it("collects what ticked positions bring, held and inherited, naming the positions", () => {
    const gains = draftGains([
      position("editors", [{ app: "shop", role: "admin" }], [{ role: "user" }]),
      position("readers", [{ app: "shop", role: "admin" }]),
    ]);
    expect(gains.get("shop/admin")).toEqual(["editors", "readers"]);
    expect(gains.get("/user")).toEqual(["editors"]);
    expect(gains.has("wiki/admin")).toBe(false);
  });

  it("loses an unticked position and those it alone includes, not one a kept position includes", () => {
    const held: PersonAccess = {
      ...access,
      positions: [
        { name: "core-team" },
        { name: "manager", through: "core-team" },
        { name: "user" },
        { name: "user", through: "core-team" },
      ],
    };
    expect([...draftLosses(held, ["core-team"])].sort()).toEqual(["core-team", "manager"]);
    expect([...draftLosses(held, ["user"])]).toEqual([]);
    expect([...draftLosses(held, ["core-team", "user"])].sort()).toEqual(["core-team", "manager", "user"]);
    // Not read yet: the unticked position alone.
    expect([...draftLosses(undefined, ["core-team"])]).toEqual(["core-team"]);
  });

  it("marks a role a ticked position would bring, and what its Admin brings with it", () => {
    const gains = draftGains([position("editors", [{ app: "shop", role: "admin" }, { app: "wiki", role: "admin" }])]);
    const none = new Set<string>();
    expect(pendingCell(access, gains, none, "shop", "admin")).toEqual({ kind: "pendingGain", positions: ["editors"] });
    // Admin includes the others: the shop's user is held already, the tenant's untouched.
    expect(pendingCell(access, gains, none, "shop", "user")).toEqual({ kind: "own", positions: [] });
    expect(pendingCell(access, gains, none, "shop", "editor")).toEqual({ kind: "pendingGain", positions: ["editors"] });
    expect(pendingCell(access, gains, none, "", "admin")).toEqual({ kind: "free", positions: [] });
    // Held already: no mark.
    expect(pendingCell(access, gains, none, "wiki", "admin")).toEqual({
      kind: "inherited",
      positions: ["core-team", "manager"],
    });
  });

  it("marks a role that comes only through positions that would be lost, and what follows from it", () => {
    const none = new Map<string, string[]>();
    // Only one of the two positions goes: Admin stays.
    expect(pendingCell(access, none, new Set(["core-team"]), "wiki", "admin").kind).toBe("inherited");
    const both = new Set(["core-team", "manager"]);
    expect(pendingCell(access, none, both, "wiki", "admin")).toEqual({
      kind: "pendingLoss",
      positions: ["core-team", "manager"],
    });
    expect(pendingCell(access, none, both, "wiki", "user")).toEqual({
      kind: "pendingLoss",
      positions: ["core-team", "manager"],
    });
    expect(pendingCell(access, none, new Set(["user"]), "", "user")).toEqual({
      kind: "pendingLoss",
      positions: ["user"],
    });
    // Given to the person themselves too: stays.
    expect(pendingCell(access, none, new Set(["user"]), "shop", "user")).toEqual({ kind: "own", positions: [] });
    // A ticked position brings it again: stays.
    const again = draftGains([position("editors", [{ app: "wiki", role: "admin" }])]);
    expect(pendingCell(access, again, both, "wiki", "admin").kind).toBe("inherited");
    expect(pendingCell(access, again, both, "wiki", "user").kind).toBe("implied");
  });

  it("shows the saved state when nothing waits", () => {
    for (const [app, role] of [["", "user"], ["wiki", "admin"], ["wiki", "user"], ["shop", "admin"]]) {
      expect(pendingCell(access, new Map(), new Set(), app, role)).toEqual(personCell(access, app, role));
    }
  });
});

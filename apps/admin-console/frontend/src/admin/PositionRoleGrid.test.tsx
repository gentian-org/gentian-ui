import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import type { AppState } from "@/api/admin";
import { cellState, gridRows, inheritedByRole, strayRoles, toggleRole } from "./PositionRoleGrid";

const t = i18n.t.bind(i18n);

const app = (profile: string, name: string, extra: Partial<AppState> = {}): AppState => ({
  profile,
  name,
  ready: true,
  phase: "Ready",
  ...extra,
});

describe("a position's roles as a grid", () => {
  it("has the tenant, then each installed app with its add-ons under it, and not what the platform places", () => {
    const rows = gridRows(t, [
      app("shop", "Shop", { addons: [{ profile: "shop-sales", name: "Sales" }] }),
      app("center", "Center", { origin: "default" }),
      app("wiki", "Wiki"),
    ]);
    expect(rows.map((r) => `${r.addon ? "  " : ""}${r.profile || "tenant"}`)).toEqual([
      "tenant",
      "shop",
      "  shop-sales",
      "wiki",
    ]);
  });

  it("ticks and unticks a role, on the tenant and on an app", () => {
    let roles = toggleRole([], "", "user", true);
    roles = toggleRole(roles, "shop", "admin", true);
    expect(roles).toEqual([{ role: "user" }, { app: "shop", role: "admin" }]);
    expect(toggleRole(roles, "shop", "admin", false)).toEqual([{ role: "user" }]);
  });

  it("tells a role given from one inherited, one Admin includes, and one not held", () => {
    const inherited = inheritedByRole([
      { object: "app:acme/wiki", app: "wiki", role: "admin", carries: [], through: ["core-team"] },
    ]);
    const roles = [{ app: "shop", role: "admin" }];
    expect(cellState(roles, inherited, "shop", "admin")).toEqual({ kind: "own" });
    expect(cellState(roles, inherited, "shop", "user")).toEqual({ kind: "implied" });
    expect(cellState(roles, inherited, "wiki", "admin")).toEqual({ kind: "inherited", through: ["core-team"] });
    expect(cellState(roles, inherited, "wiki", "editor")).toEqual({ kind: "implied" });
    expect(cellState(roles, inherited, "", "user")).toEqual({ kind: "free" });
  });

  it("names the roles on something it has no row for, so they can be taken away", () => {
    const rows = gridRows(t, [app("shop", "Shop")]);
    expect(strayRoles([{ role: "user" }, { app: "shop", role: "user" }, { app: "center", role: "admin" }], rows)).toEqual([
      { app: "center", role: "admin" },
    ]);
  });
});

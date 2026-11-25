import { describe, expect, it } from "vitest";
import type { Assignment } from "@/api/admin";
import { directRoles, invitable, type PositionChoice } from "./MembersSection";

describe("invitable", () => {
  // The registrar gives every invited person the position User, so the
  // invitation does not offer it as a choice.
  it("leaves out User and offers the rest, All apps among them", () => {
    const positions: PositionChoice[] = [
      { name: "user", label: "User", shipped: true },
      { name: "all-apps", label: "All apps", shipped: true },
      { name: "app-administrator", label: "App administrator", shipped: true },
      { name: "tenant-administrator", label: "Tenant administrator", shipped: true },
      { name: "sales-manager", label: "Sales manager", shipped: false },
    ];
    expect(invitable(positions).map((p) => p.name)).toEqual([
      "all-apps",
      "app-administrator",
      "tenant-administrator",
      "sales-manager",
    ]);
  });
});

describe("directRoles", () => {
  it("is what a person was given beside their positions", () => {
    const assignments: Assignment[] = [
      { position: "user" },
      { role: "admin" },
      { app: "shop-sales", role: "configurator" },
      { position: "engineer" },
    ];
    expect(directRoles(assignments)).toEqual([{ role: "admin" }, { app: "shop-sales", role: "configurator" }]);
    expect(directRoles([{ position: "user" }])).toEqual([]);
  });
});

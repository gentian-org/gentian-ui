import { describe, expect, it } from "vitest";
import type { AuthorizationBinding } from "@/api/admin";
import { directHolders, rolesOffered } from "./RoleHolders";

const bindings: AuthorizationBinding[] = [
  { relation: "admin", holders: [{ kind: "position", name: "app-administrator" }], grants: ["can_administer"] },
  {
    relation: "user",
    holders: [
      { kind: "position", name: "user" },
      { kind: "person", name: "u1" },
    ],
    grants: ["can_use"],
  },
  { relation: "manager", declared: true, holders: [{ kind: "person", name: "u2" }], grants: ["can_use"] },
  { relation: "salesman", declared: true, holders: [], grants: ["can_use"] },
];

describe("an app's roles", () => {
  it("are offered lowest first: user, what the app declares, admin", () => {
    expect(rolesOffered(bindings)).toEqual(["user", "manager", "salesman", "admin"]);
    // An app whose access is not read yet still has the two every app has.
    expect(rolesOffered([])).toEqual(["user", "admin"]);
  });

  it("tells the people given a role themselves from the positions that hold it", () => {
    expect(directHolders(bindings)).toEqual([
      { role: "user", person: "u1" },
      { role: "manager", person: "u2" },
    ]);
  });
});

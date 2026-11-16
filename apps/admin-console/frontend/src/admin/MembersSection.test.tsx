import { describe, expect, it } from "vitest";
import { describeGroups } from "./groupLabels";
import { invitable } from "./MembersSection";

describe("invitable", () => {
  // The registrar puts every invited person in the tenant's members group,
  // so the invitation does not offer it as a choice.
  it("leaves out the tenant's members group and offers the rest", () => {
    const groups = describeGroups(
      [
        { id: "1", name: "gentian:tenant:acme:members", path: "gentian:tenant:acme:members" },
        { id: "2", name: "gentian:tenant:acme:app-admins", path: "gentian:tenant:acme:app-admins" },
        { id: "3", name: "gentian:tenant:acme:app:open-webui-ce", path: "gentian:tenant:acme:app:open-webui-ce" },
        { id: "4", name: "gentian:tenant:acme:members-of-sales", path: "gentian:tenant:acme:members-of-sales", custom: true },
      ],
      "acme",
    );
    expect(invitable(groups).map((g) => g.path)).toEqual([
      "gentian:tenant:acme:app-admins",
      "gentian:tenant:acme:members-of-sales",
      "gentian:tenant:acme:app:open-webui-ce",
    ]);
  });
});

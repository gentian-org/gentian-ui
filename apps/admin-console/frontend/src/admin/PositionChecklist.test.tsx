import { describe, expect, it } from "vitest";
import { positionsOf } from "@/api/apps";
import { whoGetsIt } from "./CatalogueSection";
import { choosablePositions, headerState, toggledAll } from "./PositionChecklist";

describe("who gets an app, by position", () => {
  const own = [{ name: "sales", title: "Sales" }];
  const choosable = choosablePositions(own);

  it("offers every position but the one that administers every app", () => {
    expect(choosable).toEqual(["user", "tenant-administrator", "sales"]);
  });

  it("shows the box at the top as all, some or none", () => {
    expect(headerState(choosable, new Set(choosable))).toBe("all");
    expect(headerState(choosable, new Set(["sales"]))).toBe("some");
    expect(headerState(choosable, new Set())).toBe("none");
  });

  it("ticks everything from none or some, and nothing from all", () => {
    expect([...toggledAll(choosable, new Set())]).toEqual(choosable);
    expect([...toggledAll(choosable, new Set(["sales"]))]).toEqual(choosable);
    expect([...toggledAll(choosable, new Set(choosable))]).toEqual([]);
  });

  it("reads an entry's positions with User for the default grant", () => {
    expect(positionsOf({ defaultGrant: true, positions: ["sales"] })).toEqual(["user", "sales"]);
    expect(positionsOf({ positions: ["sales"] })).toEqual(["sales"]);
    expect(positionsOf(undefined)).toEqual([]);
  });

  it("says who gets a new install", () => {
    expect(whoGetsIt(["user", "sales"])).toBe("catalogue.outcomeEveryone");
    expect(whoGetsIt(["sales"])).toBe("catalogue.outcomePositions");
    expect(whoGetsIt([])).toBe("catalogue.outcomeNobody");
  });
});

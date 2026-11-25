import { describe, expect, it } from "vitest";
import { positionsOf } from "@/api/apps";
import { whoGetsIt } from "./CatalogueSection";
import { choosablePositions, headerState, toggledAll } from "./PositionChecklist";

describe("who gets an app, by position", () => {
  const own = [{ name: "sales", title: "Sales" }];
  const choosable = choosablePositions(own);

  it("offers every position but the ones that have every app and the one that gives none", () => {
    expect(choosable).toEqual(["tenant-administrator", "sales"]);
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

  it("reads an entry's positions, leaving out User, which gives no app", () => {
    expect(positionsOf({ positions: ["user", "sales"] })).toEqual(["sales"]);
    expect(positionsOf({ positions: ["sales"] })).toEqual(["sales"]);
    expect(positionsOf(undefined)).toEqual([]);
  });

  it("says who gets a new install", () => {
    expect(whoGetsIt(["sales"])).toBe("catalogue.outcomePositions");
    expect(whoGetsIt([])).toBe("catalogue.outcomeNobody");
  });
});

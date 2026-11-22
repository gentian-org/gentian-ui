import { describe, expect, it } from "vitest";
import { toggleDraft, withDraft, withoutKey } from "./membershipDraft";

describe("a draft of what a person holds", () => {
  const current = new Set(["user", "sales-manager"]);

  it("collects ticks instead of applying them, and shows them applied", () => {
    let draft = toggleDraft({}, current, "executive", true);
    draft = toggleDraft(draft, current, "sales-manager", false);
    expect(draft).toEqual({ "executive": true, "sales-manager": false });
    expect([...withDraft(current, draft)].sort()).toEqual(["executive", "user"]);
  });

  it("forgets a box ticked back to what it is, so there is nothing to save", () => {
    const draft = toggleDraft(toggleDraft({}, current, "executive", true), current, "executive", false);
    expect(draft).toEqual({});
  });

  it("drops a change once it went through and keeps the one that failed", () => {
    expect(withoutKey({ "executive": true, "sales-manager": false }, "executive")).toEqual({ "sales-manager": false });
  });
});

// The order of the quick bar, and moving an app within it, including an app
// installed after the order was saved.
//
//   node --test test/*.test.js

import assert from "node:assert/strict";
import { test } from "node:test";
import { moveToSlot, quickBarOrder } from "../src/lib/quickBar.js";

test("without a saved order the bar is the apps", () => {
  assert.deepEqual(quickBarOrder(undefined, undefined, ["a", "b"]), ["a", "b"]);
});

test("an app installed after the order was saved comes last", () => {
  assert.deepEqual(quickBarOrder(["b", "a"], [], ["a", "b", "new"]), ["b", "a", "new"]);
});

test("an app taken off the bar does not come back", () => {
  assert.deepEqual(quickBarOrder(["a"], ["gone"], ["a", "gone"]), ["a"]);
});

test("a link shortcut in the saved order stays", () => {
  assert.deepEqual(quickBarOrder(["link:1", "a"], [], ["a"]), ["link:1", "a"]);
});

test("an app installed after the order was saved can be moved", () => {
  const ids = quickBarOrder(["a", "ai"], [], ["a", "ai", "new"]);
  assert.deepEqual(moveToSlot(ids, "new", ids, 1), ["a", "new", "ai"]);
});

test("an app can be dropped in front of one installed later", () => {
  const ids = quickBarOrder(["a", "b"], [], ["a", "b", "new"]);
  assert.deepEqual(moveToSlot(ids, "a", ids, 2), ["b", "a", "new"]);
});

test("the last slot is the end of the list", () => {
  assert.deepEqual(moveToSlot(["a", "b", "c"], "a", ["a", "b", "c"], 3), ["b", "c", "a"]);
});

test("a drop just before its own slot leaves the app in place", () => {
  assert.deepEqual(moveToSlot(["a", "b", "c"], "b", ["a", "b", "c"], 1), ["a", "b", "c"]);
});

test("an entry with no slot does not shift the drop", () => {
  const ids = ["a", "uninstalled", "b", "c"];
  assert.deepEqual(moveToSlot(ids, "c", ["a", "b", "c"], 1), ["a", "uninstalled", "c", "b"]);
});

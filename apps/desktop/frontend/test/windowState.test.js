// What raising and minimizing do to a window's state.
//
//   node --test test/*.test.js

import assert from "node:assert/strict";
import { test } from "node:test";
import { minimized, stateOnRaise } from "../src/lib/windowState.js";

test("raising keeps a maximized window maximized", () => {
  assert.equal(stateOnRaise({ state: "maximized" }), "maximized");
});

test("raising keeps a normal window normal", () => {
  assert.equal(stateOnRaise({ state: "normal" }), "normal");
});

test("a window minimized from maximized comes back maximized", () => {
  assert.equal(stateOnRaise({ ...minimized({ state: "maximized" }) }), "maximized");
});

test("a window minimized from normal comes back normal", () => {
  assert.equal(stateOnRaise({ ...minimized({ state: "normal" }) }), "normal");
});

test("minimizing twice remembers the state before the first", () => {
  const once = minimized({ state: "maximized" });
  assert.equal(stateOnRaise(minimized(once)), "maximized");
});

test("a window opened minimized comes up normal", () => {
  assert.equal(stateOnRaise({ state: "minimized" }), "normal");
});

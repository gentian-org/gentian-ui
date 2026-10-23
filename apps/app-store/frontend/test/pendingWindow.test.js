// The framed path: a window opened in the click, sent on once the address is known.
//
//   node --test test/*.test.js

import assert from "node:assert/strict";
import { test } from "node:test";
import { closePending, openPending, sendPending } from "../src/lib/pendingWindow.js";

function fakeWindow({ blocked = false } = {}) {
  const opened = { closed: false, opener: "the App Store", location: { href: "about:blank" }, close() { this.closed = true; } };
  return {
    calls: [],
    opened,
    open(url, target) {
      this.calls.push([url, target]);
      return blocked ? null : opened;
    },
  };
}

test("the window is opened at once, empty, with no hold on the page", () => {
  const win = fakeWindow();
  const pending = openPending(win);
  assert.deepEqual(win.calls, [["", "_blank"]]);
  assert.equal(pending.opener, null);
  assert.equal(pending.location.href, "about:blank");
});

test("it is sent to the store's address once the API has answered", () => {
  const pending = openPending(fakeWindow());
  assert.equal(sendPending(pending, "https://id.store.example/auth?x=1"), true);
  assert.equal(pending.location.href, "https://id.store.example/auth?x=1");
});

test("an address that is not https, or a window that is gone, sends nothing", () => {
  const pending = openPending(fakeWindow());
  assert.equal(sendPending(pending, "javascript:alert(1)"), false);
  closePending(pending);
  assert.equal(pending.closed, true);
  assert.equal(sendPending(pending, "https://id.store.example/"), false);
});

test("a blocked window is said to be one, so the page offers a link instead", () => {
  assert.equal(openPending(fakeWindow({ blocked: true })), null);
  assert.equal(sendPending(null, "https://id.store.example/"), false);
});

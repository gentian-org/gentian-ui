// Opening the Admin Console at an app: a desktop window, or a tab.
//
//   node --test test/*.test.js

import assert from "node:assert/strict";
import { test } from "node:test";
import { OPEN_APP, OPENED, openInDesktop, pathOf } from "../src/lib/openInDesktop.js";

function fakeWindow({ framed, answers }) {
  const listeners = new Set();
  const win = {
    opened: [],
    posted: [],
    timers: [],
    open: (href) => win.opened.push(href),
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
    setTimeout: (fn) => win.timers.push(fn),
  };
  win.parent = framed
    ? {
        postMessage: (data) => {
          win.posted.push(data);
          if (answers) for (const fn of listeners) fn({ source: win.parent, data: { type: OPENED } });
        },
      }
    : win;
  return win;
}

const HREF = "https://admin.acme.example/?tab=apps&app=nextcloud";

test("only the path and query of an https address are sent", () => {
  assert.equal(pathOf(HREF), "/?tab=apps&app=nextcloud");
  assert.equal(pathOf("http://admin.acme.example/"), null);
});

test("outside the desktop the address opens in a tab", () => {
  const win = fakeWindow({ framed: false });
  openInDesktop("admin-console", HREF, win);
  assert.deepEqual(win.opened, [HREF]);
});

test("inside the desktop it asks for a window, and opens no tab once answered", () => {
  const win = fakeWindow({ framed: true, answers: true });
  openInDesktop("admin-console", HREF, win);
  assert.deepEqual(win.posted, [{ type: OPEN_APP, app: "admin-console", path: "/?tab=apps&app=nextcloud" }]);
  win.timers.forEach((fn) => fn());
  assert.deepEqual(win.opened, []);
});

test("a desktop that does not answer leaves it to a tab", () => {
  const win = fakeWindow({ framed: true, answers: false });
  openInDesktop("admin-console", HREF, win);
  win.timers.forEach((fn) => fn());
  assert.deepEqual(win.opened, [HREF]);
});

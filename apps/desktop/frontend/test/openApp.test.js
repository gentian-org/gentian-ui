// Which messages from a window the desktop answers by opening another app.
//
//   node --test test/*.test.js

import assert from "node:assert/strict";
import { test } from "node:test";
import { OPEN_APP, openAppRequest } from "../src/lib/openApp.js";

const STORE = "https://store.acme.example";
const APPS = [
  { id: "kernel-acme/app-store/web", title: "App Store", launchUrl: `${STORE}/` },
  { id: "kernel-acme/admin-console/web", title: "Admin Console", launchUrl: "https://admin.acme.example/" },
];
const ask = (data, origin = STORE, apps = APPS) => openAppRequest({ origin, data }, apps);
const open = (path, app = "admin-console") => ({ type: OPEN_APP, app, path });

test("a tile's page opens another of the person's apps at a path", () => {
  const got = ask(open("/?tab=apps&app=nextcloud"));
  assert.equal(got.app.id, "kernel-acme/admin-console/web");
  assert.equal(got.url, "https://admin.acme.example/?tab=apps&app=nextcloud");
});

test("a message from an origin that is no tile's is ignored", () => {
  assert.equal(ask(open("/"), "https://evil.example"), null);
  assert.equal(ask(open("/"), "null"), null);
});

test("an app the person has no tile for is not opened", () => {
  assert.equal(ask(open("/", "keycloak")), null);
  assert.equal(ask(open("/", "../admin-console")), null);
});

test("only a relative path on the target's own origin is taken", () => {
  for (const path of ["https://evil.example/", "//evil.example/", "/\\evil.example", "javascript:alert(1)", "", "x", "/a b", "/\u0000"]) {
    assert.equal(ask(open(path)), null, path);
  }
});

test("anything that is not the message is ignored", () => {
  assert.equal(ask(null), null);
  assert.equal(ask("gentian:open-app"), null);
  assert.equal(ask({ type: "other", app: "admin-console", path: "/" }), null);
  assert.equal(ask({ type: OPEN_APP, app: "admin-console" }), null);
  assert.equal(ask(open("/"), STORE, []), null);
});

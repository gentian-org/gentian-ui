import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HINT_COOKIE,
  hintCookie,
  kernelDomainOf,
  routeAddress,
  workspaceConsole,
} from "../site/sign-in/route.js";

const KERNEL = "gentian-os.org";

test("the page knows the kernel from the identity provider's host", () => {
  assert.equal(kernelDomainOf("id.gentian-os.org"), KERNEL);
  assert.equal(kernelDomainOf("ID.Gentian-OS.org"), KERNEL);
  assert.equal(kernelDomainOf("gentian-os.org"), KERNEL);
});

test("a tenant's address goes to that tenant's console", () => {
  assert.deepEqual(routeAddress(" Admin@Test.Gentian-OS.org ", KERNEL), {
    kind: "console",
    url: "https://console.test.gentian-os.org/",
    address: "admin@test.gentian-os.org",
  });
});

test("an address on the kernel domain goes to the kernel console", () => {
  assert.equal(routeAddress("admin@gentian-os.org", KERNEL).url, "https://console.gentian-os.org/");
});

test("an address the page cannot place asks for the workspace, whatever it is", () => {
  for (const address of ["someone@gmail.com", "a@b.c.gentian-os.org", "x@gentian-os.org.evil.com"]) {
    assert.equal(routeAddress(address, KERNEL).kind, "unknown", address);
  }
});

test("what is not an address is refused before anything else", () => {
  for (const input of ["", "admin", "admin@", "@test.gentian-os.org", "a b@test.gentian-os.org"]) {
    assert.equal(routeAddress(input, KERNEL).kind, "invalid", input);
  }
});

test("a workspace named by hand is a tenant on this kernel, or nothing", () => {
  assert.equal(workspaceConsole(" Acme ", KERNEL), "https://console.acme.gentian-os.org/");
  assert.equal(workspaceConsole("acme.evil.com", KERNEL), "");
  assert.equal(workspaceConsole("-acme", KERNEL), "");
  assert.equal(workspaceConsole("", KERNEL), "");
});

test("the hint reaches only the realm pages, briefly, and over TLS", () => {
  const cookie = hintCookie("admin@test.gentian-os.org");
  assert.ok(cookie.startsWith(`${HINT_COOKIE}=admin%40test.gentian-os.org;`));
  assert.match(cookie, /Path=\/auth\/realms\//);
  assert.match(cookie, /Max-Age=600/);
  assert.match(cookie, /Secure/);
  assert.doesNotMatch(cookie, /Domain=/);
});

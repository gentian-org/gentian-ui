import { test } from "node:test";
import assert from "node:assert/strict";

import {
  kernelDomainOf,
  routeAddress,
  withLoginHint,
  workspaceConsole,
} from "../site/sign-in/route.js";

const KERNEL = "gentian-os.org";

test("the page knows the kernel from the identity provider's host", () => {
  assert.equal(kernelDomainOf("gentian-os.org"), KERNEL);
  assert.equal(kernelDomainOf("Gentian-OS.org"), KERNEL);
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

test("the address travels to the console as login_hint, and nowhere else", () => {
  assert.equal(
    withLoginHint("https://console.test.gentian-os.org/", "admin@test.gentian-os.org"),
    "https://console.test.gentian-os.org/?login_hint=admin%40test.gentian-os.org",
  );
  assert.equal(withLoginHint("https://console.test.gentian-os.org/", ""), "https://console.test.gentian-os.org/");
});

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  kernelDomainOf,
  routeAddress,
  withLoginHint,
  workspaceDesktop,
} from "../site/sign-in/route.js";

const KERNEL = "gentian-os.org";

test("the page knows the kernel from the identity provider's host", () => {
  assert.equal(kernelDomainOf("gentian-os.org"), KERNEL);
  assert.equal(kernelDomainOf("Gentian-OS.org"), KERNEL);
});

test("a tenant's address goes to that tenant's desktop", () => {
  assert.deepEqual(routeAddress(" Admin@Test.Gentian-OS.org ", KERNEL), {
    kind: "desktop",
    url: "https://desktop.test.gentian-os.org/",
    address: "admin@test.gentian-os.org",
  });
});

test("an address on the kernel domain is a platform administrator's", () => {
  assert.deepEqual(routeAddress("Admin@Gentian-OS.org", KERNEL), {
    kind: "desktop",
    url: "https://platform.gentian-os.org/",
    address: "admin@gentian-os.org",
  });
});

test("the platform tenant's desktop is its zone's own name", () => {
  assert.equal(routeAddress("admin@platform.gentian-os.org", KERNEL).url, "https://platform.gentian-os.org/");
  assert.equal(workspaceDesktop(" Platform ", KERNEL), "https://platform.gentian-os.org/");
  // Only the name itself: anything else is a tenant like any other.
  assert.equal(workspaceDesktop("platform-x", KERNEL), "https://desktop.platform-x.gentian-os.org/");
});

test("nothing leads anywhere but the platform's desktop or one tenant's desktop", () => {
  const allowed = /^https:\/\/(platform|desktop\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)\.gentian-os\.org\/$/;
  for (const address of [
    "a@gentian-os.org",
    "a@platform.gentian-os.org",
    "a@acme.gentian-os.org",
    "a@desktop.gentian-os.org",
    "a@b.c.gentian-os.org",
    "a@evil.com",
    "a@gentian-os.org.evil.com",
    "a@evilgentian-os.org",
    "a@evil.com/.gentian-os.org",
    "a@evil.com#.gentian-os.org",
  ]) {
    const routed = routeAddress(address, KERNEL);
    if (routed.kind === "desktop") assert.match(routed.url, allowed, address);
    else assert.equal(routed.url, undefined, address);
  }
  for (const name of ["platform", "acme", "a.b", "evil.com/", "evil.com#", "@evil.com", "a/b", "a:b", "-a", ""]) {
    const url = workspaceDesktop(name, KERNEL);
    if (url) assert.match(url, allowed, name);
  }
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
  assert.equal(workspaceDesktop(" Acme ", KERNEL), "https://desktop.acme.gentian-os.org/");
  assert.equal(workspaceDesktop("acme.evil.com", KERNEL), "");
  assert.equal(workspaceDesktop("-acme", KERNEL), "");
  assert.equal(workspaceDesktop("", KERNEL), "");
});

test("the address travels to the desktop as login_hint, and nowhere else", () => {
  assert.equal(
    withLoginHint("https://desktop.test.gentian-os.org/", "admin@test.gentian-os.org"),
    "https://desktop.test.gentian-os.org/?login_hint=admin%40test.gentian-os.org",
  );
  assert.equal(withLoginHint("https://desktop.test.gentian-os.org/", ""), "https://desktop.test.gentian-os.org/");
});

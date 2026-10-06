import { test } from "node:test";
import assert from "node:assert/strict";

import {
  kernelDomainOf,
  routeAddress,
  singleConsole,
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

test("a single user tenant's console on this kernel is forwarded to", () => {
  assert.deepEqual(singleConsole("https://console.acme.gentian-os.org/", KERNEL), {
    kind: "tenant",
    url: "https://console.acme.gentian-os.org/",
    domain: "acme.gentian-os.org",
  });
  assert.equal(singleConsole("https://console.acme.gentian-os.org", KERNEL).url, "https://console.acme.gentian-os.org/");
  assert.equal(singleConsole("https://console.acme.gentian-os.org:443/", KERNEL).url, "https://console.acme.gentian-os.org/");
});

test("a console on any other domain is a custom domain, to be confirmed by its lookup", () => {
  assert.deepEqual(singleConsole("https://console.acme.example/", KERNEL), {
    kind: "custom",
    url: "https://console.acme.example/",
    domain: "acme.example",
  });
  // More than one label under the kernel is not a tenant's name.
  assert.equal(singleConsole("https://console.a.b.gentian-os.org/", KERNEL).kind, "custom");
  assert.equal(singleConsole("https://console.gentian-os.org.evil.com/", KERNEL).kind, "custom");
  assert.equal(singleConsole("https://console.evilgentian-os.org/", KERNEL).kind, "custom");
});

test("the kernel's own console is never the single tenant's", () => {
  assert.equal(singleConsole("https://console.gentian-os.org/", KERNEL), null);
  assert.equal(singleConsole("https://CONSOLE.Gentian-OS.org/", KERNEL), null);
});

test("anything but a bare https console address is refused", () => {
  for (const input of [
    undefined,
    null,
    42,
    {},
    "",
    "console.acme.gentian-os.org",
    "//console.acme.gentian-os.org/",
    "http://console.acme.gentian-os.org/",
    "javascript:alert(1)",
    "https://user@console.acme.gentian-os.org/",
    "https://user:pw@console.acme.gentian-os.org/",
    "https://console.acme.gentian-os.org:8443/",
    "https://console.acme.gentian-os.org/path",
    "https://console.acme.gentian-os.org/?next=https://evil.com/",
    "https://console.acme.gentian-os.org/?",
    "https://console.acme.gentian-os.org/#x",
    "https://console.acme.gentian-os.org/#",
    "https://console.acme.gentian-os.org./",
    "https://console..gentian-os.org/",
    "https://console.-acme.gentian-os.org/",
    "https://console./",
    "https://console/",
    "https://acme.gentian-os.org/",
    "https://notconsole.acme.gentian-os.org/",
    "https://evil.com/console.acme.gentian-os.org/",
    "https://evil.com\\@console.acme.gentian-os.org/",
    "https://console.acme.gentian-os.org@evil.com/",
    "https://console.1.2.3/",
    "https://[::1]/",
  ]) {
    assert.equal(singleConsole(input, KERNEL), null, String(input));
  }
  assert.equal(singleConsole("https://console.acme.gentian-os.org/", ""), null);
});

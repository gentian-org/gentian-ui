// Where an address signs in.
//
// The address says which workspace it belongs to: a tenant's people sign in
// as <name>@<tenant>.<kernel>, the platform's administrators as
// <name>@<kernel>. This page reads the part after the @ and sends the browser
// to that workspace's desktop, whose sign-in is the workspace's own. It asks
// nothing of the server, so it can tell nobody whether an account exists: an
// address it cannot place is answered by asking for the workspace's name,
// whatever the address.
//
// Every address built here is one of two and nothing else:
// https://platform.<kernel>/, or https://console.<label>.<kernel>/ for one
// DNS label.

const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
// The platform tenant: its desktop is its zone's own name, not console. under it.
const PLATFORM = "platform";
const ADDRESS = /^[^\s@]+@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

/** The kernel domain this page is served on: the cluster's bare domain. */
export function kernelDomainOf(hostname) {
  return String(hostname || "").toLowerCase();
}

/** Normalises an address, or returns "" when it is not one. */
export function normaliseAddress(input) {
  const address = String(input || "").trim().toLowerCase();
  return ADDRESS.test(address) ? address : "";
}

/** The desktop the tenant with this name signs in at: `tenant` is one label. */
function desktopOf(tenant, kernelDomain) {
  return tenant === PLATFORM
    ? `https://${PLATFORM}.${kernelDomain}/`
    : `https://console.${tenant}.${kernelDomain}/`;
}

/**
 * Routes an address.
 *   {kind: "invalid"}                 not an address
 *   {kind: "console", url, address}   a workspace on this kernel: the
 *                                     platform's for the kernel's own domain
 *   {kind: "unknown", address}        on no workspace this page can place
 */
export function routeAddress(input, kernelDomain) {
  const address = normaliseAddress(input);
  if (!address) return { kind: "invalid" };
  const domain = address.slice(address.lastIndexOf("@") + 1);
  if (domain === kernelDomain) {
    return { kind: "console", url: desktopOf(PLATFORM, kernelDomain), address };
  }
  const suffix = "." + kernelDomain;
  if (domain.endsWith(suffix)) {
    const tenant = domain.slice(0, -suffix.length);
    if (LABEL.test(tenant)) {
      return { kind: "console", url: desktopOf(tenant, kernelDomain), address };
    }
  }
  return { kind: "unknown", address };
}

/** The desktop of a workspace named by hand, or "" when the name is not one. */
export function workspaceConsole(name, kernelDomain) {
  const tenant = String(name || "").trim().toLowerCase();
  return LABEL.test(tenant) ? desktopOf(tenant, kernelDomain) : "";
}

/**
 * The console address with the person's address on it, as login_hint.
 *
 * The console is behind the edge, which starts the sign-in and hands the
 * identity provider the address it was asked for inside the request's
 * `state`. The identity provider's sign-in form reads the hint from there
 * and fills the username. Nothing is stored anywhere to make that work: no
 * cookie, and nothing on the identity provider's host.
 */
export function withLoginHint(consoleUrl, address) {
  const url = new URL(consoleUrl);
  if (address) url.searchParams.set("login_hint", address);
  return url.toString();
}

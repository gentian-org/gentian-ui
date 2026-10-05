// Where an address signs in.
//
// The address says which workspace it belongs to: a tenant's people sign in
// as <name>@<tenant>.<kernel>, the cluster's own as <name>@<kernel>. This
// page reads the part after the @ and sends the browser to that workspace's
// console, whose sign-in is the workspace's own. It asks nothing of the
// server, so it can tell nobody whether an account exists: an address it
// cannot place is answered by asking for the workspace's name, whatever the
// address.

const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const ADDRESS = /^[^\s@]+@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

/** The kernel domain this page is served under: id.<kernel>, or the kernel
 * domain itself when it is served there. */
export function kernelDomainOf(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host.startsWith("id.") ? host.slice(3) : host;
}

/** Normalises an address, or returns "" when it is not one. */
export function normaliseAddress(input) {
  const address = String(input || "").trim().toLowerCase();
  return ADDRESS.test(address) ? address : "";
}

/** The console a workspace on this kernel signs in at. */
export function consoleOf(zoneDomain) {
  return `https://console.${zoneDomain}/`;
}

/**
 * Routes an address.
 *   {kind: "invalid"}                 not an address
 *   {kind: "console", url, address}   a workspace on this kernel
 *   {kind: "unknown", address}        on no workspace this page can place
 */
export function routeAddress(input, kernelDomain) {
  const address = normaliseAddress(input);
  if (!address) return { kind: "invalid" };
  const domain = address.slice(address.lastIndexOf("@") + 1);
  if (domain === kernelDomain) {
    return { kind: "console", url: consoleOf(kernelDomain), address };
  }
  const suffix = "." + kernelDomain;
  if (domain.endsWith(suffix)) {
    const tenant = domain.slice(0, -suffix.length);
    if (LABEL.test(tenant)) {
      return { kind: "console", url: consoleOf(domain), address };
    }
  }
  return { kind: "unknown", address };
}

/** The console of a workspace named by hand, or "" when the name is not one. */
export function workspaceConsole(name, kernelDomain) {
  const tenant = String(name || "").trim().toLowerCase();
  return LABEL.test(tenant) ? consoleOf(`${tenant}.${kernelDomain}`) : "";
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

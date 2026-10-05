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

/** The cookie that carries the address to the identity provider's sign-in
 * form, which fills it in. Host-only on id.<kernel> and scoped to the realm
 * pages, so nothing but that form ever receives it, and short-lived. */
export const HINT_COOKIE = "gentian_login_hint";

export function hintCookie(address) {
  return `${HINT_COOKIE}=${encodeURIComponent(address)}; Path=/auth/realms/; Max-Age=600; Secure; SameSite=Lax`;
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

/**
 * The address a person most likely meant, when what they gave is a slip away
 * from this cluster's domain: gentian-org.org for gentian-os.org. Browsers
 * remember a mistyped username and offer it again, so the slip comes back.
 * "" when the address is not close to anything here. Offered, never followed
 * on its own: a domain that merely resembles this one is still another's.
 */
export function suggestAddress(input, kernelDomain) {
  const address = normaliseAddress(input);
  if (!address) return "";
  const at = address.lastIndexOf("@");
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  const near = (candidate) => candidate !== kernelDomain && distance(candidate, kernelDomain) <= 3;
  if (near(domain)) return `${local}@${kernelDomain}`;
  const dot = domain.indexOf(".");
  if (dot > 0) {
    const tenant = domain.slice(0, dot);
    if (LABEL.test(tenant) && near(domain.slice(dot + 1))) return `${local}@${tenant}.${kernelDomain}`;
  }
  return "";
}

import { hintCookie, kernelDomainOf, routeAddress, suggestAddress, workspaceConsole } from "./route.js";

const kernelDomain = kernelDomainOf(window.location.hostname);
const $ = (id) => document.getElementById(id);

// An address on no workspace this page can place may still be one the cluster
// serves under a custom domain. config.json's lookup names a same-origin
// directory holding one file per such domain, named by the domain's SHA-256
// and answering {"url": "https://..."}: the page finds a domain it already
// knows, and nobody can list the domains the cluster serves.
let lookup = "";

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function lookUp(address) {
  if (!lookup) return "";
  const domain = address.slice(address.lastIndexOf("@") + 1);
  try {
    const res = await fetch(`${lookup}${await sha256Hex(domain)}.json`, { cache: "no-store" });
    if (!res.ok) return "";
    const { url } = await res.json();
    return typeof url === "string" && url.startsWith("https://") ? url : "";
  } catch {
    return "";
  }
}

// The lookup directory, from config.json, which the deployment mounts.
async function applyConfig() {
  try {
    const res = await fetch("/sign-in/config.json", { cache: "no-store" });
    if (!res.ok) return;
    const cfg = await res.json();
    if (typeof cfg.lookup === "string" && cfg.lookup.startsWith("/")) {
      lookup = cfg.lookup.endsWith("/") ? cfg.lookup : cfg.lookup + "/";
    }
  } catch {
    // No configuration: no lookup, and every unplaced address is asked for
    // its workspace.
  }
}

// What the cluster calls itself and its logo, from the brand the operator
// publishes beside this page; the colours arrive by stylesheet. Without it
// the page is the platform's own.
async function applyBrand() {
  try {
    const res = await fetch("/branding/brand.json", { cache: "no-cache" });
    if (!res.ok) return;
    const brand = await res.json();
    if (typeof brand.name !== "string" || !brand.name.trim()) return;
    const name = brand.name.trim();
    document.title = `Sign in · ${name}`;
    $("product").textContent = name;
    $("logo").setAttribute("aria-label", name);
    const icon = (brand.icons || []).find(
      (i) => i && typeof i.src === "string" && (!i.purpose || i.purpose.split(" ").includes("any")),
    );
    if (icon) {
      const url = new URL(icon.src, `${window.location.origin}/branding/`).href;
      if (url.startsWith("https://")) $("logo").style.backgroundImage = `url("${url.replace(/"/g, "")}")`;
    }
  } catch {
    // The platform's own.
  }
}

function go(url, address) {
  if (address) document.cookie = hintCookie(address);
  window.location.assign(url);
}

function showError(id, message) {
  const el = $(id);
  el.textContent = message;
  el.hidden = !message;
}

let pending = "";

$("address-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("address-error", "");
  const routed = routeAddress($("address").value, kernelDomain);
  if (routed.kind === "invalid") {
    showError("address-error", "Enter your e-mail address.");
    return;
  }
  if (routed.kind === "console") {
    go(routed.url, routed.address);
    return;
  }
  const found = await lookUp(routed.address);
  if (found) {
    go(found, routed.address);
    return;
  }
  pending = routed.address;
  // Say why the question is asked. An address one letter off the cluster's
  // domain lands here too, and "which workspace?" alone reads as the page
  // having failed to recognise a tenant it should know.
  const domain = routed.address.slice(routed.address.lastIndexOf("@") + 1);
  $("unplaced").textContent =
    `${domain} is not a domain of this cluster. Addresses here end in @<workspace>.${kernelDomain}` +
    ` — check the address, or name the workspace.`;
  // A slip away from this cluster's domain: offer the address they meant,
  // one click from signing in with it.
  const meant = suggestAddress(routed.address, kernelDomain);
  const offer = $("suggestion");
  offer.hidden = !meant;
  if (meant) {
    offer.textContent = `Did you mean ${meant}?`;
    offer.onclick = () => {
      const again = routeAddress(meant, kernelDomain);
      if (again.kind === "console") go(again.url, again.address);
    };
  }
  $("address-form").hidden = true;
  $("workspace-form").hidden = false;
  (meant ? offer : $("workspace")).focus();
});

$("workspace-form").addEventListener("submit", (event) => {
  event.preventDefault();
  showError("workspace-error", "");
  const url = workspaceConsole($("workspace").value, kernelDomain);
  if (!url) {
    showError("workspace-error", "A workspace name is lower-case letters, digits and hyphens.");
    return;
  }
  go(url, pending);
});

$("back").addEventListener("click", () => {
  $("workspace-form").hidden = true;
  $("address-form").hidden = false;
  $("address").focus();
});

$("suffix").textContent = "." + kernelDomain;
applyConfig();
applyBrand();

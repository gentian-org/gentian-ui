import { kernelDomainOf, routeAddress, singleConsole, withLoginHint, workspaceConsole } from "./route.js";

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
  await forwardWhenSingle();
}

// The operator's file from the lookup directory, or null. Same-origin only:
// a lookup path that leads off this origin, or a redirect that does, fails.
async function lookupFile(name) {
  const res = await fetch(`${lookup}${name}`, { cache: "no-store", mode: "same-origin" });
  if (!res.ok) return null;
  const body = await res.json();
  return body !== null && typeof body === "object" && !Array.isArray(body) ? body : null;
}

// A cluster with one user tenant has one console for its users, and nobody
// needs asking which. The operator says so with one file in the lookup
// directory; where it is absent this is a cluster of many workspaces and the
// form stays. The administrators' console is never where this leads: they
// sign in at console.<kernel> by name.
//
// Only ever a console of this cluster: console.<tenant>.<kernel>, or a custom
// domain the operator published -- one whose own lookup file exists and names
// that same console. Nothing here comes from the address bar or the form.
async function forwardWhenSingle() {
  if (!lookup) return;
  try {
    const single = await lookupFile("_single.json");
    const target = single && singleConsole(single.url, kernelDomain);
    if (!target) return;
    if (target.kind === "custom") {
      const published = await lookupFile(`${await sha256Hex(target.domain)}.json`);
      const named = published && singleConsole(published.url, kernelDomain);
      if (!named || named.url !== target.url) return;
    }
    window.location.replace(target.url);
  } catch {
    // The form stays.
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
  window.location.assign(withLoginHint(url, address));
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
  $("address-form").hidden = true;
  $("workspace-form").hidden = false;
  $("workspace").focus();
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

import { hintCookie, kernelDomainOf, routeAddress, workspaceConsole } from "./route.js";

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

// What the operator of this cluster calls it. Read from config.json, which the
// deployment mounts; the page works without it, under the default name.
async function applyConfig() {
  try {
    const res = await fetch("/sign-in/config.json", { cache: "no-store" });
    if (!res.ok) return;
    const cfg = await res.json();
    if (typeof cfg.lookup === "string" && cfg.lookup.startsWith("/")) {
      lookup = cfg.lookup.endsWith("/") ? cfg.lookup : cfg.lookup + "/";
    }
    if (typeof cfg.productName === "string" && cfg.productName.trim()) {
      const name = cfg.productName.trim();
      document.title = `Sign in · ${name}`;
      $("product").textContent = name;
      $("logo").setAttribute("aria-label", name);
    }
    if (typeof cfg.logoUrl === "string" && /^(https:\/\/|\/)/.test(cfg.logoUrl)) {
      $("logo").style.backgroundImage = `url("${cfg.logoUrl.replace(/"/g, "")}")`;
    }
  } catch {
    // No configuration is a configuration: the defaults.
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

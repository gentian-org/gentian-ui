import { useSyncExternalStore } from "react";
import { getKernelDomain } from "@/auth/oidc";

/**
 * The cluster's brand: what this page calls the product, its icon, and its
 * look.
 *
 * The operator renders it from the cluster's Branding and the identity
 * provider's host serves it, at https://id.<kernel>/branding/, for every page
 * on the cluster: brand.css holds the design tokens as --brand-* custom
 * properties, which the design system reads with its own values as fallback,
 * and brand.json the name, the icons and whether to show the platform
 * vendor's offers. Without either the page is the platform's own.
 */
export type BrandIcon = { src: string; sizes?: string; type?: string; purpose?: string };

export type Brand = {
  name: string;
  shortName: string;
  icons?: BrandIcon[];
  hideVendorPromotions?: boolean;
};

const DEFAULT_BRAND: Brand = { name: "Gentian", shortName: "Gentian" };

let current: Brand = DEFAULT_BRAND;
const listeners = new Set<() => void>();

function brandBase(): string | null {
  const kernel = getKernelDomain();
  return kernel ? `https://id.${kernel}/branding/` : null;
}

/** The icon a page shows as its logo: the first whose purpose admits "any". */
export function brandLogo(brand: Brand): string | null {
  const base = brandBase();
  const icon = brand.icons?.find((i) => !i.purpose || i.purpose.split(" ").includes("any"));
  if (!icon || !base) return null;
  const url = new URL(icon.src, base).href;
  return url.startsWith("https://") ? url : null;
}

function setIcon(href: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
}

/**
 * Loads the brand: the stylesheet at once, so the first paint already has the
 * brand's colours, and the identity after. Called once, before the first
 * render.
 */
export function loadBrand(): void {
  const base = brandBase();
  if (!base) return;
  const sheet = document.createElement("link");
  sheet.rel = "stylesheet";
  sheet.href = base + "brand.css";
  // The browser's own chrome takes the brand's primary colour too, once the
  // stylesheet that defines it has arrived.
  sheet.onload = () => {
    const primary = getComputedStyle(document.documentElement).getPropertyValue("--brand-color-brand-500").trim();
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (primary && meta) meta.content = primary;
  };
  document.head.prepend(sheet);
  // The installed app is the brand's: its manifest names it and carries its
  // icons. Served cross-origin with CORS; a start_url on another origin is
  // ignored by the browser, so the app still starts here.
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (manifest) {
    manifest.crossOrigin = "anonymous";
    manifest.href = base + "brand.webmanifest";
  }
  fetch(base + "brand.json", { cache: "no-cache", credentials: "omit" })
    .then((res) => (res.ok ? (res.json() as Promise<Brand>) : null))
    .then((brand) => {
      if (!brand || typeof brand.name !== "string" || !brand.name) return;
      current = { ...DEFAULT_BRAND, ...brand };
      document.title = document.title.replace(DEFAULT_BRAND.name, current.name);
      const logo = brandLogo(current);
      if (logo) setIcon(logo);
      listeners.forEach((l) => l());
    })
    .catch(() => {
      // No brand published is a brand: the platform's own.
    });
}

/** The brand, re-rendering when it arrives. */
export function useBrand(): Brand {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

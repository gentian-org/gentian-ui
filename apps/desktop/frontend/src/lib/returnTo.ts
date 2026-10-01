import { defaultBasePath } from "@/lib/device";

/** Restrict post-login redirects to same-origin shell paths. */
export function safeReturnTo(value: string | null | undefined): "/desktop" | "/mobile" {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return defaultBasePath();
  }
  if (value.startsWith("/mobile")) {
    return "/mobile";
  }
  if (value.startsWith("/desktop")) {
    return "/desktop";
  }
  return defaultBasePath();
}

export function loginPathWithReturnTo(returnTo?: string): string {
  const path = safeReturnTo(returnTo ?? defaultBasePath());
  return `/login?returnTo=${encodeURIComponent(path)}`;
}

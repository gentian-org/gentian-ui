/** Coarse pointer or narrow viewport → mobile shell. */
export function prefersMobileShell(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.innerWidth < 768;
  return coarse || narrow;
}

export function defaultBasePath(): "/desktop" | "/mobile" {
  return prefersMobileShell() ? "/mobile" : "/desktop";
}

/** Match legacy base-router query params (OpenDesk login bootstrap). */
export function basePathFromLegacyRouter(search: {
  pointer_coarse?: string;
  viewport_width?: string;
  base?: string;
}): "/desktop" | "/mobile" {
  if (search.base === "gentian-mobile") {
    return "/mobile";
  }
  if (search.base === "gentian-desktop") {
    return "/desktop";
  }
  const pointerCoarse = search.pointer_coarse === "true";
  const viewportWidth = Number.parseInt(search.viewport_width ?? "0", 10);
  if (pointerCoarse && viewportWidth > 0 && viewportWidth <= 768) {
    return "/mobile";
  }
  return "/desktop";
}

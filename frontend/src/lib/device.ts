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

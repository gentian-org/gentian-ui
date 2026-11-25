/**
 * Where a person lands after signing in at an outside service they started
 * connecting to in the account panel: the liaison sends them to
 * `/?account=connections&connected=<name>` (or `failed=declined`,
 * `failed=1`). The page takes that off the address once and opens the
 * account panel, which shows the tab and what happened.
 */
export type AccountArrival = {
  tab: "connections";
  connected?: string;
  failed?: string;
};

let pending: AccountArrival | null = null;

/**
 * Takes an arrival off the address, keeps it for the account panel, and
 * answers whether there was one.
 */
export function arriveFromAddress(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get("account") !== "connections") {
    return false;
  }
  pending = {
    tab: "connections",
    connected: url.searchParams.get("connected") ?? undefined,
    failed: url.searchParams.get("failed") ?? undefined,
  };
  for (const key of ["account", "connected", "failed"]) {
    url.searchParams.delete(key);
  }
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  return true;
}

/** The arrival the account panel opens with, until it was shown. */
export function pendingArrival(): AccountArrival | null {
  return pending;
}

export function arrivalShown() {
  pending = null;
}

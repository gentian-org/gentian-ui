import type { AppWriteResult } from "@/api/apps";
import { apiFetch } from "@/api/client";

/**
 * The cluster's own catalogs (AD-14).
 *
 * Deliberately thin, and the thinness is the design rather than an omission.
 * A catalog source publishes an index of coordinates, versions, editions and
 * digests — no display name, no description, no icon, no price. Those are the
 * App Store's, they are what it is for, and a cluster reproducing them badly
 * would compete with a screen somebody else keeps current.
 */

export type CatalogueSource = {
  name: string;
  /**
   * "cluster" for one of the cluster's defaults, on the Cluster claim, which
   * every tenant sees; "tenant" for one the tenant names itself (Tenant
   * `spec.catalogue.sources`), whoever added it there.
   */
  scope?: "cluster" | "tenant";
  /** Who added it: "cluster", "tenant", or "store" for a cluster default the installer added. */
  addedBy?: string;
};

/**
 * Whether the tenant names a catalog of its own: one beyond the cluster's
 * defaults. Its apps are ones the App Store does not list, so this is what
 * the Catalogs tab is shown for.
 */
export function namesOwnCatalogue(sources: CatalogueSourcesResponse | undefined): boolean {
  return (sources?.catalogues ?? []).some((source) => source.scope === "tenant");
}

export type CatalogueSourcesResponse = {
  tenant: string;
  /** Where to send somebody for everything this cluster does not list. */
  storeUrl: string;
  catalogues: CatalogueSource[];
};

export type CatalogueEntry = {
  coordinate: string;
  name: string;
  version?: string;
  /** ce, pe, me or ee — but only ce and pe are ever listed here. */
  edition: string;
  trustTier?: string;
  /** Which bytes the entry is, as its source states it. */
  digest: string;
  /** Installable from here: the source states a digest for the entry. */
  installable: boolean;
};

export type CatalogueEntriesResponse = {
  tenant: string;
  catalogue: string;
  storeUrl: string;
  entries: CatalogueEntry[];
  /** How many entries are maintained or licensed, and so the store's. */
  storeOnly: number;
};

export function fetchCatalogueSources(tenant?: string) {
  const query = tenant ? `?tenant=${encodeURIComponent(tenant)}` : "";
  return apiFetch<CatalogueSourcesResponse>(`/catalogue/sources${query}`);
}

export function fetchCatalogueEntries(source: string, tenant?: string) {
  const query = tenant ? `?tenant=${encodeURIComponent(tenant)}` : "";
  return apiFetch<CatalogueEntriesResponse>(
    `/catalogue/sources/${encodeURIComponent(source)}/entries${query}`,
  );
}


/** One outbound request of a build that nobody has answered yet. */
export type AskedEgress = {
  /** The app the request is of: the entry itself, or one it comes with. */
  install: string;
  /** `egress/<name>`, as an approval names it. */
  privilege: string;
  /** What the profile says it needs it for. */
  reason?: string;
  /** The hosts of a request by host; none for one by address. */
  hosts?: string[];
  /** The app this one comes with, for a request that is not the entry's own. */
  cameWith?: string;
};

/** One contract a build consumes from the tenant's other apps that no grant covers yet. */
export type AskedIntegration = {
  /** The app that consumes: the entry itself, or one it comes with. */
  install: string;
  /** The contract, as a grant names it. */
  contract: string;
  /** The app the profile expects to provide it; absent where the tenant's binding chooses. */
  provider?: string;
  /** What of the contract the build asks for, and what a grant with the install grants. */
  capabilities: string[];
  /** Whether the app calls the provider as the person it acts for. */
  asPerson?: boolean;
  /** The app this one comes with, for a contract that is not the entry's own. */
  cameWith?: string;
};

export type CatalogueEntryAsks = {
  egress: AskedEgress[];
  /** Whether this person may approve them: the tenant's perimeter approver. */
  mayApprove: boolean;
  /** Absent from a director that does not say them. */
  integrations?: AskedIntegration[];
  /** Whether this person may grant them (can_grant). */
  mayGrant?: boolean;
};

/** What one build asks for, before it is installed. The director's answer. */
export function fetchCatalogueEntryAsks(entry: Pick<CatalogueEntry, "name" | "coordinate" | "digest">) {
  const source = entry.coordinate.split("/")[0];
  return apiFetch<CatalogueEntryAsks>(
    `/catalogue/sources/${encodeURIComponent(source)}/entries/${encodeURIComponent(entry.name)}/asks` +
      `?digest=${encodeURIComponent(entry.digest)}`,
  );
}

/**
 * Install one listed entry into the console's tenant: the entry's own
 * coordinate and digest, handed back as the listing gave them. The digest is
 * what pins the build; the director refuses a source that serves other bytes.
 *
 * `positions` says who gets it: the positions of the tenant whose holders use
 * the app, stated in the install itself. An empty list gives it to no
 * position; a role on it is then given per person.
 *
 * `approve` names outbound requests of the build that the person approves
 * with the install, as the director listed them. Each becomes their grant;
 * the director refuses the whole install when they may not approve.
 *
 * `grant` names the contracts the build consumes that the person grants with
 * the install, each with exactly what the build asks for; the director
 * refuses the whole install when they may not grant.
 */
export function installCatalogueEntry(
  entry: Pick<CatalogueEntry, "name" | "coordinate" | "digest">,
  positions: string[] = [],
  approve: AskedEgress[] = [],
  grant: AskedIntegration[] = [],
) {
  const body: {
    coordinate: string;
    digest: string;
    positions: string[];
    approve?: { install: string; privilege: string }[];
    grant?: { install: string; contract: string }[];
  } = {
    coordinate: entry.coordinate,
    digest: entry.digest,
    positions,
  };
  if (approve.length > 0) {
    body.approve = approve.map(({ install, privilege }) => ({ install, privilege }));
  }
  if (grant.length > 0) {
    body.grant = grant.map(({ install, contract }) => ({ install, contract }));
  }
  return apiFetch<AppWriteResult>(`/catalogue/apps/${encodeURIComponent(entry.name)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

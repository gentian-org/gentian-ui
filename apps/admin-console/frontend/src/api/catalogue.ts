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
};

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


/**
 * Install one listed entry into the console's tenant: the entry's own
 * coordinate and digest, handed back as the listing gave them. The digest is
 * what pins the build; the director refuses a source that serves other bytes.
 *
 * `positions` says who gets it: the positions of the tenant whose holders use
 * the app, stated in the install itself. An empty list gives it to no
 * position; a role on it is then given per person.
 */
export function installCatalogueEntry(
  entry: Pick<CatalogueEntry, "name" | "coordinate" | "digest">,
  positions: string[] = [],
) {
  const body = { coordinate: entry.coordinate, digest: entry.digest, positions };
  return apiFetch<AppWriteResult>(`/catalogue/apps/${encodeURIComponent(entry.name)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

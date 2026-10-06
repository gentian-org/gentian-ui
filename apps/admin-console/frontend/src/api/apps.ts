/* SPDX-License-Identifier: Apache-2.0 */
import { apiFetch } from "@/api/client";

/**
 * The tenant's installed apps, as git declares them, and what is done to one.
 *
 * What the cluster has made of them is a different answer from a different
 * service (`fetchAppStates` in admin.ts, the usher's). The Apps screen joins
 * the two and says so where they disagree.
 */

/** One entry of the tenant's apps list as git records it. */
export type DeclaredApp = {
  profile: string;
  /** The build the install is pinned to, when it was installed at one. */
  digest?: string;
  addons?: string[];
  /** Installed for everyone: every member has access by default. */
  defaultGrant?: boolean;
  /**
   * The catalogue the build was fetched from. Git records it; the director
   * does not serve it yet, so this is absent today and shown as such.
   */
  catalogue?: string;
};

export function fetchDeclaredApps() {
  return apiFetch<{ tenant: string; apps: DeclaredApp[] }>("/admin/apps");
}

/**
 * The director's answer to a write of an app's entry. A commit:
 * `commit` is there when git changed and absent when the tenant already was
 * as asked (`already_installed`, `not_installed`).
 */
export type AppWriteResult = {
  status: string;
  commit?: string;
};

/**
 * State whether an installed app is for everyone. Only that travels: the
 * entry's pinned build is left as it is.
 */
export function setAppForEveryone(profile: string, everyone: boolean) {
  return apiFetch<AppWriteResult>(`/admin/apps/${encodeURIComponent(profile)}/access`, {
    method: "PUT",
    body: JSON.stringify({ everyone }),
  });
}

/** Remove an app. Its data is kept, and a later install finds it again. */
export function uninstallApp(profile: string) {
  return apiFetch<AppWriteResult>(`/admin/apps/${encodeURIComponent(profile)}`, {
    method: "DELETE",
  });
}

/** What the cluster answered to a purge. */
export type AppPurgeResult = {
  status: string;
  message?: string;
};

/**
 * Destroy the data an uninstalled app left behind. Not undone. The cluster
 * refuses it for an app the tenant still has.
 */
export function purgeAppData(profile: string) {
  return apiFetch<AppPurgeResult>("/admin/apps/purge", {
    method: "POST",
    body: JSON.stringify({ profile }),
  });
}

/** One approved privilege, as git records the approval. */
export type PrivilegeGrant = {
  /** The component the grant is for. */
  install: string;
  /** `<kind>/<name>`, naming one request of the app's profile. */
  privilege: string;
  approver: string;
  approvedAt: string;
  reason: string;
  expiresAt?: string;
};

export function fetchTenantPrivileges() {
  return apiFetch<{ tenant: string; privileges: PrivilegeGrant[] }>("/admin/apps/privileges");
}

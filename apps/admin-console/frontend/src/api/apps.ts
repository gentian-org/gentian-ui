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

/**
 * Remove an app. The app and its sign-in client go; its files, database,
 * object storage, stored credentials and access group are kept, and a later
 * install finds them again.
 */
export function uninstallApp(profile: string) {
  return apiFetch<AppWriteResult>(`/admin/apps/${encodeURIComponent(profile)}`, {
    method: "DELETE",
  });
}

/** One uninstalled app that still holds data, as the cluster reports it. */
export type RetainedApp = {
  profile: string;
  state: string;
  /**
   * Whether the app's profile is still on the cluster. Without it nothing
   * says which stores the app had, and a purge of it is refused.
   */
  profileAvailable: boolean;
  /** Per kind of data: `present`, `absent` or `unknown`. */
  kinds: Record<string, string>;
  /** The volume claims counted as the app's files. */
  volumes?: string[];
};

/** The uninstalled apps that still hold data: what a purge of each would destroy. */
export type RetainedApps = {
  tenant: string;
  apps: RetainedApp[];
  /** Per kind, why the read reports it as unknown. */
  unknown?: Record<string, string>;
};

export function fetchRetainedApps() {
  return apiFetch<RetainedApps>("/admin/apps/retained");
}

/**
 * What the cluster answered to a purge that was not refused and did not fail.
 * Only `complete: true` means everything the app could hold was destroyed.
 */
export type AppPurgeResult = {
  status: string;
  message?: string;
  complete?: boolean;
  /** The kinds of data that are now gone. */
  destroyed?: string[];
  /** The kinds the purge did not look at, and which may still be there. */
  notExamined?: string[];
};

/**
 * Destroy the data an uninstalled app left behind. Not undone. One request,
 * answered when the purge is over, which can take several minutes; nothing
 * here gives up before the answer. The cluster refuses it for an app the
 * tenant still has, and a purge that did not finish says where it stopped.
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

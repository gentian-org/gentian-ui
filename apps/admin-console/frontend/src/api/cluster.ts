import { apiFetch } from "@/api/client";

/**
 * One setting of the cluster, as the director describes it.
 *
 * The catalogue arrives with the values, so the console renders the screen
 * from one answer and holds no list of its own. A setting with no `value` is
 * unset in the claim, which is a different thing from set to nothing: the
 * schema's default applies, and the screen says so rather than showing a blank
 * box that looks like someone cleared it.
 */
export type ClusterSetting = {
  /** Dotted path within the claim's spec, e.g. "mail.serviceMode". */
  path: string;
  /** What this setting is for, written for the person changing it. */
  doc: string;
  /** The values it accepts, when it is a closed set. */
  oneOf?: string[];
  /** What the claim carries now. Absent when the claim does not set it. */
  value?: string;
  /**
   * What applies while the setting is unset, from the Cluster XRD. Absent
   * when the schema declares no default, which is itself the answer: nothing
   * is applied, and the screen must not invent a value.
   */
  default?: string;
};

export type ClusterSettingsResponse = {
  cluster: string;
  settings: ClusterSetting[];
};

/**
 * The outcome of a write, which is a commit rather than a save.
 *
 * 202 means git has the change and the cluster does not yet, and `commit` is
 * the handle to follow it. 200 means the state asked for already held and
 * nothing was committed.
 */
export type ClusterSettingsWriteResult = {
  status: string;
  commit?: string;
  /** False when the request changed nothing. */
  changed: boolean;
};

export function fetchClusterSettings() {
  return apiFetch<ClusterSettingsResponse>("/cluster/settings");
}

export async function updateClusterSettings(
  settings: Record<string, string>,
): Promise<ClusterSettingsWriteResult> {
  const body = await apiFetch<{ status: string; commit?: string }>("/cluster/settings", {
    method: "PATCH",
    body: JSON.stringify({ settings }),
  });
  return { ...body, changed: Boolean(body.commit) };
}

/**
 * One tenant, as the deployments repository has it.
 *
 * From git and not from the cluster: a tenant whose manifest is committed but
 * which the operator has not finished provisioning is still a tenant, and the
 * screen says committed rather than pretending it is absent.
 */
export type ClusterTenant = {
  name: string;
  displayName?: string;
  /** The Keycloak realm this tenant's people live in. */
  realm?: string;
  /** Profile names installed into it. */
  apps: string[];
  /** True for a tenant the director refuses to retire. */
  protected: boolean;
  /** True while a purge is under way: its data is set to be deleted and the
   * tenant goes once the cluster has taken that in. */
  purging?: boolean;
};

export type ClusterTenantsResponse = {
  cluster: string;
  tenants: ClusterTenant[];
};

export function fetchClusterTenants() {
  return apiFetch<ClusterTenantsResponse>("/cluster/tenants");
}

export async function createClusterTenant(
  name: string,
  displayName: string,
  requireMFA = true,
): Promise<ClusterSettingsWriteResult> {
  const body = await apiFetch<{ status: string; commit?: string }>("/cluster/tenants", {
    method: "POST",
    body: JSON.stringify({ name, displayName, requireMFA }),
  });
  return { ...body, changed: Boolean(body.commit) };
}

export async function retireClusterTenant(name: string): Promise<ClusterSettingsWriteResult> {
  const body = await apiFetch<{ status: string; commit?: string }>(
    `/cluster/tenants/${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
  return { ...body, changed: Boolean(body.commit) };
}

/**
 * Retire a tenant and delete its data. The answer is the first of two
 * commits; the tenant is listed as purging until the second removes it.
 */
export async function purgeClusterTenant(name: string, keepBundles = false): Promise<ClusterSettingsWriteResult> {
  const body = await apiFetch<{ status: string; commit?: string }>(
    `/cluster/tenants/${encodeURIComponent(name)}/purge`,
    { method: "POST", body: JSON.stringify(keepBundles ? { keepBundles: true } : {}) },
  );
  return { ...body, changed: Boolean(body.commit) };
}

/** How an administrator account was handed over: mailed, or a link to show once. */
export type AdminActivation = {
  tenant: string;
  username: string;
  activation: {
    mailed: boolean;
    email?: string;
    link?: string;
    /** Seconds since the epoch. */
    expiresAt?: number;
    actions: string[];
  };
};

export function activateTenantAdmin(tenant: string, recoveryEmail?: string) {
  return apiFetch<AdminActivation>(`/cluster/tenants/${encodeURIComponent(tenant)}/activate-admin`, {
    method: "POST",
    body: JSON.stringify(recoveryEmail ? { recoveryEmail } : {}),
  });
}

/** Where an uploaded bundle went. */
export type BundleRef = { bucket: string; prefix: string; endpoint?: string; region?: string };

export async function uploadBundle(file: File): Promise<BundleRef> {
  const body = await apiFetch<{ bundle: BundleRef }>("/cluster/bundles", {
    method: "POST",
    headers: { "Content-Type": "application/x-tar" },
    body: file,
  });
  return body.bundle;
}

export type ImportStatus = {
  tenant: string;
  phase: "declared" | "provisioning" | "restoring" | "ready" | "failed";
  message?: string;
  commit?: string;
  restore?: string;
  passwordResetRequired?: boolean;
};

export function importTenant(bundle: BundleRef, decryption: { passphrase?: string; identity?: string }, name?: string) {
  return apiFetch<ImportStatus>("/cluster/tenants/import", {
    method: "POST",
    body: JSON.stringify({ bundle, decryption, ...(name ? { name } : {}) }),
  });
}

export function fetchImportStatus(tenant: string) {
  return apiFetch<ImportStatus>(`/cluster/tenants/${encodeURIComponent(tenant)}/import`);
}

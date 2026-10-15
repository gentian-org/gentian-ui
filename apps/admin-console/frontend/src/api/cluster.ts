import { ApiError, apiFetch } from "@/api/client";

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
    /** Why a link meant for `email` was not mailed: what the realm answered. */
    mailError?: string;
  };
};

/**
 * Whether a refused activation says "not there yet" rather than "failed".
 *
 * A tenant is a commit first and a tenant on the cluster some minutes later,
 * and the registrar, which reads the cluster, answers for each stage of that:
 * 404 while the cluster has no such tenant, 503 naming the provisioning while
 * its realm's credential or its login domain has not arrived, and 409 while
 * the administrator account does not exist. The screen only ever asks about a
 * tenant the deployments repository has, so each of those is a tenant on its
 * way. Every other answer is a failure and is shown as one -- a 503 that does
 * not speak of the tenant is a service that is down, not a tenant to wait for.
 */
export function notThereYet(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 404 || err.status === 409) return true;
  return (
    err.status === 503 && /still being provisioned|login domain cannot be read/i.test(err.detail ?? "")
  );
}

export function activateTenantAdmin(tenant: string, recoveryEmail?: string) {
  return apiFetch<AdminActivation>(`/cluster/tenants/${encodeURIComponent(tenant)}/activate-admin`, {
    method: "POST",
    body: JSON.stringify(recoveryEmail ? { recoveryEmail } : {}),
  });
}

/**
 * What became of the invitation the registrar was asked to send to a tenant's
 * administrator once the tenant is ready. Presence and state, never the
 * address: the registrar keeps that and answers it to nobody.
 */
export type AdminInvitationState = "none" | "pending" | "sent" | "expired" | "not-mailed" | "refused";

export type AdminInvitation = {
  tenant: string;
  state: AdminInvitationState;
  /** Seconds since the epoch, while it is pending. */
  expiresAt?: number;
  /** Why it was not mailed or was refused, as the registrar recorded it. */
  reason?: string;
};

/**
 * Hand the invitation of a tenant's administrator to the registrar. The
 * tenant need not exist yet: the registrar keeps the request and mails the
 * invitation itself when it does, so no page has to stay open for it.
 */
export function requestAdminInvitation(tenant: string, recoveryEmail: string) {
  return apiFetch<AdminInvitation>(`/cluster/tenants/${encodeURIComponent(tenant)}/admin-invitation`, {
    method: "POST",
    body: JSON.stringify({ recoveryEmail }),
  });
}

export function fetchAdminInvitation(tenant: string) {
  return apiFetch<AdminInvitation>(`/cluster/tenants/${encodeURIComponent(tenant)}/admin-invitation`);
}

/** The tenants whose administrator's invitation is waiting. */
export async function fetchPendingAdminInvitations(): Promise<string[]> {
  const body = await apiFetch<{ pending?: { tenant: string }[] }>("/cluster/admin-invitations");
  return (body.pending ?? []).map((entry) => entry.tenant);
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

export type BundleDecryption = { passphrase?: string; identity?: string };

/** What a bundle's manifest says, as far as the import card shows it. */
export type BundleManifest = {
  tenant: string;
  export?: string;
  createdAt?: string;
  /** The custom domain a TenantDomain bound the tenant to when it was taken. */
  customDomain?: string;
};

export async function inspectBundle(bundle: BundleRef, decryption: BundleDecryption): Promise<BundleManifest> {
  const body = await apiFetch<{ manifest: BundleManifest }>("/cluster/bundles/inspect", {
    method: "POST",
    body: JSON.stringify({ bundle, decryption }),
  });
  return body.manifest;
}

export type ImportStatus = {
  tenant: string;
  phase: "declared" | "provisioning" | "awaiting-key" | "restoring" | "ready" | "failed";
  message?: string;
  commit?: string;
  restore?: string;
  passwordResetRequired?: boolean;
  /** The bundle's custom domain, declared again with the tenant. */
  customDomain?: string;
};

/** keepCustomDomain: whether the bundle's custom domain is declared again. */
export function importTenant(bundle: BundleRef, decryption: BundleDecryption, keepCustomDomain: boolean) {
  return apiFetch<ImportStatus>("/cluster/tenants/import", {
    method: "POST",
    body: JSON.stringify({ bundle, decryption, keepCustomDomain }),
  });
}

export function fetchImportStatus(tenant: string) {
  return apiFetch<ImportStatus>(`/cluster/tenants/${encodeURIComponent(tenant)}/import`);
}

/** A model the cluster serves from its own weights: one entry of spec.llm.instances. */
export type ModelInstance = {
  name: string;
  modelId: string;
  /** Sizing the instance's own chart reads. Carried through as the claim has it. */
  gpuMemoryUtilization?: string;
  maxModelLen?: string;
  modelCacheSize?: string;
  imageTag?: string;
  toolCallParser?: string;
};

export type ProviderModel = {
  name: string;
  model: string;
  maxTokens?: number;
  mode?: string;
};

/** An external, OpenAI-compatible provider: one entry of spec.llm.providers. */
export type ModelProvider = {
  name: string;
  displayName?: string;
  apiBase: string;
  /**
   * Which property of the shared provider credential holds its token. Never
   * the token. It is the provider's own and follows from its name
   * (`providerKeyProperty`); the director refuses any other.
   */
  apiKeyProperty: string;
  models: ProviderModel[];
};

/** The part of the Cluster claim that decides which models the gateway offers. */
export type ModelSettings = {
  enabled: boolean;
  gpuAcceleration: boolean;
  /**
   * Whether the gateway's own console has a public address. Always present
   * in what is read; left out of a write, the claim's setting stays.
   */
  console?: { enabled: boolean };
  instances: ModelInstance[];
  providers: ModelProvider[];
};

/** The one property a provider's token is kept under: its name with "_" for "-", and "_api_key". */
export function providerKeyProperty(name: string): string {
  return `${name.replace(/-/g, "_")}_api_key`;
}

/**
 * One model under the name the gateway gives it, with what the claim alone
 * says about it. The director reads git and asks neither the gateway nor the
 * vault: `not-served` is a model of the cluster's own that nothing starts a
 * server for, `not-offered` one the gateway does not list, and `declared` a
 * provider's model, whose token is the credential named here.
 */
export type GatewayModel = {
  name: string;
  kind: "instance" | "provider";
  source: string;
  credential?: string;
  apiKeyProperty?: string;
  state: "not-served" | "not-offered" | "declared";
  reason?: string;
};

export type ClusterModelsResponse = {
  cluster: string;
  settings: ModelSettings;
  models: GatewayModel[];
};

export function fetchClusterModels() {
  return apiFetch<ClusterModelsResponse>("/cluster/models");
}

/** The whole of the settings: a model they do not name is removed from the claim. */
export async function updateClusterModels(settings: ModelSettings): Promise<ClusterSettingsWriteResult> {
  const body = await apiFetch<{ status: string; commit?: string }>("/cluster/models", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
  return { ...body, changed: Boolean(body.commit) };
}

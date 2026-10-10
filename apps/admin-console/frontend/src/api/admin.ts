/* SPDX-License-Identifier: Apache-2.0 */
import { apiFetch } from "@/api/client";
import { getAccessToken } from "@/auth/oidc";

export type AdminContext = {
  tenant: string;
  realm: string;
  isPlatformAdmin: boolean;
  isTenantAdmin: boolean;
  availableTenants: string[];
  storeConfigured: boolean;
  /**
   * Cluster kernel domain, e.g. "gtn.host". Server-provided on purpose: the
   * portal answers on portal.<kernel-domain> AND on every tenant's own host,
   * so it cannot be inferred from window.location.hostname.
   */
  kernelDomain: string;
  /**
   * The director's answer to whether this person may put something of the
   * tenant on the internet or take it off (can_expose). Absent from a
   * backend older than this screen, which is a no.
   */
  canExpose?: boolean;
};

export type AdminMember = {
  id: string;
  username: string;
  email?: string | null;
  inviteEmail?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  enabled: boolean;
  groups: string[];
  totpConfigured?: boolean;
  totpPending?: boolean;
};

export type AdminGroup = {
  id: string;
  name: string;
  path: string;
  memberCount: number;
  gentianOdooModules?: string[];
  gentianOdooGroupRoles?: string[];
  /** The tenant provisioned this app rather than only installing it, so adding
   *  a member ticks it by default. */
  defaultGrant?: boolean;
};

function tenantQuery(tenant?: string) {
  return tenant ? `?tenant=${encodeURIComponent(tenant)}` : "";
}

export function fetchAdminContext(tenant?: string) {
  return apiFetch<AdminContext>(`/admin/context${tenantQuery(tenant)}`);
}

export function fetchMembers(tenant?: string) {
  return apiFetch<AdminMember[]>(`/admin/members${tenantQuery(tenant)}`);
}

export function createMember(
  body: {
    email: string;
    firstName?: string;
    lastName?: string;
    enabled?: boolean;
  },
  tenant?: string,
) {
  return apiFetch<AdminMember>(`/admin/members${tenantQuery(tenant)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function inviteMember(
  body: {
    email: string;
    firstName?: string;
    lastName?: string;
    inviteEmail?: string;
    groupIds?: string[];
    requireTotp?: boolean;
    settingsTemplateId?: string;
  },
  tenant?: string,
) {
  return apiFetch<AdminMember>(`/admin/members/invite${tenantQuery(tenant)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function resetMemberPassword(id: string, tenant?: string) {
  return apiFetch<{ deliveryEmail: string }>(`/admin/members/${id}/reset-password${tenantQuery(tenant)}`, {
    method: "POST",
  });
}

export function enableMemberTotp(id: string, sendEmail = true, tenant?: string) {
  return apiFetch<AdminMember>(`/admin/members/${id}/totp/enable${tenantQuery(tenant)}`, {
    method: "POST",
    body: JSON.stringify({ sendEmail }),
  });
}

export function removeMemberTotp(id: string, tenant?: string) {
  return apiFetch<AdminMember>(`/admin/members/${id}/totp${tenantQuery(tenant)}`, {
    method: "DELETE",
  });
}

export function updateMember(
  id: string,
  body: {
    email?: string;
    firstName?: string;
    lastName?: string;
    enabled?: boolean;
    inviteEmail?: string | null;
  },
  tenant?: string,
) {
  return apiFetch<AdminMember>(`/admin/members/${id}${tenantQuery(tenant)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteMember(id: string, tenant?: string) {
  return apiFetch<void>(`/admin/members/${id}${tenantQuery(tenant)}`, {
    method: "DELETE",
  });
}

export function updateMemberGroups(id: string, groupIds: string[], tenant?: string) {
  return apiFetch<AdminMember>(`/admin/members/${id}/groups${tenantQuery(tenant)}`, {
    method: "PUT",
    body: JSON.stringify({ groupIds }),
  });
}

export function createGroup(name: string, tenant?: string) {
  return apiFetch<AdminGroup>(`/admin/groups${tenantQuery(tenant)}`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateGroup(
  id: string,
  name: string,
  gentianOdooModules?: string[],
  gentianOdooGroupRoles?: string[],
  tenant?: string,
) {
  return apiFetch<AdminGroup>(`/admin/groups/${id}${tenantQuery(tenant)}`, {
    method: "PATCH",
    body: JSON.stringify({ name, gentianOdooModules, gentianOdooGroupRoles }),
  });
}

export function deleteGroup(id: string, tenant?: string) {
  return apiFetch<void>(`/admin/groups/${id}${tenantQuery(tenant)}`, {
    method: "DELETE",
  });
}

export type SecurityPolicies = {
  passwordMinLength: number;
  passwordRequireDigits: boolean;
  passwordRequireLowercase: boolean;
  passwordRequireUppercase: boolean;
  passwordRequireSpecialChars: boolean;
  passwordHistoryCount: number;
  passwordMaxAgeDays: number;
  ssoSessionIdleMinutes: number;
  ssoSessionMaxHours: number;
  rememberMe: boolean;
  bruteForceProtected: boolean;
  maxLoginFailures: number;
  lockoutDurationSeconds: number;
  requireTotpAdmins: boolean;
  requireTotpMembers: "none" | "optional" | "required";
  /** Clauses of the realm's password policy this form has no control for.
   * Shown, and kept as they are when the form is saved. */
  passwordPolicyOther?: string[];
  /** False when the caller may not read the realm's password policy. The
   * password parts are then neither shown as set nor written. */
  passwordPolicyReadable?: boolean;
};

export function fetchSecurityPolicies(tenant?: string) {
  return apiFetch<SecurityPolicies>(`/admin/security-policies${tenantQuery(tenant)}`);
}

/** Sessions and lockout are committed by the director; the password parts
 * are set on the realm by the registrar. A form that could not read the
 * realm's password policy sends no password parts, so it cannot clear it. */
export function updateSecurityPolicies(body: SecurityPolicies, tenant?: string) {
  const { passwordPolicyOther: _other, passwordPolicyReadable: readable, ...rest } = body;
  const sent: Record<string, unknown> = { ...rest };
  if (readable === false) {
    for (const key of Object.keys(sent)) {
      if (key.startsWith("password")) delete sent[key];
    }
  }
  return apiFetch<{ commit?: string }>(`/admin/security-policies${tenantQuery(tenant)}`, {
    method: "PUT",
    body: JSON.stringify(sent),
  });
}

export type AdminMemberSession = {
  id: string;
  memberId: string;
  memberEmail?: string | null;
  memberUsername: string;
  clientId: string;
  clientName: string;
  ipAddress?: string | null;
  startedAt: number;
  lastAccessAt: number;
};

export function fetchSessions(tenant?: string) {
  return apiFetch<AdminMemberSession[]>(`/admin/sessions${tenantQuery(tenant)}`);
}

export function fetchMemberSessions(memberId: string, tenant?: string) {
  return apiFetch<AdminMemberSession[]>(
    `/admin/members/${memberId}/sessions${tenantQuery(tenant)}`,
  );
}

export function revokeMemberSession(memberId: string, sessionId: string, tenant?: string) {
  return apiFetch<void>(
    `/admin/members/${memberId}/sessions/${sessionId}${tenantQuery(tenant)}`,
    { method: "DELETE" },
  );
}

export function revokeAllMemberSessions(memberId: string, tenant?: string) {
  return apiFetch<void>(
    `/admin/members/${memberId}/sessions/revoke-all${tenantQuery(tenant)}`,
    { method: "POST" },
  );
}

export type AuditEventCategory = "sign_in" | "admin_action" | "entitlement";

export type AuditEvent = {
  id: string;
  occurredAt: number;
  category: AuditEventCategory;
  action: string;
  actor?: string | null;
  target?: string | null;
  tenant: string;
  ipAddress?: string | null;
  success: boolean;
  details: Record<string, string>;
};

export type AuditEventFilters = {
  user?: string;
  action?: string;
  category?: AuditEventCategory;
  from?: string;
  to?: string;
  limit?: number;
};

function auditQuery(filters: AuditEventFilters, tenant?: string) {
  const params = new URLSearchParams();
  if (tenant) {
    params.set("tenant", tenant);
  }
  if (filters.user) {
    params.set("user", filters.user);
  }
  if (filters.action) {
    params.set("action", filters.action);
  }
  if (filters.category) {
    params.set("category", filters.category);
  }
  if (filters.from) {
    params.set("from", filters.from);
  }
  if (filters.to) {
    params.set("to", filters.to);
  }
  if (filters.limit) {
    params.set("limit", String(filters.limit));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function fetchAuditEvents(filters: AuditEventFilters = {}, tenant?: string) {
  return apiFetch<AuditEvent[]>(`/admin/audit-events${auditQuery(filters, tenant)}`);
}

export async function downloadAuditExport(
  format: "json" | "csv",
  filters: AuditEventFilters = {},
  tenant?: string,
) {
  const params = new URLSearchParams(auditQuery(filters, tenant).replace(/^\?/, ""));
  params.set("format", format);
  const token = getAccessToken();
  const response = await fetch(`/api/v1/admin/audit-events/export?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error(`Audit export failed: ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `audit-export.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export type NotificationSeverity = "info" | "warning" | "critical";

export type NotificationAudience = {
  scope: "platform" | "tenant";
  tenant?: string | null;
  groups: string[];
};

export type AdminNotification = {
  id: string;
  publishedAt: number;
  title: string;
  body: string;
  severity: NotificationSeverity;
  audience: NotificationAudience;
  publisher: string;
  tenant: string;
  linkUrl?: string | null;
  linkLabel?: string | null;
  expiresAt?: number | null;
  cloudEvent: Record<string, unknown>;
};

export function fetchNotifications(tenant?: string) {
  return apiFetch<AdminNotification[]>(`/admin/notifications${tenantQuery(tenant)}`);
}

export function publishNotification(
  body: {
    title: string;
    body: string;
    severity?: NotificationSeverity;
    audience?: NotificationAudience;
    linkUrl?: string;
    linkLabel?: string;
    expiresAt?: number;
  },
  tenant?: string,
) {
  return apiFetch<AdminNotification>(`/admin/notifications${tenantQuery(tenant)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type MacWaiverEntry = {
  profile: string;
  policy: string;
  scope: string;
};

export type MacWaiverCatalogueEntry = {
  name: string;
  displayName: string;
  macWaivers: Array<{ policy: string; scope: string }>;
};

export type PlatformSecurityPolicy = {
  allowedMacWaivers: MacWaiverEntry[];
  catalogueRequests: MacWaiverCatalogueEntry[];
};

export function fetchPlatformSecurityPolicy() {
  return apiFetch<PlatformSecurityPolicy>("/admin/platform/security-policy");
}

// Customization ladder debt report — see docs/app-customization.md §8.3 in
// gentian-os. Read live from Customization CRs; the operator computes
// reviewOverdue/upstreamStale/targetVersionDrift/rungAboveRecommended on status.
export type CustomizationRecord = {
  name: string;
  namespace: string;
  summary: string;
  targetProfile: string;
  rung: string;
  scope: string;
  owner: string;
  reviewBy: string;
  phase: string;
  reviewOverdue: boolean;
  upstreamStale: boolean;
  targetVersionDrift: boolean;
  rungAboveRecommended: boolean;
};

export type CustomizationDebtByRung = {
  L0: number;
  L1: number;
  L2: number;
  L3: number;
  L4: number;
  L5: number;
  L6: number;
};

export type CustomizationDebtReport = {
  totalRecords: number;
  carriedDeltas: number;
  byRung: CustomizationDebtByRung;
  reviewOverdue: CustomizationRecord[];
  upstreamStale: CustomizationRecord[];
  rungAboveRecommended: CustomizationRecord[];
  records: CustomizationRecord[];
};

export function fetchCustomizationDebtReport() {
  return apiFetch<CustomizationDebtReport>("/admin/platform/customization-debt");
}

// What the cluster last reported about what it runs, and what became of the
// attempt -- see docs/design/operations.md §6.2 in gentian-os. The usher
// answers it to whoever holds can_audit on the cluster.
export type LicenceReportOutcome = "accepted" | "failed" | "not-sent" | "sending";

export type LicenceReportAttempt = {
  at: string;
  outcome: LicenceReportOutcome | string;
  reason?: string;
  httpStatus?: number;
  error?: string;
  nextAt?: string;
};

export type LicenceReportSent = {
  sequence: number;
  /** The request body byte for byte: it is what the signature is over. */
  body: string;
  signature: string;
  keyId: string;
};

export type LicenceReport = {
  enabled: boolean;
  url?: string;
  attempt?: LicenceReportAttempt;
  report?: LicenceReportSent;
};

export function fetchLicenceReport() {
  return apiFetch<LicenceReport>("/admin/platform/licence-report");
}

export function updatePlatformSecurityPolicy(allowedMacWaivers: MacWaiverEntry[]) {
  return apiFetch<PlatformSecurityPolicy>("/admin/platform/security-policy", {
    method: "PUT",
    body: JSON.stringify({ allowedMacWaivers }),
  });
}

export type IntegrationBinding = {
  name: string;
  contract: string;
  provider: string;
  consumer: string;
  capabilities: string[];
  state: string;
};

export type ConsumeGrant = {
  contract: string;
  granted: string[];
};

export type AllowConsumer = {
  app: string;
  contract: string;
  scope: string[];
};

export type AppGrant = {
  name: string;
  app: string;
  consume: ConsumeGrant[];
  allowConsumers: AllowConsumer[];
  phase: string;
};

export type IntegrationsOverview = {
  bindings: IntegrationBinding[];
  grants: AppGrant[];
  summary: {
    bindingCount: number;
    grantCount: number;
    grantReadyCount: number;
  };
  effectiveAccess: EffectiveAccessRow[];
};

export type EffectiveAccessRow = {
  contract: string;
  consumer: string;
  provider: string;
  bindingCapabilities: string[];
  grantedCapabilities: string[];
  macAllowed: boolean;
  grantPhase: string;
  openfgaGranted: Record<string, boolean>;
};

// Who holds which role, and what that role carries.
//
// Read-only, and it replaces the idea of exposing OpenFGA's own playground,
// which is a development tool with a write surface. Anything a person wants
// to change is changed on the other screens, through the director.
export type AuthorizationBinding = {
  // The role as the model names it: admin, auditor, security_officer.
  relation: string;
  // Keycloak group names. Empty means nobody holds it, which is a row worth
  // showing rather than one worth hiding.
  groups: string[];
  // The permissions the role carries, resolved through the model by the
  // director. Without these a reader sees "admin" and has to go and read the
  // model to find out what it means.
  grants: string[];
};

export type AuthorizationView = {
  object: string;
  bindings: AuthorizationBinding[];
  unheld: number;
};

export function fetchAuthorization(scope: "cluster" | "tenant", tenant?: string) {
  const query = scope === "cluster" ? "?scope=cluster" : tenantQuery(tenant) || "";
  return apiFetch<AuthorizationView>(`/admin/authorization${query}`);
}

export function fetchIntegrationsOverview(tenant?: string) {
  return apiFetch<IntegrationsOverview>(`/admin/integrations${tenantQuery(tenant)}`);
}

export function updateAppGrant(
  app: string,
  body: { consume: ConsumeGrant[]; allowConsumers: AllowConsumer[] },
  tenant?: string,
) {
  return apiFetch<AppGrant>(`/admin/grants/${encodeURIComponent(app)}${tenantQuery(tenant)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export type GrantableAddon = { id: string; label: string; profile: string };

/** Addons this tenant has installed and can therefore grant to a group. */
export function fetchGrantableAddons(tenant?: string) {
  return apiFetch<GrantableAddon[]>(`/admin/grantable-addons${tenantQuery(tenant)}`);
}

// --- Backups -----------------------------------------------------------------

export type BackupAppStatus = {
  name: string;
  phase: string;
  stores: string[];
  chartVersion: string;
  quiesceStart: string | null;
  quiesceEnd: string | null;
  message: string;
};

export type Backup = {
  name: string;
  phase: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  bundleBucket: string;
  bundlePrefix: string;
  encryptionMode: string;
  platformReadable: boolean;
  quiesced: string[];
  apps: BackupAppStatus[];
  message: string;
};

/** Where one manual backup is written. Mirrors TenantExport.spec.destination. */
export type BackupTarget = {
  /**
   * policy follows the workspace's backup policy — the same place the nightly
   * schedule writes. platform is the platform's own storage. custom is an
   * endpoint given here.
   */
  mode: "policy" | "platform" | "custom";
  endpoint?: string;
  bucket?: string;
  region?: string;
  /**
   * managed reuses the credential the custodian already holds for
   * this workspace. transient takes keys entered on the form, which are kept
   * for the length of the export and then removed.
   */
  credentialSource?: "managed" | "transient";
  accessKey?: string;
  secretKey?: string;
};

export type BackupCreateBody = {
  name: string;
  apps: string[];
  encryption: {
    mode: "recipient" | "passphrase";
    passphrase?: string;
    recipients?: string[];
  };
  destination?: BackupTarget;
};

export function fetchBackups(tenant?: string) {
  return apiFetch<Backup[]>(`/admin/backups${tenantQuery(tenant)}`);
}

export function fetchBackup(name: string, tenant?: string) {
  return apiFetch<Backup>(`/admin/backups/${encodeURIComponent(name)}${tenantQuery(tenant)}`);
}

export function createBackup(body: BackupCreateBody, tenant?: string) {
  return apiFetch<Backup>(`/admin/backups${tenantQuery(tenant)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteBackup(name: string, tenant?: string, opts?: { force?: boolean }) {
  const force = opts?.force ? (tenant ? "&" : "?") + "force=true" : "";
  return apiFetch<void>(
    `/admin/backups/${encodeURIComponent(name)}${tenantQuery(tenant)}${force}`,
    { method: "DELETE" },
  );
}

/** An export is finished when it can no longer change on its own. */
export function backupIsTerminal(backup: Backup): boolean {
  return backup.phase === "Ready" || backup.phase === "Failed";
}

/** What the vault holds for this workspace. Never the key itself: the public
 * half and metadata, read from OpenBao's metadata endpoint. */
export type BackupKeyStatus = {
  exists: boolean;
  recipient: string;
  setBy: string;
  updatedAt: string;
};

export function fetchBackupKeyStatus() {
  return apiFetch<BackupKeyStatus>("/credentials/backup-identity");
}

// --- Resources ---------------------------------------------------------------

export type ResourceHeadroom = {
  resource: string;
  used: string;
  hard: string;
  /** Absent when the resource has no ceiling — not zero, which would draw an
   *  empty bar for something that is in fact unlimited. */
  usedRatio?: number | null;
};

export type ResourceState = {
  tenant: string;
  plan: string;
  annotatedPlan: string;
  /** The enforced ceiling is not the one the recorded plan describes. */
  drifted: boolean;
  /** The ceiling matches no plan in the catalogue — set by hand. */
  custom: boolean;
  quota: ResourceHeadroom[];
  hasQuota: boolean;
  actual: Record<string, string>;
  /** Where `actual` came from, or why it is missing. */
  actualSource: string;
  installedApps: number;
};

export type ResourcePlan = {
  name: string;
  displayName: string;
  description: string;
  tier: number;
  productSku: string;
  quotas: Record<string, string>;
  current: boolean;
  selectable: boolean;
  /** Why `selectable` is false, in the reader's terms. */
  blocked: string;
};

export type ResourcePlanChange = {
  status: string;
  tenant: string;
  plan: string;
  previousPlan: string;
  message: string;
};

export type ResourceSample = {
  observedAt: string;
  plan: string;
  productSku: string;
  hard: Record<string, string>;
  used: Record<string, string>;
  actual?: Record<string, string> | null;
};

export type ResourceUsage = {
  tenant: string;
  samples: ResourceSample[];
};

export type ResourcePlanInterval = {
  plan: string;
  productSku: string;
  from: string;
  to: string;
  seconds: number;
  partial: boolean;
};

export type ResourceReport = {
  tenant: string;
  from: string;
  to: string;
  intervals: ResourcePlanInterval[];
  incomplete: boolean;
};

export function fetchResourceState(tenant?: string) {
  return apiFetch<ResourceState>(`/admin/resources${tenantQuery(tenant)}`);
}

export function fetchResourcePlans(tenant?: string) {
  return apiFetch<ResourcePlan[]>(`/admin/resources/plans${tenantQuery(tenant)}`);
}

export function changeResourcePlan(plan: string, tenant?: string, force = false) {
  return apiFetch<ResourcePlanChange>(`/admin/resources${tenantQuery(tenant)}`, {
    method: "PUT",
    body: JSON.stringify({ plan, force }),
  });
}

export function fetchResourceUsage(
  params: { from?: string; to?: string; stepSeconds?: number } = {},
  tenant?: string,
) {
  const search = new URLSearchParams();
  if (tenant) search.set("tenant", tenant);
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
  if (params.stepSeconds) search.set("stepSeconds", String(params.stepSeconds));
  const query = search.toString();
  return apiFetch<ResourceUsage>(`/admin/resources/usage${query ? `?${query}` : ""}`);
}

export function fetchResourceReport(
  params: { from?: string; to?: string } = {},
  tenant?: string,
) {
  const search = new URLSearchParams();
  if (tenant) search.set("tenant", tenant);
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
  const query = search.toString();
  return apiFetch<ResourceReport>(`/admin/resources/report${query ? `?${query}` : ""}`);
}

/** Every tenant's ceiling and consumption — platform administrators only. */
export function fetchTenantResourceStates() {
  return apiFetch<ResourceState[]>("/admin/resources/tenants");
}

// --- Changes ----------------------------------------------------------------

/**
 * One change to declared state, from git.
 *
 * Every change the platform makes is a commit the director authored as the
 * person whose token authorised it, trailered with the relation and object
 * that permitted it. A commit with `throughPlatform: false` was pushed by
 * hand — with whatever credential the pusher held and no record of what
 * allowed it — and is shown as such rather than dressed up as authorised.
 */
export type Change = {
  commit: string;
  author: { Name: string; Email: string };
  at: string;
  summary: string;
  files: string[];
  throughPlatform: boolean;
  principal?: string;
  decision?: string;
  requestId?: string;
};

export type ChangesResponse = {
  changes: Change[];
  /** What this list does not cover, in the director's own words. */
  covers: string;
};

export function fetchChanges(tenant?: string, scope: "tenant" | "cluster" = "tenant") {
  const params = new URLSearchParams({ scope, limit: "50" });
  if (tenant) {
    params.set("tenant", tenant);
  }
  return apiFetch<ChangesResponse>(`/admin/changes?${params.toString()}`);
}

// People, groups and the realm's password policy (S7A.17).
//
// The console reads and writes these through the director, with the caller's
// own token. Nothing here holds a Keycloak credential: the director holds one
// per realm, and what the caller may do with it was decided by OpenFGA before
// the director touched anything.

export type Person = {
  id: string;
  /** Keycloak's login name. For anybody invited here it is the address. */
  username: string;
  email: string;
  /** The display name, empty until they set one. */
  name?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  /** An authenticator is enrolled. Filled only by the single read. */
  totpConfigured?: boolean;
  /** They must enrol one at their next sign-in. */
  totpRequired?: boolean;
  /**
   * Invited and not finished: the address is unverified or a required action
   * is outstanding. Worth its own column — somebody who cannot sign in yet
   * looks identical otherwise, which is how a failed invitation goes unseen.
   */
  pending: boolean;
  /** Group paths, without the leading slash. Filled only by the single read. */
  groups?: string[];
  /**
   * The address they have a mailbox under on the cluster's own mail server.
   * Absent when they have none there. Removing somebody who has one comes
   * with a question: is the mailbox archived, or deleted.
   */
  mailbox?: string;
};

/** What whoever removes a person decides about that person's mailbox. */
export type MailboxChoice = "archive" | "delete";

/** One removed person's mailbox: what was decided, and what became of it. */
export type RemovedMailbox = {
  /** Names the record, for the request that deletes an archived mailbox. */
  id: string;
  address: string;
  choice: MailboxChoice;
  /** `none`: the address never had a mailbox. */
  state: "pending" | "archived" | "deleted" | "none" | "failed";
  /** A sentence about the state: what is waited for, or why it failed. */
  message?: string;
  removedAt: string;
  /** Who removed the person and made the choice. */
  by?: string;
  archivedAt?: string;
  deletedAt?: string;
  sizeBytes?: number;
  messages?: number;
  /** The archived mailbox was asked to be deleted and is not gone yet. */
  deletionRequested?: boolean;
  deletionBy?: string;
};

export type PersonGroup = {
  id: string;
  /** The path without the leading slash, which is the name the graph uses. */
  path: string;
  name: string;
  /** Made by an administrator here, and so the only kind that can be deleted. */
  custom?: boolean;
  /** An app the tenant provisioned for everybody rather than only installed:
   *  ticked when a person is added, so it is opt-out for new people. */
  defaultGrant?: boolean;
};

export type SettingsTemplate = { id: string; name: string };

export type IdentitySettings = {
  tenant: string;
  realm: string;
  /** Keycloak's own spelling, e.g. "length(12) and notUsername(undefined)". */
  passwordPolicy: string;
  /** What follows the @ in a login composed here; empty when unknown. */
  loginDomain?: string;
  /** Whether settings templates can be offered at all. */
  templates?: boolean;
};

export type InviteResult = {
  person: Person;
  /**
   * False means the person exists and the link did not go. The repair is to
   * re-send rather than to invite again, so the screen has to tell them apart.
   */
  mailed: boolean;
  warning?: string;
  /** Present when a template was asked for. */
  templateApplied?: boolean;
};

export type Invitation = {
  /** Where the invitation and later password resets are mailed. */
  email: string;
  /** The part before @<loginDomain>. */
  username?: string;
  firstName?: string;
  lastName?: string;
  requireTotp?: boolean;
  settingsTemplate?: string;
  groups: string[];
};

export function fetchPeople(opts?: { search?: string; tenant?: string }) {
  const params = new URLSearchParams();
  if (opts?.search) params.set("search", opts.search);
  if (opts?.tenant) params.set("tenant", opts.tenant);
  const query = params.toString();
  return apiFetch<{ tenant: string; people: Person[] }>(
    `/admin/people${query ? `?${query}` : ""}`,
  );
}

export function fetchPerson(id: string, tenant?: string) {
  return apiFetch<Person>(`/admin/people/${encodeURIComponent(id)}${tenantQuery(tenant)}`);
}

export function fetchPersonGroups(tenant?: string) {
  return apiFetch<{ tenant: string; groups: PersonGroup[] }>(`/admin/groups${tenantQuery(tenant)}`);
}

export function fetchIdentitySettings(tenant?: string) {
  return apiFetch<IdentitySettings>(`/admin/identity${tenantQuery(tenant)}`);
}

export function invitePerson(body: Invitation, tenant?: string) {
  return apiFetch<InviteResult>(`/admin/people/invite${tenantQuery(tenant)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function setMembership(
  body: { person: string; group: string; member: boolean },
  tenant?: string,
) {
  return apiFetch<{ person: string; group: string; member: boolean }>(
    `/admin/people/membership${tenantQuery(tenant)}`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export function setPasswordPolicy(passwordPolicy: string, tenant?: string) {
  return apiFetch<IdentitySettings>(`/admin/identity/password-policy${tenantQuery(tenant)}`, {
    method: "POST",
    body: JSON.stringify({ passwordPolicy }),
  });
}

function postAction<T>(path: string, body: unknown, tenant?: string) {
  return apiFetch<T>(`${path}${tenantQuery(tenant)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Names, delivery address and whether they may sign in; omitted fields stay. */
export function updatePerson(
  body: { person: string; firstName?: string; lastName?: string; enabled?: boolean; email?: string },
  tenant?: string,
) {
  return postAction<Person>("/admin/people/update", body, tenant);
}

/**
 * Remove somebody. `mailbox` is the answer about their mailbox, sent only
 * when they have one and the person removing them chose: nothing here, and
 * nothing behind it, chooses in their place.
 */
export function removePerson(person: string, mailbox?: MailboxChoice, tenant?: string) {
  return postAction<{ removed: boolean; mailbox?: { address: string; choice: MailboxChoice; id: string } }>(
    "/admin/people/remove",
    mailbox ? { person, mailbox } : { person },
    tenant,
  );
}

export function fetchRemovedMailboxes(tenant?: string) {
  return apiFetch<{ tenant: string; mailboxDomain?: string; mailboxes: RemovedMailbox[] }>(
    `/admin/removed-mailboxes${tenantQuery(tenant)}`,
  );
}

/** Delete one archived mailbox, by the id the list gives it. */
export function deleteArchivedMailbox(mailbox: string, tenant?: string) {
  return postAction<{ deletionRequested: boolean }>("/admin/removed-mailboxes/delete", { mailbox }, tenant);
}

export function sendPasswordReset(person: string, tenant?: string) {
  return postAction<{ mailed: boolean }>("/admin/people/reset-password", { person }, tenant);
}

export function requireTotp(person: string, mail: boolean, tenant?: string) {
  return postAction<{ totpRequired: boolean }>("/admin/people/require-totp", { person, mail }, tenant);
}

export function removeTotp(person: string, tenant?: string) {
  return postAction<{ totpRequired: boolean }>("/admin/people/remove-totp", { person }, tenant);
}

export function createCustomGroup(name: string, tenant?: string) {
  return postAction<PersonGroup>("/admin/groups/create", { name }, tenant);
}

export function renameCustomGroup(group: string, name: string, tenant?: string) {
  return postAction<PersonGroup>("/admin/groups/rename", { group, name }, tenant);
}

export function deleteCustomGroup(group: string, tenant?: string) {
  return postAction<{ deleted: boolean }>("/admin/groups/delete", { group }, tenant);
}

export function fetchGroupMembers(group: string, tenant?: string) {
  const params = new URLSearchParams({ group });
  if (tenant) params.set("tenant", tenant);
  return apiFetch<{ group: string; people: Person[] }>(`/admin/groups/members?${params.toString()}`);
}

export function fetchSettingsTemplates(tenant?: string) {
  return apiFetch<{ templates: SettingsTemplate[] }>(`/admin/templates${tenantQuery(tenant)}`);
}

/** One of the tenant's components as the cluster holds it. */
export type AppState = {
  profile: string;
  name: string;
  ready: boolean;
  phase: string;
  message?: string;
  failure?: string;
  /** Requests of the app's profile nobody has granted yet, as `<kind>/<name>`. */
  pendingPrivileges?: string[];
  /** The component's own conditions, as the operator reports them. */
  conditions?: { type: string; status: string; reason?: string; message?: string }[];
};

export function fetchAppStates() {
  return apiFetch<{ tenant: string; apps: AppState[] }>("/admin/apps/status");
}

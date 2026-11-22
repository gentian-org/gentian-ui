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
  /**
   * The director's answer to whether this person may say what one app of the
   * tenant may consume from another (can_grant). Absent from a backend older
   * than this screen, which is a no.
   */
  canGrant?: boolean;
  /**
   * The director's answer to whether this person may answer an app's egress
   * request (can_approve_privilege, the tenant's perimeter approver's). Absent
   * from a backend older than the Approve button, which is a no.
   */
  canApprovePrivilege?: boolean;
  /**
   * The director's answer to whether this person may answer the requests
   * that weaken what protects the node, podSecurity and clusterRoles: the
   * cluster's security officer's (cluster#can_approve). Absent from a backend
   * older than the security officer's Approve button, which is a no.
   */
  canApproveNodePrivilege?: boolean;
  /**
   * Whether this person is the cluster's perimeter approver
   * (cluster#can_approve_perimeter): they answer every tenant's egress
   * requests on the Approvals screen. Absent from an older backend: a no.
   */
  canApprovePerimeter?: boolean;
  /** Whether this person may read who holds the cluster's roles (cluster#can_audit). */
  canAuditCluster?: boolean;
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
};

export function fetchSecurityPolicies(tenant?: string) {
  return apiFetch<SecurityPolicies>(`/admin/security-policies${tenantQuery(tenant)}`);
}

export function updateSecurityPolicies(body: SecurityPolicies, tenant?: string) {
  return apiFetch<SecurityPolicies>(`/admin/security-policies${tenantQuery(tenant)}`, {
    method: "PUT",
    body: JSON.stringify(body),
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

// Customization ladder debt report — see docs/guides/app-customization.md §8.3 in
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
// attempt -- see docs/concepts/operations.md §6.2 in gentian-os. The usher
// answers it to whoever holds can_audit on the cluster.
export type UsageStatisticsOutcome = "accepted" | "failed" | "not-sent" | "sending";

export type UsageStatisticsAttempt = {
  at: string;
  outcome: UsageStatisticsOutcome | string;
  reason?: string;
  httpStatus?: number;
  error?: string;
  nextAt?: string;
};

export type UsageStatisticsSent = {
  sequence: number;
  /** The request body byte for byte: it is what the signature is over. */
  body: string;
  signature: string;
  keyId: string;
};

export type UsageStatistics = {
  enabled: boolean;
  url?: string;
  attempt?: UsageStatisticsAttempt;
  report?: UsageStatisticsSent;
};

export function fetchUsageStatistics() {
  return apiFetch<UsageStatistics>("/admin/platform/usage-statistics");
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
  grantPhase: string;
  /** What the binding asks for and the grant does not permit. */
  ungranted: string[];
};

// Who holds which role, and what that role carries.
//
// Read-only, and it replaces the idea of exposing OpenFGA's own playground,
// which is a development tool with a write surface. Anything a person wants
// to change is changed on the other screens.

/** One holder of a role: a position of the tenant, a person, or a group of the sign-in service. */
export type Holder = {
  kind: "position" | "person" | "group" | (string & {});
  /**
   * The position's name; the person's account id, qualified by its realm
   * for a role the cluster gives by name; or the group's name.
   */
  name: string;
};

export type AuthorizationBinding = {
  // The role as the model names it (admin, user, auditor), or the name of a
  // role an app's profile declares.
  relation: string;
  // Who holds it. Empty means nobody does, which is a row worth showing
  // rather than one worth hiding.
  holders: Holder[];
  // The permissions the role carries, resolved through the model. Without
  // these a reader sees "admin" and has to go and read the model to find out
  // what it means.
  grants: string[];
  /** True for a role an app's profile declares. */
  declared?: boolean;
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

// The access page: what a person, a position or an app holds, read by the
// usher from the rights store. Read-only. What a person holds is given from
// both ends: the roles they were given, each with the position it comes
// through, and the store's own answer to every permission and role, since
// more is in effect than is held.

/** One role held on one object. */
export type HeldRole = {
  /** user, admin, or the name of a role the app declares. */
  role: string;
  declared?: boolean;
  /** The position it is held through; absent for a role given directly. */
  position?: string;
  /** True for a role the person holds as themselves, beside their positions. */
  direct?: boolean;
  /** The permissions the role carries on this kind of object. */
  carries: string[];
};

/** One permission on one object, for one person. */
export type AccessPermission = {
  name: string;
  /** The rights store's own answer for this person. */
  inEffect: boolean;
  /**
   * Where it comes from: `role` (a held role carries it), `tenant` (on an
   * app, it follows from what the person holds on the tenant), `app` (it
   * follows from what they hold on the app's base or on one of its add-ons),
   * `elsewhere` (in effect, and nothing read here accounts for it). Absent:
   * the person does not have it.
   */
  from?: "role" | "tenant" | "app" | "elsewhere" | (string & {});
};

export type ObjectAccess = {
  object: string;
  /** The profile, for an app. */
  app?: string;
  /** The roles the person was given here. */
  held: HeldRole[];
  /** The roles in effect here: the held ones and those that follow from them. */
  roles: string[];
  permissions: AccessPermission[];
};

/** A position a person holds: given to them, or included by one that was. */
export type PositionHeld = {
  name: string;
  /** The given position that includes this one; absent when it was given itself. */
  through?: string;
};

export type PersonAccess = {
  tenant: string;
  subject: string;
  positions: PositionHeld[];
  onTenant: ObjectAccess;
  apps: ObjectAccess[];
};

/** One role a position holds on one object. */
export type PositionHold = { object: string; app?: string; role: string; declared?: boolean; carries: string[] };

export type PositionAccess = {
  tenant: string;
  position: string;
  holds: PositionHold[];
  /** The positions whose roles its holders hold too. */
  includes: string[];
  /** The positions whose holders hold this one. */
  includedIn: string[];
  /** The accounts that were given the position itself, by id. */
  holders: string[];
};

export function fetchPersonAccess(id: string, tenant?: string) {
  return apiFetch<PersonAccess>(`/admin/access/people/${encodeURIComponent(id)}${tenantQuery(tenant)}`);
}

export function fetchPositionAccess(name: string, tenant?: string) {
  return apiFetch<PositionAccess>(`/admin/access/positions/${encodeURIComponent(name)}${tenantQuery(tenant)}`);
}

export function fetchAppAccess(profile: string, tenant?: string) {
  return apiFetch<AuthorizationView>(`/admin/access/apps/${encodeURIComponent(profile)}${tenantQuery(tenant)}`);
}

// Positions: named sets of roles a kind of person holds. Three every tenant
// has; a tenant declares its own at the director, which commits them. Who
// holds a position, or a role beside one, is given at the registrar.

/** The positions every tenant has. */
export const SHIPPED_POSITIONS = ["user", "app-administrator", "tenant-administrator"] as const;

/** One role a position holds: on an app, or on the tenant itself when app is absent. */
export type PositionRole = { app?: string; role: string };

/** A tenant's own position, as it is declared. */
export type TenantPosition = {
  name: string;
  title?: string;
  description?: string;
  includes?: string[];
  roles?: PositionRole[];
};

export type TenantPositions = { tenant: string; shipped: string[]; positions: TenantPosition[] };

export function fetchPositions(tenant?: string) {
  return apiFetch<TenantPositions>(`/admin/positions${tenantQuery(tenant)}`);
}

export function setPosition(position: TenantPosition, tenant?: string) {
  const { name, ...declaration } = position;
  return apiFetch<{ status: string; commit?: string }>(
    `/admin/positions/${encodeURIComponent(name)}${tenantQuery(tenant)}`,
    { method: "PUT", body: JSON.stringify(declaration) },
  );
}

export function removePosition(name: string, tenant?: string) {
  return apiFetch<{ status: string; commit?: string }>(
    `/admin/positions/${encodeURIComponent(name)}${tenantQuery(tenant)}`,
    { method: "DELETE" },
  );
}

/** One thing a person was given: a position, or a role and the app it is held on. */
export type Assignment = { position?: string; role?: string; app?: string };

export type AssignmentResult = {
  person: string;
  changed: boolean;
  holds: boolean;
  /** True when the person now administers the tenant and was asked for a second factor. */
  totpRequired?: boolean;
  warning?: string;
};

export function fetchAssignments(person: string, tenant?: string) {
  return apiFetch<{ tenant: string; person: string; assignments: Assignment[] }>(
    `/admin/people/${encodeURIComponent(person)}/assignments${tenantQuery(tenant)}`,
  );
}

/** Give a person a position or a role (holds true), or take it back. */
export function setAssignment(input: { person: string; assignment: Assignment; holds: boolean }, tenant?: string) {
  return apiFetch<AssignmentResult>(`/admin/people/${input.holds ? "give" : "take"}${tenantQuery(tenant)}`, {
    method: "POST",
    body: JSON.stringify({ person: input.person, ...input.assignment }),
  });
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

/** Withdraw everything one app was permitted to consume and to offer. */
export function clearAppGrant(app: string, tenant?: string) {
  return apiFetch<void>(`/admin/grants/${encodeURIComponent(app)}${tenantQuery(tenant)}`, {
    method: "DELETE",
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
  /** The schedule that took this export; absent for one a person started. */
  schedule?: string;
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

/** What is exported before an app update (gentian-os versioning.md §5). */
export type BeforeMove = "tenant" | "app" | "none";

/** The part of the tenant's backup policy this console reads and sets. */
export type BackupPolicy = {
  configured: boolean;
  /** Whether the cluster lets the tenant state a policy of its own. */
  allowTenantOverride: boolean;
  /** What the tenant states; absent when it inherits the cluster's. */
  beforeMove?: BeforeMove;
  /** What applies. */
  effectiveBeforeMove: BeforeMove;
};

export function fetchBackupPolicy(tenant?: string) {
  return apiFetch<BackupPolicy>(`/admin/backup-policy${tenantQuery(tenant)}`);
}

/** Set what is exported before an app update; "" inherits the cluster's. */
export function setBeforeMove(beforeMove: BeforeMove | "", tenant?: string) {
  return apiFetch<unknown>(`/admin/backup-policy/before-move${tenantQuery(tenant)}`, {
    method: "PUT",
    body: JSON.stringify({ beforeMove }),
  });
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
  /** The ceiling matches no plan in the catalog — set by hand. */
  custom: boolean;
  quota: ResourceHeadroom[];
  hasQuota: boolean;
  actual: Record<string, string>;
  /** Where `actual` came from, or why it is missing. */
  actualSource: string;
  installedApps: number;
  /** Where the tenant orders another plan, as the cluster states it. */
  ordering?: PlanOrdering;
  /** The plan the tenant's administrator asked to be moved to, if pending. */
  request?: PlanRequest;
};

/** A tenant administrator's pending request for another plan. */
export type PlanRequest = {
  plan: string;
  by?: string;
  /** RFC 3339. */
  at?: string;
  reason?: string;
};

/** The cluster's notice on ordering another plan: a text by language and at
 *  most one action, the url already naming the tenant. */
export type PlanOrdering = {
  text: Record<string, string>;
  url?: string;
  email?: string;
  phone?: string;
};

export type ResourcePlan = {
  name: string;
  displayName: string;
  description: string;
  tier: number;
  productSku: string;
  units?: number;
  retired?: boolean;
  quotas: Record<string, string>;
  current: boolean;
  selectable: boolean;
  /** Why `selectable` is false, in the reader's terms. */
  blocked: string;
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

/** The director's answer to moving a tenant: 202 with a commit, or 200 when
 *  the tenant is on that plan already. */
export type ResourcePlanChange = {
  status: string;
  tenant: string;
  plan: string;
  previousPlan: string;
  message: string;
  commit?: string;
};

export function changeResourcePlan(plan: string, tenant?: string, force = false) {
  return apiFetch<ResourcePlanChange>(`/admin/resources${tenantQuery(tenant)}`, {
    method: "PUT",
    body: JSON.stringify({ plan, force }),
  });
}

export function requestResourcePlan(plan: string, reason: string, tenant?: string) {
  return apiFetch<{ status: string; plan: string; commit?: string }>(
    `/admin/resources/request${tenantQuery(tenant)}`,
    { method: "PUT", body: JSON.stringify({ plan, reason }) },
  );
}

/** Withdraw (the tenant's administrator) or decline (the cluster's) the
 *  tenant's pending request. */
export function clearResourcePlanRequest(tenant?: string) {
  return apiFetch<{ status: string }>(`/admin/resources/request${tenantQuery(tenant)}`, {
    method: "DELETE",
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
 * person whose token authorized it, trailered with the relation and object
 * that permitted it. A commit with `throughPlatform: false` was pushed by
 * hand — with whatever credential the pusher held and no record of what
 * allowed it — and is shown as such rather than dressed up as authorized.
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

// People and groups (S7A.17).
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
  /** They must enroll one at their next sign-in. */
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
  /** The positions the person holds from the start, beside user. */
  positions?: string[];
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

/**
 * Who answers one pending request: the tenant's perimeter approver
 * (can_approve_privilege) or the cluster's security officer (cluster
 * can_approve). Any other value is a kind of answer this console does not
 * know, and it offers no button for it.
 */
export type PendingPrivilegeApproval = {
  privilege: string;
  approvedBy: "perimeter-approver" | "security-officer" | (string & {});
  /** The profile's reason, and the request the tenant's administrator made. */
  reason?: string | null;
  requestedBy?: string | null;
  requestedAt?: string | null;
  note?: string | null;
  /** When a grant for it ran out: approved once, waiting again. */
  expiredAt?: string | null;
  /**
   * The approver's no, when one was said: who, when and why. The request is
   * still pending -- the app keeps waiting -- until somebody approves, or
   * asks again. Absent from an older operator.
   */
  declinedBy?: string | null;
  declinedAt?: string | null;
  declineReason?: string | null;
};

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
  /**
   * The same requests, each with who answers it, as the operator decides it
   * from the kind and the director applies it to the approval. Absent from an
   * operator older than this field, and then no request offers the button.
   */
  pendingPrivilegeApprovals?: PendingPrivilegeApproval[];
  /** The component's own conditions, as the operator reports them. */
  conditions?: { type: string; status: string; reason?: string; message?: string }[];
  /**
   * Who put the component in the tenant, from the operator's
   * `gentianos.io/component-origin` label: `default` for one the platform
   * places in every tenant and manages itself, `install` for one the tenant
   * installed. Absent from an operator older than this field, and then the
   * component counts as installed.
   */
  origin?: "default" | "install";
  /**
   * The profile's trust tier, and what the profile has the component hold on
   * people's behalf. Absent from an operator older than these fields, and for
   * a component whose profile the cluster no longer has.
   */
  trustTier?: string;
  holds?: AppHold[];
  /**
   * How the tenant's app administrators come to administer inside the app.
   * Absent when the profile maps them to nothing: who administers inside it
   * is then set in the app itself.
   */
  administrators?: AppAdministrators;
  /** The app's add-ons the cluster holds a component for, each with its own. */
  addons?: {
    profile: string;
    name: string;
    trustTier?: string;
    holds?: AppHold[];
    administrators?: AppAdministrators;
  }[];
};

/**
 * The app administrator's role is one group of the sign-in service for the
 * whole tenant, and not in the rights store: its members are made
 * administrators inside each app by the app's own means, which this names.
 */
export type AppAdministrators = {
  /** The group whose members they are. */
  group: string;
  /** How the membership reaches the app: `sync`, `token`, `sign-in`. */
  ways: string[];
  /** The in-app role the app's sync job puts them in. */
  role?: string;
  /** The app's roles a member's token carries. */
  tokenRoles?: string[];
};

/**
 * One thing a component holds on people's behalf, as the operator read it from
 * the profile. `kind` is the operator's word for it; one this console does not
 * know is shown as it came.
 */
export type AppHold = {
  kind: string;
  /** Whether the person has to be there: `present`, or `away` for also when not. */
  presence?: "present" | "away" | (string & {});
  /** What it concerns: entries, contracts, services, scopes or ways. */
  names?: string[];
};

export function fetchAppStates() {
  return apiFetch<{ tenant: string; apps: AppState[] }>("/admin/apps/status");
}

// --- The platform's administrators entering the tenant (iam.md 1.1c) --------

/** Whether the platform's administrators may sign in to the tenant as its administrators. */
export function fetchPlatformAccess(tenant?: string) {
  return apiFetch<{ tenant: string; adminsEnter: boolean }>(`/admin/platform-access${tenantQuery(tenant)}`);
}

/** The tenant's own switch: a commit to its manifest. */
export function updatePlatformAccess(adminsEnter: boolean, tenant?: string) {
  return apiFetch<{ status: string; commit?: string }>(`/admin/platform-access${tenantQuery(tenant)}`, {
    method: "PUT",
    body: JSON.stringify({ adminsEnter }),
  });
}

/** Where the organization is; its country is the tenant's. */
export type TenantAddress = {
  street?: string;
  postalCode?: string;
  city?: string;
  region?: string;
};

/** Who the tenant is, as the tenant's manifest declares it (spec.organization). */
export type TenantOrganization = {
  legalName?: string;
  currency?: string;
  timeZone?: string;
  fiscalYearStartMonth?: number;
  address?: TenantAddress;
  website?: string;
  email?: string;
  phone?: string;
  taxId?: string;
  registrationNumber?: string;
};

/**
 * Tenant Settings: who the tenant is, and which of the facts an app needs to
 * set itself up are still missing (legal name, country, currency, time zone,
 * languages), by their place in the manifest.
 */
export type TenantSettings = {
  displayName: string;
  country: string;
  /** The first is the tenant's own language. */
  locales: string[];
  organization: TenantOrganization;
  missing: string[];
};

export function fetchTenantSettings(tenant?: string) {
  return apiFetch<TenantSettings>(`/admin/tenant-settings${tenantQuery(tenant)}`);
}

export function updateTenantSettings(body: Omit<TenantSettings, "missing">, tenant?: string) {
  return apiFetch<{ status: string }>(`/admin/tenant-settings${tenantQuery(tenant)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

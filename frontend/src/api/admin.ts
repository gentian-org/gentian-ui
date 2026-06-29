import { apiFetch } from "@/api/client";
import { getAccessToken } from "@/auth/oidc";

export type AdminContext = {
  tenant: string;
  realm: string;
  isPlatformAdmin: boolean;
  isTenantAdmin: boolean;
  availableTenants: string[];
  storeConfigured: boolean;
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
  },
  tenant?: string,
) {
  return apiFetch<AdminMember>(`/admin/members/invite${tenantQuery(tenant)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function resetMemberPassword(id: string, tenant?: string) {
  return apiFetch<void>(`/admin/members/${id}/reset-password${tenantQuery(tenant)}`, {
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

export function fetchGroups(tenant?: string) {
  return apiFetch<AdminGroup[]>(`/admin/groups${tenantQuery(tenant)}`);
}

export function createGroup(name: string, tenant?: string) {
  return apiFetch<AdminGroup>(`/admin/groups${tenantQuery(tenant)}`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateGroup(id: string, name: string, tenant?: string) {
  return apiFetch<AdminGroup>(`/admin/groups/${id}${tenantQuery(tenant)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
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

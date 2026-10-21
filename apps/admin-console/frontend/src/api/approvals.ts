/* SPDX-License-Identifier: Apache-2.0 */
import { apiFetch } from "@/api/client";

/**
 * One privilege awaiting the cluster's security officer, as the operator
 * lists it across every tenant (gentian-os internal/applifecycle,
 * privilege_requests.go): the app, what it asks, the profile's reason, and
 * the request its tenant's administrator made.
 */
export type Approval = {
  tenant: string;
  profile: string;
  /** The Component's name: what the approval names. */
  install: string;
  privilege: string;
  approvedBy: "tenant" | "security-officer";
  reason?: string | null;
  requestedBy?: string | null;
  requestedAt?: string | null;
  note?: string | null;
  /** When a grant for it ran out: approved once, waiting again. */
  expiredAt?: string | null;
};

export function fetchApprovals() {
  return apiFetch<{ approvals: Approval[] }>("/admin/approvals");
}

export type NodePrivilegeApproval = { reason: string; expiresAt?: string };

/**
 * Approve one request for the tenant it was made in. The director decides
 * whether this person may, by the kind, and records them as the approver.
 */
export function approveNodePrivilege(approval: Approval, body: NodePrivilegeApproval) {
  const [kind, name] = approval.privilege.split("/", 2);
  return apiFetch<{ status: string; commit?: string }>(
    `/admin/approvals/${encodeURIComponent(approval.tenant)}/${encodeURIComponent(approval.install)}/${encodeURIComponent(kind)}/${encodeURIComponent(name ?? "")}`,
    { method: "PUT", body: JSON.stringify(body) },
  );
}

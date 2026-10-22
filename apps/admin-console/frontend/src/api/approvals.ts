/* SPDX-License-Identifier: Apache-2.0 */
import { apiFetch } from "@/api/client";

/**
 * One pending privilege, awaiting the cluster's security officer or the
 * tenant's perimeter approver (approvedBy), as the operator lists it across
 * every tenant (gentian-os internal/applifecycle,
 * privilege_requests.go): the app, what it asks, the profile's reason, and
 * the request its tenant's administrator made.
 */
export type Approval = {
  tenant: string;
  profile: string;
  /** The Component's name: what the approval names. */
  install: string;
  privilege: string;
  approvedBy: "perimeter-approver" | "security-officer" | (string & {});
  reason?: string | null;
  requestedBy?: string | null;
  requestedAt?: string | null;
  note?: string | null;
  /** When a grant for it ran out: approved once, waiting again. */
  expiredAt?: string | null;
  /**
   * The approver's no, when one was said: who, when and why. The privilege
   * is still pending; a new request or a later approval clears it.
   */
  declinedBy?: string | null;
  declinedAt?: string | null;
  declineReason?: string | null;
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

export type NodePrivilegeDecline = { reason: string };

/**
 * Decline one request for the tenant it was made in. The same right as the
 * approval's, decided by the director; nothing is committed, and the
 * operator records who declined, when and why on the app.
 */
export function declineNodePrivilege(approval: Approval, body: NodePrivilegeDecline) {
  const [kind, name] = approval.privilege.split("/", 2);
  return apiFetch<{ status: string }>(
    `/admin/approvals/${encodeURIComponent(approval.tenant)}/${encodeURIComponent(approval.profile)}/${encodeURIComponent(kind)}/${encodeURIComponent(name ?? "")}/decline`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

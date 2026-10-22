/* SPDX-License-Identifier: Apache-2.0 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { fetchAdminContext } from "@/api/admin";
import { approveNodePrivilege, declineNodePrivilege, fetchApprovals, type Approval } from "@/api/approvals";
import "./admin.css";

const mono = { mono: <span className="admin-console__mono" /> };
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * What every tenant's apps ask of the platform, each with the profile's
 * reason and the request its tenant's administrator made: pod-security
 * waivers and cluster roles for the cluster's security officer
 * (approvedBy security-officer, cluster can_approve), egress for the
 * cluster's perimeter approver (approvedBy perimeter-approver, cluster
 * can_approve_perimeter). The list is the usher's; each approver sees the
 * requests they answer, the cluster's administrator sees all. The buttons
 * follow the director's answer to the right, and the director decides again.
 * A decline is the same right: it commits nothing and the app keeps
 * waiting, but whoever asked is told why.
 */
export function ApprovalsSection() {
  const { t } = useTranslation();
  const approvalsQuery = useQuery({ queryKey: ["admin", "approvals"], queryFn: () => fetchApprovals() });
  const contextQuery = useQuery({ queryKey: ["admin", "context"], queryFn: () => fetchAdminContext() });
  const context = contextQuery.data;
  const mayApprove = (approval: Approval) =>
    approval.approvedBy === "security-officer"
      ? context?.canApproveNodePrivilege === true
      : approval.approvedBy === "perimeter-approver" && context?.canApprovePerimeter === true;
  const approvals = (approvalsQuery.data?.approvals ?? []).filter(
    (approval) => context?.isPlatformAdmin === true || mayApprove(approval),
  );

  return (
    <section className="admin-console__section">
      <h2 className="admin-console__section-title">{t("approvals.title")}</h2>
      <p className="admin-console__hint">{t("approvals.lead")}</p>
      {approvalsQuery.isLoading ? <p className="admin-console__loading">{t("approvals.reading")}</p> : null}
      {approvalsQuery.isError ? (
        <p className="admin-console__error">
          {t("approvals.unavailable")} {messageOf(approvalsQuery.error)}
        </p>
      ) : null}
      {approvalsQuery.isSuccess && approvals.length === 0 ? (
        <p className="admin-console__hint">{t("approvals.none")}</p>
      ) : null}
      {approvals.length > 0 ? (
        <div className="admin-console__table-wrap">
          <table className="admin-console__table">
            <thead>
              <tr>
                <th>{t("approvals.tenant")}</th>
                <th>{t("approvals.app")}</th>
                <th>{t("approvals.privilege")}</th>
                <th>{t("approvals.request")}</th>
                <th>{t("approvals.answer")}</th>
              </tr>
            </thead>
            <tbody>
              {approvals.map((approval) => (
                <tr key={`${approval.tenant}/${approval.install}/${approval.privilege}`}>
                  <td className="admin-console__mono">{approval.tenant}</td>
                  <td className="admin-console__mono">{approval.install}</td>
                  <td>
                    <div className="admin-console__mono">{approval.privilege}</div>
                    <div className="admin-console__hint">{approval.reason || t("approvals.noReason")}</div>
                  </td>
                  <td>
                    {approval.requestedBy ? (
                      <>
                        <div>
                          <Trans
                            i18nKey="approvals.requestedBy"
                            values={{ who: approval.requestedBy, when: approval.requestedAt ? new Date(approval.requestedAt).toLocaleString() : "" }}
                            components={mono}
                          />
                        </div>
                        {approval.note ? <div className="admin-console__hint">{approval.note}</div> : null}
                      </>
                    ) : (
                      <div className="admin-console__hint">{t("approvals.notRequested")}</div>
                    )}
                    {approval.expiredAt ? (
                      <div className="admin-console__hint">
                        {t("approvals.expired", { when: new Date(approval.expiredAt).toLocaleString() })}
                      </div>
                    ) : null}
                    {approval.declinedBy ? (
                      <div className="admin-console__hint">
                        <Trans
                          i18nKey="approvals.declinedBy"
                          values={{
                            who: approval.declinedBy,
                            when: approval.declinedAt ? new Date(approval.declinedAt).toLocaleString() : "",
                            reason: approval.declineReason ?? "",
                          }}
                          components={mono}
                        />
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {mayApprove(approval) ? (
                      <AnswerRequest approval={approval} />
                    ) : (
                      <div className="admin-console__hint">
                        {t(approval.approvedBy === "perimeter-approver" ? "approvals.notYoursPerimeter" : "approvals.notYours")}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The officer's answer: an approval -- a reason in their words, an optional
 * end, then one commit through the director for the request's tenant -- or
 * a decline, a reason and nothing committed. Either way the director's
 * refusal is shown as it worded it.
 */
function AnswerRequest({ approval }: { approval: Approval }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<"approve" | "decline" | null>(null);
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const settle = () => {
    setOpen(null);
    setReason("");
    void queryClient.invalidateQueries({ queryKey: ["admin", "approvals"] });
  };
  const approve = useMutation({
    mutationFn: () =>
      approveNodePrivilege(approval, {
        reason: reason.trim(),
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      }),
    onSuccess: settle,
  });
  const decline = useMutation({
    mutationFn: () => declineNodePrivilege(approval, { reason: reason.trim() }),
    onSuccess: settle,
  });
  const tooShort = reason.trim().length < 10;
  const busy = approve.isPending || decline.isPending;

  if (approve.isSuccess) {
    return (
      <span className="admin-console__hint">
        {approve.data.commit ? (
          <Trans i18nKey="approvals.approvedAs" values={{ commit: approve.data.commit }} components={mono} />
        ) : (
          t("approvals.approvedAlready")
        )}
      </span>
    );
  }
  if (decline.isSuccess) {
    return <span className="admin-console__hint">{t("approvals.declined")}</span>;
  }
  if (!open) {
    return (
      <div className="admin-console__actions">
        <button type="button" className="admin-console__btn" onClick={() => setOpen("approve")}>
          {t("approvals.approve")}
        </button>
        <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={() => setOpen("decline")}>
          {t("approvals.decline")}
        </button>
      </div>
    );
  }
  const declining = open === "decline";
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (tooShort) return;
        if (declining) decline.mutate();
        else approve.mutate();
      }}
    >
      <label className="admin-console__field">
        <span>{t(declining ? "approvals.declineReasonLabel" : "approvals.reasonLabel")}</span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} required minLength={10} maxLength={1000} rows={3} />
      </label>
      {declining ? null : (
        <label className="admin-console__field">
          <span>{t("approvals.expiresLabel")}</span>
          <input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
        </label>
      )}
      <p className="admin-console__hint">{t(declining ? "approvals.declineReasonHint" : "approvals.reasonHint")}</p>
      {approve.isError ? (
        <p className="admin-console__error">
          {t("approvals.approveFailed")} {messageOf(approve.error)}
        </p>
      ) : null}
      {decline.isError ? (
        <p className="admin-console__error">
          {t("approvals.declineFailed")} {messageOf(decline.error)}
        </p>
      ) : null}
      <div className="admin-console__actions">
        <button type="submit" className="admin-console__btn" disabled={tooShort || busy}>
          {t(declining ? "approvals.declineConfirm" : "approvals.approveConfirm", { privilege: approval.privilege })}
        </button>
        <button type="button" className="admin-console__btn admin-console__btn--quiet" disabled={busy} onClick={() => setOpen(null)}>
          {t("approvals.cancel")}
        </button>
      </div>
    </form>
  );
}

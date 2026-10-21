/* SPDX-License-Identifier: Apache-2.0 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { fetchAdminContext } from "@/api/admin";
import { approveNodePrivilege, fetchApprovals, type Approval } from "@/api/approvals";
import "./admin.css";

const mono = { mono: <span className="admin-console__mono" /> };
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * What every tenant's apps ask of the node, for the cluster's security
 * officer: pod-security waivers and cluster roles, each with the profile's
 * reason and the request its tenant's administrator made. The list is the
 * usher's, read under cluster can_approve or can_configure; the button
 * follows the director's answer to can_approve (adminContext.
 * canApproveNodePrivilege), and the director decides again on the approval.
 */
export function ApprovalsSection() {
  const { t } = useTranslation();
  const approvalsQuery = useQuery({ queryKey: ["admin", "approvals"], queryFn: () => fetchApprovals() });
  const contextQuery = useQuery({ queryKey: ["admin", "context"], queryFn: () => fetchAdminContext() });
  const mayApprove = contextQuery.data?.canApproveNodePrivilege === true;
  const approvals = approvalsQuery.data?.approvals ?? [];

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
                  </td>
                  <td>
                    {mayApprove ? (
                      <ApproveRequest approval={approval} />
                    ) : (
                      <div className="admin-console__hint">{t("approvals.notYours")}</div>
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
 * One approval: a reason in the officer's words, an optional end, then one
 * commit through the director for the request's tenant. The director's
 * refusal is shown as it worded it.
 */
function ApproveRequest({ approval }: { approval: Approval }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const approve = useMutation({
    mutationFn: () =>
      approveNodePrivilege(approval, {
        reason: reason.trim(),
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      }),
    onSuccess: () => {
      setOpen(false);
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "approvals"] });
    },
  });
  const tooShort = reason.trim().length < 10;

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
  if (!open) {
    return (
      <div className="admin-console__actions">
        <button type="button" className="admin-console__btn" onClick={() => setOpen(true)}>
          {t("approvals.approve")}
        </button>
      </div>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!tooShort) approve.mutate();
      }}
    >
      <label className="admin-console__field">
        <span>{t("approvals.reasonLabel")}</span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} required minLength={10} maxLength={1000} rows={3} />
      </label>
      <label className="admin-console__field">
        <span>{t("approvals.expiresLabel")}</span>
        <input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
      </label>
      <p className="admin-console__hint">{t("approvals.reasonHint")}</p>
      {approve.isError ? (
        <p className="admin-console__error">
          {t("approvals.approveFailed")} {messageOf(approve.error)}
        </p>
      ) : null}
      <div className="admin-console__actions">
        <button type="submit" className="admin-console__btn" disabled={tooShort || approve.isPending}>
          {t("approvals.approveConfirm", { privilege: approval.privilege })}
        </button>
        <button type="button" className="admin-console__btn admin-console__btn--quiet" disabled={approve.isPending} onClick={() => setOpen(false)}>
          {t("approvals.cancel")}
        </button>
      </div>
    </form>
  );
}

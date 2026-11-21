/* SPDX-License-Identifier: Apache-2.0 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { fetchAdminContext, fetchAppStates, type AppState } from "@/api/admin";
import { approveNodePrivilege, declineNodePrivilege, fetchApprovals, type Approval } from "@/api/approvals";
import "./admin.css";
import { formatDateTime } from "@/lib/format";

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
 * waiting, but whoever asked is told why. A pod-security waiver the
 * cluster's allowlist lacks says so, and approving it adds the entry too.
 */
export function ApprovalsSection() {
  const { t } = useTranslation();
  const contextQuery = useQuery({ queryKey: ["admin", "context"], queryFn: () => fetchAdminContext() });
  const context = contextQuery.data;
  // The cluster's list is read by the cluster's approvers and administrator
  // alone (the usher refuses anybody else); the tenant's perimeter approver
  // reads the requests of the tenant's own apps.
  const ofCluster =
    context?.isPlatformAdmin === true || context?.canApproveNodePrivilege === true || context?.canApprovePerimeter === true;
  const ofTenant = context?.canApprovePrivilege === true;
  const approvalsQuery = useQuery({
    queryKey: ["admin", "approvals"],
    queryFn: () => fetchApprovals(),
    enabled: ofCluster,
  });
  const statesQuery = useQuery({
    queryKey: ["admin", "apps", "status"],
    queryFn: () => fetchAppStates(),
    enabled: ofTenant,
  });
  const tenant = statesQuery.data?.tenant;
  const mayApprove = (approval: Approval) =>
    approval.approvedBy === "security-officer"
      ? context?.canApproveNodePrivilege === true
      : approval.approvedBy === "perimeter-approver" &&
        (context?.canApprovePerimeter === true || (ofTenant && approval.tenant === tenant));
  const listed = new Map<string, Approval>();
  for (const approval of [
    ...(approvalsQuery.data?.approvals ?? []),
    ...tenantApprovals(statesQuery.data?.tenant, statesQuery.data?.apps ?? []),
  ]) {
    listed.set(`${approval.tenant}/${approval.install}/${approval.privilege}`, approval);
  }
  const approvals = [...listed.values()].filter(
    (approval) => context?.isPlatformAdmin === true || mayApprove(approval),
  );
  const loading = approvalsQuery.isLoading || statesQuery.isLoading;
  const failed = approvalsQuery.isError ? approvalsQuery.error : statesQuery.isError ? statesQuery.error : null;
  const read = (!ofCluster || approvalsQuery.isSuccess) && (!ofTenant || statesQuery.isSuccess);

  return (
    <section className="admin-console__section">
      <h2 className="admin-console__section-title">{t("approvals.title")}</h2>
      <p className="admin-console__hint">{t("approvals.lead")}</p>
      {loading ? <p className="admin-console__loading">{t("approvals.reading")}</p> : null}
      {failed ? (
        <p className="admin-console__error">
          {t("approvals.unavailable")} {messageOf(failed)}
        </p>
      ) : null}
      {read && approvals.length === 0 ? <p className="admin-console__hint">{t("approvals.none")}</p> : null}
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
                    {approval.waiver && !approval.waiver.allowlisted ? (
                      <div className="admin-console__hint">
                        <Trans
                          i18nKey="approvals.notAllowlisted"
                          values={{ entry: `${approval.waiver.profile}/${approval.waiver.policy}/${approval.waiver.scope}` }}
                          components={mono}
                        />
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {approval.requestedBy ? (
                      <>
                        <div>
                          <Trans
                            i18nKey="approvals.requestedBy"
                            values={{ who: approval.requestedBy, when: approval.requestedAt ? formatDateTime(approval.requestedAt) : "" }}
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
                        {t("approvals.expired", { when: formatDateTime(approval.expiredAt) })}
                      </div>
                    ) : null}
                    {approval.declinedBy ? (
                      <div className="admin-console__hint">
                        <Trans
                          i18nKey="approvals.declinedBy"
                          values={{
                            who: approval.declinedBy,
                            when: approval.declinedAt ? formatDateTime(approval.declinedAt) : "",
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
                      <NotAnsweredHere approval={approval} />
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
 * The requests of the tenant's own apps, from what the cluster says of each
 * (the usher's app states): the egress the tenant's perimeter approver
 * answers, in the shape of the cluster's list. An add-on's requests are the
 * add-on's own install's.
 */
export function tenantApprovals(tenant: string | undefined, apps: AppState[]): Approval[] {
  if (!tenant) return [];
  return apps.flatMap((app) =>
    (app.pendingPrivilegeApprovals ?? [])
      .filter((p) => p.approvedBy === "perimeter-approver")
      .map((p) => ({
        tenant,
        profile: app.profile,
        install: app.name || app.profile,
        privilege: p.privilege,
        approvedBy: p.approvedBy,
        reason: p.reason,
        requestedBy: p.requestedBy,
        requestedAt: p.requestedAt,
        note: p.note,
        expiredAt: p.expiredAt,
        declinedBy: p.declinedBy,
        declinedAt: p.declinedAt,
        declineReason: p.declineReason,
      })),
  );
}

/**
 * Whose a request is, for a reader who cannot answer it here. The usher
 * names the approver; one this console has no button for is named as it is
 * rather than passed off as the security officer's. Break-glass answers
 * from the command line, so the command is shown.
 */
function NotAnsweredHere({ approval }: { approval: Approval }) {
  const { t } = useTranslation();
  if (approval.approvedBy === "perimeter-approver") {
    return <div className="admin-console__hint">{t("approvals.notYoursPerimeter")}</div>;
  }
  if (approval.approvedBy === "security-officer") {
    return <div className="admin-console__hint">{t("approvals.notYours")}</div>;
  }
  if (approval.approvedBy === "break-glass") {
    return (
      <div className="admin-console__hint">
        <Trans
          i18nKey="approvals.breakGlass"
          values={{
            command: `kubectl gentian apps approve ${approval.install} ${approval.privilege} --tenant ${approval.tenant}`,
          }}
          components={mono}
        />
      </div>
    );
  }
  return (
    <div className="admin-console__hint">
      <Trans i18nKey="approvals.otherApprover" values={{ who: approval.approvedBy }} components={mono} />
    </div>
  );
}

/**
 * The officer's answer: an approval -- a comment if they leave one, an optional
 * end, then one commit through the director for the request's tenant -- or
 * a decline, a reason and nothing committed. Either way the director's
 * refusal is shown as it worded it.
 */
export function AnswerRequest({ approval }: { approval: Approval }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<"approve" | "decline" | null>(null);
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const settle = () => {
    setOpen(null);
    setReason("");
    void queryClient.invalidateQueries({ queryKey: ["admin", "approvals"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "apps", "status"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "apps", "privileges"] });
  };
  const approve = useMutation({
    mutationFn: () =>
      approveNodePrivilege(approval, {
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
        // A waiver the cluster does not permit yet: its allowlist entry is
        // added in the same approval.
        ...(approval.waiver && !approval.waiver.allowlisted
          ? { allowlist: { profile: approval.waiver.profile, policy: approval.waiver.policy, scope: approval.waiver.scope } }
          : {}),
      }),
    onSuccess: settle,
  });
  const decline = useMutation({
    mutationFn: () => declineNodePrivilege(approval, { reason: reason.trim() }),
    onSuccess: settle,
  });
  // A decline is shown to whoever asked, so it says why. An approval's
  // comment is the approver's to leave or not.
  const tooShort = open === "decline" && reason.trim().length < 10;
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
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required={declining}
          minLength={declining ? 10 : undefined}
          maxLength={1000}
          rows={declining ? 3 : 2}
        />
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

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { approvePrivilege, fetchContext, requestPrivilege, type PendingApproval } from "@/api/store";
import { DateText, ProblemNote } from "@/store/parts";

const mono = { mono: <span className="admin-console__mono" /> };

/**
 * The Approvals step of an install: what the app asks of the platform beyond
 * the default posture, and who answers each request (store-contract.md §6.4
 * step 4).
 *
 * The operator says who answers -- the tenant's perimeter approver for
 * egress, the cluster's security officer for what weakens the node -- and
 * the director decides again on every approval. This step offers what the
 * answer says: egress is approved here, with the person's reason, by whoever
 * the director says may (can_approve_privilege); anything else is asked for,
 * and answered in the approver's admin console.
 * Nothing here decides who may; a refusal is shown in the director's words.
 */
export function Approvals({
  coordinate,
  approvals,
  onChanged,
}: {
  coordinate: string;
  approvals: PendingApproval[];
  /** Something was approved or asked for: look at the cluster again. */
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const contextQuery = useQuery({ queryKey: ["context"], queryFn: fetchContext, retry: false });
  const mayApprove = (approval: PendingApproval) =>
    approval.approvedBy === "perimeter-approver" && contextQuery.data?.mayApprovePrivilege === true;
  const forOfficer = approvals.some((a) => a.approvedBy === "security-officer");
  const forPerimeter = approvals.some((a) => a.approvedBy === "perimeter-approver" && !mayApprove(a));
  return (
    <div className="store-approvals" aria-live="polite">
      <p className="admin-console__lead">{t("approvals.lead")}</p>
      <ul className="store-approvals__list">
        {approvals.map((approval) => (
          <li key={`${approval.addon ?? ""} ${approval.privilege}`} className="store-notice store-approvals__item">
            <p className="store-notice__title">
              <span className="admin-console__mono">{approval.privilege}</span>
              {" — "}
              {t(approval.approvedBy === "perimeter-approver" ? "approvals.kindPerimeterApprover" : "approvals.kindSecurityOfficer")}
            </p>
            {approval.addon ? (
              <p className="admin-console__meta">
                <Trans i18nKey="approvals.forAddon" values={{ addon: approval.addon }} components={mono} />
              </p>
            ) : null}
            <p className="store-notice__text">{approval.reason ?? t("approvals.noReason")}</p>
            {approval.expiredAt ? (
              <p className="admin-console__hint">
                {t("approvals.expired")} <DateText value={approval.expiredAt} />
              </p>
            ) : null}
            {mayApprove(approval) ? (
              <Approve coordinate={askedOf(coordinate, approval)} approval={approval} onChanged={onChanged} />
            ) : (
              <Request coordinate={askedOf(coordinate, approval)} approval={approval} onChanged={onChanged} />
            )}
          </li>
        ))}
      </ul>
      {forOfficer ? <p className="admin-console__meta">{t("approvals.officerHint")}</p> : null}
      {forPerimeter ? <p className="admin-console__meta">{t("approvals.perimeterHint")}</p> : null}
      <p className="admin-console__meta">{t("approvals.carriesOn")}</p>
    </div>
  );
}

/** The entry a request is approved or asked for under: the add-on's own, in
 * the app's catalogue, for one an add-on makes; the app's otherwise. */
function askedOf(coordinate: string, approval: PendingApproval): string {
  if (!approval.addon) return coordinate;
  const slash = coordinate.lastIndexOf("/");
  return `${coordinate.slice(0, slash + 1)}${approval.addon}`;
}

/** The perimeter approver's own answer: a reason, then one commit. */
function Approve({
  coordinate,
  approval,
  onChanged,
}: {
  coordinate: string;
  approval: PendingApproval;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const approve = useMutation({
    mutationFn: () => approvePrivilege(coordinate, approval.privilege, { reason: reason.trim() }),
    onSuccess: () => {
      setOpen(false);
      onChanged();
    },
  });
  const tooShort = reason.trim().length < 10;

  if (approve.isSuccess) {
    return (
      <p className="admin-console__hint">
        {approve.data.commit ? (
          <Trans i18nKey="approvals.approvedAs" values={{ commit: approve.data.commit }} components={mono} />
        ) : (
          t("approvals.approvedAlready")
        )}
      </p>
    );
  }
  if (!open) {
    return (
      <div className="admin-console__actions">
        <button type="button" className="admin-console__btn admin-console__btn--primary" onClick={() => setOpen(true)}>
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
      <label className="admin-console__label">
        <span className="admin-console__label-text">{t("approvals.reasonLabel")}</span>
        <textarea
          className="store-input"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          minLength={10}
          maxLength={1000}
          rows={3}
        />
      </label>
      <p className="admin-console__hint">{t("approvals.reasonHint")}</p>
      {approve.isError ? <ProblemNote error={approve.error} /> : null}
      <div className="admin-console__actions">
        <button type="submit" className="admin-console__btn admin-console__btn--primary" disabled={tooShort || approve.isPending}>
          {t("approvals.approveConfirm", { privilege: approval.privilege })}
        </button>
        <button type="button" className="admin-console__btn admin-console__btn--quiet" disabled={approve.isPending} onClick={() => setOpen(false)}>
          {t("approvals.cancel")}
        </button>
      </div>
    </form>
  );
}

/**
 * Asking the approver. Once asked, the request is shown as the
 * cluster records it -- who, when, the note -- and the step waits. One the
 * approver declined is shown with their reason and can be asked for again:
 * the same request, which the operator treats as new and which clears the
 * no. A request just made here is shown from the answer until the cluster
 * reports it.
 */
function Request({
  coordinate,
  approval,
  onChanged,
}: {
  coordinate: string;
  approval: PendingApproval;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const request = useMutation({
    mutationFn: () => requestPrivilege(coordinate, approval.privilege, note.trim()),
    onSuccess: () => {
      setOpen(false);
      onChanged();
    },
  });
  const justAsked = request.data?.request
    ? { by: request.data.request.requestedBy, at: request.data.request.requestedAt, note: request.data.request.note ?? null }
    : null;
  const declined = !justAsked && approval.declinedBy ? approval : null;
  const recorded = justAsked ?? (!declined && approval.requestedBy ? { by: approval.requestedBy, at: approval.requestedAt, note: approval.note } : null);

  if (recorded) {
    return (
      <>
        <p className="admin-console__hint">
          <Trans i18nKey="approvals.requestedBy" values={{ who: recorded.by }} components={mono} /> <DateText value={recorded.at} />
        </p>
        {recorded.note ? <p className="store-problem__said">{recorded.note}</p> : null}
        <p className="admin-console__hint">{t("approvals.waitingForApprover")}</p>
      </>
    );
  }
  const said = declined ? (
    <>
      <p className="admin-console__hint">
        <Trans i18nKey="approvals.declinedBy" values={{ who: declined.declinedBy }} components={mono} />{" "}
        {declined.declinedAt ? <DateText value={declined.declinedAt} /> : null}
      </p>
      {declined.declineReason ? <p className="store-problem__said">{declined.declineReason}</p> : null}
      <p className="admin-console__hint">{t("approvals.declinedWaits")}</p>
    </>
  ) : null;
  if (!open) {
    return (
      <>
        {said}
        <div className="admin-console__actions">
          <button type="button" className="admin-console__btn admin-console__btn--primary" onClick={() => setOpen(true)}>
            {t(declined ? "approvals.requestAgain" : "approvals.request")}
          </button>
        </div>
      </>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        request.mutate();
      }}
    >
      {said}
      <label className="admin-console__label">
        <span className="admin-console__label-text">{t("approvals.noteLabel")}</span>
        <textarea className="store-input" value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={2} />
      </label>
      {request.isError ? <ProblemNote error={request.error} /> : null}
      <div className="admin-console__actions">
        <button type="submit" className="admin-console__btn admin-console__btn--primary" disabled={request.isPending}>
          {t("approvals.requestConfirm", { privilege: approval.privilege })}
        </button>
        <button type="button" className="admin-console__btn admin-console__btn--quiet" disabled={request.isPending} onClick={() => setOpen(false)}>
          {t("approvals.cancel")}
        </button>
      </div>
    </form>
  );
}

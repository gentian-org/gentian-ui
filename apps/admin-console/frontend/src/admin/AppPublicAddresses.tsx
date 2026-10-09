/* SPDX-License-Identifier: Apache-2.0 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { fetchAdminContext } from "@/api/admin";
import {
  approveExposure,
  fetchTenantExposures,
  withdrawExposure,
  type AppWriteResult,
  type ExposureApprovalRequest,
  type ExposureEntry,
} from "@/api/apps";
import { ApiError } from "@/api/client";
import "./admin.css";

const mono = { mono: <span className="admin-console__mono" /> };

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** What the director said, as it said it, when the answer carried a reason. */
const refusalOf = (err: unknown) => (err instanceof ApiError && err.detail ? err.detail : messageOf(err));

const day = (value?: string) => (value ? new Date(value).toLocaleDateString() : "");

/** An entry as the command names it: `<app instance>/<entry>`. */
const nameOf = (entry: ExposureEntry) => `${entry.install}/${entry.exposureName}`;

/**
 * What this screen offers for an entry. The director decides whether an
 * approval or a withdrawal is taken; this only decides what is worth asking.
 *
 * An approval is offered where the director gives an address, because the
 * dialog shows that address and an entry without one would be published
 * nowhere. An entry the director can name and not describe -- a component the
 * platform itself ships -- is left to the command, in both directions: what
 * a withdrawal would take down cannot be shown here.
 */
function offeredFor(entry: ExposureEntry): {
  approve: "approve" | "review" | null;
  withdraw: boolean;
  why: "nowhere" | "notShown" | null;
} {
  if (entry.state === "unmatched") return { approve: null, withdraw: true, why: null };
  const known = ["requested", "approved", "reviewDue", "expired"].includes(entry.state);
  if (!known) return { approve: null, withdraw: false, why: null };
  if (!entry.authMode) return { approve: null, withdraw: false, why: "notShown" };
  const withdraw = entry.state === "approved" || entry.state === "reviewDue";
  if (!entry.host) return { approve: null, withdraw, why: "nowhere" };
  const approve = entry.state === "requested" || entry.state === "expired" ? "approve" : "review";
  return { approve, withdraw, why: null };
}

/** What the director answered to the last approval or withdrawal here. */
type Done = { kind: "approved" | "reviewed" | "withdrawn"; name: string; result: AppWriteResult };

/**
 * Public addresses: what this app, and the add-ons switched on inside it,
 * ask to have on the internet, and whether that was approved.
 *
 * The director's answer, read from the app's profile and the tenant's
 * registry in git: for each entry the address it is published at, its paths,
 * whether anybody signs in, and its state -- requested, approved by whom and
 * until when, due for review, or expired.
 *
 * A person the director says may publish for the tenant (can_expose, read
 * with the console's context) is offered approving and withdrawing. That
 * answer only decides which buttons are drawn: the director asks again on
 * every request, and its refusal is shown as it came.
 *
 * Not shown at all for an app that declares nothing for the internet, which
 * is most of them, and while that is not known yet.
 */
export function AppPublicAddresses({ app, addons }: { app: string; addons: string[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["admin", "apps", "exposures"],
    queryFn: () => fetchTenantExposures(),
  });
  // The same read the console opens with, so this asks nothing twice.
  const context = useQuery({
    queryKey: ["admin", "context"],
    queryFn: () => fetchAdminContext(),
  });
  const canExpose = context.data?.canExpose === true;
  const tenant = query.data?.tenant ?? "";

  // The entry the dialog is about, as it was listed when the dialog opened:
  // what is shown there is what is approved.
  const [asking, setAsking] = useState<ExposureEntry | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [failed, setFailed] = useState<{ name: string; message: string } | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "apps", "exposures"] });

  const approve = useMutation({
    mutationFn: ({ entry, body }: { entry: ExposureEntry; body: ExposureApprovalRequest }) =>
      approveExposure(entry.install, entry.exposureName, body),
    onSuccess: (result, { entry }) => {
      const reviewed = entry.state === "approved" || entry.state === "reviewDue";
      setDone({ kind: reviewed ? "reviewed" : "approved", name: nameOf(entry), result });
      setAsking(null);
      void refresh();
    },
  });
  const withdraw = useMutation({
    mutationFn: (entry: ExposureEntry) => withdrawExposure(entry.install, entry.exposureName),
    onSuccess: (result, entry) => {
      setDone({ kind: "withdrawn", name: nameOf(entry), result });
      void refresh();
    },
    onError: (err, entry) => setFailed({ name: nameOf(entry), message: refusalOf(err) }),
  });

  const open = (entry: ExposureEntry) => {
    approve.reset();
    setDone(null);
    setFailed(null);
    setAsking(entry);
  };
  const askWithdraw = (entry: ExposureEntry) => {
    const values = { name: nameOf(entry), tenant, address: entry.host ? `https://${entry.host}` : "" };
    const question =
      entry.state === "unmatched"
        ? t("apps.publicWithdrawConfirmUnmatched", values)
        : entry.host
          ? t("apps.publicWithdrawConfirm", values)
          : t("apps.publicWithdrawConfirmNoAddress", values);
    if (!window.confirm(question)) return;
    setDone(null);
    setFailed(null);
    withdraw.mutate(entry);
  };

  const names = new Set([app, ...addons]);
  const entries = (query.data?.entries ?? []).filter((e) => names.has(e.install));

  if (query.isError) {
    return (
      <div className="admin-console__subsection">
        <h3 className="admin-console__subsection-title">{t("apps.publicTitle")}</h3>
        <p className="admin-console__error">
          {t("apps.publicUnavailable")} {messageOf(query.error)}
        </p>
      </div>
    );
  }
  if (entries.length === 0 && !done) return null;

  return (
    <div className="admin-console__subsection">
      <h3 className="admin-console__subsection-title">{t("apps.publicTitle")}</h3>
      <p className="admin-console__hint">
        <Trans i18nKey="apps.publicLead" components={mono} />
      </p>
      {context.isSuccess && !canExpose ? <p className="admin-console__hint">{t("apps.publicNotApprover")}</p> : null}
      {done ? <DoneNotice done={done} /> : null}
      {entries.length > 0 ? (
        <div className="admin-console__table-wrap">
          <table className="admin-console__table">
            <thead>
              <tr>
                <th>{t("apps.publicAddress")}</th>
                <th>{t("apps.publicPaths")}</th>
                <th>{t("apps.publicSignIn")}</th>
                <th>{t("apps.publicState")}</th>
                {canExpose ? <th>{t("apps.publicActions")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={nameOf(entry)}>
                  <td>
                    <AddressCell entry={entry} app={app} />
                  </td>
                  <td>
                    <PathsCell entry={entry} />
                  </td>
                  <td>{signInOf(t, entry)}</td>
                  <td>
                    <StateCell entry={entry} />
                  </td>
                  {canExpose ? (
                    <td>
                      <ActionsCell
                        entry={entry}
                        busy={withdraw.isPending || approve.isPending}
                        failed={failed?.name === nameOf(entry) ? failed.message : null}
                        onApprove={() => open(entry)}
                        onWithdraw={() => askWithdraw(entry)}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {asking ? (
        <ApproveDialog
          entry={asking}
          tenant={tenant}
          pending={approve.isPending}
          refusal={approve.isError ? refusalOf(approve.error) : null}
          onConfirm={(body) => approve.mutate({ entry: asking, body })}
          onClose={() => setAsking(null)}
        />
      ) : null}
    </div>
  );
}

/** What the director answered, said once. With a commit, git has the change and the cluster does not yet. */
function DoneNotice({ done }: { done: Done }) {
  const { kind, name, result } = done;
  const values = { name, commit: (result.commit ?? "").slice(0, 8), status: result.status };
  if (!result.commit) {
    return (
      <p className="admin-console__hint" role="status">
        {kind === "withdrawn" ? (
          <Trans i18nKey="apps.publicOutcomeNotPublished" values={values} components={mono} />
        ) : (
          <Trans i18nKey="apps.publicOutcomeUnchanged" values={values} components={mono} />
        )}
      </p>
    );
  }
  return (
    <p className="admin-console__success" role="status">
      {kind === "approved" ? (
        <Trans i18nKey="apps.publicOutcomeApproved" values={values} components={mono} />
      ) : kind === "reviewed" ? (
        <Trans i18nKey="apps.publicOutcomeReviewed" values={values} components={mono} />
      ) : (
        <Trans i18nKey="apps.publicOutcomeWithdrawn" values={values} components={mono} />
      )}
    </p>
  );
}

function ActionsCell({
  entry,
  busy,
  failed,
  onApprove,
  onWithdraw,
}: {
  entry: ExposureEntry;
  busy: boolean;
  /** The director's refusal of this entry's withdrawal, in its words. */
  failed: string | null;
  onApprove: () => void;
  onWithdraw: () => void;
}) {
  const { t } = useTranslation();
  const offered = offeredFor(entry);
  return (
    <>
      <div className="admin-console__actions">
        {offered.approve ? (
          <button type="button" className="admin-console__btn" disabled={busy} aria-haspopup="dialog" onClick={onApprove}>
            {offered.approve === "approve" ? t("apps.publicApprove") : t("apps.publicReview")}
          </button>
        ) : null}
        {offered.withdraw ? (
          <button type="button" className="admin-console__btn admin-console__btn--danger" disabled={busy} onClick={onWithdraw}>
            {t("apps.publicWithdraw")}
          </button>
        ) : null}
      </div>
      {offered.why === "nowhere" ? <div className="admin-console__hint">{t("apps.publicNoApproveNowhere")}</div> : null}
      {offered.why === "notShown" ? (
        <div className="admin-console__hint">
          <Trans i18nKey="apps.publicNoActionNotShown" components={mono} />
        </div>
      ) : null}
      {failed ? (
        <div className="admin-console__error" role="alert">
          <p>
            <strong>{t("apps.publicWithdrawRefused")}</strong>
          </p>
          <p>{failed}</p>
        </div>
      ) : null}
    </>
  );
}

/**
 * Approving one entry, or reviewing an approved one, behind its name typed
 * out.
 *
 * It shows what the command shows before it sends anything: the address, the
 * paths and that nothing else at the address is published, the paths never
 * published, who can reach it in the director's sentence, and what the
 * approval so far says. Typing the entry is the confirmation, as for the
 * console's other acts that a click is too easy for: this one puts something
 * on the internet.
 *
 * An entry for the cluster's main address also shows the director's rule in
 * full, as the read carried it, and a box that starts unticked. Only that
 * box sends the acknowledgement; typing the entry does not. Without a rule
 * from the director there is nothing to acknowledge, and nothing is sent.
 *
 * A refusal is shown here, in the director's words, and the dialog stays.
 */
function ApproveDialog({
  entry,
  tenant,
  pending,
  refusal,
  onConfirm,
  onClose,
}: {
  entry: ExposureEntry;
  tenant: string;
  pending: boolean;
  refusal: string | null;
  onConfirm: (body: ExposureApprovalRequest) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [expires, setExpires] = useState("");
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  const name = nameOf(entry);
  const main = entry.mainAddress === true;
  const rule = entry.mainAddressRule ?? "";
  const review = entry.state === "approved" || entry.state === "reviewDue";
  const approval = entry.approval;
  const paths = entry.paths ?? [];
  const denied = entry.denyPaths ?? [];
  const values = { entry: entry.exposureName, app: entry.install, tenant, name };
  const confirmed = typed.trim() === name && (!main || (rule !== "" && acknowledged));

  const send = () => {
    if (!confirmed || pending) return;
    const body: ExposureApprovalRequest = {};
    if (reason.trim()) body.reason = reason.trim();
    // A day is the end of that day, UTC, as the command reads it.
    if (expires) body.expiresAt = `${expires}T23:59:59Z`;
    if (main) {
      body.apex = true;
      body.acknowledgeMainAddressRule = acknowledged;
    }
    onConfirm(body);
  };

  return (
    <dialog
      ref={ref}
      className="admin-console__dialog"
      aria-labelledby="public-approve-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onClose();
      }}
    >
      <form
        className="admin-console__dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <h3 id="public-approve-title" className="admin-console__dialog-title">
          {review ? (
            <Trans i18nKey="apps.publicReviewTitle" values={values} components={mono} />
          ) : (
            <Trans i18nKey="apps.publicApproveTitle" values={values} components={mono} />
          )}
        </h3>
        <p className="admin-console__lead">
          {review ? (
            <Trans i18nKey="apps.publicReviewIntro" values={values} components={mono} />
          ) : entry.state === "expired" ? (
            <Trans
              i18nKey="apps.publicApproveIntroExpired"
              values={{ ...values, until: day(approval?.expiresAt) }}
              components={mono}
            />
          ) : (
            <Trans i18nKey="apps.publicApproveIntro" values={values} components={mono} />
          )}
        </p>

        <div>
          <div className="admin-console__edit-row">
            <div className="admin-console__edit-row-label">{t("apps.publicAddress")}</div>
            <div className="admin-console__edit-row-value">
              <span className="admin-console__mono">{`https://${entry.host ?? ""}`}</span>
            </div>
          </div>
          <div className="admin-console__edit-row">
            <div className="admin-console__edit-row-label">{t("apps.publicPaths")}</div>
            <div className="admin-console__edit-row-value">
              <span className="admin-console__mono">{paths.join("  ")}</span>
              <div className="admin-console__hint">
                {paths.includes("/") ? t("apps.publicWholeAddress") : t("apps.publicOnlyThese")}
              </div>
            </div>
          </div>
          {denied.length > 0 ? (
            <div className="admin-console__edit-row">
              <div className="admin-console__edit-row-label">{t("apps.publicRefused")}</div>
              <div className="admin-console__edit-row-value">
                <span className="admin-console__mono">{denied.join("  ")}</span>
                <div className="admin-console__hint">{t("apps.publicRefusedDetail")}</div>
              </div>
            </div>
          ) : null}
          <div className="admin-console__edit-row">
            <div className="admin-console__edit-row-label">{t("apps.publicAccess")}</div>
            {/* The director's sentence where it sent one. */}
            <div className="admin-console__edit-row-value">{entry.access || signInOf(t, entry)}</div>
          </div>
          {entry.state !== "requested" && approval ? (
            <div className="admin-console__edit-row">
              <div className="admin-console__edit-row-label">{t("apps.publicSoFar")}</div>
              <div className="admin-console__edit-row-value">
                <Trans
                  i18nKey="apps.publicApprovedBy"
                  values={{ who: approval.owner, when: day(approval.publishedAt) }}
                  components={mono}
                />
                <div>{t("apps.publicReviewBy", { review: day(approval.reviewAt) })}</div>
                <div>
                  {approval.expiresAt ? t("apps.publicUntil", { until: day(approval.expiresAt) }) : t("apps.publicNoEnd")}
                </div>
                {approval.reason ? <div>{t("apps.publicReason", { reason: approval.reason })}</div> : null}
                <div className="admin-console__hint">{t("apps.publicSoFarReplaced")}</div>
              </div>
            </div>
          ) : null}
        </div>

        <label className="admin-console__label" htmlFor="public-approve-expires">
          <span className="admin-console__label-text">{t("apps.publicExpiresLabel")}</span>
          <input
            id="public-approve-expires"
            type="date"
            value={expires}
            disabled={pending}
            onChange={(e) => setExpires(e.target.value)}
          />
        </label>
        <p className="admin-console__hint">{t("apps.publicExpiresHint")}</p>
        <label className="admin-console__label" htmlFor="public-approve-reason">
          <span className="admin-console__label-text">{t("apps.publicReasonLabel")}</span>
          <input
            id="public-approve-reason"
            type="text"
            value={reason}
            autoComplete="off"
            disabled={pending}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <p className="admin-console__hint">{t("apps.publicRecorded")}</p>

        {main ? (
          <div className="admin-console__warning">
            <p>
              <strong>{t("apps.publicMainRuleTitle")}</strong>
            </p>
            {rule ? (
              <>
                {/* The director's rule, whole and as it came. */}
                <p>{rule}</p>
                <label className="admin-console__checkbox">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    disabled={pending}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                  />
                  <span>{t("apps.publicMainRuleAcknowledge")}</span>
                </label>
              </>
            ) : (
              <p>{t("apps.publicMainRuleMissing")}</p>
            )}
          </div>
        ) : null}

        <label className="admin-console__label" htmlFor="public-approve-confirm">
          <span className="admin-console__label-text">
            <Trans i18nKey="apps.publicTypeToConfirm" values={values} components={mono} />
          </span>
          <input
            id="public-approve-confirm"
            type="text"
            value={typed}
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>

        {refusal ? (
          <div className="admin-console__error" role="alert">
            <p>
              <strong>{review ? t("apps.publicReviewRefused") : t("apps.publicApproveRefused")}</strong>
            </p>
            <p>{refusal}</p>
          </div>
        ) : null}

        <div className="admin-console__dialog-footer" role={pending ? "status" : undefined}>
          <button type="button" className="admin-console__btn admin-console__btn--quiet" disabled={pending} onClick={onClose}>
            {t("apps.cancel")}
          </button>
          <button type="submit" className="admin-console__btn admin-console__btn--danger-solid" disabled={!confirmed || pending}>
            {pending
              ? t("apps.publicSending")
              : review
                ? t("apps.publicReviewConfirm")
                : t("apps.publicApproveConfirm")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function AddressCell({ entry, app }: { entry: ExposureEntry; app: string }) {
  const { t } = useTranslation();
  return (
    <>
      {entry.host ? (
        <span className="admin-console__mono">{`https://${entry.host}`}</span>
      ) : (
        <span>{t("apps.publicNoAddress")}</span>
      )}
      {entry.mainAddress ? (
        <div>
          <span className="admin-console__badge admin-console__badge--info">{t("apps.publicMainAddress")}</span>
        </div>
      ) : null}
      <div className="admin-console__hint">
        {entry.install === app ? (
          <Trans i18nKey="apps.publicEntry" values={{ entry: entry.exposureName }} components={mono} />
        ) : (
          <Trans
            i18nKey="apps.publicEntryOfAddon"
            values={{ entry: entry.exposureName, addon: entry.install }}
            components={mono}
          />
        )}
      </div>
      {/* Why it has no address: the director's own words. */}
      {!entry.host && entry.note && entry.state !== "unmatched" ? (
        <div className="admin-console__hint">{entry.note}</div>
      ) : null}
    </>
  );
}

function PathsCell({ entry }: { entry: ExposureEntry }) {
  const { t } = useTranslation();
  const paths = entry.paths ?? [];
  const denied = entry.denyPaths ?? [];
  if (paths.length === 0) return <span>{t("apps.publicNotKnown")}</span>;
  const whole = paths.includes("/");
  return (
    <>
      <span className="admin-console__mono">{paths.join("  ")}</span>
      <div className="admin-console__hint">
        {whole ? t("apps.publicWholeAddress") : t("apps.publicOnlyThese")}
      </div>
      {denied.length > 0 ? (
        <div className="admin-console__hint">
          <Trans i18nKey="apps.publicNeverPublished" values={{ paths: denied.join("  ") }} components={mono} />
        </div>
      ) : null}
    </>
  );
}

/** Who can reach the entry. The platform checks nobody at a public address. */
function signInOf(t: TFunction, entry: ExposureEntry) {
  if (!entry.authMode) return t("apps.publicNotKnown");
  if (entry.anyoneWithoutSignIn) return t("apps.publicAnyone");
  return t("apps.publicCheckedByApp", { mode: entry.authMode });
}

function StateCell({ entry }: { entry: ExposureEntry }) {
  const { t } = useTranslation();
  const approval = entry.approval;
  const approvedBy = approval ? (
    <div>
      <Trans
        i18nKey="apps.publicApprovedBy"
        values={{ who: approval.owner, when: day(approval.publishedAt) }}
        components={mono}
      />
    </div>
  ) : null;
  const reason = approval?.reason ? (
    <div className="admin-console__hint">{t("apps.publicReason", { reason: approval.reason })}</div>
  ) : null;

  switch (entry.state) {
    case "requested":
      return (
        <>
          <span className="admin-console__badge admin-console__badge--warn">{t("apps.publicRequested")}</span>
          <div>{t("apps.publicRequestedDetail")}</div>
        </>
      );
    case "approved":
      return (
        <>
          <span className="admin-console__badge admin-console__badge--ok">{t("apps.publicApproved")}</span>
          {approvedBy}
          <div>{t("apps.publicReviewBy", { review: day(approval?.reviewAt) })}</div>
          <div>
            {approval?.expiresAt
              ? t("apps.publicUntil", { until: day(approval.expiresAt) })
              : t("apps.publicNoEnd")}
          </div>
          {reason}
        </>
      );
    case "reviewDue":
      return (
        <>
          <span className="admin-console__badge admin-console__badge--warn">{t("apps.publicReviewDue")}</span>
          <div>{t("apps.publicReviewDueDetail", { review: day(approval?.reviewAt) })}</div>
          {approvedBy}
          <div>
            {approval?.expiresAt
              ? t("apps.publicUntil", { until: day(approval.expiresAt) })
              : t("apps.publicNoEnd")}
          </div>
          {reason}
        </>
      );
    case "expired":
      return (
        <>
          <span className="admin-console__badge admin-console__badge--danger">{t("apps.publicExpired")}</span>
          <div>{t("apps.publicExpiredDetail", { until: day(approval?.expiresAt) })}</div>
          {approvedBy}
          {reason}
        </>
      );
    case "unmatched":
      return (
        <>
          <span className="admin-console__badge admin-console__badge--warn">{t("apps.publicUnmatched")}</span>
          {/* The director's own words for why. */}
          {entry.note ? <div>{entry.note}</div> : null}
          {approvedBy}
        </>
      );
    default:
      // A state this screen does not know is shown as the director named it.
      return <span className="admin-console__mono">{entry.state}</span>;
  }
}

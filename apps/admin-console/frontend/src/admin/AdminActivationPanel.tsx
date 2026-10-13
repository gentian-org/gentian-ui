import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  activateTenantAdmin,
  fetchAdminInvitation,
  notThereYet,
  type AdminActivation,
  type AdminInvitation,
} from "@/api/cluster";
import "./admin.css";

/** How long a tenant the cluster does not have yet is waited for. */
const WAIT_LIMIT_MS = 15 * 60 * 1000;
/** How often the registrar is asked again while waiting. */
const ASK_AGAIN_MS = 10 * 1000;

/**
 * Hand a tenant's administrator account to its holder.
 *
 * The account has no password. The director issues a single-use, expiring
 * link that sets one -- and a second factor unless the tenant opts out --
 * mailed to the recovery address when one is given, otherwise shown here,
 * once. Nobody but its holder ever knows the password; issuing a link again
 * is how a locked-out administrator gets back in.
 *
 * A tenant is a commit before it is a tenant on the cluster. Until the
 * cluster has it, with its realm and its administrator account, the registrar
 * answers "not there yet" (see notThereYet). That is not an error and is not
 * shown as one: this says the tenant is being created, offers nothing to
 * press, and asks again until the registrar's answer is the activation. The
 * console reads no state of its own for this -- the registrar's answer is the
 * only one there is. Anything else it answers is a failure and is shown.
 *
 * A tenant created with a recovery address does not need any of that waiting:
 * the registrar has taken the invitation (`invited`) and mails it itself when
 * the tenant is ready. This then says so, says the page can be closed, and --
 * if it stays open -- asks the registrar what became of the invitation. When
 * it expired or could not be mailed, the activation is offered here by hand.
 */
export function AdminActivationPanel({
  tenant,
  initialEmail = "",
  auto = false,
  invited = false,
  notKept,
  onInvitationSettled,
  onWaiting,
  onClose,
}: {
  tenant: string;
  initialEmail?: string;
  /** Start straight away, as after creating the tenant. */
  auto?: boolean;
  /** The registrar holds the invitation and sends it; this only reports. */
  invited?: boolean;
  /** Why the registrar did not take the invitation, when this sends it instead. */
  notKept?: string;
  /** Told when the registrar's invitation is no longer pending. */
  onInvitationSettled?: () => void;
  /** Told whenever this starts or stops waiting for the cluster. */
  onWaiting?: (waiting: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(initialEmail);
  const [result, setResult] = useState<AdminActivation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A tenant just created is waited for from the start: until the registrar
  // has answered, nothing says the cluster has it.
  const [waiting, setWaiting] = useState(auto);
  const [gaveUp, setGaveUp] = useState(false);
  const [copied, setCopied] = useState(false);
  const started = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  // What the registrar says became of the invitation it holds. Pending until
  // it says otherwise: it accepted the request a moment ago.
  const [invitation, setInvitation] = useState<AdminInvitation | null>(
    invited ? { tenant, state: "pending" } : null,
  );
  const invitationTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!invited) return;
    let stopped = false;
    const look = () => {
      fetchAdminInvitation(tenant)
        .then((answer) => {
          if (stopped) return;
          setInvitation(answer);
          if (answer.state === "pending") {
            invitationTimer.current = window.setTimeout(look, ASK_AGAIN_MS);
          } else {
            onInvitationSettled?.();
          }
        })
        .catch(() => {
          // Not knowing is not news: the registrar sends it all the same.
          if (!stopped) invitationTimer.current = window.setTimeout(look, ASK_AGAIN_MS);
        });
    };
    invitationTimer.current = window.setTimeout(look, ASK_AGAIN_MS);
    return () => {
      stopped = true;
      window.clearTimeout(invitationTimer.current);
    };
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ask = () => {
    setBusy(true);
    setError(null);
    activateTenantAdmin(tenant, email.trim() || undefined)
      .then((answer) => {
        setWaiting(false);
        setResult(answer);
      })
      .catch((err: Error) => {
        if (notThereYet(err)) {
          if (Date.now() - started.current < WAIT_LIMIT_MS) {
            setWaiting(true);
            timer.current = window.setTimeout(ask, ASK_AGAIN_MS);
            return;
          }
          setWaiting(false);
          setGaveUp(true);
          return;
        }
        setWaiting(false);
        setError(err.message);
      })
      .finally(() => setBusy(false));
  };

  // Each time a person asks, the wait starts over.
  const start = () => {
    started.current = Date.now();
    setGaveUp(false);
    ask();
  };

  useEffect(() => {
    if (auto) start();
    return () => window.clearTimeout(timer.current);
    // Once, on opening: the address is the one the form was given.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onWaiting?.(waiting);
    return () => {
      if (waiting) onWaiting?.(false);
    };
    // Only a change of the state is news.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  const activation = result?.activation;
  // While the registrar holds the invitation, or has sent it, there is
  // nothing to ask for here. Afterwards the activation by hand is offered.
  const held = invitation?.state === "pending" || invitation?.state === "sent";
  const reason = invitation?.reason ?? "";
  const expires = activation?.expiresAt ? new Date(activation.expiresAt * 1000).toLocaleString() : "";

  return (
    <div className="admin-console__editor">
      <h3 className="admin-console__card-title">{t("tenants.activateTitle", { tenant })}</h3>

      {!result && invitation?.state === "pending" && (
        <>
          <p className="admin-console__success">
            <Trans
              i18nKey="tenants.invitationAccepted"
              values={{ tenant, email: initialEmail }}
              components={{ mono: <span className="admin-console__mono" /> }}
            />
          </p>
          <p className="admin-console__hint">{t("tenants.invitationWaiting")}</p>
          <div className="admin-console__editor-footer">
            <span />
            <button className="admin-console__btn admin-console__btn--quiet" type="button" onClick={onClose}>
              {t("tenants.close")}
            </button>
          </div>
        </>
      )}
      {!result && invitation?.state === "sent" && (
        <>
          <p className="admin-console__success">
            {initialEmail
              ? t("tenants.invitationSent", { email: initialEmail })
              : t("tenants.invitationSentNoAddress")}
          </p>
          <div className="admin-console__editor-footer">
            <span />
            <button className="admin-console__btn" type="button" onClick={onClose}>
              {t("tenants.close")}
            </button>
          </div>
        </>
      )}
      {!result && invitation?.state === "expired" && (
        <p className="admin-console__error">{t("tenants.invitationExpired", { tenant })}</p>
      )}
      {!result && invitation?.state === "not-mailed" && (
        <p className="admin-console__error">{t("tenants.invitationNotMailed", { tenant, reason })}</p>
      )}
      {!result && invitation?.state === "refused" && (
        <p className="admin-console__error">{t("tenants.invitationRefused", { reason })}</p>
      )}
      {!result && invitation?.state === "none" && (
        <p className="admin-console__hint">{t("tenants.invitationSuperseded")}</p>
      )}
      {!result && notKept && <p className="admin-console__error">{t("tenants.invitationNotKept", { reason: notKept })}</p>}

      {!result && !held && waiting && (
        <>
          <p className="admin-console__card-desc">
            <Trans
              i18nKey="tenants.notThereYet"
              values={{ tenant }}
              components={{ mono: <span className="admin-console__mono" /> }}
            />
          </p>
          <p className="admin-console__hint">{t("tenants.waitingForProvisioning")}</p>
          <div className="admin-console__editor-footer">
            <span />
            <button className="admin-console__btn admin-console__btn--quiet" type="button" onClick={onClose}>
              {t("tenants.close")}
            </button>
          </div>
        </>
      )}

      {!result && !held && !waiting && (
        <>
          <p className="admin-console__card-desc">{t("tenants.activateLead")}</p>
          <div className="admin-console__field-row">
            <div className="admin-console__field">
              <label htmlFor={`act-email-${tenant}`}>{t("tenants.recoveryEmail")}</label>
              <input
                id={`act-email-${tenant}`}
                type="email"
                value={email}
                placeholder={t("tenants.recoveryEmailPlaceholder")}
                disabled={busy}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="admin-console__hint">{t("tenants.recoveryEmailHint")}</p>
            </div>
            <div className="admin-console__field" />
          </div>
          {gaveUp && (
            <p className="admin-console__error">
              {t("tenants.stillNotThere", { tenant, minutes: WAIT_LIMIT_MS / 60000 })}
            </p>
          )}
          {error && <p className="admin-console__error">{error}</p>}
          <div className="admin-console__editor-footer">
            <button className="admin-console__btn admin-console__btn--quiet" type="button" onClick={onClose}>
              {t("tenants.close")}
            </button>
            <button
              className="admin-console__btn admin-console__btn--primary"
              type="button"
              disabled={busy}
              onClick={start}
            >
              {email.trim() ? t("tenants.sendActivation") : t("tenants.showActivationLink")}
            </button>
          </div>
        </>
      )}

      {activation?.mailed && (
        <>
          <p className="admin-console__success">
            {t("tenants.activationMailed", { user: result?.username, email: activation.email })}
          </p>
          <div className="admin-console__editor-footer">
            <span />
            <button className="admin-console__btn" type="button" onClick={onClose}>
              {t("tenants.close")}
            </button>
          </div>
        </>
      )}

      {activation && !activation.mailed && activation.mailError && (
        <p className="admin-console__hint">
          {t("tenants.activationNotMailed", { email: activation.email ?? "", reason: activation.mailError })}
        </p>
      )}
      {activation && !activation.mailed && activation.link && (
        <>
          <p className="admin-console__card-desc">{t("tenants.activationLinkLead", { user: result?.username })}</p>
          <div className="admin-console__email-input-wrapper">
            <input
              readOnly
              value={activation.link}
              aria-label={t("tenants.activationLink")}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              className="admin-console__btn"
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(activation.link ?? "").then(() => setCopied(true));
              }}
            >
              {copied ? t("tenants.copied") : t("tenants.copy")}
            </button>
          </div>
          <p className="admin-console__hint">
            {t("tenants.activationLinkHint", { expires })}
          </p>
          <div className="admin-console__editor-footer">
            <span />
            <button className="admin-console__btn" type="button" onClick={onClose}>
              {t("tenants.close")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

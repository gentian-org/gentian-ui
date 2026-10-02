import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { activateTenantAdmin, type AdminActivation } from "@/api/cluster";
import "./admin.css";

/** How long a just-created tenant is waited for before giving up. */
const WAIT_LIMIT_MS = 15 * 60 * 1000;

/**
 * Hand a tenant's administrator account to its holder.
 *
 * The account has no password. The director issues a single-use, expiring
 * link that sets one -- and a second factor unless the tenant opts out --
 * mailed to the recovery address when one is given, otherwise shown here,
 * once. Nobody but its holder ever knows the password; issuing a link again
 * is how a locked-out administrator gets back in.
 *
 * Right after a tenant is created its realm and account do not exist yet, so
 * in that case this waits and tries again until they do.
 */
export function AdminActivationPanel({
  tenant,
  initialEmail = "",
  auto = false,
  onClose,
}: {
  tenant: string;
  initialEmail?: string;
  /** Start straight away and wait out provisioning, as after creating it. */
  auto?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(initialEmail);
  const [result, setResult] = useState<AdminActivation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [copied, setCopied] = useState(false);
  const started = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const run = (wait: boolean) => {
    if (!started.current) started.current = Date.now();
    setBusy(true);
    setError(null);
    activateTenantAdmin(tenant, email.trim() || undefined)
      .then((answer) => {
        setWaiting(false);
        setResult(answer);
      })
      .catch((err: Error) => {
        const provisioning = /still being provisioned/i.test(err.message);
        if (wait && provisioning && Date.now() - started.current < WAIT_LIMIT_MS) {
          setWaiting(true);
          timer.current = window.setTimeout(() => run(true), 10000);
          return;
        }
        setWaiting(false);
        setError(err.message);
      })
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    if (auto) run(true);
    return () => window.clearTimeout(timer.current);
    // Once, on opening: the address is the one the form was given.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activation = result?.activation;
  const expires = activation?.expiresAt ? new Date(activation.expiresAt * 1000).toLocaleString() : "";

  return (
    <div className="admin-console__editor">
      <h3 className="admin-console__card-title">{t("tenants.activateTitle", { tenant })}</h3>

      {!result && (
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
                disabled={busy || waiting}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="admin-console__hint">{t("tenants.recoveryEmailHint")}</p>
            </div>
            <div className="admin-console__field" />
          </div>
          {waiting && <p className="admin-console__hint">{t("tenants.waitingForProvisioning")}</p>}
          {error && <p className="admin-console__error">{error}</p>}
          <div className="admin-console__editor-footer">
            <button className="admin-console__btn admin-console__btn--quiet" type="button" onClick={onClose}>
              {t("tenants.close")}
            </button>
            <button
              className="admin-console__btn admin-console__btn--primary"
              type="button"
              disabled={busy || waiting}
              onClick={() => run(false)}
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

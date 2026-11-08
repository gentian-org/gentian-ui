import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import "./admin.css";

export type RetireMode = "retire" | "purge";

/**
 * Retiring or purging one tenant, behind its name typed out.
 *
 * Two outcomes, chosen here rather than by a deletion policy someone set
 * months ago: retire takes the tenant off the cluster and keeps its data, so
 * re-adding the manifest brings it back; purge deletes the data with it, and
 * nothing brings that back. Typing the name is the confirmation because a
 * click is too easy to make on the wrong row.
 *
 * A native modal dialog: it holds focus, Escape closes it, and the page
 * behind it cannot be clicked.
 */
export function RetireTenantDialog({
  tenant,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  tenant: string;
  pending: boolean;
  error?: string;
  onConfirm: (mode: RetireMode, options: { keepBundles: boolean }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<RetireMode>("retire");
  const [keepBundles, setKeepBundles] = useState(false);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  const confirmed = typed.trim() === tenant;

  const card = (value: RetireMode, title: string, body: string) => (
    <label className={`admin-console__choice${mode === value ? " admin-console__choice--selected" : ""}`}>
      <input type="radio" name="retire-mode" checked={mode === value} onChange={() => setMode(value)} />
      <span>
        <span className="admin-console__choice-title">{title}</span>
        <span className="admin-console__choice-desc">{body}</span>
      </span>
    </label>
  );

  return (
    <dialog
      ref={ref}
      className="admin-console__dialog"
      aria-labelledby="retire-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onClose();
      }}
    >
      <form
        className="admin-console__dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (confirmed && !pending) onConfirm(mode, { keepBundles: mode === "purge" && keepBundles });
        }}
      >
        <h3 id="retire-title" className="admin-console__dialog-title">
          <Trans
            i18nKey="tenants.dialogTitle"
            values={{ tenant }}
            components={{ mono: <span className="admin-console__mono" /> }}
          />
        </h3>

        <div className="admin-console__choices">
          {card("retire", t("tenants.modeRetire"), t("tenants.modeRetireBody"))}
          {card("purge", t("tenants.modePurge"), t("tenants.modePurgeBody"))}
        </div>

        {mode === "purge" && (
          <label className="admin-console__choice">
            <input type="checkbox" checked={keepBundles} onChange={(e) => setKeepBundles(e.target.checked)} />
            <span>
              <span className="admin-console__choice-title">{t("tenants.keepBundles")}</span>
              <span className="admin-console__choice-desc">{t("tenants.keepBundlesBody")}</span>
            </span>
          </label>
        )}

        <label className="admin-console__label" htmlFor="retire-confirm">
          <span className="admin-console__label-text">
            <Trans
              i18nKey="tenants.typeToConfirm"
              values={{ tenant }}
              components={{ mono: <span className="admin-console__mono" /> }}
            />
          </span>
          <input
            id="retire-confirm"
            type="text"
            value={typed}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>

        {error ? <p className="admin-console__error">{error}</p> : null}

        <div className="admin-console__dialog-footer">
          <button type="button" className="admin-console__btn admin-console__btn--quiet" disabled={pending} onClick={onClose}>
            {t("tenants.cancel")}
          </button>
          <button type="submit" className="admin-console__btn admin-console__btn--danger-solid" disabled={!confirmed || pending}>
            {mode === "purge" ? t("tenants.purgeTenant") : t("tenants.retireTenant")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

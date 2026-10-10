/* SPDX-License-Identifier: Apache-2.0 */
/** Who can read a backup — the one control shared by every form that makes one.
 *
 * The platform's key, a key the person holds, or a passphrase. This console
 * makes no key: a key made here is a key it held, and it holds nothing. A
 * person makes theirs on their own machine (`age-keygen`) and gives the public
 * half, or uses again the one this workspace already has.
 *
 * The same radio-card pattern as the destination selector above it, so a form
 * asking two questions asks them the same way.
 */
import { useEffect, useState, type ReactNode } from "react";
import { fetchBackupKeyStatus, type BackupKeyStatus } from "@/api/admin";
import { Trans, useTranslation } from "react-i18next";

/** "passphrase" only appears where a human is present to type one — a schedule
 * has nobody at 03:00, so its form does not offer it. */
export type KeyChoice = "platform" | "existing" | "passphrase";

/** What the caller needs to build a request: the recipients, and whether the
 * choice is finished enough to submit. */
export type KeyDecision = {
  choice: KeyChoice;
  recipients: string[];
  ready: boolean;
};

export function useBackupKeyStatus(tenant: string) {
  const [status, setStatus] = useState<BackupKeyStatus | null>(null);
  useEffect(() => {
    let live = true;
    fetchBackupKeyStatus().then(
      (s) => live && setStatus(s),
      // A workspace with no key, or a custodian that is not reachable,
      // both mean "cannot offer the existing key" — not an error worth showing
      // in front of a backup form.
      () => live && setStatus({ exists: false, recipient: "", setBy: "", updatedAt: "" }),
    );
    return () => {
      live = false;
    };
  }, [tenant]);
  return status;
}

export function BackupKeyChoice({
  tenant,
  choice,
  onChoiceChange,
  onDecision,
  idPrefix,
  passphrase,
}: {
  tenant: string;
  choice: KeyChoice;
  onChoiceChange: (next: KeyChoice) => void;
  onDecision: (d: KeyDecision) => void;
  /** Radio groups must not collide when two forms are open on one page. */
  idPrefix: string;
  /** The passphrase card and its inputs, for forms that offer that mode.
   * Supplied by the caller because the passphrase itself never belongs to this
   * control — it goes in a Secret, not in a recipients list. */
  passphrase?: { body: string; fields: ReactNode; ready: boolean };
}) {
  const { t } = useTranslation();

  const status = useBackupKeyStatus(tenant);
  const [pasted, setPasted] = useState("");

  // Everything the parent needs, derived in one place so a form cannot disagree
  // with the control about what was chosen.
  useEffect(() => {
    if (choice === "platform") {
      onDecision({ choice, recipients: [], ready: true });
      return;
    }
    if (choice === "passphrase") {
      onDecision({ choice, recipients: [], ready: passphrase?.ready ?? false });
      return;
    }
    const typed = pasted.trim();
    const r = typed ? [typed] : status?.recipient ? [status.recipient] : [];
    onDecision({ choice, recipients: r, ready: r.length > 0 });
  }, [choice, pasted, status, passphrase?.ready, onDecision]);

  const card = (value: KeyChoice, title: string, body: string) => (
    <label
      className={`admin-console__choice${choice === value ? " admin-console__choice--selected" : ""}`}
    >
      <input
        type="radio"
        name={`${idPrefix}-key`}
        checked={choice === value}
        onChange={() => onChoiceChange(value)}
      />
      <span>
        <span className="admin-console__choice-title">{title}</span>
        <span className="admin-console__choice-desc">{body}</span>
      </span>
    </label>
  );

  return (
    <fieldset className="admin-console__fieldset admin-console__fieldset--plain">
      <legend>{t("backupKey.whoCanReadIt")}</legend>

      <div className="admin-console__choices">
        {card("platform", t("backupKey.platformKey"), t("backupKey.platformKeyBody"))}
        {status?.exists
          ? card(
              "existing",
              t("backupKey.existingKey"),
              status.setBy
                ? t("backupKey.existingKeyBodyBy", { who: status.setBy })
                : t("backupKey.existingKeyBody"),
            )
          : card("existing", t("backupKey.ownKey"), t("backupKey.ownKeyBody"))}
        {passphrase && card("passphrase", t("backupKey.myPassphrase"), passphrase.body)}
      </div>

      {choice === "passphrase" && passphrase && (
        <div className="admin-console__stack admin-console__stack--indent">{passphrase.fields}</div>
      )}

      {choice === "existing" && (
        <div className="admin-console__stack">
          {status?.exists && status.recipient && !pasted && (
            <p className="admin-console__hint">
              {t("backupKey.using")}<code className="admin-console__wrap">{status.recipient}</code>
            </p>
          )}
          {status?.exists && !status.recipient && (
            <p className="admin-console__warning">
              {t("backupKey.aKeyIsEscrowedFor")}</p>
          )}
          <label className="admin-console__label">
            <span className="admin-console__label-text">
              {t(status?.exists ? "backupKey.orADifferentKey" : "backupKey.yourPublicKey")}
            </span>
            <textarea
              rows={2}
              spellCheck={false}
              placeholder={t("backupKey.age1")}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <span className="admin-console__hint">
              <Trans i18nKey="backupKey.pasteHint" components={{ code: <code /> }} />
            </span>
          </label>
        </div>
      )}
    </fieldset>
  );
}

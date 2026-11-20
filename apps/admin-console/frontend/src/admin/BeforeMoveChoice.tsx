/* SPDX-License-Identifier: Apache-2.0 */
/**
 * What is exported before an app moves to a newer build: the tenant's backup
 * policy's beforeMove (gentian-os docs/concepts/versioning.md §5). The only
 * part of the backup policy this console sets; its destinations and keys are
 * the Operations Console's.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchBackupPolicy, setBeforeMove, type BeforeMove } from "@/api/admin";
import "./admin.css";

const MODES: BeforeMove[] = ["tenant", "app", "none"];

type BeforeMoveChoiceProps = {
  tenant: string;
};

export function BeforeMoveChoice({ tenant }: BeforeMoveChoiceProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const policyQuery = useQuery({
    queryKey: ["admin", "backup-policy", tenant],
    queryFn: () => fetchBackupPolicy(tenant),
  });

  const mutation = useMutation({
    mutationFn: (mode: BeforeMove | "") => setBeforeMove(mode, tenant),
    onSuccess: async () => {
      setError(null);
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ["admin", "backup-policy", tenant] });
    },
    onError: (err: Error) => {
      setSaved(false);
      setError(err.message);
    },
  });

  const policy = policyQuery.data;
  if (!policy) {
    return null;
  }
  const locked = !policy.allowTenantOverride;
  const current = policy.effectiveBeforeMove;
  const inherited = locked || !policy.beforeMove;

  return (
    <fieldset className="admin-console__fieldset admin-console__fieldset--plain">
      <legend>{t("beforeMove.title")}</legend>
      <p className="admin-console__hint">{t("beforeMove.lead")}</p>
      {MODES.map((mode) => (
        <label
          key={mode}
          className={`admin-console__choice${current === mode ? " admin-console__choice--selected" : ""}`}
        >
          <input
            type="radio"
            name="before-move"
            checked={current === mode}
            disabled={locked || mutation.isPending}
            onChange={() => mutation.mutate(mode)}
          />
          <span>
            <span className="admin-console__choice-title">{t(`beforeMove.${mode}Title`)}</span>
            <span className="admin-console__choice-desc">{t(`beforeMove.${mode}Body`)}</span>
          </span>
        </label>
      ))}
      {locked ? (
        <p className="admin-console__hint">{t("beforeMove.locked")}</p>
      ) : inherited ? (
        <p className="admin-console__hint">{t("beforeMove.inherited")}</p>
      ) : (
        <button
          type="button"
          className="admin-console__btn"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate("")}
        >
          {t("beforeMove.useCluster")}
        </button>
      )}
      {saved && !error && <p className="admin-console__success">{t("beforeMove.saved")}</p>}
      {error && <p className="admin-console__error">{error}</p>}
    </fieldset>
  );
}

/* SPDX-License-Identifier: Apache-2.0 */
/**
 * One export, now, to the cluster's own storage, encrypted to a key the
 * tenant chooses, and downloaded as one file -- the tenant's way to take their
 * data with them (gentian-os docs/concepts/data-ownership.md §2). Only the
 * exports a person started are listed: backups, their schedules and their
 * recovery are the Operations Console's.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  backupIsTerminal,
  createBackup,
  deleteBackup,
  fetchBackups,
  type Backup,
  type BackupCreateBody,
} from "@/api/admin";
import { BackupKeyChoice, type KeyChoice, type KeyDecision } from "@/admin/BackupKeyChoice";
import "./admin.css";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "@/lib/format";

type ExportSectionProps = {
  tenant: string;
};

const POLL_MS = 5000;

function exportName(): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-").toLowerCase();
  return `export-${stamp}`;
}

/** The phase color: an export is fine, working, or broken — nothing in between. */
function phaseBadgeClass(phase: string): string {
  if (phase === "Ready") {
    return "admin-console__badge admin-console__badge--ok";
  }
  if (phase === "Failed") {
    return "admin-console__badge admin-console__badge--danger";
  }
  return "admin-console__badge admin-console__badge--info";
}

export function ExportSection({ tenant }: ExportSectionProps) {
  const { t } = useTranslation();

  const queryClient = useQueryClient();
  const [keyChoice, setKeyChoice] = useState<KeyChoice>("platform");
  const [keyDecision, setKeyDecision] = useState<KeyDecision>({
    choice: "platform",
    recipients: [],
    ready: true,
  });
  const mode: "recipient" | "passphrase" = keyChoice === "passphrase" ? "passphrase" : "recipient";
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Names whose deletion was accepted but whose card is still in the list:
  // the operator holds a deleted export until its bundle is gone from
  // storage, so the entry lingers for a few seconds after the DELETE call.
  const [deleting, setDeleting] = useState<string[]>([]);

  const backupsQuery = useQuery({
    queryKey: ["admin", "backups", tenant],
    queryFn: () => fetchBackups(tenant),
    // Poll only while something can still change on its own — a running
    // export, or one whose deletion is still being carried out.
    refetchInterval: (query) => {
      const data = query.state.data as Backup[] | undefined;
      if (!data || deleting.length > 0) {
        return POLL_MS;
      }
      return data.some((backup) => !backup.schedule && !backupIsTerminal(backup)) ? POLL_MS : false;
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: BackupCreateBody) => createBackup(body, tenant),
    onSuccess: async (created) => {
      setError(null);
      setSuccess(
        mode === "passphrase"
          ? `Export ${created.name} started. Keep the passphrase safe — without it nobody can open this bundle, including support.`
          : `Export ${created.name} started.`,
      );
      setPassphrase("");
      setConfirmPassphrase("");
      await queryClient.invalidateQueries({ queryKey: ["admin", "backups", tenant] });
    },
    onError: (err: Error) => {
      setSuccess(null);
      setError(err.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (vars: { name: string; force: boolean }) =>
      deleteBackup(vars.name, tenant, { force: vars.force }),
    onSuccess: async (_result, vars) => {
      setError(null);
      setSuccess(`Deleting ${vars.name}.`);
      setDeleting((prev) => (prev.includes(vars.name) ? prev : [...prev, vars.name]));
      await queryClient.invalidateQueries({ queryKey: ["admin", "backups", tenant] });
    },
    onError: (err: Error) => {
      setSuccess(null);
      setError(err.message);
    },
  });

  const exports = (backupsQuery.data ?? []).filter((backup) => !backup.schedule);
  const running = exports.filter((backup) => !backupIsTerminal(backup));

  useEffect(() => {
    setDeleting((prev) => {
      const kept = prev.filter((name) => exports.some((backup) => backup.name === name));
      return kept.length === prev.length ? prev : kept;
    });
  }, [exports]);

  function confirmDelete(backup: Backup) {
    const terminal = backupIsTerminal(backup);
    const question = terminal
      ? `Delete the export "${backup.name}"? This cannot be undone.`
      : `Abort the running export "${backup.name}"? Paused apps are resumed.`;
    if (window.confirm(question)) {
      deleteMutation.mutate({ name: backup.name, force: !terminal });
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (mode === "passphrase") {
      if (passphrase.length < 12) {
        setError(t("backup.passphraseTooShort"));
        return;
      }
      if (passphrase !== confirmPassphrase) {
        setError(t("backup.passphrasesDiffer"));
        return;
      }
    }

    // A key choice that was started and not finished — "a key I already
    // have" with nothing pasted — would otherwise submit as the platform key,
    // quietly giving the export to exactly the reader the choice was made to
    // exclude.
    if (!keyDecision.ready) {
      setError(t("backup.enterPublicKey"));
      return;
    }

    createMutation.mutate({
      name: exportName(),
      apps: [],
      encryption:
        mode === "passphrase"
          ? { mode, passphrase }
          : { mode, recipients: keyDecision.recipients },
      // The cluster's own storage, always: an export is staged there and
      // downloaded from there.
      destination: { mode: "platform" as const },
    });
  }

  return (
    <section>
      <header className="admin-console__section-head">
        <div>
          <h2 className="admin-console__section-title">{t("export.title")}</h2>
          <p className="admin-console__lead">{t("export.lead")}</p>
        </div>
      </header>

      {error && <p className="admin-console__error">{error}</p>}
      {success && <p className="admin-console__success">{success}</p>}

      <form className="admin-console__form admin-console__form--plain" onSubmit={submit}>
        <BackupKeyChoice
          tenant={tenant}
          idPrefix="manual-backup"
          choice={keyChoice}
          onChoiceChange={setKeyChoice}
          onDecision={setKeyDecision}
          passphrase={{
            body: t("backup.passphraseBody"),
            ready: passphrase.length >= 12 && passphrase === confirmPassphrase,
            fields: (
              <>
              <label className="admin-console__label">
                <span className="admin-console__label-text">{t("backup.passphrase")}</span>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  minLength={12}
                  autoComplete="new-password"
                  required
                />
              </label>
              <label className="admin-console__label">
                <span className="admin-console__label-text">{t("backup.confirmPassphrase")}</span>
                <input
                  type="password"
                  value={confirmPassphrase}
                  onChange={(event) => setConfirmPassphrase(event.target.value)}
                  minLength={12}
                  autoComplete="new-password"
                  required
                />
              </label>
              </>
            ),
          }}
        />

        <div className="admin-console__submit">
          <button
            type="submit"
            className="admin-console__btn admin-console__btn--primary"
            disabled={createMutation.isPending || running.length > 0}
          >
            {t(createMutation.isPending ? "backup.starting" : "backup.startExport")}
          </button>
          {running.length > 0 && (
            <p className="admin-console__hint">{t("backup.anExportIsAlreadyRunning")}</p>
          )}
        </div>
      </form>

      {exports.length > 0 && (
        <div className="admin-console__cards">
          {exports.map((backup) => (
            <article key={backup.name} className="admin-console__card">
              <div className="admin-console__card-main">
                <div className="admin-console__card-title">
                  <span className="admin-console__mono">{backup.name}</span>
                  <span className={phaseBadgeClass(backup.phase)}>
                    {backup.phase || t("backup.pending")}
                  </span>
                </div>
                {backup.phase === "Failed" && backup.message && (
                  <p className="admin-console__card-desc">{backup.message}</p>
                )}
              </div>

              <div className="admin-console__card-aside admin-console__card-aside--top admin-console__hint">
                {formatDateTime(backup.completedAt ?? backup.startedAt ?? backup.createdAt)}
                {backup.phase === "Ready" && (
                  // A plain link, not a fetch: the bundle can be gigabytes and
                  // the browser's own download handles that; the session
                  // cookie the edge set is what authorizes it.
                  <a
                    className="admin-console__btn admin-console__btn--primary"
                    href={`/api/v1/admin/backups/${encodeURIComponent(backup.name)}/download?tenant=${encodeURIComponent(tenant)}`}
                    download={`${tenant}-${backup.name}.gentian`}
                  >
                    {t("export.download")}
                  </a>
                )}
                <button
                  type="button"
                  className="admin-console__btn admin-console__btn--danger"
                  disabled={deleting.includes(backup.name) || deleteMutation.isPending}
                  onClick={() => confirmDelete(backup)}
                >
                  {deleting.includes(backup.name)
                    ? "Deleting…"
                    : backupIsTerminal(backup)
                      ? "Delete"
                      : "Abort"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

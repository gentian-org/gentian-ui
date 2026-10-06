/* SPDX-License-Identifier: Apache-2.0 */
/**
 * One export, now, to the cluster's own storage, encrypted to a key the
 * tenant chooses -- the sovereign half of backup (sovereignty-concept.md §3).
 * Scheduled backups, destinations and recovery are the Operations Console's;
 * this screen promotes it beside the list.
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
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";

type BackupSectionProps = {
  tenant: string;
};

const POLL_MS = 5000;

function defaultName(): string {
  // Date-stamped, because a list of exports is only useful if you can tell at
  // a glance which one is which.
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-").toLowerCase();
  return `export-${stamp}`;
}

function pauseWindow(app: Backup["apps"][number], t: TFunction): string {
  if (!app.quiesceStart) {
    return "—";
  }
  if (!app.quiesceEnd) {
    return t("backup.pausedNow");
  }
  const seconds = Math.max(
    0,
    Math.round((Date.parse(app.quiesceEnd) - Date.parse(app.quiesceStart)) / 1000),
  );
  return `${seconds}s`;
}

function formatTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString();
}

/** The phase colour: an export is fine, working, or broken — nothing in between. */
function phaseBadgeClass(phase: string): string {
  if (phase === "Ready") {
    return "admin-console__badge admin-console__badge--ok";
  }
  if (phase === "Failed") {
    return "admin-console__badge admin-console__badge--danger";
  }
  return "admin-console__badge admin-console__badge--info";
}

export function ExportSection({ tenant }: BackupSectionProps) {
  const { t } = useTranslation();

  const queryClient = useQueryClient();
  const [name, setName] = useState(defaultName);
  const [keyChoice, setKeyChoice] = useState<KeyChoice>("new");
  const [keyDecision, setKeyDecision] = useState<KeyDecision>({
    choice: "new",
    recipients: [],
    ready: false,
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
    // export, or one whose deletion is still being carried out. A finished
    // list that keeps refetching is load with no new information.
    refetchInterval: (query) => {
      const data = query.state.data as Backup[] | undefined;
      if (!data) {
        return POLL_MS;
      }
      if (deleting.length > 0) {
        return POLL_MS;
      }
      return data.some((backup) => !backupIsTerminal(backup)) ? POLL_MS : false;
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
      setName(defaultName());
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
      setSuccess(`Deleting ${vars.name} — the stored bundle is being removed.`);
      setDeleting((prev) => (prev.includes(vars.name) ? prev : [...prev, vars.name]));
      await queryClient.invalidateQueries({ queryKey: ["admin", "backups", tenant] });
    },
    onError: (err: Error) => {
      setSuccess(null);
      setError(err.message);
    },
  });

  const backups = backupsQuery.data ?? [];
  const running = backups.filter((backup) => !backupIsTerminal(backup));

  useEffect(() => {
    setDeleting((prev) => {
      const kept = prev.filter((name) => backups.some((backup) => backup.name === name));
      return kept.length === prev.length ? prev : kept;
    });
  }, [backups]);

  function confirmDelete(backup: Backup) {
    const terminal = backupIsTerminal(backup);
    const question = terminal
      ? `Delete backup "${backup.name}"? Its stored bundle is removed from object storage. This cannot be undone.`
      : `Abort the running backup "${backup.name}"? Paused apps are resumed, and anything captured so far is removed.`;
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

    // A key choice that was started and not finished — "a new key" with nothing
    // generated yet, or "a key I already have" with nothing pasted — would
    // otherwise submit as the platform key, quietly giving the backup to
    // exactly the reader the choice was made to exclude.
    if (!keyDecision.ready) {
      setError(
        t(
          keyDecision.choice === "new"
            ? "backup.generateKeyFirst"
            : "backup.enterPublicKey",
        ),
      );
      return;
    }

    createMutation.mutate({
      name,
      apps: [],
      encryption:
        mode === "passphrase"
          ? { mode, passphrase }
          : { mode, recipients: keyDecision.recipients },
      // The cluster's own storage, always: an export is staged there and
      // fetched from there. Where scheduled backups go is the Operations
      // Console's policy, not this form's.
      destination: { mode: "platform" as const },
    });
  }

  return (
    <section>
      <header className="admin-console__section-head">
        <div>
          <h2 className="admin-console__section-title">{t("export.title")}</h2>
          <p className="admin-console__lead">
            {t("export.lead")}</p>
        </div>
        <button
          type="button"
          className="admin-console__btn"
          onClick={() => void backupsQuery.refetch()}
        >
          {t("backup.refresh")}</button>
      </header>

      {error && <p className="admin-console__error">{error}</p>}
      {success && <p className="admin-console__success">{success}</p>}

      <form className="admin-console__form admin-console__form--plain" onSubmit={submit}>
        <div className="admin-console__stack">
          <label className="admin-console__label">
            <span className="admin-console__label-text">{t("backup.name")}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("backup.export20260818")}
              required
            />
          </label>
        </div>

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
            <p className="admin-console__hint">
              {t("backup.anExportIsAlreadyRunning")}</p>
          )}
        </div>
      </form>

      <div className="admin-console__subsection">
        <h3 className="admin-console__subsection-title">{t("backup.history")}</h3>

        {backupsQuery.isLoading && <p className="admin-console__loading">{t("backup.loading")}</p>}

        {!backupsQuery.isLoading && backups.length === 0 && (
          <p className="admin-console__empty">{t("backup.noExportsYet")}</p>
        )}

        <div className="admin-console__cards">
          {backups.map((backup) => (
            <article key={backup.name} className="admin-console__card">
              <div className="admin-console__card-main">
                <div className="admin-console__card-title">
                  <span className="admin-console__mono">{backup.name}</span>
                  <span className={phaseBadgeClass(backup.phase)}>
                    {backup.phase || t("backup.pending")}
                  </span>
                  <span className="admin-console__badge">
                    {t(backup.encryptionMode === "passphrase" ? "backup.yourPassphrase" : "backup.platformKey")}
                  </span>
                </div>

                {backup.message && (
                  <p className="admin-console__card-desc">{backup.message}</p>
                )}

                {backup.phase === "Ready" && !backup.platformReadable && (
                  <p className="admin-console__card-desc">
                    {t("backup.onlyYouCanOpenThis")}</p>
                )}

                {backup.bundlePrefix && (
                  <p className="admin-console__card-meta">
                    <code>
                      {backup.bundleBucket}/{backup.bundlePrefix}
                    </code>
                  </p>
                )}
              </div>

              <div className="admin-console__card-aside admin-console__card-aside--top admin-console__hint">
                {formatTime(backup.completedAt ?? backup.startedAt ?? backup.createdAt)}
                {backup.phase === "Ready" && (
                  // A plain link, not a fetch: the bundle can be gigabytes and
                  // the browser's own download handles that; the session
                  // cookie the edge set is what authorises it.
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

              {(backup.quiesced.length > 0 || backup.apps.length > 0 ||
                backup.phase === "Ready") && (
                <div className="admin-console__card-footer">
                  {backup.quiesced.length > 0 && (
                    <p className="admin-console__warning">
                      {t("backup.pausedRightNow", { apps: backup.quiesced.join(", ") })}
                    </p>
                  )}

                  {backup.apps.length > 0 && (
                    <div className="admin-console__table-wrap">
                      <table className="admin-console__table">
                        <thead>
                          <tr>
                            <th>{t("backup.app")}</th>
                            <th>{t("backup.state")}</th>
                            <th>{t("backup.captured")}</th>
                            <th>{t("backup.pausedFor")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {backup.apps.map((app) => (
                            <tr key={app.name}>
                              <td>{app.name}</td>
                              <td>
                                {app.phase || "Pending"}
                                {app.message && (
                                  <span className="admin-console__hint"> — {app.message}</span>
                                )}
                              </td>
                              <td>{app.stores.length > 0 ? app.stores.join(", ") : "—"}</td>
                              <td>{pauseWindow(app, t)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {backup.phase === "Ready" && (
                    <p className="admin-console__hint">
                      <Trans i18nKey="backup.bundleStays" components={{ code: <code /> }} />
                    </p>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

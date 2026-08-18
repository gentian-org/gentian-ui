import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  backupIsTerminal,
  createBackup,
  fetchBackups,
  type Backup,
  type BackupCreateBody,
} from "@/api/admin";
import "./admin.css";

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

function pauseWindow(app: Backup["apps"][number]): string {
  if (!app.quiesceStart) {
    return "—";
  }
  if (!app.quiesceEnd) {
    return "paused now";
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

export function BackupSection({ tenant }: BackupSectionProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(defaultName);
  const [mode, setMode] = useState<"recipient" | "passphrase">("recipient");
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const backupsQuery = useQuery({
    queryKey: ["admin", "backups", tenant],
    queryFn: () => fetchBackups(tenant),
    // Poll only while something can still change on its own. A finished list
    // that keeps refetching is load with no new information.
    refetchInterval: (query) => {
      const data = query.state.data as Backup[] | undefined;
      if (!data) {
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

  const backups = backupsQuery.data ?? [];
  const running = backups.filter((backup) => !backupIsTerminal(backup));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (mode === "passphrase") {
      if (passphrase.length < 12) {
        setError("Use a passphrase of at least 12 characters.");
        return;
      }
      if (passphrase !== confirmPassphrase) {
        setError("The passphrases do not match.");
        return;
      }
    }

    createMutation.mutate({
      name,
      apps: [],
      encryption: mode === "passphrase" ? { mode, passphrase } : { mode },
    });
  }

  return (
    <section>
      <div className="admin-console__toolbar">
        <h2 className="admin-console__title" style={{ fontSize: "1.125rem" }}>
          Backup
        </h2>
        <button
          type="button"
          className="admin-console__btn"
          onClick={() => backupsQuery.refetch()}
        >
          Refresh
        </button>
      </div>

      <p style={{ fontSize: "0.875rem", color: "var(--gtn-ink-4)", marginBottom: "1rem" }}>
        An export captures this workspace — app databases, files and member accounts — into one
        encrypted bundle. Apps are paused one at a time while each is captured, so every app's data
        is internally consistent; the rest keep running.
      </p>

      {error && <p className="admin-console__error">{error}</p>}
      {success && <p className="admin-console__success">{success}</p>}

      <form onSubmit={submit} style={{ marginBottom: "1.5rem" }}>
        <label style={{ display: "block", fontSize: "0.875rem", marginBottom: "0.75rem" }}>
          <span style={{ display: "block", marginBottom: "0.25rem" }}>Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="export-2026-08-18"
            required
          />
        </label>

        <fieldset style={{ border: "none", padding: 0, margin: "0 0 0.75rem" }}>
          <legend style={{ fontSize: "0.875rem", marginBottom: "0.5rem" }}>Encryption</legend>

          <label
            style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start", marginBottom: "0.5rem" }}
          >
            <input
              type="radio"
              name="encryption-mode"
              checked={mode === "recipient"}
              onChange={() => setMode("recipient")}
            />
            <span style={{ fontSize: "0.875rem" }}>
              <strong>Platform key</strong>
              <br />
              <span style={{ color: "var(--gtn-ink-4)" }}>
                Encrypted to the platform's backup key, so support can help you restore it. Use this
                for routine and scheduled backups.
              </span>
            </span>
          </label>

          <label style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
            <input
              type="radio"
              name="encryption-mode"
              checked={mode === "passphrase"}
              onChange={() => setMode("passphrase")}
            />
            <span style={{ fontSize: "0.875rem" }}>
              <strong>My passphrase</strong>
              <br />
              <span style={{ color: "var(--gtn-ink-4)" }}>
                Encrypted so only you can open it — not the platform, not support. If the passphrase
                is lost, the bundle cannot be recovered by anyone.
              </span>
            </span>
          </label>

          {mode === "passphrase" && (
            <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem", maxWidth: "24rem" }}>
              <label style={{ fontSize: "0.875rem" }}>
                <span style={{ display: "block", marginBottom: "0.25rem" }}>Passphrase</span>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  minLength={12}
                  autoComplete="new-password"
                  required
                />
              </label>
              <label style={{ fontSize: "0.875rem" }}>
                <span style={{ display: "block", marginBottom: "0.25rem" }}>Confirm passphrase</span>
                <input
                  type="password"
                  value={confirmPassphrase}
                  onChange={(event) => setConfirmPassphrase(event.target.value)}
                  minLength={12}
                  autoComplete="new-password"
                  required
                />
              </label>
            </div>
          )}
        </fieldset>

        <button
          type="submit"
          className="admin-console__btn"
          disabled={createMutation.isPending || running.length > 0}
        >
          {createMutation.isPending ? "Starting…" : "Start export"}
        </button>
        {running.length > 0 && (
          <p style={{ fontSize: "0.8125rem", color: "var(--gtn-ink-4)", marginTop: "0.5rem" }}>
            An export is already running. Only one runs at a time, so no app is paused by two at
            once.
          </p>
        )}
      </form>

      <h3 className="admin-console__title" style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
        History
      </h3>

      {backupsQuery.isLoading && <p style={{ fontSize: "0.875rem" }}>Loading…</p>}
      {!backupsQuery.isLoading && backups.length === 0 && (
        <p style={{ fontSize: "0.875rem" }}>No exports yet.</p>
      )}

      {backups.map((backup) => (
        <div key={backup.name} style={{ marginBottom: "1.5rem" }}>
          <div className="admin-console__toolbar">
            <h4 className="admin-console__title" style={{ fontSize: "0.9375rem" }}>
              {backup.name} — {backup.phase || "Pending"}
            </h4>
            <span style={{ fontSize: "0.8125rem", color: "var(--gtn-ink-4)" }}>
              {formatTime(backup.completedAt ?? backup.startedAt ?? backup.createdAt)}
            </span>
          </div>

          {backup.message && (
            <p style={{ fontSize: "0.8125rem", color: "var(--gtn-ink-4)" }}>{backup.message}</p>
          )}

          {backup.quiesced.length > 0 && (
            <p className="admin-console__error">
              Paused right now: {backup.quiesced.join(", ")}. These apps stay offline until this
              export finishes.
            </p>
          )}

          <p style={{ fontSize: "0.8125rem", marginBottom: "0.5rem" }}>
            {backup.encryptionMode === "passphrase" ? "Your passphrase" : "Platform key"}
            {backup.phase === "Ready" && !backup.platformReadable && " — only you can open this bundle"}
            {backup.bundlePrefix && (
              <>
                {" · "}
                <span className="admin-console__mono">
                  {backup.bundleBucket}/{backup.bundlePrefix}
                </span>
              </>
            )}
          </p>

          {backup.apps.length > 0 && (
            <table className="admin-console__table">
              <thead>
                <tr>
                  <th>App</th>
                  <th>State</th>
                  <th>Captured</th>
                  <th>Paused for</th>
                </tr>
              </thead>
              <tbody>
                {backup.apps.map((app) => (
                  <tr key={app.name}>
                    <td>{app.name}</td>
                    <td>
                      {app.phase || "Pending"}
                      {app.message && (
                        <span style={{ color: "var(--gtn-ink-4)" }}> — {app.message}</span>
                      )}
                    </td>
                    <td>{app.stores.length > 0 ? app.stores.join(", ") : "—"}</td>
                    <td>{pauseWindow(app)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {backup.phase === "Ready" && (
            <p style={{ fontSize: "0.8125rem", color: "var(--gtn-ink-4)", marginTop: "0.5rem" }}>
              The bundle stays in the platform's object storage at the location above.{" "}
              <span className="admin-console__mono">bundle-info.json</span> inside it is readable
              and names the exact command that decrypts the rest.
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

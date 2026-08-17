import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  deleteRepository,
  fetchCredentials,
  fetchRepositories,
  NeedsConfirmation,
  saveRepository,
  setCredential,
  type ConfirmationRequired,
  type CredentialStatus,
  type RepositoryInput,
  type RepositoryView,
} from "@/api/credentials";

/**
 * Credentials and repositories.
 *
 * Two rules this component exists inside, both enforced by the API rather than
 * here:
 *
 *   No credential value is ever rendered. The API cannot return one, so this
 *   shows whether a value exists, who set it and when — never the value. Lost
 *   credentials are rotated, not recovered, and the form says so.
 *
 *   The API decides what is dangerous. A 428 carries the reason and the string
 *   to retype; this renders that answer. Deciding it here as well would put the
 *   rules in two places, and the copy in the browser is the one an operator can
 *   skip.
 */
export function CredentialsSection() {
  const queryClient = useQueryClient();
  const credentialsQuery = useQuery({
    queryKey: ["admin", "credentials"],
    queryFn: fetchCredentials,
  });
  const repositoriesQuery = useQuery({
    queryKey: ["admin", "repositories"],
    queryFn: fetchRepositories,
  });

  if (credentialsQuery.isLoading) {
    return <p>Loading credentials…</p>;
  }
  if (credentialsQuery.isError) {
    return (
      <p className="admin-console__error">
        The credential manager is unavailable. Credentials cannot be read or supplied until it
        responds.
      </p>
    );
  }

  const credentials = credentialsQuery.data ?? [];
  const unsatisfied = credentials.filter((c) => !c.satisfied && !c.optional);

  return (
    <section className="admin-section">
      <h2 className="admin-section__title">Credentials</h2>
      <p className="admin-section__lead">
        Values are write-only. This shows whether a credential is present, who set it and when —
        never the value itself. A lost credential is rotated, not recovered.
      </p>

      {unsatisfied.length > 0 ? (
        <p className="admin-console__error" role="status">
          {unsatisfied.length} required credential{unsatisfied.length === 1 ? " is" : "s are"} not
          yet supplied.
        </p>
      ) : null}

      <ul className="admin-list">
        {credentials.map((credential) => (
          <CredentialRow
            key={credential.name}
            credential={credential}
            onSaved={() =>
              void queryClient.invalidateQueries({ queryKey: ["admin", "credentials"] })
            }
          />
        ))}
        {credentials.length === 0 ? (
          <li>No credentials are declared for your scope.</li>
        ) : null}
      </ul>

      <RepositoriesPanel
        repositories={repositoriesQuery.data ?? []}
        loading={repositoriesQuery.isLoading}
        onChanged={() => {
          void queryClient.invalidateQueries({ queryKey: ["admin", "repositories"] });
          void queryClient.invalidateQueries({ queryKey: ["admin", "credentials"] });
        }}
      />
    </section>
  );
}

function CredentialRow({
  credential,
  onSaved,
}: {
  credential: CredentialStatus;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationFn: (fields: Record<string, string>) => setCredential(credential.name, fields),
    onSuccess: () => {
      // Clear immediately: a submitted value has no reason to stay in component
      // state, where a later render could put it somewhere it does not belong.
      setValues({});
      setOpen(false);
      onSaved();
    },
  });

  return (
    <li className="admin-list__item">
      <div>
        <strong>{credential.displayName}</strong>{" "}
        <span className={credential.satisfied ? "badge badge--ok" : "badge badge--warn"}>
          {credential.satisfied ? "present" : credential.optional ? "not set" : "missing"}
        </span>
        {credential.tenant ? <span className="badge">tenant: {credential.tenant}</span> : null}
        {credential.description ? <p>{credential.description}</p> : null}
        {/* ESO's verdict, not a guess — a "missing" here means the value is
            genuinely absent from OpenBao rather than that something failed to
            start. */}
        {!credential.satisfied && credential.reason ? (
          <p className="admin-console__error">{credential.reason}</p>
        ) : null}
        {credential.setBy ? (
          <p>
            Set by {credential.setBy}
            {credential.updatedAt ? ` on ${new Date(credential.updatedAt).toLocaleString()}` : ""}
          </p>
        ) : null}
      </div>

      {open ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate(values);
          }}
        >
          {credential.fields.map((field) => (
            <label key={field.key}>
              {field.key}
              <input
                type={field.secret ? "password" : "text"}
                autoComplete={field.secret ? "new-password" : "off"}
                value={values[field.key] ?? ""}
                placeholder={field.example}
                onChange={(event) =>
                  setValues((prev) => ({ ...prev, [field.key]: event.target.value }))
                }
              />
            </label>
          ))}
          {/* Validation runs against the real endpoint before anything is
              stored, so a rejection here is the target refusing the value —
              not a format check this form invented. */}
          {mutation.isError ? (
            <p className="admin-console__error">{(mutation.error as Error).message}</p>
          ) : null}
          <button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Validating…" : "Save"}
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)}>
          {credential.satisfied ? "Replace" : "Supply"}
        </button>
      )}
    </li>
  );
}

function RepositoriesPanel({
  repositories,
  loading,
  onChanged,
}: {
  repositories: RepositoryView[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<{
    name: string;
    input?: RepositoryInput;
    detail: ConfirmationRequired;
  } | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = async (name: string, input?: RepositoryInput, confirm?: string) => {
    setError(null);
    try {
      if (input) {
        await saveRepository(name, { ...input, confirm });
      } else {
        await deleteRepository(name, confirm);
      }
      setPending(null);
      setTyped("");
      onChanged();
    } catch (err) {
      if (err instanceof NeedsConfirmation) {
        setPending({ name, input, detail: err.detail });
        setTyped("");
        return;
      }
      setError((err as Error).message);
    }
  };

  return (
    <>
      <h3 className="admin-section__title">Repositories</h3>
      <p className="admin-section__lead">
        Where your apps come from. The cluster&apos;s own repositories are listed but not
        editable — your apps depend on them.
      </p>
      {loading ? <p>Loading repositories…</p> : null}
      {error ? <p className="admin-console__error">{error}</p> : null}

      <ul className="admin-list">
        {repositories.map((repo) => (
          <li key={repo.name} className="admin-list__item">
            <div>
              <strong>{repo.name}</strong>{" "}
              <span className="badge">{repo.role}</span>
              <span className="badge">{repo.type}</span>
              {!repo.owned ? <span className="badge">cluster</span> : null}
              <p>
                <code>{repo.url}</code>
                {repo.branch ? ` (${repo.branch})` : ""}
              </p>
            </div>
            {repo.owned ? (
              <button
                type="button"
                className="button--danger"
                onClick={() => void run(repo.name)}
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {/* The danger zone. It appears only when the API says an operation is
          dangerous, and it repeats the exact string the API will compare —
          so the console cannot drift into asking for the wrong confirmation,
          or into skipping one. */}
      {pending ? (
        <div className="danger-zone" role="alertdialog" aria-labelledby="danger-zone-title">
          <h4 id="danger-zone-title" className="danger-zone__title">
            This cannot be undone
          </h4>
          <p>{pending.detail.error}</p>
          <label>
            Type <code>{pending.detail.confirmWith}</code> to confirm
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            className="button--danger"
            disabled={typed !== pending.detail.confirmWith}
            onClick={() => void run(pending.name, pending.input, typed)}
          >
            I understand, continue
          </button>
          <button
            type="button"
            onClick={() => {
              setPending(null);
              setTyped("");
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </>
  );
}

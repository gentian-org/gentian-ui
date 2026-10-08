/* SPDX-License-Identifier: Apache-2.0 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import {
  fetchAppResidue,
  removeAppResidue,
  type ResidueItem,
  type ResidueRemoval,
} from "@/api/apps";
import { ApiError } from "@/api/client";
import "./admin.css";

const mono = { mono: <span className="admin-console__mono" /> };

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** How a removal ended: the cluster's answer, or the refusal or failure that came instead. */
type Outcome =
  | { item: ResidueItem; result: ResidueRemoval }
  | { item: ResidueItem; status?: number; message: string };

/**
 * Leftovers from updates: the pieces earlier builds of this app, or of an
 * add-on switched on inside it, brought to the cluster and newer builds no
 * longer bring.
 *
 * Nothing removes them automatically, on purpose: a tenant moved back to the
 * older build finds its pieces. This is the report of what is there, and for
 * each piece why, since when, and -- for a sign-in configuration -- whether
 * it is still in effect.
 *
 * The pieces are the cluster's, one of each for every tenant that has the
 * app. So whether a piece can be deleted from here is not this screen's to
 * decide and it does not: the answer says who may (`removableBy`). Only when
 * it says this tenant's administrator is a Delete button shown; otherwise the
 * report is read-only and says whom to ask. The server refuses the same way
 * whatever this screen shows.
 *
 * Deleting is behind the piece's name typed out, and what the cluster then
 * answers is shown as it said it. Only an answer that says the piece is
 * deleted is called deleted; an answer that did not arrive is called unknown,
 * and the list is read again either way.
 */
export function AppLeftovers({ app }: { app: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState<ResidueItem | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const residueQuery = useQuery({
    queryKey: ["admin", "apps", "residue", app],
    queryFn: () => fetchAppResidue(app),
  });

  const remove = useMutation({
    mutationFn: ({ item, typed }: { item: ResidueItem; typed: string }) =>
      // Asked for the app or add-on the piece names, with what was typed:
      // the server compares it to the name, not this screen alone.
      removeAppResidue(item.profile ?? app, {
        kind: item.kind,
        name: item.name,
        ...(item.namespace ? { namespace: item.namespace } : {}),
        confirm: typed,
      }),
    onSuccess: (result, { item }) => setOutcome({ item, result }),
    onError: (err, { item }) =>
      setOutcome({
        item,
        status: err instanceof ApiError ? err.status : undefined,
        message: (err instanceof ApiError && err.detail) || messageOf(err),
      }),
    onSettled: () => {
      setAsking(null);
      // Whatever the answer, what is on the cluster may have changed.
      void queryClient.invalidateQueries({ queryKey: ["admin", "apps", "residue"] });
    },
  });

  const data = residueQuery.data;
  const items = data?.residue ?? [];
  const notes = data?.incomplete ?? [];
  // Only the one word the server uses for it. Anything else is read-only.
  const deletable = data?.removableBy === "tenant";
  const notInstalled = residueQuery.error instanceof ApiError && residueQuery.error.status === 404;

  return (
    <div className="admin-console__subsection">
      <h3 className="admin-console__subsection-title">{t("apps.leftoversTitle")}</h3>
      <p className="admin-console__hint">{t("apps.leftoversLead")}</p>

      {outcome ? <RemovalNotice outcome={outcome} /> : null}

      {residueQuery.isLoading ? (
        <p className="admin-console__hint">{t("apps.leftoversReading")}</p>
      ) : notInstalled ? (
        <p className="admin-console__hint">{t("apps.leftoversNotOnCluster")}</p>
      ) : residueQuery.isError ? (
        <p className="admin-console__error">
          {t("apps.leftoversUnavailable")} {messageOf(residueQuery.error)}
        </p>
      ) : (
        <>
          {notes.length > 0 ? (
            <div className="admin-console__warning" role="status">
              <p>
                <strong>{t("apps.leftoversIncomplete")}</strong>
              </p>
              {notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          ) : null}
          {items.length === 0 ? (
            <p className="admin-console__empty">{t("apps.leftoversNone")}</p>
          ) : (
            <>
              {deletable ? null : <p className="admin-console__lead">{t("apps.leftoversShared")}</p>}
              <div className="admin-console__table-wrap">
                <table className="admin-console__table">
                  <thead>
                    <tr>
                      <th>{t("apps.leftoverKind")}</th>
                      <th>{t("apps.leftoverName")}</th>
                      <th>{t("apps.leftoverWhy")}</th>
                      <th>{t("apps.leftoverSince")}</th>
                      <th>{t("apps.leftoverInEffect")}</th>
                      {deletable ? <th /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={`${item.kind}/${item.namespace ?? ""}/${item.name}`}>
                        <td>{kindWord(t, item.kind)}</td>
                        <td>
                          <span className="admin-console__mono">{item.name}</span>
                          {item.profile && item.profile !== app ? (
                            <div className="admin-console__hint">
                              <Trans
                                i18nKey="apps.leftoverOfAddon"
                                values={{ addon: item.profile }}
                                components={mono}
                              />
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <div>{classWord(t, item.class)}</div>
                          <div className="admin-console__hint">{item.reason}</div>
                        </td>
                        <td>{item.created ? new Date(item.created).toLocaleDateString() : "—"}</td>
                        <td>
                          <InEffect item={item} />
                        </td>
                        {deletable ? (
                          <td>
                            {item.removable ? (
                              <button
                                type="button"
                                className="admin-console__btn admin-console__btn--danger"
                                disabled={remove.isPending}
                                onClick={() => {
                                  setOutcome(null);
                                  setAsking(item);
                                }}
                              >
                                {t("apps.leftoverDelete")}
                              </button>
                            ) : (
                              <div className="admin-console__hint">
                                {t("apps.leftoverNotRemovable")} {item.notRemovable}
                              </div>
                            )}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {asking ? (
        <DeleteDialog
          app={app}
          item={asking}
          pending={remove.isPending}
          onConfirm={(typed) => {
            if (!remove.isPending) remove.mutate({ item: asking, typed });
          }}
          onClose={() => setAsking(null)}
        />
      ) : null}
    </div>
  );
}

type T = ReturnType<typeof useTranslation>["t"];

/** The kind of piece, in the reader's words; one the screen has no word for is shown as it came. */
function kindWord(t: T, kind: string): string {
  switch (kind) {
    case "Composition":
      return t("apps.leftoverKindComposition");
    case "OIDCPackCatalog":
      return t("apps.leftoverKindSignIn");
    case "ConfigMap":
      return t("apps.leftoverKindAsset");
    case "Customization":
      return t("apps.leftoverKindCustomization");
    default:
      return kind;
  }
}

/** Why the piece is left over, in one line; the cluster's own sentence is shown beneath it. */
function classWord(t: T, cls: string): string {
  switch (cls) {
    case "dropped":
      return t("apps.leftoverDropped");
    case "orphaned":
      return t("apps.leftoverOrphaned");
    default:
      return cls;
  }
}

/**
 * Whether a leftover sign-in configuration still decides anything. It is the
 * one kind of leftover that does: a sign-in client is configured from the
 * first piece on the cluster that holds its entry, whoever brought it.
 */
function InEffect({ item }: { item: ResidueItem }) {
  const { t } = useTranslation();
  const oidc = item.oidc;
  if (!oidc) return <>—</>;
  const only = oidc.clients ?? [];
  const shared = oidc.contested ?? [];
  return (
    <>
      {oidc.effective === "yes" ? (
        <span className="admin-console__badge admin-console__badge--warn">{t("apps.leftoverEffectYes")}</span>
      ) : oidc.effective === "contested" ? (
        <span className="admin-console__badge admin-console__badge--warn">
          {t("apps.leftoverEffectContested")}
        </span>
      ) : oidc.effective === "no" ? (
        <span className="admin-console__badge">{t("apps.leftoverEffectNo")}</span>
      ) : (
        <span className="admin-console__badge admin-console__mono">{oidc.effective}</span>
      )}
      {only.length > 0 ? (
        <div className="admin-console__hint">
          <Trans i18nKey="apps.leftoverOnlyFor" values={{ clients: only.join(", ") }} components={mono} />
        </div>
      ) : null}
      {shared.length > 0 ? (
        <div className="admin-console__hint">
          <Trans i18nKey="apps.leftoverAlsoElsewhere" values={{ clients: shared.join(", ") }} components={mono} />
        </div>
      ) : null}
    </>
  );
}

/**
 * How the removal ended, in words.
 *
 * Deleted is said only for an answer that says so. An answer that the
 * deletion was taken and the piece is still there is said as that. A refusal
 * is shown with the reason it gave and says nothing was deleted. And when no
 * proper answer arrived, what happened is not known, and that is what is said.
 */
function RemovalNotice({ outcome }: { outcome: Outcome }) {
  const { t } = useTranslation();
  const values = { name: outcome.item.name };
  if ("result" in outcome) {
    const { result } = outcome;
    if (result.status === "deleted") {
      return (
        <div className="admin-console__success" role="status">
          <p>
            <Trans i18nKey="apps.leftoverDeleted" values={values} components={mono} />
          </p>
          {result.message ? <p>{t("apps.leftoverClusterSaid", { message: result.message })}</p> : null}
        </div>
      );
    }
    if (result.status === "deleting") {
      return (
        <div className="admin-console__warning" role="status">
          <p>
            <Trans i18nKey="apps.leftoverDeleting" values={values} components={mono} />
          </p>
          {result.message ? <p>{t("apps.leftoverClusterSaid", { message: result.message })}</p> : null}
        </div>
      );
    }
    // An answer this screen has no sentence for is not called a deletion.
    return (
      <div className="admin-console__warning" role="alert">
        <p>
          <Trans
            i18nKey="apps.leftoverOtherAnswer"
            values={{ ...values, status: result.status }}
            components={mono}
          />
        </p>
        {result.message ? <p>{result.message}</p> : null}
      </div>
    );
  }
  const { status, message } = outcome;
  if (status === 409) {
    return (
      <div className="admin-console__error" role="alert">
        <p>
          <strong>
            <Trans i18nKey="apps.leftoverRefused" values={values} components={mono} />
          </strong>
        </p>
        <p>{message}</p>
      </div>
    );
  }
  if (status === 403) {
    return (
      <div className="admin-console__error" role="alert">
        <p>
          <strong>
            <Trans i18nKey="apps.leftoverForbidden" values={values} components={mono} />
          </strong>
        </p>
        <p>{message}</p>
      </div>
    );
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return (
      <div className="admin-console__error" role="alert">
        <p>
          <strong>
            <Trans i18nKey="apps.leftoverNotDone" values={values} components={mono} />
          </strong>
        </p>
        <p>{message}</p>
      </div>
    );
  }
  return (
    <div className="admin-console__error" role="alert">
      <p>
        <strong>
          <Trans i18nKey="apps.leftoverUnknown" values={values} components={mono} />
        </strong>
      </p>
      <p>{message}</p>
    </div>
  );
}

/**
 * Deleting one piece, behind its name typed out.
 *
 * It says what is deleted and from where, and what that costs: a build of the
 * app older than the one installed that needed the piece would no longer find
 * it. A sign-in configuration that is still in effect says so again here.
 *
 * Once confirmed the dialog stays until the cluster has answered, and offers
 * nothing to press: a deletion is not asked for twice.
 */
function DeleteDialog({
  app,
  item,
  pending,
  onConfirm,
  onClose,
}: {
  app: string;
  item: ResidueItem;
  pending: boolean;
  onConfirm: (typed: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  const confirmed = typed.trim() === item.name;
  const values = { name: item.name, kind: kindWord(t, item.kind), app: item.profile ?? app };
  const inEffect = item.oidc?.effective === "yes" || item.oidc?.effective === "contested";

  return (
    <dialog
      ref={ref}
      className="admin-console__dialog"
      aria-labelledby="leftover-delete-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onClose();
      }}
    >
      <form
        className="admin-console__dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (confirmed && !pending) onConfirm(typed.trim());
        }}
      >
        <h3 id="leftover-delete-title" className="admin-console__dialog-title">
          <Trans i18nKey="apps.leftoverDialogTitle" values={values} components={mono} />
        </h3>
        <p className="admin-console__lead">
          <Trans i18nKey="apps.leftoverDialogBody" values={values} components={mono} />
        </p>
        <p className="admin-console__lead">
          <Trans i18nKey="apps.leftoverDialogDowngrade" values={values} components={mono} />
        </p>
        {inEffect ? <p className="admin-console__warning">{t("apps.leftoverDialogInEffect")}</p> : null}
        <p className="admin-console__lead">{t("apps.leftoverDialogFinal")}</p>

        <label className="admin-console__label" htmlFor="leftover-delete-confirm">
          <span className="admin-console__label-text">
            <Trans i18nKey="apps.leftoverTypeToConfirm" values={values} components={mono} />
          </span>
          <input
            id="leftover-delete-confirm"
            type="text"
            value={typed}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            disabled={pending}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>

        <div className="admin-console__dialog-footer" role={pending ? "status" : undefined}>
          <button
            type="button"
            className="admin-console__btn admin-console__btn--quiet"
            disabled={pending}
            onClick={onClose}
          >
            {t("apps.cancel")}
          </button>
          <button
            type="submit"
            className="admin-console__btn admin-console__btn--danger-solid"
            disabled={!confirmed || pending}
          >
            {pending ? t("apps.leftoverDeletingNow") : t("apps.leftoverDeleteConfirm")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { fetchContext, fetchMeta, fetchOverview, setCredential, type OverviewRow } from "@/api/store";
import { coordinateParams } from "@/store/BrowsePage";
import { CredentialOutcomeNote } from "@/store/InstallPanel";
import { ExternalLink, ProblemNote, shortDigest, StoreSignIn, useStoreName } from "@/store/parts";
import { useStoreSession } from "@/store/session";

const mono = { mono: <span className="admin-console__mono" /> };

/**
 * Replacing a repository's credential, behind a confirmation.
 *
 * For when a credential may have leaked. The store mints a new one and this
 * app hands it to the custodian; the one it replaces keeps working for a day
 * and is refused after that. It is asked for by a person and never on a
 * schedule.
 */
function ReplaceCredentialDialog({
  row,
  storeName,
  onConfirm,
  onClose,
}: {
  row: OverviewRow;
  storeName: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="admin-console__dialog"
      aria-labelledby="replace-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form
        className="admin-console__dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <h3 id="replace-title" className="admin-console__dialog-title">
          <Trans i18nKey="credential.replaceTitle" values={{ app: row.name ?? row.profile }} components={mono} />
        </h3>
        <p className="admin-console__lead">{t("credential.replaceBody", { store: storeName })}</p>
        <ul className="store-links">
          {(row.acquisition?.repositories ?? []).map((repository) => (
            <li key={repository.name}>
              <span className="admin-console__mono">{repository.url}</span>
            </li>
          ))}
        </ul>
        <p className="admin-console__hint">{t("credential.rotatedOverlap")}</p>
        <div className="admin-console__dialog-footer">
          <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={onClose}>
            {t("install.cancel")}
          </button>
          <button type="submit" className="admin-console__btn admin-console__btn--danger">
            {t("credential.replaceAction")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function Row({ row, storeName }: { row: OverviewRow; storeName: string }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const replace = useMutation({ mutationFn: (id: string) => setCredential(id, true) });
  const acquisition = row.acquisition;
  const badge = row.stage === "ready" ? "ok" : row.stage === "failing" ? "danger" : row.stage === "acquired" || row.stage === "checkout" ? "warn" : "info";
  const page = row.coordinate ? coordinateParams(row.coordinate) : null;
  return (
    <>
      <tr>
        <td>
          {page ? (
            <Link to="/app/$catalogue/$app" params={page} className="admin-console__btn-link">
              {row.name ?? row.profile}
            </Link>
          ) : (
            row.profile
          )}
          <div className="admin-console__meta admin-console__mono">{row.coordinate ?? row.profile}</div>
        </td>
        <td>
          <span className={`admin-console__badge admin-console__badge--${badge}`}>{t(`stage.${row.stage}`)}</span>
          {row.installed?.forEveryone ? <span className="admin-console__chip store-chip--after">{t("install.forEveryone")}</span> : null}
          {/* Why, in the cluster's own words. */}
          {row.state?.failure ? <div className="admin-console__error">{row.state.failure}</div> : null}
          {row.stage !== "ready" && row.state?.message ? <div className="admin-console__meta">{row.state.message}</div> : null}
        </td>
        <td>
          {row.installed?.digest ? (
            <span className="admin-console__mono" title={row.installed.digest}>
              {shortDigest(row.installed.digest)}
            </span>
          ) : row.installed ? (
            t("installed.notPinned")
          ) : (
            "—"
          )}
          {row.updateAvailable && row.latest ? (
            <div className="admin-console__meta">{t("install.updateAvailable", { version: row.latest.version })}</div>
          ) : null}
        </td>
        <td>
          {acquisition ? (
            <>
              {t(`acquisition.${acquisition.status}`)}
              {acquisition.version ? <div className="admin-console__meta">{acquisition.version}</div> : null}
            </>
          ) : (
            "—"
          )}
        </td>
        <td>
          <div className="store-row__actions">
            {page && !row.installed && acquisition ? (
              <Link to="/app/$catalogue/$app" params={page} className="admin-console__btn admin-console__btn--primary">
                {acquisition.status === "pending" ? t("install.continue") : t("install.installAction")}
              </Link>
            ) : null}
            {page && row.updateAvailable ? (
              <Link to="/app/$catalogue/$app" params={page} className="admin-console__btn admin-console__btn--primary">
                {t("install.updateAction")}
              </Link>
            ) : null}
            {acquisition && acquisition.status === "confirmed" && acquisition.repositories.length > 0 ? (
              <button type="button" className="admin-console__btn" disabled={replace.isPending} onClick={() => setConfirming(true)}>
                {t("credential.replaceAction")}
              </button>
            ) : null}
          </div>
        </td>
      </tr>
      {replace.data || replace.error ? (
        <tr>
          <td colSpan={5}>
            {replace.data ? <CredentialOutcomeNote outcome={replace.data} /> : null}
            {replace.error ? <ProblemNote error={replace.error} /> : null}
          </td>
        </tr>
      ) : null}
      {confirming && acquisition ? (
        <tr>
          <td colSpan={5}>
            <ReplaceCredentialDialog
              row={row}
              storeName={storeName}
              onClose={() => setConfirming(false)}
              onConfirm={() => {
                setConfirming(false);
                replace.mutate(acquisition.id);
              }}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * What this tenant has: acquired at the store, installed on the cluster.
 *
 * Two answers, joined. What is installed and how it is doing is the
 * cluster's, and is shown whether or not the store can be asked. What the
 * tenant has acquired is the store's, and needs the person's sign-in to the
 * store: opening this page is one of the two things that asks for it.
 *
 * Nothing is taken away from here. An installed app is administered --
 * access, uninstall, purge -- in the Admin Console.
 */
export function InstalledPage() {
  const { t } = useTranslation();
  const { session } = useStoreSession();
  const signedIn = session?.signedIn === true;
  const overviewQuery = useQuery({ queryKey: ["overview", signedIn], queryFn: fetchOverview, retry: false });
  const contextQuery = useQuery({ queryKey: ["context"], queryFn: fetchContext, retry: false });
  const metaQuery = useQuery({ queryKey: ["store", "meta"], queryFn: fetchMeta, retry: false });
  const storeName = useStoreName(metaQuery.data?.name);
  const overview = overviewQuery.data;

  return (
    <section>
      <div className="admin-console__section-head">
        <div>
          <h1 className="admin-console__section-title">{t("installed.title")}</h1>
          <p className="admin-console__lead">{t("installed.lead")}</p>
        </div>
      </div>

      {!signedIn ? <StoreSignIn reason={t("session.neededForAcquisitions", { store: storeName })} storeName={storeName} /> : null}

      {overviewQuery.isLoading ? <p className="admin-console__loading">{t("installed.loading")}</p> : null}
      {overviewQuery.isError ? <ProblemNote error={overviewQuery.error} /> : null}

      {overview ? (
        <>
          {overview.storeProblem ? (
            <>
              <ProblemNote problem={overview.storeProblem} />
              <p className="admin-console__meta">{t("shell.storeAwayClusterStays")}</p>
            </>
          ) : null}
          {Object.entries(overview.clusterProblems).map(([service, problem]) => (
            <ProblemNote key={service} problem={problem} />
          ))}
          {overview.rows.length === 0 ? (
            <p className="admin-console__empty">{signedIn ? t("installed.nothing") : t("installed.nothingInstalled")}</p>
          ) : (
            <div className="admin-console__table-wrap">
              <table className="admin-console__table">
                <thead>
                  <tr>
                    <th>{t("installed.colApp")}</th>
                    <th>{t("installed.colState")}</th>
                    <th>{t("installed.colBuild")}</th>
                    <th>{t("installed.colAcquisition")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {overview.rows.map((row) => (
                    <Row key={row.profile} row={row} storeName={storeName} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      <p className="admin-console__meta store-admin-note">
        {t("install.administeredInConsole")}{" "}
        <ExternalLink href={contextQuery.data?.adminConsoleUrl}>{t("install.openAdminConsole")}</ExternalLink>
      </p>
    </section>
  );
}

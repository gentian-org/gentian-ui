import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fetchAppStates } from "@/api/admin";
import {
  fetchCatalogueEntries,
  fetchCatalogueSources,
  installCatalogueEntry,
  provisionApp,
  uninstallApp,
  type AppWriteResult,
  type CatalogueEntry,
} from "@/api/catalogue";
import "./admin.css";
import { Trans, useTranslation } from "react-i18next";

/** How long a ticked "give everyone access" waits for the cluster to have the app. */
const ACCESS_WAIT_LIMIT_MS = 10 * 60 * 1000;
const ACCESS_POLL_MS = 5000;

/** What the last install or uninstall came to, in the director's own terms. */
type Outcome = { app: string; result: AppWriteResult };

/** Where "give every member access" stands for the app just installed. */
type Access =
  | { app: string; kind: "waiting" | "granted" }
  | { app: string; kind: "refused"; message: string };

const mono = { mono: <span className="admin-console__mono" /> };

/** The first twelve hex characters of a digest: enough to tell two builds apart by eye. */
function shortDigest(digest: string) {
  return digest.replace(/^sha256:/, "").slice(0, 12);
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The cluster's own catalogues — the fallback, and it is meant to look like
 * one.
 *
 * The App Store is the route to an app. It knows what an app is for, what it
 * costs, who maintains it and what it looks like, and people whose job that is
 * keep it current. This screen exists for the cases the store cannot answer:
 * it is unreachable, the cluster is air-gapped, or the entry is this
 * operator's own profile in their own repository, which nobody sells and
 * nobody else lists.
 *
 * So it is a table of coordinates. No cards, no icons, no descriptions, no
 * search, no categories, no screenshots. That is not an unfinished screen — a
 * second, worse shop would pull people away from the one that is maintained,
 * and every field it could add here is a field that would go stale. What it
 * shows is what a cluster can actually vouch for on its own: what is in its
 * catalogues, at which version, in which edition, and whether this tenant may
 * install it without asking anybody.
 *
 * Where it may, the row installs it: the entry's coordinate and digest go back
 * to the director exactly as its listing gave them, and the director decides
 * whether this person may. An install is a commit, so the row does not change
 * at once — "installed" is read from the cluster, which has the app only after
 * the next sync.
 *
 * Only ce (community) and pe (private) entries appear, because they are the
 * ones whose value does not depend on a supplier. me (maintained) and ee
 * (enterprise) are counted and named to the store.
 */
export function CatalogueSection({ tenant }: { tenant: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [confirming, setConfirming] = useState<CatalogueEntry | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  // An app whose install was committed with access for everyone asked for,
  // and which the cluster did not have yet when the grant was first tried.
  const [awaiting, setAwaiting] = useState<{ app: string; since: number } | null>(null);
  const granting = useRef(false);

  // What the cluster holds of this tenant's apps: the same answer the Export
  // tab reads, and what "installed" means on this screen. Asked again every
  // few seconds only while a grant is waiting for an app to arrive.
  const statesQuery = useQuery({
    queryKey: ["admin", "apps", "status"],
    queryFn: () => fetchAppStates(),
    refetchInterval: awaiting ? ACCESS_POLL_MS : false,
  });
  const installed = new Set((statesQuery.data?.apps ?? []).map((a) => a.profile));

  // Granting is done by the cluster, now, and it refuses an app it does not
  // have. Straight after an install's commit that is the ordinary case, so a
  // refusal then is not an answer yet: it is tried once more when the app
  // has arrived, and that answer is shown whatever it is.
  async function grant(app: string, clusterHasIt: boolean) {
    if (granting.current) return;
    granting.current = true;
    try {
      await provisionApp(app);
      setAwaiting(null);
      setAccess({ app, kind: "granted" });
    } catch (err) {
      if (clusterHasIt) {
        setAwaiting(null);
        setAccess({ app, kind: "refused", message: messageOf(err) });
      } else {
        setAwaiting((current) => current ?? { app, since: Date.now() });
        setAccess({ app, kind: "waiting" });
      }
    } finally {
      granting.current = false;
    }
  }

  const awaitedArrived = awaiting ? installed.has(awaiting.app) : false;
  useEffect(() => {
    if (!awaiting) return;
    if (awaitedArrived) {
      void grant(awaiting.app, true);
    } else if (Date.now() - awaiting.since > ACCESS_WAIT_LIMIT_MS) {
      setAwaiting(null);
      setAccess({ app: awaiting.app, kind: "refused", message: t("catalogue.accessGaveUp") });
    }
    // Re-run on every poll, not only when the list changes: the limit is a
    // matter of time passing.
  }, [awaiting, awaitedArrived, statesQuery.dataUpdatedAt]);

  const installMutation = useMutation({
    mutationFn: ({ entry }: { entry: CatalogueEntry; everyone: boolean }) => installCatalogueEntry(entry),
    onSuccess: (result, { entry, everyone }) => {
      setConfirming(null);
      setOutcome({ app: entry.name, result });
      setAccess(null);
      setAwaiting(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "apps", "status"] });
      if (everyone) void grant(entry.name, installed.has(entry.name));
    },
  });
  const uninstallMutation = useMutation({
    mutationFn: (entry: CatalogueEntry) => uninstallApp(entry.name),
    onSuccess: (result, entry) => {
      setOutcome({ app: entry.name, result });
      setAccess(null);
      setAwaiting(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "apps", "status"] });
    },
  });

  function askInstall(entry: CatalogueEntry) {
    installMutation.reset();
    uninstallMutation.reset();
    setConfirming(entry);
  }

  function askUninstall(entry: CatalogueEntry) {
    if (window.confirm(t("catalogue.uninstallConfirm", { app: entry.name, tenant }))) {
      installMutation.reset();
      uninstallMutation.mutate(entry);
    }
  }

  const sourcesQuery = useQuery({
    queryKey: ["catalogue", "sources", tenant],
    queryFn: () => fetchCatalogueSources(tenant),
  });
  const [selected, setSelected] = useState<string | null>(null);

  const sources = sourcesQuery.data?.catalogues ?? [];
  const storeUrl = sourcesQuery.data?.storeUrl ?? "";

  // The first catalogue, until somebody picks another. Not a stored default:
  // a cluster with one source should not need a click to see it.
  useEffect(() => {
    if (!selected && sources.length > 0) {
      setSelected(sources[0].name);
    }
  }, [selected, sources]);

  const entriesQuery = useQuery({
    queryKey: ["catalogue", "entries", tenant, selected],
    queryFn: () => fetchCatalogueEntries(selected as string, tenant),
    enabled: Boolean(selected),
  });

  if (sourcesQuery.isLoading) {
    return <p className="admin-console__loading">{t("catalogue.loadingCatalogues")}</p>;
  }
  if (sourcesQuery.isError) {
    return <p className="admin-console__error">{t("catalogue.cataloguesAreUnavailable")}</p>;
  }

  return (
    <section>
      <header className="admin-console__section-head">
        <div>
          <h2 className="admin-console__section-title">{t("catalogue.catalogues")}</h2>
          <p className="admin-console__lead">
            {storeUrl ? (
              <>
                Apps come from the{" "}
                <a href={storeUrl} target="_blank" rel="noreferrer">
                  {t("catalogue.appStore")}</a>
                . This page is the plain fallback: what is in this cluster&rsquo;s own
                catalogue sources, for when the store is not the answer.
              </>
            ) : (
              <>
                This cluster belongs to no App Store, so its own catalogue sources are all
                there is.
              </>
            )}
          </p>
        </div>
      </header>

      {sources.length === 0 ? (
        <p className="admin-console__lead">
          {t("catalogue.thisClusterNamesNoCatalogue")}<code>spec.catalogue.sources</code>.
        </p>
      ) : (
        <>
          <p className="admin-console__lead">
            {sources.map((source) => (
              <button
                key={source.name}
                type="button"
                className={`admin-console__tab${
                  selected === source.name ? " admin-console__tab--active" : ""
                }`}
                onClick={() => setSelected(source.name)}
              >
                {source.name}
                {source.open ? " (open)" : ""}
              </button>
            ))}
          </p>
          {outcome ? <OutcomeNotice outcome={outcome} /> : null}
          {access?.kind === "granted" ? (
            <p className="admin-console__success">
              <Trans i18nKey="catalogue.accessGranted" values={{ app: access.app }} components={mono} />
            </p>
          ) : access?.kind === "waiting" ? (
            <p className="admin-console__hint">
              <Trans i18nKey="catalogue.accessWaiting" values={{ app: access.app }} components={mono} />
            </p>
          ) : access?.kind === "refused" ? (
            <p className="admin-console__error">
              <Trans
                i18nKey="catalogue.accessRefused"
                values={{ app: access.app, message: access.message }}
                components={mono}
              />
            </p>
          ) : null}
          {uninstallMutation.isError ? (
            <p className="admin-console__error">{messageOf(uninstallMutation.error)}</p>
          ) : null}
          <CatalogueTable
            storeUrl={storeUrl}
            loading={entriesQuery.isLoading}
            error={entriesQuery.isError}
            entries={entriesQuery.data?.entries ?? []}
            sourceOpen={entriesQuery.data?.open ?? false}
            storeOnly={entriesQuery.data?.storeOnly ?? 0}
            installed={installed}
            busy={installMutation.isPending || uninstallMutation.isPending}
            onInstall={askInstall}
            onUninstall={askUninstall}
          />
        </>
      )}
      {confirming ? (
        <InstallDialog
          entry={confirming}
          pending={installMutation.isPending}
          error={installMutation.isError ? messageOf(installMutation.error) : undefined}
          onConfirm={(everyone) => installMutation.mutate({ entry: confirming, everyone })}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </section>
  );
}

/**
 * What the director answered, said once.
 *
 * With a commit, git has the change and the cluster does not: the row keeps
 * saying what the cluster holds until the next sync, and this line is what
 * stands in for it meanwhile. Without one, the tenant already was as asked.
 */
function OutcomeNotice({ outcome }: { outcome: Outcome }) {
  const { app, result } = outcome;
  const commit = (result.commit ?? "").slice(0, 8);
  if (result.status === "installed" && result.commit) {
    return (
      <p className="admin-console__success">
        <Trans i18nKey="catalogue.outcomeInstalled" values={{ app, commit }} components={mono} />
      </p>
    );
  }
  if (result.status === "updated" && result.commit) {
    return (
      <p className="admin-console__success">
        <Trans i18nKey="catalogue.outcomeUpdated" values={{ app, commit }} components={mono} />
      </p>
    );
  }
  if (result.status === "uninstalled" && result.commit) {
    return (
      <p className="admin-console__success">
        <Trans i18nKey="catalogue.outcomeUninstalled" values={{ app, commit }} components={mono} />
      </p>
    );
  }
  if (result.status === "already_installed") {
    return (
      <p className="admin-console__hint">
        <Trans i18nKey="catalogue.outcomeAlreadyInstalled" values={{ app }} components={mono} />
      </p>
    );
  }
  if (result.status === "not_installed") {
    return (
      <p className="admin-console__hint">
        <Trans i18nKey="catalogue.outcomeNotInstalled" values={{ app }} components={mono} />
      </p>
    );
  }
  // A status this screen has no sentence for is shown as it came.
  return (
    <p className="admin-console__hint">
      <Trans i18nKey="catalogue.outcomeOther" values={{ app, status: result.status }} components={mono} />
    </p>
  );
}

/**
 * Installing one entry, said back before it is done: which app, and which
 * build of it — the digest is what is installed, the name is only what it is
 * called.
 *
 * One choice rides along. Installing makes an app exist in the tenant; who
 * may open it is a separate matter, and by default the answer is nobody.
 * Ticking the box asks the cluster to put every current member into the
 * app's group once the install is accepted.
 */
function InstallDialog({
  entry,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  entry: CatalogueEntry;
  pending: boolean;
  error?: string;
  onConfirm: (everyone: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const [everyone, setEveryone] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      className="admin-console__dialog"
      aria-labelledby="install-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onClose();
      }}
    >
      <form
        className="admin-console__dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pending) onConfirm(everyone);
        }}
      >
        <h3 id="install-title" className="admin-console__dialog-title">
          <Trans i18nKey="catalogue.installTitle" values={{ app: entry.name }} components={mono} />
        </h3>
        <p className="admin-console__lead">
          <Trans
            i18nKey="catalogue.installBody"
            values={{ coordinate: entry.coordinate, digest: shortDigest(entry.digest) }}
            components={mono}
          />
        </p>

        <label className="admin-console__choice">
          <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} />
          <span>
            <span className="admin-console__choice-title">{t("catalogue.everyone")}</span>
            <span className="admin-console__choice-desc">{t("catalogue.everyoneBody")}</span>
          </span>
        </label>

        {error ? <p className="admin-console__error">{error}</p> : null}

        <div className="admin-console__dialog-footer">
          <button type="button" className="admin-console__btn admin-console__btn--quiet" disabled={pending} onClick={onClose}>
            {t("catalogue.cancel")}
          </button>
          <button type="submit" className="admin-console__btn admin-console__btn--primary" disabled={pending}>
            {t("catalogue.installAction")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function CatalogueTable({
  entries,
  sourceOpen,
  storeOnly,
  storeUrl,
  loading,
  error,
  installed,
  busy,
  onInstall,
  onUninstall,
}: {
  entries: CatalogueEntry[];
  /** Whether the Cluster claim opens this source to the tenant. */
  sourceOpen: boolean;
  storeOnly: number;
  storeUrl: string;
  loading: boolean;
  error: boolean;
  /** Profiles the cluster holds for the tenant. */
  installed: Set<string>;
  busy: boolean;
  onInstall: (entry: CatalogueEntry) => void;
  onUninstall: (entry: CatalogueEntry) => void;
}) {
  const { t } = useTranslation();

  if (loading) {
    return <p className="admin-console__loading">{t("catalogue.loadingEntries")}</p>;
  }
  if (error) {
    // The source is somebody else's web server and it is allowed to be down.
    return (
      <p className="admin-console__error">
        {t("catalogue.thisCatalogueSourceCouldNot")}</p>
    );
  }

  return (
    <>
      {entries.length === 0 ? (
        <p className="admin-console__empty">{t("catalogue.nothingThisClusterListsFor")}</p>
      ) : (
        <div className="admin-console__table-wrap">
          <table className="admin-console__table">
            <thead>
              <tr>
                <th>{t("catalogue.coordinate")}</th>
                <th>{t("catalogue.version")}</th>
                <th>{t("catalogue.edition")}</th>
                <th>{t("catalogue.trust")}</th>
                <th>{t("catalogue.install")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.coordinate}>
                  <td>
                    <code>{entry.coordinate}</code>
                  </td>
                  <td>{entry.version ?? "—"}</td>
                  <td>
                    <code>{entry.edition}</code>
                  </td>
                  <td>{entry.trustTier ?? "—"}</td>
                  <td>
                    {installed.has(entry.name) ? (
                      // What the cluster holds, by profile name: a tenant
                      // has one app of a name whichever source it came from.
                      <>
                        <span>{t("catalogue.installed")}</span>{" "}
                        <button
                          type="button"
                          className="admin-console__btn admin-console__btn--danger"
                          disabled={busy}
                          onClick={() => onUninstall(entry)}
                        >
                          {t("catalogue.uninstall")}
                        </button>
                      </>
                    ) : entry.installable ? (
                      // The cluster offers this entry to this tenant, so the
                      // row installs it: the entry's coordinate and digest go
                      // to the director, which decides whether this person
                      // may. Nothing is decided here, the button included --
                      // it is shown for what the listing says, not for who
                      // is looking.
                      <button
                        type="button"
                        className="admin-console__btn"
                        disabled={busy}
                        onClick={() => onInstall(entry)}
                      >
                        {t("catalogue.installAction")}
                      </button>
                    ) : (
                      // Not offered from here, and the listing implies why:
                      // an entry is installable when its source is open to
                      // the tenant and the entry states its digest.
                      <span>
                        {!sourceOpen
                          ? t("catalogue.sourceNotOpen")
                          : !entry.digest
                            ? t("catalogue.noDigest")
                            : t("catalogue.viaTheAppStore")}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {storeOnly > 0 ? (
        <p className="admin-console__lead">
          {t("catalogue.storeOnly", { count: storeOnly })}{" "}
          {storeUrl ? (
            <a href={storeUrl} target="_blank" rel="noreferrer">
              {t("catalogue.seeThemInTheApp")}
            </a>
          ) : (
            t("catalogue.theyAreTheStoreS")
          )}
        </p>
      ) : null}
    </>
  );
}

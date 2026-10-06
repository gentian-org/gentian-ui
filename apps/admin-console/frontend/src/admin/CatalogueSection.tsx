import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fetchAppStates } from "@/api/admin";
import { uninstallApp, type AppWriteResult } from "@/api/apps";
import {
  fetchCatalogueEntries,
  fetchCatalogueSources,
  installCatalogueEntry,
  type CatalogueEntry,
} from "@/api/catalogue";
import "./admin.css";
import { Trans, useTranslation } from "react-i18next";

/** What the last install or uninstall came to, in the director's own terms. */
type Outcome = { app: string; result: AppWriteResult; everyone?: boolean };

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
 * catalogues, at which version, in which edition, and whether it can be
 * installed from here.
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

  // What the cluster holds of this tenant's apps: the same answer the Export
  // tab reads, and what "installed" means on this screen.
  const statesQuery = useQuery({
    queryKey: ["admin", "apps", "status"],
    queryFn: () => fetchAppStates(),
  });
  const installed = new Set((statesQuery.data?.apps ?? []).map((a) => a.profile));

  // "For everyone" is part of the install itself: the director records it
  // with the app, and the cluster gives every member access once the app is
  // ready. Nothing is left for this page to do afterwards.
  const installMutation = useMutation({
    mutationFn: ({ entry, everyone }: { entry: CatalogueEntry; everyone: boolean }) =>
      installCatalogueEntry(entry, everyone),
    onSuccess: (result, { entry, everyone }) => {
      setConfirming(null);
      setOutcome({ app: entry.name, result, everyone });
      void queryClient.invalidateQueries({ queryKey: ["admin", "apps", "status"] });
    },
  });
  const uninstallMutation = useMutation({
    mutationFn: (entry: CatalogueEntry) => uninstallApp(entry.name),
    onSuccess: (result, entry) => {
      setOutcome({ app: entry.name, result });
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
              </button>
            ))}
          </p>
          {outcome ? <OutcomeNotice outcome={outcome} /> : null}
          {uninstallMutation.isError ? (
            <p className="admin-console__error">{messageOf(uninstallMutation.error)}</p>
          ) : null}
          <CatalogueTable
            storeUrl={storeUrl}
            loading={entriesQuery.isLoading}
            error={entriesQuery.isError}
            entries={entriesQuery.data?.entries ?? []}
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
  const { t } = useTranslation();
  const { app, result, everyone } = outcome;
  const commit = (result.commit ?? "").slice(0, 8);
  if (result.status === "installed" && result.commit) {
    return (
      <p className="admin-console__success">
        <Trans i18nKey="catalogue.outcomeInstalled" values={{ app, commit }} components={mono} />
        {everyone ? <> {t("catalogue.outcomeEveryone")}</> : null}
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
 * may open it is a separate matter. Plain "Install" leaves that to Members,
 * person by person; "Install for everyone" states it in the install itself,
 * and the cluster gives every member access once the app is ready.
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

        <div className="admin-console__choices" role="radiogroup" aria-labelledby="install-title">
          <label className={`admin-console__choice${everyone ? "" : " admin-console__choice--selected"}`}>
            <input
              type="radio"
              name="install-access"
              checked={!everyone}
              disabled={pending}
              onChange={() => setEveryone(false)}
            />
            <span>
              <span className="admin-console__choice-title">{t("catalogue.installPlain")}</span>
              <span className="admin-console__choice-desc">{t("catalogue.installPlainBody")}</span>
            </span>
          </label>
          <label className={`admin-console__choice${everyone ? " admin-console__choice--selected" : ""}`}>
            <input
              type="radio"
              name="install-access"
              checked={everyone}
              disabled={pending}
              onChange={() => setEveryone(true)}
            />
            <span>
              <span className="admin-console__choice-title">{t("catalogue.installEveryone")}</span>
              <span className="admin-console__choice-desc">{t("catalogue.installEveryoneBody")}</span>
            </span>
          </label>
        </div>

        {error ? <p className="admin-console__error">{error}</p> : null}

        <div className="admin-console__dialog-footer">
          <button type="button" className="admin-console__btn admin-console__btn--quiet" disabled={pending} onClick={onClose}>
            {t("catalogue.cancel")}
          </button>
          <button type="submit" className="admin-console__btn admin-console__btn--primary" disabled={pending}>
            {everyone ? t("catalogue.installEveryone") : t("catalogue.installAction")}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function CatalogueTable({
  entries,
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
                      // The listing calls this entry installable, so the row
                      // installs it: the entry's coordinate and digest go
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
                      // Not offered from here, and the listing says why: an
                      // entry is installable when its source states the
                      // digest of it.
                      <span>{t("catalogue.noDigest")}</span>
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

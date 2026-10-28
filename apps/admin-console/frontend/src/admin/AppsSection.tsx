/* SPDX-License-Identifier: Apache-2.0 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";
import {
  fetchAdminContext,
  fetchAppStates,
  fetchIntegrationsOverview,
  fetchPersonGroups,
  type AdminContext,
  type AppState,
} from "@/api/admin";
import {
  approvePrivilege,
  fetchDeclaredApps,
  fetchRetainedApps,
  fetchTenantPrivileges,
  purgeAppData,
  setAddonForEveryone,
  setAppForEveryone,
  uninstallApp,
  type AppPurgeResult,
  type AppWriteResult,
  type DeclaredApp,
  type RetainedApp,
} from "@/api/apps";
import { ApiError } from "@/api/client";
import { AppLeftovers } from "./AppLeftovers";
import { AppPublicAddresses } from "./AppPublicAddresses";
import { GroupMembers } from "./GroupMembers";
import { describeGroups } from "./groupLabels";
import "./admin.css";
import { formatDateTime } from "@/lib/format";

const mono = { mono: <span className="admin-console__mono" /> };
const code = { code: <code /> };

/** An app's name as the director accepts it; anything else cannot be one. */
const APP_NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** The first twelve hex characters of a digest: enough to tell two builds apart by eye. */
function shortDigest(digest: string) {
  return digest.replace(/^sha256:/, "").slice(0, 12);
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * One app as this screen knows it: what git declares, what the cluster
 * reports, or both. Either half can be missing, and which one is missing is
 * the thing worth showing.
 */
export type AppRow = { profile: string; declared?: DeclaredApp; state?: AppState };

/**
 * The list's rows: git's apps and the cluster's components, joined by profile.
 *
 * A component runs or does not whatever put it there, so one the platform
 * placed as a default (origin `default`) gives a declared app its standing
 * like any other. A default component git does not declare is the
 * platform's own -- the desktop, the consoles -- and is not a row: it is not
 * the tenant's app, and it is not being removed.
 */
export function joinApps(declaredApps: DeclaredApp[], states: AppState[]): AppRow[] {
  const byProfile = new Map<string, AppRow>();
  for (const declared of declaredApps) {
    byProfile.set(declared.profile, { profile: declared.profile, declared });
  }
  for (const state of states) {
    const row = byProfile.get(state.profile);
    if (!row && state.origin === "default") continue;
    byProfile.set(state.profile, { ...(row ?? { profile: state.profile }), state });
  }
  return [...byProfile.values()].sort((a, b) => a.profile.localeCompare(b.profile));
}

/** What the director answered to the last write on this screen. */
type Outcome = { kind: "access" | "uninstall"; app: string; everyone?: boolean; result: AppWriteResult };

/**
 * The tenant's installed apps, and everything that is done to one after it
 * is installed.
 *
 * One list, joined from two answers that are allowed to disagree. Git says
 * what the tenant is meant to have (the director); the cluster says what it
 * has made of that (the usher). An app in one and not the other is between
 * the two -- committed and not yet rolled out, or removed from git and still
 * being taken down -- and the row says which rather than hiding it.
 *
 * Nothing is installed from here. An app arrives from the App Store, or by
 * command where a cluster has none; this screen looks after the ones that are
 * there: who may open one, what it exchanges with other apps, what it asked
 * of the platform, and taking it away again.
 *
 * The list says which apps there are and how each stands. Everything about
 * one app is in its Details, a panel that opens on top of the list: there is
 * one place for it, and the list stays a list.
 *
 * Every action goes to the service that owns it with the person's own token,
 * and what that service answers is shown as it said it, a refusal included.
 * This screen decides nothing about who may do what.
 */
/** How often the tab asks again, so an install or removal shows without a reload. */
const APPS_REFRESH_MS = 5000;

/** The app a link names (?app=<profile>), when it names one. */
export function linkedApp(search: string = typeof window === "undefined" ? "" : window.location.search): string | null {
  const wanted = new URLSearchParams(search).get("app");
  return wanted && /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(wanted) ? wanted : null;
}

export function AppsSection({
  tenant,
  onOpenIntegrations,
}: {
  tenant: string;
  /** Go to the Integrations screen, where what an app may consume is changed. */
  onOpenIntegrations: () => void;
}) {
  const { t } = useTranslation();
  // The app whose Details are open, by name: the row is looked up again on
  // every render, so the panel shows the app as it is now and closes by
  // itself when the app is gone from both answers.
  // A link may name one (?app=<profile>): the App Store's last step of an
  // install for selected users opens its Details here, where access is given.
  const [open, setOpen] = useState<string | null>(() => linkedApp());
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const declaredQuery = useQuery({
    queryKey: ["admin", "apps", "declared"],
    queryFn: () => fetchDeclaredApps(),
    refetchInterval: APPS_REFRESH_MS,
  });
  const statesQuery = useQuery({
    queryKey: ["admin", "apps", "status"],
    queryFn: () => fetchAppStates(),
    refetchInterval: APPS_REFRESH_MS,
  });

  const rows = useMemo(
    () => joinApps(declaredQuery.data?.apps ?? [], statesQuery.data?.apps ?? []),
    [declaredQuery.data, statesQuery.data],
  );

  if (declaredQuery.isLoading || statesQuery.isLoading) {
    return <p className="admin-console__loading">{t("apps.loading")}</p>;
  }

  // Which halves were answered. A half that was not is not an empty half:
  // "not on the cluster" may only be said when the cluster was heard.
  const declaredKnown = declaredQuery.isSuccess;
  const statesKnown = statesQuery.isSuccess;
  const opened = rows.find((row) => row.profile === open);

  return (
    <section>
      <header className="admin-console__section-head">
        <div>
          <h2 className="admin-console__section-title">{t("apps.title")}</h2>
          <p className="admin-console__lead">
            <Trans i18nKey="apps.installNote" components={code} />
          </p>
        </div>
      </header>

      {declaredQuery.isError ? (
        <p className="admin-console__error">
          {t("apps.declaredUnavailable")} {messageOf(declaredQuery.error)}
        </p>
      ) : null}
      {statesQuery.isError ? (
        <p className="admin-console__error">
          {t("apps.statesUnavailable")} {messageOf(statesQuery.error)}
        </p>
      ) : null}
      {outcome ? <OutcomeNotice outcome={outcome} /> : null}

      {rows.length === 0 ? (
        declaredKnown || statesKnown ? (
          <p className="admin-console__empty">{t("apps.none")}</p>
        ) : null
      ) : (
        <div className="admin-console__table-wrap">
          <table className="admin-console__table">
            <thead>
              <tr>
                <th>{t("apps.app")}</th>
                <th>{t("apps.state")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.profile}>
                  <td className="admin-console__mono">{row.profile}</td>
                  <td>
                    <Standing row={row} declaredKnown={declaredKnown} statesKnown={statesKnown} />
                  </td>
                  <td>
                    <button
                      className="admin-console__btn"
                      type="button"
                      aria-haspopup="dialog"
                      onClick={() => setOpen(row.profile)}
                    >
                      {t("apps.details")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {opened ? (
        <AppDetails
          // A different app is a different panel: nothing typed or answered
          // for one carries over to the next.
          key={opened.profile}
          row={opened}
          tenant={tenant}
          declaredKnown={declaredKnown}
          statesKnown={statesKnown}
          outcome={outcome?.app === opened.profile ? outcome : null}
          onOutcome={(next) => {
            setOutcome(next);
            // An uninstall is answered on the list: the app is on its way
            // out, and what the answer says next is below the list.
            if (next.kind === "uninstall") setOpen(null);
          }}
          onOpenIntegrations={() => {
            setOpen(null);
            onOpenIntegrations();
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}

      <RetainedSection tenant={tenant} declared={declaredQuery.data?.apps} />
    </section>
  );
}

/**
 * Where an app stands between git and the cluster, as one badge.
 *
 * Running or not is the cluster's word. The two in-between states are this
 * screen's own reading of the join, and each is only said when the half it
 * depends on was actually answered.
 */
function Standing({
  row,
  declaredKnown,
  statesKnown,
}: {
  row: AppRow;
  declaredKnown: boolean;
  statesKnown: boolean;
}) {
  const { t } = useTranslation();
  if (!row.state) {
    return statesKnown ? (
      <span className="admin-console__badge admin-console__badge--warn">{t("apps.notRolledOut")}</span>
    ) : (
      <span className="admin-console__badge">{t("apps.unknown")}</span>
    );
  }
  if (!row.declared && declaredKnown) {
    return <span className="admin-console__badge admin-console__badge--warn">{t("apps.beingRemoved")}</span>;
  }
  if (row.state.phase === "ready") {
    return <span className="admin-console__badge admin-console__badge--ok">{t("apps.phaseReady")}</span>;
  }
  if (row.state.phase === "installing") {
    return <span className="admin-console__badge admin-console__badge--info">{t("apps.phaseInstalling")}</span>;
  }
  if (row.state.phase === "failing") {
    return <span className="admin-console__badge admin-console__badge--danger">{t("apps.phaseFailing")}</span>;
  }
  // A phase this screen has no word for is shown as the cluster said it.
  return <span className="admin-console__badge admin-console__mono">{row.state.phase}</span>;
}

/**
 * One app's Details: a panel on top of the Apps list, with everything this
 * console knows about the app and everything it can do to it.
 *
 * From the top: how the app stands, who has it, what it exchanges with other
 * apps, what it asked of the platform, what it asks to have on the internet
 * (shown only for an app that asks), taking it away, and -- last -- what
 * earlier builds of it left on the cluster.
 *
 * A native modal dialog, like the console's others: it holds focus, the page
 * behind it is inert, Escape closes it, and so do the two Close buttons.
 */
function AppDetails({
  row,
  tenant,
  declaredKnown,
  statesKnown,
  outcome,
  onOutcome,
  onOpenIntegrations,
  onClose,
}: {
  row: AppRow;
  tenant: string;
  declaredKnown: boolean;
  statesKnown: boolean;
  /** What the director answered to the last write on this app, if any. */
  outcome: Outcome | null;
  onOutcome: (outcome: Outcome) => void;
  onOpenIntegrations: () => void;
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
      className="admin-console__dialog admin-console__dialog--wide"
      aria-labelledby="app-details-title"
      onCancel={(e) => {
        // A dialog opened from inside this one answers its own Escape.
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        onClose();
      }}
    >
      <div className="admin-console__dialog-body">
        <div className="admin-console__dialog-head">
          <h3 id="app-details-title" className="admin-console__dialog-title">
            <Trans i18nKey="apps.detailsTitle" values={{ app: row.profile }} components={mono} />
          </h3>
          <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={onClose}>
            {t("apps.close")}
          </button>
        </div>
        {outcome ? <OutcomeNotice outcome={outcome} /> : null}
        <StatePart row={row} declaredKnown={declaredKnown} statesKnown={statesKnown} />
        <AccessPart row={row} tenant={tenant} onOutcome={onOutcome} />
        <IntegrationsPart row={row} tenant={tenant} onOpenIntegrations={onOpenIntegrations} />
        <PrivilegesPart row={row} />
        <AppPublicAddresses app={row.profile} addons={row.declared?.addons ?? []} />
        <UninstallPart row={row} tenant={tenant} declaredKnown={declaredKnown} onOutcome={onOutcome} />
        <AppLeftovers app={row.profile} />
        <div className="admin-console__dialog-footer">
          <button type="button" className="admin-console__btn" onClick={onClose}>
            {t("apps.close")}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** A value too long to read, with the way to take all of it. */
function CopyValue({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="admin-console__btn admin-console__btn--quiet"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true));
      }}
    >
      {copied ? t("apps.copied") : t("apps.copyFull")}
    </button>
  );
}

/** A label and its value, in the console's two-column row. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="admin-console__edit-row">
      <div className="admin-console__edit-row-label">{label}</div>
      <div className="admin-console__edit-row-value">{children}</div>
    </div>
  );
}

/**
 * Status: the app at a glance -- how it stands on the cluster and why, which
 * build git pins, where that build came from, what is switched on inside it,
 * and whether it is for everyone.
 *
 * The cluster's own words are shown as they came -- the message, the failure,
 * every condition -- because "why is it not running" is answered there and
 * nowhere else.
 */
function StatePart({
  row,
  declaredKnown,
  statesKnown,
}: {
  row: AppRow;
  declaredKnown: boolean;
  statesKnown: boolean;
}) {
  const { t } = useTranslation();
  const { declared, state } = row;
  const addons = declared?.addons ?? [];
  const pins = new Map((declared?.addonPins ?? []).map((pin) => [pin.name, pin]));
  const conditions = state?.conditions ?? [];
  return (
    <div className="admin-console__subsection">
      <h3 className="admin-console__subsection-title">{t("apps.stateTitle")}</h3>
      <div className="admin-console__edit-panel">
        <Fact label={t("apps.app")}>
          <span className="admin-console__mono">{row.profile}</span>
        </Fact>
        <Fact label={t("apps.onCluster")}>
          {state ? (
            <>
              <Standing row={row} declaredKnown={declaredKnown} statesKnown={statesKnown} />
              {state.message ? <div>{state.message}</div> : null}
              {state.failure && state.failure !== state.message ? (
                <div className="admin-console__mono">{state.failure}</div>
              ) : null}
            </>
          ) : statesKnown ? (
            t("apps.noComponent")
          ) : (
            t("apps.unknown")
          )}
        </Fact>
        <Fact label={t("apps.inGit")}>
          {declared ? t("apps.declaredYes") : declaredKnown ? t("apps.declaredNo") : t("apps.unknown")}
        </Fact>
        <Fact label={t("apps.build")}>
          {declared?.digest ? (
            <>
              <span className="admin-console__mono" title={declared.digest}>
                {shortDigest(declared.digest)}
              </span>{" "}
              <CopyValue value={declared.digest} />
            </>
          ) : declared ? (
            t("apps.notPinned")
          ) : (
            "—"
          )}
        </Fact>
        <Fact label={t("apps.version")}>{t("apps.notAvailableYet")}</Fact>
        <Fact label={t("apps.catalogue")}>
          {declared?.catalogue ? (
            <span className="admin-console__mono">{declared.catalogue}</span>
          ) : (
            t("apps.notAvailableYet")
          )}
        </Fact>
        <Fact label={t("apps.addons")}>
          {addons.length === 0
            ? t("apps.addonsNone")
            : addons.map((addon) => {
                const pin = pins.get(addon);
                return (
                  <div key={addon}>
                    <span className="admin-console__chip">{addon}</span>{" "}
                    {pin ? (
                      <>
                        <span className="admin-console__mono" title={pin.digest}>
                          {shortDigest(pin.digest)}
                        </span>
                        {pin.catalogue ? (
                          <>
                            {" "}
                            <Trans i18nKey="apps.addonFrom" values={{ catalogue: pin.catalogue }} components={mono} />
                          </>
                        ) : null}
                      </>
                    ) : (
                      t("apps.notPinned")
                    )}
                  </div>
                );
              })}
        </Fact>
        <Fact label={t("apps.forEveryone")}>
          {declared ? (declared.defaultGrant ? t("apps.yes") : t("apps.no")) : "—"}
        </Fact>
      </div>
      {conditions.length > 0 ? (
        <div className="admin-console__table-wrap">
          <table className="admin-console__table">
            <thead>
              <tr>
                <th>{t("apps.condition")}</th>
                <th>{t("apps.conditionStatus")}</th>
                <th>{t("apps.conditionReason")}</th>
                <th>{t("apps.conditionMessage")}</th>
              </tr>
            </thead>
            <tbody>
              {conditions.map((c) => (
                <tr key={c.type}>
                  <td className="admin-console__mono">{c.type}</td>
                  <td className="admin-console__mono">{c.status}</td>
                  <td className="admin-console__mono">{c.reason || "—"}</td>
                  <td>{c.message || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Access: whether the app is for everyone, and who has it now.
 *
 * "For everyone" is a key on the app's entry in git. Switching it restates
 * that key through the director's install route and leaves the pinned build
 * alone. It is offered only for an app git declares, because the same request
 * for one git does not have would install it.
 *
 * Who has access now is who is in the app's group, and that is the registrar's
 * list, changed a person at a time.
 */
export function AccessPart({
  row,
  tenant,
  onOutcome,
}: {
  row: AppRow;
  tenant: string;
  onOutcome: (outcome: Outcome) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { profile, declared } = row;
  const everyone = Boolean(declared?.defaultGrant);

  const groupsQuery = useQuery({
    queryKey: ["admin", "people", "groups"],
    queryFn: () => fetchPersonGroups(),
  });
  // The app's group, found the way Members and Groups find it: by what the
  // registrar's path says it is for, never by a name put together here.
  const group = useMemo(
    () =>
      describeGroups(groupsQuery.data?.groups ?? [], tenant).find(
        (g) => g.kind === "app" && g.label === profile,
      ),
    [groupsQuery.data, tenant, profile],
  );

  const access = useMutation({
    mutationFn: (next: boolean) => setAppForEveryone(profile, next),
    onSuccess: (result, next) => {
      onOutcome({ kind: "access", app: profile, everyone: next, result });
      void queryClient.invalidateQueries({ queryKey: ["admin", "apps", "declared"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "people"] });
    },
  });

  function switchAccess() {
    const question = everyone
      ? t("apps.everyoneOffConfirm", { app: profile, tenant })
      : t("apps.everyoneOnConfirm", { app: profile, tenant });
    if (window.confirm(question)) access.mutate(!everyone);
  }

  // A default component is the platform's: who may open it is decided for
  // the cluster, not by the tenant, so nothing here is offered for it.
  if (row.state?.origin === "default") {
    return (
      <div className="admin-console__subsection">
        <h3 className="admin-console__subsection-title">{t("apps.accessTitle")}</h3>
        <p className="admin-console__hint">{t("apps.accessPlatformManaged")}</p>
      </div>
    );
  }

  return (
    <div className="admin-console__subsection">
      <h3 className="admin-console__subsection-title">{t("apps.accessTitle")}</h3>
      {declared ? (
        <>
          <p className="admin-console__lead">
            {everyone ? t("apps.everyoneIsOn") : t("apps.everyoneIsOff")}
          </p>
          <div className="admin-console__actions">
            <button
              type="button"
              className="admin-console__btn"
              disabled={access.isPending}
              onClick={switchAccess}
            >
              {everyone ? t("apps.everyoneSwitchOff") : t("apps.everyoneSwitchOn")}
            </button>
          </div>
          {access.isError ? <p className="admin-console__error">{messageOf(access.error)}</p> : null}
        </>
      ) : (
        <p className="admin-console__hint">{t("apps.everyoneNotDeclared")}</p>
      )}

      <h4 className="admin-console__group-title">{t("apps.peopleTitle")}</h4>
      {groupsQuery.isLoading ? (
        <p className="admin-console__hint">{t("apps.readingGroup")}</p>
      ) : groupsQuery.isError ? (
        <p className="admin-console__error">{messageOf(groupsQuery.error)}</p>
      ) : group ? (
        <>
          <p className="admin-console__hint">
            <Trans i18nKey="apps.peopleLead" values={{ group: group.path }} components={mono} />
          </p>
          <GroupMembers group={group} />
        </>
      ) : (
        <p className="admin-console__hint">{t("apps.noGroupYet")}</p>
      )}

      {(declared?.addons ?? []).length > 0 ? (
        <>
          <h4 className="admin-console__group-title">{t("apps.addonAccessTitle")}</h4>
          <p className="admin-console__hint">{t("apps.addonAccessLead")}</p>
          {(declared?.addons ?? []).map((addon) => (
            <AddonAccess
              key={addon}
              profile={profile}
              addon={addon}
              tenant={tenant}
              everyone={(declared?.addonGrants ?? []).some((g) => g.name === addon && g.defaultGrant)}
              groups={groupsQuery.data?.groups ?? []}
              onOutcome={onOutcome}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

/**
 * One add-on's own access. An add-on is entitled by its own group, as an app
 * is: whether it is for everyone, and who is in its group, are the add-on's,
 * not the app's.
 */
function AddonAccess({
  profile,
  addon,
  tenant,
  everyone,
  groups,
  onOutcome,
}: {
  profile: string;
  addon: string;
  tenant: string;
  everyone: boolean;
  groups: Parameters<typeof describeGroups>[0];
  onOutcome: (outcome: Outcome) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const group = useMemo(
    () => describeGroups(groups, tenant).find((g) => g.kind === "app" && g.label === addon),
    [groups, tenant, addon],
  );
  const access = useMutation({
    mutationFn: (next: boolean) => setAddonForEveryone(profile, addon, next),
    onSuccess: (result, next) => {
      onOutcome({ kind: "access", app: addon, everyone: next, result });
      void queryClient.invalidateQueries({ queryKey: ["admin", "apps", "declared"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "people"] });
    },
  });
  function switchAccess() {
    const question = everyone
      ? t("apps.everyoneOffConfirm", { app: addon, tenant })
      : t("apps.everyoneOnConfirm", { app: addon, tenant });
    if (window.confirm(question)) access.mutate(!everyone);
  }
  return (
    <div className="admin-console__subsection" data-addon={addon}>
      <h5 className="admin-console__group-title">
        <span className="admin-console__chip">{addon}</span>
      </h5>
      <p className="admin-console__lead">{everyone ? t("apps.addonEveryoneIsOn") : t("apps.addonEveryoneIsOff")}</p>
      <div className="admin-console__actions">
        <button type="button" className="admin-console__btn" disabled={access.isPending} onClick={switchAccess}>
          {everyone ? t("apps.everyoneSwitchOff") : t("apps.everyoneSwitchOn")}
        </button>
      </div>
      {access.isError ? <p className="admin-console__error">{messageOf(access.error)}</p> : null}
      {group ? <GroupMembers group={group} /> : <p className="admin-console__hint">{t("apps.addonNoGroupYet")}</p>}
    </div>
  );
}

/**
 * Integrations: what this app consumes from other apps and what it offers
 * them, read from the same answer the Integrations screen shows, narrowed to
 * this app. What an app may consume is changed there, not here.
 */
function IntegrationsPart({
  row,
  tenant,
  onOpenIntegrations,
}: {
  row: AppRow;
  tenant: string;
  onOpenIntegrations: () => void;
}) {
  const { t } = useTranslation();
  const overviewQuery = useQuery({
    queryKey: ["admin", "integrations", tenant],
    queryFn: () => fetchIntegrationsOverview(tenant),
  });
  // An app is named by its profile and, on the cluster, by its component;
  // the two are usually the same word and either may appear in a binding.
  const names = new Set([row.profile, row.state?.name].filter(Boolean) as string[]);
  const mine = (overviewQuery.data?.effectiveAccess ?? []).filter(
    (entry) => names.has(entry.consumer) || names.has(entry.provider),
  );

  return (
    <div className="admin-console__subsection">
      <h3 className="admin-console__subsection-title">{t("apps.integrationsTitle")}</h3>
      {overviewQuery.isLoading ? (
        <p className="admin-console__hint">{t("apps.readingIntegrations")}</p>
      ) : overviewQuery.isError ? (
        <p className="admin-console__error">{messageOf(overviewQuery.error)}</p>
      ) : mine.length === 0 ? (
        <p className="admin-console__hint">{t("apps.integrationsNone")}</p>
      ) : (
        <div className="admin-console__table-wrap">
          <table className="admin-console__table">
            <thead>
              <tr>
                <th>{t("apps.contract")}</th>
                <th>{t("apps.direction")}</th>
                <th>{t("apps.bound")}</th>
                <th>{t("apps.granted")}</th>
                <th>{t("apps.grantPhase")}</th>
              </tr>
            </thead>
            <tbody>
              {mine.map((entry) => (
                <tr key={`${entry.consumer}-${entry.provider}-${entry.contract}`}>
                  <td>
                    <code>{entry.contract}</code>
                  </td>
                  <td>
                    {names.has(entry.consumer) ? (
                      <Trans i18nKey="apps.consumesFrom" values={{ app: entry.provider }} components={mono} />
                    ) : (
                      <Trans i18nKey="apps.offersTo" values={{ app: entry.consumer }} components={mono} />
                    )}
                  </td>
                  <td className="admin-console__mono">{entry.bindingCapabilities.join(", ") || "—"}</td>
                  <td className="admin-console__mono">{entry.grantedCapabilities.join(", ") || "—"}</td>
                  <td className="admin-console__mono">{entry.grantPhase || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="admin-console__actions">
        <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={onOpenIntegrations}>
          {t("apps.openIntegrations")}
        </button>
      </div>
    </div>
  );
}

/**
 * Privileges: what the app asked of the platform beyond the default posture,
 * and what was answered.
 *
 * Two services, joined: the cluster names the requests nobody has granted yet
 * (the app waits on them), and git holds each approval with who gave it and
 * why. Together they are everything the app asked for that needs an answer.
 *
 * Each request is answered here by whoever holds the right it needs, one
 * commit with the approver's reason. Which right that is the operator says
 * on the request (approvedBy): the tenant's perimeter approver for egress
 * (can_approve_privilege), the cluster's security officer for what weakens
 * the node (cluster can_approve). The button follows the director's answer
 * to that right; anyone else is told whose it is rather than offered what
 * the director would refuse. The director asks again on the approval.
 */
export function PrivilegesPart({ row }: { row: AppRow }) {
  const { t } = useTranslation();
  const grantsQuery = useQuery({
    queryKey: ["admin", "apps", "privileges"],
    queryFn: () => fetchTenantPrivileges(),
  });
  const names = new Set([row.profile, row.state?.name].filter(Boolean) as string[]);
  const approved = (grantsQuery.data?.privileges ?? []).filter((g) => names.has(g.install));
  const pending = row.state?.pendingPrivileges ?? [];
  const contextQuery = useQuery({
    queryKey: ["admin", "context"],
    queryFn: () => fetchAdminContext(),
  });
  const context = contextQuery.data;
  const approvedBy = new Map(
    (row.state?.pendingPrivilegeApprovals ?? []).map((p) => [p.privilege, p.approvedBy]),
  );
  const declined = new Map(
    (row.state?.pendingPrivilegeApprovals ?? []).filter((p) => p.declinedBy).map((p) => [p.privilege, p]),
  );
  const install = row.state?.name ?? row.profile;

  return (
    <div className="admin-console__subsection">
      <h3 className="admin-console__subsection-title">{t("apps.privilegesTitle")}</h3>
      <p className="admin-console__hint">{t("apps.privilegesLead")}</p>
      {!row.state ? <p className="admin-console__hint">{t("apps.pendingUnknown")}</p> : null}
      {grantsQuery.isError ? (
        <p className="admin-console__error">
          {t("apps.approvedUnavailable")} {messageOf(grantsQuery.error)}
        </p>
      ) : null}
      {grantsQuery.isLoading ? (
        <p className="admin-console__hint">{t("apps.readingPrivileges")}</p>
      ) : pending.length === 0 && approved.length === 0 ? (
        <p className="admin-console__hint">{t("apps.privilegesNone")}</p>
      ) : (
        <div className="admin-console__table-wrap">
          <table className="admin-console__table">
            <thead>
              <tr>
                <th>{t("apps.privilege")}</th>
                <th>{t("apps.answer")}</th>
                <th>{t("apps.answerDetail")}</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((privilege) => (
                <tr key={`pending-${privilege}`}>
                  <td className="admin-console__mono">{privilege}</td>
                  <td>
                    <span className="admin-console__badge admin-console__badge--warn">
                      {t(declined.has(privilege) ? "apps.privilegeDeclined" : "apps.privilegeWaiting")}
                    </span>
                  </td>
                  <td>
                    {declined.has(privilege) ? (
                      <>
                        <div>
                          <Trans
                            i18nKey="apps.privilegeDeclinedBy"
                            values={{
                              who: declined.get(privilege)?.declinedBy ?? "",
                              when: declined.get(privilege)?.declinedAt
                                ? formatDateTime(declined.get(privilege)?.declinedAt as string)
                                : "",
                            }}
                            components={mono}
                          />
                        </div>
                        <div>{declined.get(privilege)?.declineReason}</div>
                        <div className="admin-console__hint">{t("apps.privilegeDeclinedDetail")}</div>
                      </>
                    ) : (
                      <div>{t("apps.privilegeWaitingDetail")}</div>
                    )}
                    {mayApprove(approvedBy.get(privilege), context) ? (
                      <ApprovePrivilege install={install} privilege={privilege} />
                    ) : (approvedBy.get(privilege) ?? legacyApprover(privilege)) === "perimeter-approver" ? (
                      <div className="admin-console__hint">{t("apps.privilegeApproveNotYours")}</div>
                    ) : (
                      <div className="admin-console__hint">{t("apps.privilegeApproveSecurityOfficer")}</div>
                    )}
                  </td>
                </tr>
              ))}
              {approved.map((grant) => (
                <tr key={`approved-${grant.install}-${grant.privilege}`}>
                  <td className="admin-console__mono">{grant.privilege}</td>
                  <td>
                    <span className="admin-console__badge admin-console__badge--ok">
                      {t("apps.privilegeApproved")}
                    </span>
                  </td>
                  <td>
                    <div>
                      <Trans
                        i18nKey="apps.privilegeApprovedBy"
                        values={{
                          approver: grant.approver,
                          when: formatDateTime(grant.approvedAt),
                        }}
                        components={mono}
                      />
                    </div>
                    <div>{grant.reason}</div>
                    {grant.expiresAt ? (
                      <div>
                        {t("apps.privilegeExpires", { when: formatDateTime(grant.expiresAt) })}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="admin-console__hint">{t("apps.privilegeDetailNotAvailable")}</p>
    </div>
  );
}

/**
 * Whether the director would let this person answer a request that the
 * operator says is answered by `approvedBy`. Nothing is inferred: a request
 * without approvedBy (an older operator), a value this console does not know,
 * or a context without the right (an older backend) is a no.
 */
function mayApprove(approvedBy: string | undefined, context: AdminContext | undefined): boolean {
  if (approvedBy === "perimeter-approver") return context?.canApprovePrivilege === true;
  if (approvedBy === "security-officer") return context?.canApproveNodePrivilege === true;
  return false;
}

/**
 * Whose a request is, for the wording alone, when an operator older than
 * approvedBy did not say: the rule such an operator applied. It never offers
 * the button; that waits for the operator's own answer.
 */
function legacyApprover(privilege: string): string {
  return privilege.startsWith("egress/") ? "perimeter-approver" : "security-officer";
}

/**
 * Approve one waiting request: a reason in the approver's words, then one
 * commit through the director. The director decides whether this person may
 * and records them as the approver; its refusal is shown as it worded it.
 */
function ApprovePrivilege({ install, privilege }: { install: string; privilege: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const approve = useMutation({
    mutationFn: () => approvePrivilege(install, privilege, { reason: reason.trim() }),
    onSuccess: () => {
      setOpen(false);
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "apps", "privileges"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "apps", "status"] });
    },
  });
  const tooShort = reason.trim().length < 10;

  if (!open) {
    return (
      <div className="admin-console__actions">
        <button type="button" className="admin-console__btn" onClick={() => setOpen(true)}>
          {t("apps.privilegeApprove")}
        </button>
        {approve.isSuccess ? <span className="admin-console__hint">{t("apps.privilegeApproved")}</span> : null}
      </div>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!tooShort) approve.mutate();
      }}
    >
      <label className="admin-console__field">
        <span>{t("apps.privilegeApproveReason")}</span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          minLength={10}
          maxLength={1000}
          rows={3}
        />
      </label>
      <p className="admin-console__hint">{t("apps.privilegeApproveHint")}</p>
      {approve.isError ? (
        <p className="admin-console__error">
          {t("apps.privilegeApproveFailed")} {messageOf(approve.error)}
        </p>
      ) : null}
      <div className="admin-console__actions">
        <button type="submit" className="admin-console__btn" disabled={tooShort || approve.isPending}>
          {t("apps.privilegeApproveConfirm", { privilege })}
        </button>
        <button
          type="button"
          className="admin-console__btn admin-console__btn--quiet"
          disabled={approve.isPending}
          onClick={() => setOpen(false)}
        >
          {t("apps.privilegeApproveCancel")}
        </button>
      </div>
    </form>
  );
}

/**
 * Uninstall: removes the app and keeps its data.
 *
 * A commit, like the install was. The app and its sign-in client go; its
 * files, database, object storage, stored credentials and access group stay.
 * Destroying those is a different act with a different name, offered
 * elsewhere on this screen and only once the app is gone -- so taking an app
 * away never takes its data with it by accident.
 */
function UninstallPart({
  row,
  tenant,
  declaredKnown,
  onOutcome,
}: {
  row: AppRow;
  tenant: string;
  declaredKnown: boolean;
  onOutcome: (outcome: Outcome) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { profile } = row;
  const uninstall = useMutation({
    mutationFn: () => uninstallApp(profile),
    onSuccess: (result) => {
      onOutcome({ kind: "uninstall", app: profile, result });
      void queryClient.invalidateQueries({ queryKey: ["admin", "apps"] });
    },
  });

  return (
    <div className="admin-console__subsection">
      <h3 className="admin-console__subsection-title">{t("apps.uninstallTitle")}</h3>
      {row.declared || !declaredKnown ? (
        <>
          <p className="admin-console__lead">{t("apps.uninstallLead")}</p>
          <div className="admin-console__actions">
            <button
              type="button"
              className="admin-console__btn admin-console__btn--danger"
              disabled={uninstall.isPending}
              onClick={() => {
                if (window.confirm(t("apps.uninstallConfirm", { app: profile, tenant }))) uninstall.mutate();
              }}
            >
              {t("apps.uninstall")}
            </button>
          </div>
          {uninstall.isError ? <p className="admin-console__error">{messageOf(uninstall.error)}</p> : null}
        </>
      ) : (
        <p className="admin-console__hint">{t("apps.alreadyUninstalled")}</p>
      )}
    </div>
  );
}

/**
 * What the director answered, said once.
 *
 * With a commit, git has the change and the cluster does not yet. Without
 * one, the tenant already was as asked.
 */
function OutcomeNotice({ outcome }: { outcome: Outcome }) {
  const { app, result, kind, everyone } = outcome;
  const commit = (result.commit ?? "").slice(0, 8);
  const values = { app, commit, status: result.status };
  if (kind === "access" && result.commit) {
    return (
      <p className="admin-console__success">
        {everyone ? (
          <Trans i18nKey="apps.outcomeEveryoneOn" values={values} components={mono} />
        ) : (
          <Trans i18nKey="apps.outcomeEveryoneOff" values={values} components={mono} />
        )}
      </p>
    );
  }
  if (kind === "access" && result.status === "already_installed") {
    return (
      <p className="admin-console__hint">
        <Trans i18nKey="apps.outcomeAccessUnchanged" values={values} components={mono} />
      </p>
    );
  }
  if (kind === "uninstall" && result.status === "uninstalled" && result.commit) {
    return (
      <p className="admin-console__success">
        <Trans i18nKey="apps.outcomeUninstalled" values={values} components={mono} />
      </p>
    );
  }
  if (kind === "uninstall" && result.status === "not_installed") {
    return (
      <p className="admin-console__hint">
        <Trans i18nKey="apps.outcomeNotInstalled" values={values} components={mono} />
      </p>
    );
  }
  // An answer this screen has no sentence for is shown as it came.
  return (
    <p className="admin-console__hint">
      <Trans i18nKey="apps.outcomeOther" values={values} components={mono} />
    </p>
  );
}

/** The kinds of data an uninstalled app can still hold, in the order shown. */
const RETAINED_KINDS = ["files", "database", "objectStorage", "credentials", "accessGroup", "cache"] as const;

/** How a purge ended, for the notice that says so. */
type PurgeOutcome =
  | { app: string; result: AppPurgeResult }
  | { app: string; refused: boolean; message: string };

/** Whether a purge ended with an answer that says it is complete. */
const purgeComplete = (outcome: PurgeOutcome) => "result" in outcome && outcome.result.complete === true;

/** Purging one app, its answer or failure turned into how it ended. */
async function purgeOne(app: string): Promise<PurgeOutcome> {
  try {
    return { app, result: await purgeAppData(app) };
  } catch (err) {
    const status = err instanceof ApiError ? err.status : undefined;
    return {
      app,
      // A 4xx is the cluster declining to start. Anything else -- a purge
      // that stopped half-way, a relay that stopped waiting, no answer at
      // all -- may have destroyed something, and asking again is safe.
      refused: status !== undefined && status >= 400 && status < 500,
      message: (err instanceof ApiError && err.detail) || messageOf(err),
    };
  }
}

/**
 * Uninstalled apps with retained data, and purging them.
 *
 * Uninstalling keeps what an app stored, and this list is the only place that
 * says so afterwards: the apps the tenant no longer has that still hold data,
 * and which kinds each one holds. It is the cluster's answer and it is built
 * on the matching a purge uses, so what a row shows is what purging that app
 * destroys.
 *
 * Rows can be selected, and the selected apps purged behind one confirmation
 * that lists them all -- an app with many add-ons leaves many rows. The purges
 * run one after the other, each the same request a single purge makes.
 *
 * A purge is one request that is answered when it is over, which can take
 * minutes. Nothing here gives up before the answer; while purges run the
 * dialog stays open, says how far it got and how each one ended, and nothing
 * else can be started. What comes back is shown as the cluster said it, and
 * only an answer that says it is complete is called done.
 *
 * The answer also names the kinds of data the cluster could not check, and
 * why. Whenever it names any, the list may be missing apps, and that is said
 * above it; an empty list is then not called empty.
 *
 * Naming an app by hand is offered when the list could not be read, and when
 * it came back empty without everything having been checked.
 */
export function RetainedSection({ tenant, declared }: { tenant: string; declared?: DeclaredApp[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // The apps the dialog asks about, before the purge is confirmed.
  const [asking, setAsking] = useState<string[] | null>(null);
  // The confirmed purges and how each finished one ended, while they run.
  const [running, setRunning] = useState<{ apps: string[]; done: PurgeOutcome[] } | null>(null);
  const [outcomes, setOutcomes] = useState<PurgeOutcome[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const runningRef = useRef(false);
  const busy = running !== null;

  const retainedQuery = useQuery({
    queryKey: ["admin", "apps", "retained"],
    queryFn: () => fetchRetainedApps(),
    refetchInterval: APPS_REFRESH_MS,
  });

  async function run(apps: string[]) {
    if (runningRef.current || apps.length === 0) return;
    runningRef.current = true;
    setOutcomes([]);
    setAsking(null);
    const done: PurgeOutcome[] = [];
    setRunning({ apps, done });
    for (const app of apps) {
      done.push(await purgeOne(app));
      setRunning({ apps, done: [...done] });
    }
    runningRef.current = false;
    setRunning(null);
    setOutcomes(done);
    // What is purged is gone from the list; what did not finish stays selected.
    setSelected((prev) => {
      const next = new Set(prev);
      for (const outcome of done) if (purgeComplete(outcome)) next.delete(outcome.app);
      return next;
    });
    // Whatever the answers, what is held may have changed.
    void queryClient.invalidateQueries({ queryKey: ["admin", "apps", "retained"] });
  }

  function ask(apps: string[]) {
    if (busy || apps.length === 0) return;
    setOutcomes([]);
    setAsking(apps);
  }

  const apps = retainedQuery.data?.apps ?? [];
  const reasons = retainedQuery.data?.unknown ?? {};
  // Only an app whose profile is available can be purged, so only it can be selected.
  const selectable = apps.filter((app) => app.profileAvailable).map((app) => app.profile);
  const chosen = selectable.filter((app) => selected.has(app));
  const allChosen = selectable.length > 0 && chosen.length === selectable.length;

  function toggle(app: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(app);
      else next.delete(app);
      return next;
    });
  }

  // Every kind the cluster could not check, the known ones first in the order
  // the table shows them: an app that holds only such data is not listed.
  const known: readonly string[] = RETAINED_KINDS;
  const uncheckedKinds = [
    ...known.filter((kind) => kind in reasons),
    ...Object.keys(reasons).filter((kind) => !known.includes(kind)),
  ];
  const incomplete = uncheckedKinds.length > 0;
  const byName = (
    <details>
      <summary className="admin-console__hint">{t("apps.purgeByName")}</summary>
      <PurgeByName declared={declared} busy={busy} onAsk={(app) => ask([app])} />
    </details>
  );
  const dialogApps = running?.apps ?? asking;

  return (
    <div className="admin-console__subsection">
      <h3 className="admin-console__subsection-title">{t("apps.retainedTitle")}</h3>
      <p className="admin-console__lead">{t("apps.retainedLead")}</p>

      {outcomes.length > 1 ? (
        <p className="admin-console__lead" role="status">
          {t("apps.purgeBatchSummary", {
            complete: outcomes.filter(purgeComplete).length,
            count: outcomes.length,
          })}
        </p>
      ) : null}
      {outcomes.map((outcome) => (
        <PurgeOutcomeNotice key={outcome.app} outcome={outcome} busy={busy} onRetry={() => void run([outcome.app])} />
      ))}

      {retainedQuery.isLoading ? (
        <p className="admin-console__hint">{t("apps.retainedReading")}</p>
      ) : retainedQuery.isError ? (
        <>
          <p className="admin-console__error">
            {t("apps.retainedUnavailable")} {messageOf(retainedQuery.error)}
          </p>
          {byName}
        </>
      ) : (
        <>
          {incomplete ? (
            <div className="admin-console__warning" role="status">
              <p>
                <strong>{t("apps.retainedIncomplete")}</strong>
              </p>
              {uncheckedKinds.map((kind) => (
                <p key={kind}>{t("apps.retainedUncheckedWhy", { kind: kindWord(t, kind), why: reasons[kind] })}</p>
              ))}
            </div>
          ) : null}
          {apps.length === 0 ? (
            incomplete ? (
              <>
                <p className="admin-console__empty">{t("apps.retainedNoneChecked")}</p>
                {byName}
              </>
            ) : (
              <p className="admin-console__empty">{t("apps.retainedNone")}</p>
            )
          ) : (
            <>
              <div className="admin-console__actions">
                <button
                  type="button"
                  className="admin-console__btn admin-console__btn--danger"
                  disabled={busy || chosen.length === 0}
                  onClick={() => ask(chosen)}
                >
                  {t("apps.purgeSelected", { count: chosen.length })}
                </button>
              </div>
              <div className="admin-console__table-wrap">
                <table className="admin-console__table">
                  <thead>
                    <tr>
                      <th>
                        <SelectAll
                          checked={allChosen}
                          partial={chosen.length > 0 && !allChosen}
                          disabled={busy || selectable.length === 0}
                          onChange={(on) => setSelected(new Set(on ? selectable : []))}
                        />
                      </th>
                      <th>{t("apps.app")}</th>
                      {RETAINED_KINDS.map((kind) => (
                        <th key={kind}>{kindWord(t, kind)}</th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {apps.map((app) => (
                      <RetainedRow
                        key={app.profile}
                        app={app}
                        busy={busy}
                        selected={selected.has(app.profile)}
                        onSelect={(on) => toggle(app.profile, on)}
                        onAsk={(name) => ask([name])}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {dialogApps ? (
        <PurgeDialog
          apps={dialogApps}
          tenant={tenant}
          done={running?.done ?? null}
          onConfirm={() => void run(dialogApps)}
          onClose={() => setAsking(null)}
        />
      ) : null}
    </div>
  );
}

/** The header checkbox: on when every selectable row is, mixed when some are. */
function SelectAll({
  checked,
  partial,
  disabled,
  onChange,
}: {
  checked: boolean;
  partial: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = partial;
  }, [partial]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={t("apps.retainedSelectAll")}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

/** A kind of data, in the reader's words; one the screen has no word for is shown as it came. */
function kindWord(t: TFunction, kind: string): string {
  switch (kind) {
    case "files":
      return t("apps.kindFiles");
    case "database":
      return t("apps.kindDatabase");
    case "objectStorage":
      return t("apps.kindObjectStorage");
    case "credentials":
      return t("apps.kindCredentials");
    case "accessGroup":
      return t("apps.kindAccessGroup");
    case "cache":
      return t("apps.kindCache");
    case "provisioningRecords":
      return t("apps.kindProvisioningRecords");
    case "database.mariadb":
      return t("apps.kindMariaDB");
    case "credentials.extensions":
      return t("apps.kindExtensionCredentials");
    case "accessGroup.extensions":
      return t("apps.kindExtensionGroups");
    case "files.chartNamed":
      return t("apps.kindChartNamedFiles");
    default:
      return kind;
  }
}

/** Whether one kind of data is there, as the cluster said it. */
function KindState({ state }: { state?: string }) {
  const { t } = useTranslation();
  if (state === "present") {
    return <span className="admin-console__badge admin-console__badge--info">{t("apps.kindPresent")}</span>;
  }
  if (state === "absent") {
    return <span className="admin-console__badge">{t("apps.kindAbsent")}</span>;
  }
  if (state === "unknown") {
    return <span className="admin-console__badge admin-console__badge--warn">{t("apps.kindUnknown")}</span>;
  }
  return state ? <span className="admin-console__badge admin-console__mono">{state}</span> : <>—</>;
}

function RetainedRow({
  app,
  busy,
  selected,
  onSelect,
  onAsk,
}: {
  app: RetainedApp;
  busy: boolean;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onAsk: (app: string) => void;
}) {
  const { t } = useTranslation();
  const volumes = app.volumes ?? [];
  return (
    <tr>
      <td>
        <input
          type="checkbox"
          aria-label={t("apps.retainedSelect", { app: app.profile })}
          checked={selected && app.profileAvailable}
          disabled={busy || !app.profileAvailable}
          onChange={(e) => onSelect(e.target.checked)}
        />
      </td>
      <td className="admin-console__mono">{app.profile}</td>
      {RETAINED_KINDS.map((kind) => (
        <td key={kind}>
          <KindState state={app.kinds?.[kind]} />
          {kind === "files"
            ? volumes.map((volume) => (
                <div key={volume} className="admin-console__mono">
                  {volume}
                </div>
              ))
            : null}
        </td>
      ))}
      <td>
        <button
          type="button"
          className="admin-console__btn admin-console__btn--danger"
          disabled={busy || !app.profileAvailable}
          onClick={() => onAsk(app.profile)}
        >
          {t("apps.purge")}
        </button>
        {app.profileAvailable ? null : <div className="admin-console__hint">{t("apps.purgeNeedsProfile")}</div>}
      </td>
    </tr>
  );
}

/**
 * How the purge ended, in the cluster's words.
 *
 * Done is said only for an answer that says it is complete. An answer that
 * looks like success and does not say so is incomplete, with what was not
 * examined. A refusal is shown as the reason it gave; a purge that did not
 * finish is shown whole -- it names the step that failed, what was already
 * destroyed and what was not attempted -- with the way to ask again.
 */
function PurgeOutcomeNotice({
  outcome,
  busy,
  onRetry,
}: {
  outcome: PurgeOutcome;
  busy: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const { app } = outcome;
  if ("result" in outcome) {
    const { result } = outcome;
    if (result.complete === true) {
      return (
        <p className="admin-console__success" role="status">
          <Trans i18nKey="apps.purgeComplete" values={{ app }} components={mono} />
        </p>
      );
    }
    const notExamined = result.notExamined ?? [];
    return (
      <div className="admin-console__warning" role="alert">
        <p>
          <strong>
            <Trans i18nKey="apps.purgeIncomplete" values={{ app }} components={mono} />
          </strong>
        </p>
        {notExamined.length > 0 ? (
          <>
            <p>{t("apps.purgeNotExamined")}</p>
            <ul>
              {notExamined.map((kind) => (
                <li key={kind}>{kindWord(t, kind)}</li>
              ))}
            </ul>
          </>
        ) : null}
        <p>
          <Trans i18nKey="apps.purgeClusterAnswered" values={{ status: result.status }} components={mono} />
        </p>
        {result.message ? <p>{result.message}</p> : null}
      </div>
    );
  }
  if (outcome.refused) {
    return (
      <div className="admin-console__error" role="alert">
        <p>
          <strong>
            <Trans i18nKey="apps.purgeRefused" values={{ app }} components={mono} />
          </strong>
        </p>
        <p>{outcome.message}</p>
      </div>
    );
  }
  return (
    <div className="admin-console__error" role="alert">
      <p>
        <strong>
          <Trans i18nKey="apps.purgeFailed" values={{ app }} components={mono} />
        </strong>
      </p>
      <p>{outcome.message}</p>
      <p>{t("apps.purgeRetryHint")}</p>
      <div className="admin-console__actions">
        <button type="button" className="admin-console__btn admin-console__btn--danger" disabled={busy} onClick={onRetry}>
          {t("apps.purgeRetry")}
        </button>
      </div>
    </div>
  );
}

/**
 * Naming the app by hand, for when the list of retained apps could not be
 * read, or is empty without everything having been checked. The cluster still refuses the request for an app that is installed or
 * still being taken down.
 */
function PurgeByName({
  declared,
  busy,
  onAsk,
}: {
  declared?: DeclaredApp[];
  busy: boolean;
  onAsk: (app: string) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const app = name.trim();
  const valid = APP_NAME.test(app);
  const stillInstalled = (declared ?? []).some((d) => d.profile === app);

  return (
    <form
      className="admin-console__form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !stillInstalled && !busy) onAsk(app);
      }}
    >
      <div className="admin-console__field-row">
        <div className="admin-console__field">
          <label htmlFor="purge-app-name">{t("apps.purgeName")}</label>
          <input
            id="purge-app-name"
            value={name}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="admin-console__field" />
      </div>
      {app && !valid ? <p className="admin-console__hint">{t("apps.purgeNameInvalid")}</p> : null}
      {stillInstalled ? (
        <p className="admin-console__hint">
          <Trans i18nKey="apps.purgeStillInstalled" values={{ app }} components={mono} />
        </p>
      ) : null}
      <div className="admin-console__form-footer">
        <button
          type="submit"
          className="admin-console__btn admin-console__btn--danger"
          disabled={!valid || stillInstalled || busy}
        >
          {t("apps.purgeOpen")}
        </button>
      </div>
    </form>
  );
}

/** How one purge in a run stands, as a word for the progress list. */
function purgeStateWord(t: TFunction, outcome: PurgeOutcome | undefined, current: boolean): ReactNode {
  if (!outcome) {
    return current ? (
      <span className="admin-console__badge admin-console__badge--info">{t("apps.purgeStateRunning")}</span>
    ) : (
      <span className="admin-console__badge">{t("apps.purgeStateWaiting")}</span>
    );
  }
  if (purgeComplete(outcome)) {
    return <span className="admin-console__badge admin-console__badge--info">{t("apps.purgeStateComplete")}</span>;
  }
  if ("result" in outcome) {
    return <span className="admin-console__badge admin-console__badge--warn">{t("apps.purgeStateIncomplete")}</span>;
  }
  return (
    <span className="admin-console__badge admin-console__badge--warn">
      {outcome.refused ? t("apps.purgeStateRefused") : t("apps.purgeStateFailed")}
    </span>
  );
}

/**
 * Purging the data of one app or several, behind a typed confirmation.
 *
 * Typing is the confirmation because this is the one act on this screen
 * nothing brings back, and a click is too easy to make: one app's name, or,
 * for several, how many apps are listed.
 *
 * Once confirmed the dialog stays, saying the purges are running, until every
 * answer is there: it cannot be dismissed and offers nothing to press, so a
 * purge is not asked for twice and the answers are not walked away from. For
 * several apps it shows how far the run is and how each finished purge ended.
 * It sets no time limit of its own.
 */
export function PurgeDialog({
  apps,
  tenant,
  done,
  onConfirm,
  onClose,
}: {
  apps: string[];
  tenant: string;
  /** How each finished purge ended, once the purges are confirmed; null before. */
  done: PurgeOutcome[] | null;
  onConfirm: () => void;
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

  const single = apps.length === 1;
  const app = apps[0];
  const count = apps.length;
  const expected = single ? app : String(count);
  const confirmed = typed.trim() === expected;
  const pending = done !== null;

  return (
    <dialog
      ref={ref}
      className="admin-console__dialog"
      aria-labelledby="purge-app-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onClose();
      }}
    >
      {pending ? (
        <div className="admin-console__dialog-body" role="status" aria-live="polite">
          <h3 id="purge-app-title" className="admin-console__dialog-title">
            {single ? (
              <Trans i18nKey="apps.purgeRunningTitle" values={{ app }} components={mono} />
            ) : (
              t("apps.purgeBatchRunningTitle", { count })
            )}
          </h3>
          <p className="admin-console__lead">{t("apps.purgeRunningBody")}</p>
          {single ? null : (
            <>
              <p className="admin-console__lead">{t("apps.purgeBatchProgress", { done: done.length, count })}</p>
              <ul>
                {apps.map((name, i) => (
                  <li key={name}>
                    <span className="admin-console__mono">{name}</span>{" "}
                    {purgeStateWord(t, done[i], i === done.length)}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="admin-console__dialog-footer">
            <button type="button" className="admin-console__btn admin-console__btn--danger-solid" disabled>
              {t("apps.purging")}
            </button>
          </div>
        </div>
      ) : (
        <form
          className="admin-console__dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            if (confirmed) onConfirm();
          }}
        >
          <h3 id="purge-app-title" className="admin-console__dialog-title">
            {single ? (
              <Trans i18nKey="apps.purgeDialogTitle" values={{ app }} components={mono} />
            ) : (
              t("apps.purgeBatchDialogTitle", { count })
            )}
          </h3>
          <p className="admin-console__lead">
            {single ? (
              <Trans i18nKey="apps.purgeDialogBody" values={{ app, tenant }} components={mono} />
            ) : (
              <Trans i18nKey="apps.purgeBatchDialogBody" values={{ tenant }} components={mono} />
            )}
          </p>
          {single ? null : (
            <ul>
              {apps.map((name) => (
                <li key={name} className="admin-console__mono">
                  {name}
                </li>
              ))}
            </ul>
          )}
          <p className="admin-console__lead">{t("apps.purgeDialogKept")}</p>
          <p className="admin-console__lead">{t("apps.purgeDialogFinal")}</p>

          <label className="admin-console__label" htmlFor="purge-app-confirm">
            <span className="admin-console__label-text">
              {single ? (
                <Trans i18nKey="apps.purgeTypeToConfirm" values={{ app }} components={mono} />
              ) : (
                <Trans i18nKey="apps.purgeBatchTypeToConfirm" values={{ count }} components={mono} />
              )}
            </span>
            <input
              id="purge-app-confirm"
              type="text"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>

          <div className="admin-console__dialog-footer">
            <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={onClose}>
              {t("apps.cancel")}
            </button>
            <button type="submit" className="admin-console__btn admin-console__btn--danger-solid" disabled={!confirmed}>
              {t("apps.purgeConfirm")}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

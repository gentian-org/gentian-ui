/* SPDX-License-Identifier: Apache-2.0 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";
import {
  fetchAppStates,
  fetchIntegrationsOverview,
  fetchPersonGroups,
  type AppState,
} from "@/api/admin";
import {
  fetchDeclaredApps,
  fetchRetainedApps,
  fetchTenantPrivileges,
  purgeAppData,
  setAppForEveryone,
  uninstallApp,
  type AppPurgeResult,
  type AppWriteResult,
  type DeclaredApp,
  type RetainedApp,
} from "@/api/apps";
import { ApiError } from "@/api/client";
import { GroupMembers } from "./GroupMembers";
import { describeGroups } from "./groupLabels";
import "./admin.css";

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
type AppRow = { profile: string; declared?: DeclaredApp; state?: AppState };

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
 * Every action goes to the service that owns it with the person's own token,
 * and what that service answers is shown as it said it, a refusal included.
 * This screen decides nothing about who may do what.
 */
export function AppsSection({
  tenant,
  onOpenIntegrations,
}: {
  tenant: string;
  /** Go to the Integrations screen, where what an app may consume is changed. */
  onOpenIntegrations: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const declaredQuery = useQuery({
    queryKey: ["admin", "apps", "declared"],
    queryFn: () => fetchDeclaredApps(),
  });
  const statesQuery = useQuery({
    queryKey: ["admin", "apps", "status"],
    queryFn: () => fetchAppStates(),
  });

  const rows = useMemo(() => {
    const byProfile = new Map<string, AppRow>();
    for (const declared of declaredQuery.data?.apps ?? []) {
      byProfile.set(declared.profile, { profile: declared.profile, declared });
    }
    for (const state of statesQuery.data?.apps ?? []) {
      const row = byProfile.get(state.profile) ?? { profile: state.profile };
      byProfile.set(state.profile, { ...row, state });
    }
    return [...byProfile.values()].sort((a, b) => a.profile.localeCompare(b.profile));
  }, [declaredQuery.data, statesQuery.data]);

  if (declaredQuery.isLoading || statesQuery.isLoading) {
    return <p className="admin-console__loading">{t("apps.loading")}</p>;
  }

  // Which halves were answered. A half that was not is not an empty half:
  // "not on the cluster" may only be said when the cluster was heard.
  const declaredKnown = declaredQuery.isSuccess;
  const statesKnown = statesQuery.isSuccess;

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
                <th>{t("apps.build")}</th>
                <th>{t("apps.state")}</th>
                <th>{t("apps.forEveryone")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <AppListRow
                  key={row.profile}
                  row={row}
                  tenant={tenant}
                  declaredKnown={declaredKnown}
                  statesKnown={statesKnown}
                  open={open === row.profile}
                  onToggle={() => setOpen(open === row.profile ? null : row.profile)}
                  onOutcome={setOutcome}
                  onOpenIntegrations={onOpenIntegrations}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

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

function AppListRow({
  row,
  tenant,
  declaredKnown,
  statesKnown,
  open,
  onToggle,
  onOutcome,
  onOpenIntegrations,
}: {
  row: AppRow;
  tenant: string;
  declaredKnown: boolean;
  statesKnown: boolean;
  open: boolean;
  onToggle: () => void;
  onOutcome: (outcome: Outcome) => void;
  onOpenIntegrations: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <tr className={open ? "admin-console__row--editing" : undefined}>
        <td className="admin-console__mono">{row.profile}</td>
        <td>
          {row.declared?.digest ? (
            <span className="admin-console__mono">{shortDigest(row.declared.digest)}</span>
          ) : (
            "—"
          )}
        </td>
        <td>
          <Standing row={row} declaredKnown={declaredKnown} statesKnown={statesKnown} />
        </td>
        <td>{row.declared ? (row.declared.defaultGrant ? t("apps.yes") : t("apps.no")) : "—"}</td>
        <td>
          <button className="admin-console__btn admin-console__btn--quiet" type="button" onClick={onToggle}>
            {open ? t("apps.close") : t("apps.open")}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5}>
            <AppDetail
              row={row}
              tenant={tenant}
              declaredKnown={declaredKnown}
              statesKnown={statesKnown}
              onOutcome={onOutcome}
              onOpenIntegrations={onOpenIntegrations}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/** One app, opened: its state, who has it, what it exchanges, what it asked for, and removing it. */
function AppDetail({
  row,
  tenant,
  declaredKnown,
  statesKnown,
  onOutcome,
  onOpenIntegrations,
}: {
  row: AppRow;
  tenant: string;
  declaredKnown: boolean;
  statesKnown: boolean;
  onOutcome: (outcome: Outcome) => void;
  onOpenIntegrations: () => void;
}) {
  return (
    <div className="admin-console__editor">
      <StatePart row={row} declaredKnown={declaredKnown} statesKnown={statesKnown} />
      <AccessPart row={row} tenant={tenant} onOutcome={onOutcome} />
      <IntegrationsPart row={row} tenant={tenant} onOpenIntegrations={onOpenIntegrations} />
      <PrivilegesPart row={row} />
      <UninstallPart row={row} tenant={tenant} declaredKnown={declaredKnown} onOutcome={onOutcome} />
    </div>
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
 * State: which build git pins, and what the cluster has made of it.
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
  const conditions = state?.conditions ?? [];
  return (
    <div className="admin-console__subsection">
      <h3 className="admin-console__subsection-title">{t("apps.stateTitle")}</h3>
      <div className="admin-console__edit-panel">
        <Fact label={t("apps.build")}>
          {declared?.digest ? (
            <span className="admin-console__mono">{declared.digest}</span>
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
        <Fact label={t("apps.inGit")}>
          {declared ? t("apps.declaredYes") : declaredKnown ? t("apps.declaredNo") : t("apps.unknown")}
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
        <Fact label={t("apps.addons")}>
          {addons.length === 0
            ? t("apps.addonsNone")
            : addons.map((addon) => (
                <span key={addon} className="admin-console__chip">
                  {addon}
                </span>
              ))}
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
function AccessPart({
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
 * and what was answered. Read-only.
 *
 * Two services, joined: the cluster names the requests nobody has granted yet
 * (the app waits on them), and git holds each approval with who gave it and
 * why. Together they are everything the app asked for that needs an answer.
 */
function PrivilegesPart({ row }: { row: AppRow }) {
  const { t } = useTranslation();
  const grantsQuery = useQuery({
    queryKey: ["admin", "apps", "privileges"],
    queryFn: () => fetchTenantPrivileges(),
  });
  const names = new Set([row.profile, row.state?.name].filter(Boolean) as string[]);
  const approved = (grantsQuery.data?.privileges ?? []).filter((g) => names.has(g.install));
  const pending = row.state?.pendingPrivileges ?? [];

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
                      {t("apps.privilegeWaiting")}
                    </span>
                  </td>
                  <td>{t("apps.privilegeWaitingDetail")}</td>
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
                          when: new Date(grant.approvedAt).toLocaleString(),
                        }}
                        components={mono}
                      />
                    </div>
                    <div>{grant.reason}</div>
                    {grant.expiresAt ? (
                      <div>
                        {t("apps.privilegeExpires", { when: new Date(grant.expiresAt).toLocaleString() })}
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

/** How a purge ended, for the one notice that says so. */
type PurgeOutcome =
  | { app: string; result: AppPurgeResult }
  | { app: string; refused: boolean; message: string };

/**
 * Uninstalled apps with retained data, and purging one.
 *
 * Uninstalling keeps what an app stored, and this list is the only place that
 * says so afterwards: the apps the tenant no longer has that still hold data,
 * and which kinds each one holds. It is the cluster's answer and it is built
 * on the matching a purge uses, so what a row shows is what purging that app
 * destroys.
 *
 * A purge is one request that is answered when it is over, which can take
 * minutes. Nothing here gives up before the answer; while it runs the dialog
 * stays open and nothing else can be started. What comes back is shown as the
 * cluster said it, and only an answer that says it is complete is called done.
 *
 * The answer also names the kinds of data the cluster could not check, and
 * why. Whenever it names any, the list may be missing apps, and that is said
 * above it; an empty list is then not called empty.
 *
 * Naming an app by hand is offered when the list could not be read, and when
 * it came back empty without everything having been checked.
 */
function RetainedSection({ tenant, declared }: { tenant: string; declared?: DeclaredApp[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // The app the dialog is about, and whether its purge has been confirmed:
  // from then on the dialog only says that it is running.
  const [asking, setAsking] = useState<{ app: string; confirmed: boolean } | null>(null);
  const [outcome, setOutcome] = useState<PurgeOutcome | null>(null);

  const retainedQuery = useQuery({
    queryKey: ["admin", "apps", "retained"],
    queryFn: () => fetchRetainedApps(),
  });

  const purge = useMutation({
    mutationFn: (app: string) => purgeAppData(app),
    onSuccess: (result, app) => setOutcome({ app, result }),
    onError: (err, app) => {
      const status = err instanceof ApiError ? err.status : undefined;
      setOutcome({
        app,
        // A 4xx is the cluster declining to start. Anything else -- a purge
        // that stopped half-way, a relay that stopped waiting, no answer at
        // all -- may have destroyed something, and asking again is safe.
        refused: status !== undefined && status >= 400 && status < 500,
        message: (err instanceof ApiError && err.detail) || messageOf(err),
      });
    },
    onSettled: () => {
      setAsking(null);
      // Whatever the answer, what is held may have changed.
      void queryClient.invalidateQueries({ queryKey: ["admin", "apps", "retained"] });
    },
  });

  function run(app: string) {
    if (purge.isPending) return;
    setOutcome(null);
    setAsking({ app, confirmed: true });
    purge.mutate(app);
  }

  function ask(app: string) {
    if (purge.isPending) return;
    setOutcome(null);
    setAsking({ app, confirmed: false });
  }

  const apps = retainedQuery.data?.apps ?? [];
  const reasons = retainedQuery.data?.unknown ?? {};
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
      <PurgeByName declared={declared} busy={purge.isPending} onAsk={ask} />
    </details>
  );

  return (
    <div className="admin-console__subsection">
      <h3 className="admin-console__subsection-title">{t("apps.retainedTitle")}</h3>
      <p className="admin-console__lead">{t("apps.retainedLead")}</p>

      {outcome ? (
        <PurgeOutcomeNotice outcome={outcome} busy={purge.isPending} onRetry={() => run(outcome.app)} />
      ) : null}

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
            <div className="admin-console__table-wrap">
              <table className="admin-console__table">
                <thead>
                  <tr>
                    <th>{t("apps.app")}</th>
                    {RETAINED_KINDS.map((kind) => (
                      <th key={kind}>{kindWord(t, kind)}</th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {apps.map((app) => (
                    <RetainedRow key={app.profile} app={app} busy={purge.isPending} onAsk={ask} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {asking ? (
        <PurgeDialog
          app={asking.app}
          tenant={tenant}
          pending={asking.confirmed}
          onConfirm={() => run(asking.app)}
          onClose={() => setAsking(null)}
        />
      ) : null}
    </div>
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
  onAsk,
}: {
  app: RetainedApp;
  busy: boolean;
  onAsk: (app: string) => void;
}) {
  const { t } = useTranslation();
  const volumes = app.volumes ?? [];
  return (
    <tr>
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

/**
 * Purging one app's data, behind its name typed out.
 *
 * Typing the name is the confirmation because this is the one act on this
 * screen nothing brings back, and a click is too easy to make.
 *
 * Once confirmed the dialog stays, saying the purge is running, until the
 * answer is there: it cannot be dismissed and offers nothing to press, so a
 * purge is not asked for twice and the answer is not walked away from. It
 * sets no time limit of its own.
 */
function PurgeDialog({
  app,
  tenant,
  pending,
  onConfirm,
  onClose,
}: {
  app: string;
  tenant: string;
  pending: boolean;
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

  const confirmed = typed.trim() === app;

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
            <Trans i18nKey="apps.purgeRunningTitle" values={{ app }} components={mono} />
          </h3>
          <p className="admin-console__lead">{t("apps.purgeRunningBody")}</p>
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
            <Trans i18nKey="apps.purgeDialogTitle" values={{ app }} components={mono} />
          </h3>
          <p className="admin-console__lead">
            <Trans i18nKey="apps.purgeDialogBody" values={{ app, tenant }} components={mono} />
          </p>
          <p className="admin-console__lead">{t("apps.purgeDialogKept")}</p>
          <p className="admin-console__lead">{t("apps.purgeDialogFinal")}</p>

          <label className="admin-console__label" htmlFor="purge-app-confirm">
            <span className="admin-console__label-text">
              <Trans i18nKey="apps.purgeTypeToConfirm" values={{ app }} components={mono} />
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

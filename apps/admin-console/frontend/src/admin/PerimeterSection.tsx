/* SPDX-License-Identifier: Apache-2.0 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { fetchAdminContext, fetchAppStates } from "@/api/admin";
import { ApiError } from "@/api/client";
import {
  fetchPerimeterHistory,
  fetchPerimeterTraffic,
  fetchTenantPrivileges,
  fetchTrustedDomains,
  stopTrustingDomain,
  trustDomain,
  withdrawPrivilege,
  type ExposureEntry,
  type PrivilegeGrant,
} from "@/api/apps";
import { PublicAddressList } from "./AppPublicAddresses";
import { AnswerRequest, tenantApprovals } from "./ApprovalsSection";
import "./admin.css";
import { formatDateTime, formatNumber } from "@/lib/format";

const mono = { mono: <span className="admin-console__mono" /> };

/** Waiting for a decision: asked for and never approved, approved and lapsed,
 *  due for review, or approved for something the app no longer declares. */
const waiting = (entry: ExposureEntry) =>
  ["requested", "expired", "reviewDue", "unmatched"].includes(entry.state);

/** On the internet now, or kept as approved behind sign-in. */
const published = (entry: ExposureEntry) => ["approved", "reviewDue"].includes(entry.state);

/**
 * The tenant's perimeter, for those who answer for it: what asks to be on the
 * internet, what is, and who decided each, from the commits that did it.
 *
 * Shown to a person the director says may publish for the tenant
 * (can_expose), and read through routes guarded by the same relation, so an
 * approver who is not otherwise a member of the tenant sees what they
 * approve. Approving and withdrawing are the Apps screen's, here for all of
 * the tenant's apps at once.
 */
export function PerimeterSection() {
  const { t } = useTranslation();
  return (
    <section>
      <div className="admin-console__toolbar">
        <h2 className="admin-console__section-title">{t("perimeter.title")}</h2>
      </div>
      <p className="admin-console__lead">
        <Trans i18nKey="perimeter.lead" components={mono} />
      </p>
      <PublicAddressList
        source="perimeter"
        include={waiting}
        title={t("perimeter.requestsTitle")}
        empty={t("perimeter.requestsNone")}
      />
      <PublicAddressList
        source="perimeter"
        include={published}
        title={t("perimeter.surfaceTitle")}
        lead={t("perimeter.surfaceLead")}
        empty={t("perimeter.surfaceNone")}
      />
      <Outbound />
      <TrustedDomainList />
      <PerimeterTraffic />
      <PerimeterHistory />
    </section>
  );
}

/**
 * The tenant's way out: what its apps ask to reach beyond the tenant
 * (egress, the perimeter approver's to answer) and what they were granted,
 * by whom and why. The requests are what the cluster says of each app; the
 * grants are git's. Answering is the director's, as on the Approvals and
 * Apps screens.
 */
function Outbound() {
  const { t } = useTranslation();
  const statesQuery = useQuery({ queryKey: ["admin", "apps", "status"], queryFn: () => fetchAppStates() });
  const grantsQuery = useQuery({ queryKey: ["admin", "apps", "privileges"], queryFn: () => fetchTenantPrivileges() });
  const contextQuery = useQuery({ queryKey: ["admin", "context"], queryFn: () => fetchAdminContext() });
  const waiting = tenantApprovals(statesQuery.data?.tenant, statesQuery.data?.apps ?? []).filter((a) =>
    a.privilege.startsWith("egress/"),
  );
  const granted = (grantsQuery.data?.privileges ?? []).filter((g) => g.privilege.startsWith("egress/"));
  const mayAnswer = contextQuery.data?.canApprovePrivilege === true;
  const failed = statesQuery.isError ? statesQuery.error : grantsQuery.isError ? grantsQuery.error : null;

  return (
    <div className="admin-console__subsection">
      <h3 className="admin-console__subsection-title">{t("perimeter.outboundTitle")}</h3>
      <p className="admin-console__hint">{t("perimeter.outboundLead")}</p>
      {statesQuery.isLoading || grantsQuery.isLoading ? (
        <p className="admin-console__loading">{t("perimeter.outboundReading")}</p>
      ) : null}
      {failed ? (
        <p className="admin-console__error">
          {t("perimeter.outboundUnavailable")} {failed instanceof Error ? failed.message : String(failed)}
        </p>
      ) : null}
      {statesQuery.isSuccess && grantsQuery.isSuccess && waiting.length === 0 && granted.length === 0 ? (
        <p className="admin-console__hint">{t("perimeter.outboundNone")}</p>
      ) : null}
      {waiting.length > 0 || granted.length > 0 ? (
        <div className="admin-console__table-wrap">
          <table className="admin-console__table">
            <thead>
              <tr>
                <th>{t("perimeter.outboundApp")}</th>
                <th>{t("perimeter.outboundPrivilege")}</th>
                <th>{t("perimeter.outboundState")}</th>
                <th>{t("perimeter.outboundDetail")}</th>
              </tr>
            </thead>
            <tbody>
              {waiting.map((request) => (
                <tr key={`waiting-${request.install}-${request.privilege}`}>
                  <td className="admin-console__mono">{request.install}</td>
                  <td>
                    <div className="admin-console__mono">{request.privilege}</div>
                    <div className="admin-console__hint">{request.reason || t("approvals.noReason")}</div>
                  </td>
                  <td>
                    <span className="admin-console__badge admin-console__badge--warn">
                      {t(request.declinedBy ? "perimeter.outboundDeclined" : "perimeter.outboundWaiting")}
                    </span>
                  </td>
                  <td>
                    {request.declinedBy ? (
                      <div className="admin-console__hint">
                        <Trans
                          i18nKey="approvals.declinedBy"
                          values={{
                            who: request.declinedBy,
                            when: request.declinedAt ? formatDateTime(request.declinedAt) : "",
                            reason: request.declineReason ?? "",
                          }}
                          components={mono}
                        />
                      </div>
                    ) : null}
                    {mayAnswer ? (
                      <AnswerRequest approval={request} />
                    ) : (
                      <div className="admin-console__hint">{t("approvals.notYoursPerimeter")}</div>
                    )}
                  </td>
                </tr>
              ))}
              {granted.map((grant) => (
                <tr key={`granted-${grant.install}-${grant.privilege}`}>
                  <td className="admin-console__mono">{grant.install}</td>
                  <td className="admin-console__mono">{grant.privilege}</td>
                  <td>
                    <span className="admin-console__badge admin-console__badge--ok">{t("perimeter.outboundGranted")}</span>
                  </td>
                  <td>
                    <div>
                      <Trans
                        i18nKey="perimeter.outboundGrantedBy"
                        values={{ who: grant.approver, when: formatDateTime(grant.approvedAt) }}
                        components={mono}
                      />
                    </div>
                    <div>{grant.reason}</div>
                    {grant.expiresAt ? (
                      <div className="admin-console__hint">
                        {t("perimeter.outboundExpires", { when: formatDateTime(grant.expiresAt) })}
                      </div>
                    ) : null}
                    {mayAnswer ? <WithdrawGrant grant={grant} /> : null}
                  </td>
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
 * Take back one grant. The director decides whether the person may, as it
 * does for the approval; its refusal is shown as it came.
 */
export function WithdrawGrant({ grant }: { grant: PrivilegeGrant }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const withdraw = useMutation({
    mutationFn: () => withdrawPrivilege(grant.install, grant.privilege),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "approvals"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "apps", "status"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "apps", "privileges"] });
    },
  });
  const ask = () => {
    if (!window.confirm(t("perimeter.outboundWithdrawConfirm", { app: grant.install, privilege: grant.privilege }))) return;
    withdraw.mutate();
  };
  const refusal = withdraw.isError
    ? withdraw.error instanceof ApiError && withdraw.error.detail
      ? withdraw.error.detail
      : withdraw.error instanceof Error
        ? withdraw.error.message
        : String(withdraw.error)
    : null;
  return (
    <div>
      <button
        type="button"
        className="admin-console__btn admin-console__btn--danger"
        disabled={withdraw.isPending || withdraw.isSuccess}
        onClick={ask}
      >
        {t(withdraw.isPending ? "perimeter.outboundWithdrawing" : "perimeter.outboundWithdraw")}
      </button>
      {withdraw.isSuccess ? <div className="admin-console__hint">{t("perimeter.outboundWithdrawn")}</div> : null}
      {refusal ? (
        <div className="admin-console__error">
          {t("perimeter.outboundWithdrawRefused")} {refusal}
        </div>
      ) : null}
    </div>
  );
}

/** A domain as the director takes one: lower-case labels, at least two. */
const DOMAIN = /^([a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?\.)+[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/;

const refusalOf = (err: unknown) =>
  err instanceof ApiError && err.detail ? err.detail : err instanceof Error ? err.message : String(err);

/**
 * The domains trusted for this tenant alone: an egress request whose hosts
 * are all in trusted domains is granted without a further answer. The
 * perimeter approver adds and removes them while the cluster's administrator
 * delegated the list to the tenant; the director decides both.
 */
function TrustedDomainList() {
  const query = useQuery({ queryKey: ["admin", "perimeter", "trusted-domains"], queryFn: () => fetchTrustedDomains() });
  const contextQuery = useQuery({ queryKey: ["admin", "context"], queryFn: () => fetchAdminContext() });
  const { t } = useTranslation();
  return (
    <div className="admin-console__subsection">
      <h3 className="admin-console__subsection-title">{t("perimeter.trustedTitle")}</h3>
      <p className="admin-console__hint">{t("perimeter.trustedLead")}</p>
      {query.isLoading ? <p className="admin-console__loading">{t("perimeter.outboundReading")}</p> : null}
      {query.isError ? (
        <p className="admin-console__error">
          {t("perimeter.trustedUnavailable")} {refusalOf(query.error)}
        </p>
      ) : null}
      {query.data ? (
        <TrustedDomainsView
          delegated={query.data.delegated}
          domains={query.data.domains}
          mayChange={contextQuery.data?.canApprovePrivilege === true}
        />
      ) : null}
    </div>
  );
}

/** The list, and for whoever may change a delegated one, adding and removing. */
export function TrustedDomainsView({
  delegated,
  domains,
  mayChange,
}: {
  delegated: boolean;
  domains: string[];
  mayChange: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState("");
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "perimeter", "trusted-domains"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "apps", "status"] });
  };
  const add = useMutation({
    mutationFn: (domain: string) => trustDomain(domain),
    onSuccess: () => {
      setTyped("");
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: (domain: string) => stopTrustingDomain(domain), onSuccess: refresh });
  const domain = typed.trim().toLowerCase();
  const editable = delegated && mayChange;
  const askRemove = (name: string) => {
    if (!window.confirm(t("perimeter.trustedRemoveConfirm", { domain: name }))) return;
    add.reset();
    remove.mutate(name);
  };
  const failed = add.isError ? add.error : remove.isError ? remove.error : null;

  return (
    <>
      {!delegated ? <p className="admin-console__hint">{t("perimeter.trustedNotDelegated")}</p> : null}
      {delegated && !mayChange ? <p className="admin-console__hint">{t("perimeter.trustedNotYours")}</p> : null}
      {domains.length === 0 ? (
        <p className="admin-console__hint">{t("perimeter.trustedNone")}</p>
      ) : (
        <div className="admin-console__table-wrap">
          <table className="admin-console__table">
            <thead>
              <tr>
                <th>{t("perimeter.trustedDomain")}</th>
                {editable ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {domains.map((name) => (
                <tr key={name}>
                  <td className="admin-console__mono">{name}</td>
                  {editable ? (
                    <td>
                      <button
                        type="button"
                        className="admin-console__btn admin-console__btn--danger"
                        disabled={remove.isPending}
                        onClick={() => askRemove(name)}
                      >
                        {t("perimeter.trustedRemove")}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editable ? (
        <form
          className="admin-console__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!DOMAIN.test(domain)) return;
            if (!window.confirm(t("perimeter.trustedAddConfirm", { domain }))) return;
            remove.reset();
            add.mutate(domain);
          }}
        >
          <p className="admin-console__warning">{t("perimeter.trustedAddWarning")}</p>
          <div className="admin-console__field">
            <label className="admin-console__label" htmlFor="trusted-domain">
              <span className="admin-console__label-text">{t("perimeter.trustedAddLabel")}</span>
              <input
                id="trusted-domain"
                type="text"
                value={typed}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setTyped(e.target.value)}
              />
            </label>
            {domain !== "" && !DOMAIN.test(domain) ? (
              <p className="admin-console__field-error">{t("perimeter.trustedInvalid")}</p>
            ) : (
              <p className="admin-console__hint">{t("perimeter.trustedAddHint")}</p>
            )}
          </div>
          <button type="submit" className="admin-console__btn" disabled={!DOMAIN.test(domain) || add.isPending}>
            {t(add.isPending ? "perimeter.trustedAdding" : "perimeter.trustedAdd")}
          </button>
        </form>
      ) : null}
      {failed ? (
        <p className="admin-console__error">
          {t("perimeter.trustedRefused")} {refusalOf(failed)}
        </p>
      ) : null}
    </>
  );
}

/** Who published, reviewed or withdrew which entry, and what allowed them. */
function PerimeterHistory() {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["admin", "perimeter", "history"],
    queryFn: () => fetchPerimeterHistory(),
  });
  return (
    <div className="admin-console__subsection">
      <h3 className="admin-console__subsection-title">{t("perimeter.historyTitle")}</h3>
      {query.isLoading ? <p className="admin-console__hint">{t("perimeter.historyReading")}</p> : null}
      {query.isError ? (
        <p className="admin-console__error">
          {t("perimeter.historyUnavailable")}{" "}
          {query.error instanceof Error ? query.error.message : String(query.error)}
        </p>
      ) : null}
      {query.data ? <p className="admin-console__hint">{query.data.covers}</p> : null}
      {query.data && query.data.changes.length === 0 ? (
        <p className="admin-console__hint">{t("perimeter.historyNone")}</p>
      ) : null}
      {query.data && query.data.changes.length > 0 ? (
        <div className="admin-console__table-wrap">
          <table className="admin-console__table">
            <thead>
              <tr>
                <th>{t("perimeter.historyWhen")}</th>
                <th>{t("perimeter.historyWhat")}</th>
                <th>{t("perimeter.historyWho")}</th>
                <th>{t("perimeter.historyAuthority")}</th>
              </tr>
            </thead>
            <tbody>
              {query.data.changes.map((change) => (
                <tr key={change.commit}>
                  <td>{change.at ? formatDateTime(change.at) : "—"}</td>
                  <td>
                    {change.summary}
                    <div className="admin-console__mono">{change.commit.slice(0, 7)}</div>
                  </td>
                  <td>{change.author?.Name || change.principal || "—"}</td>
                  <td>
                    {change.throughPlatform ? (
                      <span className="admin-console__mono">{change.decision}</span>
                    ) : (
                      <span className="admin-console__hint">{t("perimeter.historyByHand")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** The windows traffic is shown over, and the step each is drawn in. */
const WINDOWS = [
  { key: "day", hours: 24, step: 3600 },
  { key: "week", hours: 24 * 7, step: 6 * 3600 },
  { key: "month", hours: 24 * 30, step: 24 * 3600 },
] as const;

const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

/**
 * What the public paths carried: the busiest first, with how much of it was
 * answered, refused by the app, or failed, and the tenant's requests over
 * time. From the counters the edge keeps, read a few times an hour.
 */
function PerimeterTraffic() {
  const { t } = useTranslation();
  const [windowKey, setWindowKey] = useState<(typeof WINDOWS)[number]["key"]>("week");
  const chosen = WINDOWS.find((w) => w.key === windowKey) ?? WINDOWS[1];
  const query = useQuery({
    queryKey: ["admin", "perimeter", "traffic", chosen.key],
    queryFn: () => {
      const to = new Date();
      return fetchPerimeterTraffic(new Date(to.getTime() - chosen.hours * 3600_000), to, chosen.step);
    },
  });
  const totals = query.data?.totals ?? [];
  const series = query.data?.series ?? [];
  const peak = Math.max(1, ...series.map((p) => p.requests));
  return (
    <div className="admin-console__subsection">
      <div className="admin-console__toolbar">
        <h3 className="admin-console__subsection-title">{t("perimeter.trafficTitle")}</h3>
        <div className="admin-console__actions">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              className={`admin-console__btn${w.key === chosen.key ? " admin-console__btn--primary" : ""}`}
              aria-pressed={w.key === chosen.key}
              onClick={() => setWindowKey(w.key)}
            >
              {t(`perimeter.trafficWindow_${w.key}`)}
            </button>
          ))}
        </div>
      </div>
      {query.isLoading ? <p className="admin-console__hint">{t("perimeter.trafficReading")}</p> : null}
      {query.isError ? (
        <p className="admin-console__error">
          {t("perimeter.trafficUnavailable")}{" "}
          {query.error instanceof Error ? query.error.message : String(query.error)}
        </p>
      ) : null}
      {query.data ? <p className="admin-console__hint">{query.data.covers}</p> : null}
      {query.data && totals.length === 0 ? <p className="admin-console__hint">{t("perimeter.trafficNone")}</p> : null}
      {series.length > 0 ? (
        <div role="img" aria-label={t("perimeter.trafficChart")} className="admin-console__traffic-chart">
          {series.map((p) => (
            <div
              key={p.at}
              title={`${formatDateTime(p.at)}: ${p.requests}`}
              className={`admin-console__traffic-bar${p["5xx"] > 0 ? " admin-console__traffic-bar--failed" : ""}`}
              style={{ height: `${Math.max(2, (p.requests / peak) * 100)}%` }}
            />
          ))}
        </div>
      ) : null}
      {totals.length > 0 ? (
        <div className="admin-console__table-wrap">
          <table className="admin-console__table">
            <thead>
              <tr>
                <th>{t("perimeter.trafficEntry")}</th>
                <th>{t("perimeter.trafficPath")}</th>
                <th>{t("perimeter.trafficRequests")}</th>
                <th>{t("perimeter.traffic2xx")}</th>
                <th>{t("perimeter.traffic3xx")}</th>
                <th>{t("perimeter.traffic4xx")}</th>
                <th>{t("perimeter.traffic5xx")}</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((row) => (
                <tr key={`${row.component}/${row.exposure}${row.path}`}>
                  <td>
                    <span className="admin-console__mono">
                      {row.component ? `${row.component}/${row.exposure}` : row.exposure}
                    </span>
                  </td>
                  <td>
                    <span className="admin-console__mono">{row.path}</span>
                  </td>
                  <td>{formatNumber(row.requests)}</td>
                  <td>{share(row["2xx"], row.requests)}</td>
                  <td>{share(row["3xx"], row.requests)}</td>
                  <td>{share(row["4xx"], row.requests)}</td>
                  <td>{share(row["5xx"], row.requests)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

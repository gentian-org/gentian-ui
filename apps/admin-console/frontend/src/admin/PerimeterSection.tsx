/* SPDX-License-Identifier: Apache-2.0 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { fetchPerimeterHistory, fetchPerimeterTraffic, type ExposureEntry } from "@/api/apps";
import { PublicAddressList } from "./AppPublicAddresses";
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
      <PerimeterTraffic />
      <PerimeterHistory />
    </section>
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

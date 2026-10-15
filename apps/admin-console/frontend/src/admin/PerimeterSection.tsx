/* SPDX-License-Identifier: Apache-2.0 */
import { useQuery } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import { fetchPerimeterHistory, type ExposureEntry } from "@/api/apps";
import { PublicAddressList } from "./AppPublicAddresses";
import "./admin.css";

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
                  <td>{change.at ? new Date(change.at).toLocaleString() : "—"}</td>
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

/* SPDX-License-Identifier: Apache-2.0 */
import { useQuery } from "@tanstack/react-query";
import { fetchLicenceReport } from "@/api/admin";
import "./admin.css";
import { useTranslation } from "react-i18next";

/** The usher's words for an attempt, and the catalogue key that says each. */
const OUTCOME_KEYS: Record<string, string> = {
  accepted: "outcomeAccepted",
  failed: "outcomeFailed",
  "not-sent": "outcomeNotSent",
  sending: "outcomeSending",
};
const REASON_KEYS: Record<string, string> = {
  "signing-key-absent": "reasonSigningKeyAbsent",
  "signing-key-invalid": "reasonSigningKeyInvalid",
  "inventory-unavailable": "reasonInventoryUnavailable",
  "endpoint-unreachable": "reasonEndpointUnreachable",
  "endpoint-refused": "reasonEndpointRefused",
};

function when(value: string | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/**
 * The body as a person reads it. Indented for the eye only: the bytes that
 * were signed are the ones the usher handed over, and a body that is not
 * JSON is shown as it came rather than guessed at.
 */
function readable(body: string) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

/**
 * What this cluster last told its licensor, and what became of it.
 *
 * Read-only on purpose. Whether a cluster reports is fixed when it is
 * installed, and the report is sent by the operator on its own schedule;
 * this screen is where whoever runs the cluster reads what was said about
 * them. Who may read it is the usher's decision, and its refusal is shown in
 * its own words.
 */
export function LicenceReportSection() {
  const { t } = useTranslation();

  const reportQuery = useQuery({
    queryKey: ["admin", "platform", "licence-report"],
    queryFn: () => fetchLicenceReport(),
  });

  if (reportQuery.isLoading) {
    return <p className="admin-console__loading">{t("licenceReport.loading")}</p>;
  }
  if (reportQuery.isError || !reportQuery.data) {
    return (
      <p className="admin-console__error">
        {t("licenceReport.unavailable")}{" "}
        {reportQuery.error instanceof Error ? reportQuery.error.message : ""}
      </p>
    );
  }

  const { enabled, url, attempt, report } = reportQuery.data;

  return (
    <section>
      <header className="admin-console__section-head">
        <div>
          <h2 className="admin-console__section-title">{t("licenceReport.title")}</h2>
          <p className="admin-console__lead">{t("licenceReport.lead")}</p>
        </div>
      </header>

      {!enabled ? (
        <p className="admin-console__empty">{t("licenceReport.off")}</p>
      ) : (
        <>
          <div className="admin-console__table-wrap">
            <table className="admin-console__table">
              <tbody>
                <tr>
                  <th scope="row">{t("licenceReport.state")}</th>
                  <td>{t("licenceReport.on")}</td>
                </tr>
                <tr>
                  <th scope="row">{t("licenceReport.sentTo")}</th>
                  <td>
                    <span className="admin-console__mono">{url || "—"}</span>
                  </td>
                </tr>
                <tr>
                  <th scope="row">{t("licenceReport.lastAttempt")}</th>
                  <td>{attempt ? when(attempt.at) : t("licenceReport.noAttempt")}</td>
                </tr>
                {attempt ? (
                  <tr>
                    <th scope="row">{t("licenceReport.outcome")}</th>
                    <td>
                      <div>
                        {OUTCOME_KEYS[attempt.outcome]
                          ? t(`licenceReport.${OUTCOME_KEYS[attempt.outcome]}`)
                          : attempt.outcome}
                      </div>
                      {attempt.reason ? (
                        <div className="admin-console__hint">
                          {REASON_KEYS[attempt.reason]
                            ? t(`licenceReport.${REASON_KEYS[attempt.reason]}`)
                            : attempt.reason}
                        </div>
                      ) : null}
                      {attempt.httpStatus ? (
                        <div className="admin-console__hint">
                          {t("licenceReport.httpStatus", { status: attempt.httpStatus })}
                        </div>
                      ) : null}
                      {attempt.error ? (
                        <div className="admin-console__mono" style={{ fontSize: "0.75rem" }}>
                          {attempt.error}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ) : null}
                <tr>
                  <th scope="row">{t("licenceReport.nextAttempt")}</th>
                  <td>{when(attempt?.nextAt)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="admin-console__subsection">
            <h3 className="admin-console__subsection-title">{t("licenceReport.exactlyWhatWasSent")}</h3>
            {report ? (
              <>
                <p className="admin-console__hint">
                  {t("licenceReport.sequence", { sequence: report.sequence })}
                </p>
                <pre className="admin-console__mono admin-console__report-body">
                  {readable(report.body)}
                </pre>
                <div className="admin-console__table-wrap">
                  <table className="admin-console__table">
                    <tbody>
                      <tr>
                        <th scope="row">{t("licenceReport.signature")}</th>
                        <td>
                          <span className="admin-console__mono">{report.signature}</span>
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">{t("licenceReport.keyId")}</th>
                        <td>
                          <span className="admin-console__mono">{report.keyId}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="admin-console__empty">{t("licenceReport.nothingSent")}</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

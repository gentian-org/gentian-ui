import { useQuery } from "@tanstack/react-query";
import { fetchCustomizationDebtReport, type CustomizationRecord } from "@/api/admin";

const RUNGS = ["L0", "L1", "L2", "L3", "L4", "L5", "L6"] as const;

/**
 * The customization debt report — see gentian-os/docs/app-customization.md §8.3.
 *
 * Reads live Customization CRs. The headline number is "carried deltas" (records
 * at L4 or above): that count is the one meant to trend down over time, the same
 * way ServiceNow and SAP shops track customization debt after the fact — this
 * lets Gentian see it before it accumulates.
 */
export function CustomizationDebtSection() {
  const reportQuery = useQuery({
    queryKey: ["admin", "platform", "customization-debt"],
    queryFn: () => fetchCustomizationDebtReport(),
  });

  if (reportQuery.isLoading) {
    return <p>Loading customization debt report…</p>;
  }
  if (reportQuery.isError || !reportQuery.data) {
    return <p className="admin-console__error">Customization debt report is unavailable.</p>;
  }

  const report = reportQuery.data;

  return (
    <section className="admin-section">
      <h2 className="admin-section__title">Customization debt</h2>
      <p className="admin-section__lead">
        Every deviation from an app as shipped, tracked as a{" "}
        <code>Customization</code> record. Lower rungs (L0–L1) are routine;
        rungs L4 and above are carried deltas that must be reviewed, forwarded
        upstream, and eventually dropped. See the{" "}
        <a
          href="https://github.com/gentian-org/gentian-os/blob/main/docs/app-customization.md"
          target="_blank"
          rel="noreferrer"
        >
          customization ladder
        </a>
        .
      </p>

      <p className="admin-section__meta">
        {report.totalRecords} record{report.totalRecords === 1 ? "" : "s"} ·{" "}
        <strong>{report.carriedDeltas}</strong> carried delta
        {report.carriedDeltas === 1 ? "" : "s"} at L4 or above
      </p>

      <table className="admin-table">
        <thead>
          <tr>
            {RUNGS.map((rung) => (
              <th key={rung}>{rung}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {RUNGS.map((rung) => (
              <td key={rung}>{report.byRung[rung]}</td>
            ))}
          </tr>
        </tbody>
      </table>

      <RecordList
        title="Past review date"
        empty="Nothing is overdue for review."
        records={report.reviewOverdue}
      />
      <RecordList
        title="Upstream-first obligation unmet or superseded"
        empty="Every carried delta has a recorded upstream outcome."
        records={report.upstreamStale}
      />
      <RecordList
        title="A cheaper rung is now available"
        empty="No record could currently descend to a cheaper rung."
        records={report.rungAboveRecommended}
      />
    </section>
  );
}

function RecordList({
  title,
  empty,
  records,
}: {
  title: string;
  empty: string;
  records: CustomizationRecord[];
}) {
  return (
    <div className="admin-section__subsection">
      <h3>{title}</h3>
      {records.length === 0 ? (
        <p>{empty}</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Record</th>
              <th>Target</th>
              <th>Rung</th>
              <th>Scope</th>
              <th>Owner</th>
              <th>Review by</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={`${record.namespace}/${record.name}`}>
                <td>{record.summary || record.name}</td>
                <td>
                  <code>{record.targetProfile}</code>
                </td>
                <td>
                  <code>{record.rung}</code>
                </td>
                <td>{record.scope}</td>
                <td>{record.owner}</td>
                <td>{record.reviewBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

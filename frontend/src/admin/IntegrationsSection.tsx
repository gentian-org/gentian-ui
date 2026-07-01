import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  fetchIntegrationsOverview,
  updateAppGrant,
  type AppGrant,
  type ConsumeGrant,
} from "@/api/admin";

type IntegrationsSectionProps = {
  tenant: string;
};

function formatOpenfga(cap: string, granted: Record<string, boolean>): string {
  if (Object.keys(granted).length === 0) {
    return "—";
  }
  const value = granted[cap];
  if (value === undefined) {
    return "—";
  }
  return value ? "yes" : "no";
}

export function IntegrationsSection({ tenant }: IntegrationsSectionProps) {
  const queryClient = useQueryClient();
  const overviewQuery = useQuery({
    queryKey: ["admin", "integrations", tenant],
    queryFn: () => fetchIntegrationsOverview(tenant),
  });
  const [editing, setEditing] = useState<AppGrant | null>(null);

  const saveMutation = useMutation({
    mutationFn: (grant: AppGrant) =>
      updateAppGrant(
        grant.app,
        { consume: grant.consume, allowConsumers: grant.allowConsumers },
        tenant,
      ),
    onSuccess: () => {
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "integrations", tenant] });
    },
  });

  if (overviewQuery.isLoading) {
    return <p>Loading integrations…</p>;
  }
  if (overviewQuery.isError || !overviewQuery.data) {
    return <p className="admin-console__error">Integrations overview is unavailable.</p>;
  }

  const { bindings, grants, summary, effectiveAccess } = overviewQuery.data;

  return (
    <section className="admin-section">
      <h2 className="admin-section__title">Integrations &amp; grants</h2>
      <p className="admin-section__lead">
        Active IntegrationBindings are operator-wired. AppGrants are tenant-approved capability
        subsets synced to OpenFGA. Contract NetworkPolicies allow egress only for granted
        capabilities.
      </p>

      <p className="admin-section__meta">
        {summary.bindingCount} binding{summary.bindingCount === 1 ? "" : "s"} ·{" "}
        {summary.grantCount} grant{summary.grantCount === 1 ? "" : "s"} ·{" "}
        {summary.grantReadyCount} OpenFGA-synced
      </p>

      <h3 className="admin-section__subtitle">Effective access</h3>
      {effectiveAccess.length === 0 ? (
        <p>No integration bindings to preview.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Contract</th>
              <th>Consumer → Provider</th>
              <th>Bound</th>
              <th>Granted</th>
              <th>MAC egress</th>
              <th>Grant phase</th>
              <th>OpenFGA</th>
            </tr>
          </thead>
          <tbody>
            {effectiveAccess.map((row) => (
              <tr key={`${row.consumer}-${row.contract}`}>
                <td><code>{row.contract}</code></td>
                <td>
                  {row.consumer} → {row.provider}
                </td>
                <td>{row.bindingCapabilities.join(", ") || "—"}</td>
                <td>{row.grantedCapabilities.join(", ") || "—"}</td>
                <td>{row.macAllowed ? "allowed" : "denied"}</td>
                <td>{row.grantPhase || "—"}</td>
                <td>
                  {row.grantedCapabilities.length === 0
                    ? "—"
                    : row.grantedCapabilities
                        .map((cap) => `${cap}: ${formatOpenfga(cap, row.openfgaGranted)}`)
                        .join("; ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="admin-section__subtitle">Bindings</h3>
      {bindings.length === 0 ? (
        <p>No active integration bindings.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Contract</th>
              <th>Consumer</th>
              <th>Provider</th>
              <th>Capabilities</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {bindings.map((b) => (
              <tr key={b.name}>
                <td><code>{b.contract}</code></td>
                <td>{b.consumer}</td>
                <td>{b.provider}</td>
                <td>{b.capabilities.join(", ") || "—"}</td>
                <td>{b.state || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="admin-section__subtitle">App grants</h3>
      {grants.length === 0 ? (
        <p>No AppGrant objects yet (created when consumer bindings exist).</p>
      ) : (
        <ul className="admin-list">
          {grants.map((grant) => (
            <li key={grant.name} className="admin-list__item">
              <div>
                <strong>{grant.app}</strong> · phase {grant.phase || "Pending"}
              </div>
              <button
                type="button"
                className="admin-button"
                onClick={() => setEditing(grant)}
              >
                Edit grant
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <div className="admin-modal">
          <h3>Edit grant — {editing.app}</h3>
          {editing.consume.map((entry, index) => (
            <div key={entry.contract} className="admin-field">
              <label htmlFor={`grant-${entry.contract}`}>
                {entry.contract} capabilities (comma-separated)
              </label>
              <input
                id={`grant-${entry.contract}`}
                className="admin-input"
                value={entry.granted.join(", ")}
                onChange={(event) => {
                  const granted = event.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const consume = editing.consume.map((c, i) =>
                    i === index ? { ...c, granted } : c,
                  ) satisfies ConsumeGrant[];
                  setEditing({ ...editing, consume });
                }}
              />
            </div>
          ))}
          <div className="admin-section__actions">
            <button
              type="button"
              className="admin-button admin-button--primary"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate(editing)}
            >
              Save
            </button>
            <button type="button" className="admin-button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  fetchPlatformAuthorizationSummary,
  fetchPlatformSecurityPolicy,
  updatePlatformSecurityPolicy,
  type MacWaiverEntry,
} from "@/api/admin";

export function PlatformSecuritySection() {
  const queryClient = useQueryClient();
  const policyQuery = useQuery({
    queryKey: ["admin", "platform", "security-policy"],
    queryFn: () => fetchPlatformSecurityPolicy(),
  });
  const summaryQuery = useQuery({
    queryKey: ["admin", "platform", "authorization-summary"],
    queryFn: () => fetchPlatformAuthorizationSummary(),
  });
  const [draft, setDraft] = useState<MacWaiverEntry[] | null>(null);

  const saveMutation = useMutation({
    mutationFn: (allowed: MacWaiverEntry[]) => updatePlatformSecurityPolicy(allowed),
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "platform", "security-policy"] });
    },
  });

  if (policyQuery.isLoading) {
    return <p>Loading platform security policy…</p>;
  }
  if (policyQuery.isError || !policyQuery.data) {
    return <p className="admin-console__error">Platform security policy is unavailable.</p>
  }

  const allowed = draft ?? policyQuery.data.allowedMacWaivers;
  const requests = policyQuery.data.catalogueRequests;

  const toggleApproval = (profile: string, policy: string, scope: string) => {
    const key = `${profile}/${policy}/${scope}`;
    const exists = allowed.some(
      (w) => w.profile === profile && w.policy === policy && w.scope === scope,
    );
    if (exists) {
      setDraft(allowed.filter((w) => `${w.profile}/${w.policy}/${w.scope}` !== key));
      return;
    }
    setDraft([...allowed, { profile, policy, scope }]);
  };

  return (
    <section className="admin-section">
      <h2 className="admin-section__title">Platform security</h2>
      <p className="admin-section__lead">
        Approve MAC waivers requested by catalogue AppProfiles. Workloads receive waiver pod
        labels only when both the profile declares a request and the cluster allows it.
      </p>

      {summaryQuery.data ? (
        <p className="admin-section__meta">
          {summaryQuery.data.tenantCount} tenant{summaryQuery.data.tenantCount === 1 ? "" : "s"} ·{" "}
          {summaryQuery.data.bindingCount} integration binding
          {summaryQuery.data.bindingCount === 1 ? "" : "s"} ·{" "}
          {summaryQuery.data.grantCount} AppGrant
          {summaryQuery.data.grantCount === 1 ? "" : "s"} (
          {summaryQuery.data.grantReadyCount} OpenFGA-synced) ·{" "}
          {summaryQuery.data.allowedMacWaivers} approved MAC waiver
          {summaryQuery.data.allowedMacWaivers === 1 ? "" : "s"} ·{" "}
          {summaryQuery.data.catalogueMacWaiverProfiles} catalogue profile
          {summaryQuery.data.catalogueMacWaiverProfiles === 1 ? "" : "s"} requesting waivers
        </p>
      ) : null}

      {requests.length === 0 ? (
        <p>No catalogue profiles currently request MAC waivers.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Profile</th>
              <th>Policy</th>
              <th>Scope</th>
              <th>Approved</th>
            </tr>
          </thead>
          <tbody>
            {requests.flatMap((entry) =>
              entry.macWaivers.map((w) => {
                const approved = allowed.some(
                  (a) =>
                    a.profile === entry.name &&
                    a.policy === w.policy &&
                    a.scope === w.scope,
                );
                return (
                  <tr key={`${entry.name}-${w.policy}-${w.scope}`}>
                    <td>{entry.displayName || entry.name}</td>
                    <td><code>{w.policy}</code></td>
                    <td><code>{w.scope}</code></td>
                    <td>
                      <input
                        type="checkbox"
                        checked={approved}
                        onChange={() => toggleApproval(entry.name, w.policy, w.scope)}
                      />
                    </td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      )}

      <div className="admin-section__actions">
        <button
          type="button"
          className="admin-button admin-button--primary"
          disabled={draft === null || saveMutation.isPending}
          onClick={() => saveMutation.mutate(allowed)}
        >
          {saveMutation.isPending ? "Saving…" : "Save allowlist"}
        </button>
        {draft !== null ? (
          <button type="button" className="admin-button" onClick={() => setDraft(null)}>
            Reset
          </button>
        ) : null}
      </div>
    </section>
  );
}

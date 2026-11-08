import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  clearAppGrant,
  fetchAdminContext,
  fetchIntegrationsOverview,
  updateAppGrant,
  type AppGrant,
  type ConsumeGrant,
  type EffectiveAccessRow,
} from "@/api/admin";
import { ApiError } from "@/api/client";
import { withContract, withoutContract, type Written } from "./grants";
import "./admin.css";
import { useTranslation } from "react-i18next";

type IntegrationsSectionProps = {
  tenant: string;
};

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** What the director said, as it said it, when the answer carried a reason. */
const refusalOf = (err: unknown) => (err instanceof ApiError && err.detail ? err.detail : messageOf(err));

const rowKey = (row: EffectiveAccessRow) => `${row.consumer}/${row.contract}`;

/**
 * The integrations of the tenant's apps that wait for the administrator, and
 * the ones that were granted.
 *
 * Two installed apps whose profiles agree on a contract are bound by the
 * operator, and nothing is opened between them until somebody who may grant
 * (can_grant) approves it here. Approving writes the consumer's grant through
 * the director, which commits it; the operator opens the way once the cluster
 * has applied the commit, so the row moves only then. Withdrawing takes the
 * contract out of the grant again. The director asks again on every write,
 * whatever buttons this draws, and its refusal is shown as it came.
 */
function IntegrationApprovals({
  tenant,
  rows,
  grants,
}: {
  tenant: string;
  rows: EffectiveAccessRow[];
  grants: AppGrant[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const contextQuery = useQuery({
    queryKey: ["admin", "context"],
    queryFn: () => fetchAdminContext(),
  });
  const canGrant = contextQuery.data?.canGrant === true;
  // What a person unticked of what a binding asks for, by row. Everything
  // asked for is offered ticked: the request is what the profile declares.
  const [withheld, setWithheld] = useState<Record<string, string[]>>({});
  // The row last written, and the list it stood in: until the cluster has
  // applied the commit it stays there, and its button waits.
  const [done, setDone] = useState<{ key: string; from: "pending" | "granted" } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const [written, setWritten] = useState<Written>({});

  const write = useMutation({
    mutationFn: async ({ row, granted }: { row: EffectiveAccessRow; granted: string[] | null }) => {
      const body = granted
        ? withContract(grants, written, row.consumer, row.contract, granted)
        : withoutContract(grants, written, row.consumer, row.contract);
      if (body) {
        await updateAppGrant(row.consumer, body, tenant);
      } else {
        await clearAppGrant(row.consumer, tenant);
      }
      return body;
    },
    onMutate: () => {
      setDone(null);
      setFailed(null);
    },
    onSuccess: (body, { row, granted }) => {
      setWritten((before) => ({ ...before, [row.consumer]: body }));
      setDone({ key: rowKey(row), from: granted ? "pending" : "granted" });
      void queryClient.invalidateQueries({ queryKey: ["admin", "integrations", tenant] });
    },
    onError: (err, { row }) => setFailed({ key: rowKey(row), message: refusalOf(err) }),
  });

  const pending = rows.filter((row) => row.grantedCapabilities.length === 0);
  const granted = rows.filter((row) => row.grantedCapabilities.length > 0);

  const applying = (row: EffectiveAccessRow, list: "pending" | "granted") =>
    done?.key === rowKey(row) && done.from === list;
  const waiting = pending.some((row) => applying(row, "pending")) || granted.some((row) => applying(row, "granted"));
  // While a commit waits for the cluster, the overview is asked again until
  // the row has moved.
  useQuery({
    queryKey: ["admin", "integrations", tenant],
    queryFn: () => fetchIntegrationsOverview(tenant),
    enabled: waiting,
    refetchInterval: waiting ? 3000 : false,
  });

  const chosen = (row: EffectiveAccessRow) =>
    row.bindingCapabilities.filter((cap) => !(withheld[rowKey(row)] ?? []).includes(cap));

  const toggle = (row: EffectiveAccessRow, cap: string) => {
    const key = rowKey(row);
    const now = withheld[key] ?? [];
    setWithheld({ ...withheld, [key]: now.includes(cap) ? now.filter((c) => c !== cap) : [...now, cap] });
  };

  const outcome = (row: EffectiveAccessRow, list: "pending" | "granted") => {
    const key = rowKey(row);
    if (failed?.key === key) {
      return <div className="admin-console__error">{t("integrations.writeRefused", { reason: failed.message })}</div>;
    }
    if (applying(row, list)) {
      return <div className="admin-console__hint">{t("integrations.writeCommitted")}</div>;
    }
    return null;
  };

  return (
    <>
      <h3 className="admin-console__subtitle">{t("integrations.pendingTitle")}</h3>
      <p className="admin-console__hint" style={{ marginBottom: "0.75rem" }}>
        {canGrant ? t("integrations.pendingLead") : t("integrations.pendingLeadReadOnly")}</p>
      {pending.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "var(--gtn-ink-4)", marginBottom: "1.5rem" }}>
          {t("integrations.pendingNone")}</p>
      ) : (
        <table className="admin-console__table" style={{ marginBottom: "2rem" }}>
          <thead>
            <tr>
              <th>{t("integrations.consumer")}</th>
              <th>{t("integrations.contract")}</th>
              <th>{t("integrations.provider")}</th>
              <th>{t("integrations.requested")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pending.map((row) => (
              <tr key={rowKey(row)}>
                <td style={{ fontWeight: 600 }}>{row.consumer}</td>
                <td><code>{row.contract}</code></td>
                <td>{row.provider}</td>
                <td>
                  {row.bindingCapabilities.length === 0 ? (
                    <span>{t("integrations.asksForNothing")}</span>
                  ) : (
                    row.bindingCapabilities.map((cap) => (
                      <label key={cap} style={{ display: "block", whiteSpace: "nowrap" }}>
                        <input
                          type="checkbox"
                          checked={chosen(row).includes(cap)}
                          disabled={!canGrant || write.isPending}
                          onChange={() => toggle(row, cap)}
                        />{" "}
                        <code>{cap}</code>
                      </label>
                    ))
                  )}
                  {outcome(row, "pending")}
                </td>
                <td style={{ textAlign: "right" }}>
                  {canGrant ? (
                    <button
                      type="button"
                      className={`admin-console__btn admin-console__btn--primary${
                        applying(row, "pending") ? " admin-console__btn--waiting" : ""}`}
                      disabled={write.isPending || applying(row, "pending") || chosen(row).length === 0}
                      onClick={() => write.mutate({ row, granted: chosen(row) })}
                    >
                      {applying(row, "pending") ? t("integrations.applying") : t("integrations.approve")}</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="admin-console__subtitle">{t("integrations.grantedTitle")}</h3>
      {granted.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "var(--gtn-ink-4)", marginBottom: "1.5rem" }}>
          {t("integrations.grantedNone")}</p>
      ) : (
        <table className="admin-console__table" style={{ marginBottom: "2rem" }}>
          <thead>
            <tr>
              <th>{t("integrations.consumer")}</th>
              <th>{t("integrations.contract")}</th>
              <th>{t("integrations.provider")}</th>
              <th>{t("integrations.granted")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {granted.map((row) => (
              <tr key={rowKey(row)}>
                <td style={{ fontWeight: 600 }}>{row.consumer}</td>
                <td><code>{row.contract}</code></td>
                <td>{row.provider}</td>
                <td>
                  <code>{row.grantedCapabilities.join(", ")}</code>
                  {row.ungranted.length > 0 ? (
                    <div className="admin-console__hint">
                      {t("integrations.notGranted", { capabilities: row.ungranted.join(", ") })}</div>
                  ) : null}
                  {outcome(row, "granted")}
                </td>
                <td style={{ textAlign: "right" }}>
                  {canGrant ? (
                    <button
                      type="button"
                      className={`admin-console__btn${applying(row, "granted") ? " admin-console__btn--waiting" : ""}`}
                      disabled={write.isPending || applying(row, "granted")}
                      onClick={() => write.mutate({ row, granted: null })}
                    >
                      {applying(row, "granted") ? t("integrations.applying") : t("integrations.withdraw")}</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function IntegrationsSection({ tenant }: IntegrationsSectionProps) {
  const { t } = useTranslation();

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
    return <p>{t("integrations.loadingIntegrations")}</p>;
  }
  if (overviewQuery.isError || !overviewQuery.data) {
    return <p className="admin-console__error">{t("integrations.integrationsOverviewIsUnavailable")}</p>;
  }

  const { bindings, grants, summary, effectiveAccess } = overviewQuery.data;

  return (
    <section>
      <div className="admin-console__toolbar">
        <h2 className="admin-console__section-title">
          {t("integrations.integrationsGrants")}</h2>
      </div>
      <p className="admin-console__hint" style={{ marginBottom: "1rem" }}>
        {t("integrations.activeIntegrationbindingsAreOperatorWired")}</p>

      <p className="admin-console__mono" style={{ fontSize: "0.8125rem", color: "var(--gtn-ink-4)", marginBottom: "1.5rem" }}>
        {summary.bindingCount} binding{summary.bindingCount === 1 ? "" : "s"} ·{" "}
        {summary.grantCount} grant{summary.grantCount === 1 ? "" : "s"} ·{" "}
        {summary.grantReadyCount} ready
      </p>

      <IntegrationApprovals tenant={tenant} rows={effectiveAccess} grants={grants} />

      <h3 className="admin-console__subtitle">{t("integrations.effectiveAccess")}</h3>
      {effectiveAccess.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "var(--gtn-ink-4)", marginBottom: "1.5rem" }}>
          {t("integrations.noIntegrationBindingsToPreview")}</p>
      ) : (
        <table className="admin-console__table" style={{ marginBottom: "2rem" }}>
          <thead>
            <tr>
              <th>{t("integrations.contract")}</th>
              <th>{t("integrations.consumerProvider")}</th>
              <th>{t("integrations.bound")}</th>
              <th>{t("integrations.granted")}</th>
              <th>{t("integrations.grantPhase")}</th>
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
                <td>{row.grantPhase || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3 className="admin-console__subtitle">{t("integrations.bindings")}</h3>
      {bindings.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "var(--gtn-ink-4)", marginBottom: "1.5rem" }}>
          {t("integrations.noActiveIntegrationBindings")}</p>
      ) : (
        <table className="admin-console__table" style={{ marginBottom: "2rem" }}>
          <thead>
            <tr>
              <th>{t("integrations.contract2")}</th>
              <th>{t("integrations.consumer")}</th>
              <th>{t("integrations.provider")}</th>
              <th>{t("integrations.capabilities")}</th>
              <th>{t("integrations.state")}</th>
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

      <h3 className="admin-console__subtitle">{t("integrations.appGrants")}</h3>
      {grants.length === 0 ? (
        <p style={{ fontSize: "0.875rem", color: "var(--gtn-ink-4)" }}>
          {t("integrations.noAppgrantObjectsYetCreated")}</p>
      ) : (
        <table className="admin-console__table" style={{ maxWidth: "36rem", marginBottom: "2rem" }}>
          <thead>
            <tr>
              <th>{t("integrations.app")}</th>
              <th>{t("integrations.phase")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {grants.map((grant) => (
              <tr key={grant.name}>
                <td style={{ fontWeight: 600 }}>{grant.app}</td>
                <td>{grant.phase || "Pending"}</td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className="admin-console__btn"
                    onClick={() => setEditing(grant)}
                  >
                    {t("integrations.editGrant")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing ? (
        <div className="admin-console__edit-panel" style={{ maxWidth: "36rem", marginTop: "1rem" }}>
          <div className="admin-console__edit-panel-header">
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.9375rem" }}>
                {t("integrations.editGrant2")}</div>
              <div className="admin-console__mono" style={{ fontSize: "0.8125rem", color: "var(--gtn-ink-4)" }}>
                {editing.app}
              </div>
            </div>
            <button type="button" className="admin-console__btn" onClick={() => setEditing(null)}>
              {t("integrations.close")}</button>
          </div>

          <div className="admin-console__edit-panel-body" style={{ padding: "1rem" }}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveMutation.mutate(editing);
              }}
            >
              {editing.consume.map((entry, index) => (
                <div key={entry.contract} className="admin-console__field" style={{ marginBottom: "1rem" }}>
                  <label htmlFor={`grant-${entry.contract}`}>
                    {entry.contract} {t("integrations.capabilitiesCommaSeparated")}</label>
                  <input
                    id={`grant-${entry.contract}`}
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
              <div className="admin-console__form-footer">
                <button
                  type="submit"
                  className="admin-console__btn admin-console__btn--primary"
                  style={{ marginRight: "0.5rem" }}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? "Saving…" : "Save"}
                </button>
                <button type="button" className="admin-console__btn" onClick={() => setEditing(null)}>
                  {t("integrations.cancel")}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}

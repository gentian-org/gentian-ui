import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchClusterUpdates, moveOutdated, setAppUpdateMode, type UpdateEntry } from "@/api/cluster";
import "./admin.css";

const MODES = ["", "latest", "manual", "tenant"] as const;

function shortDigest(digest?: string): string {
  return digest ? digest.replace("sha256:", "").slice(0, 12) : "—";
}

/**
 * The update report (gentian-os docs/plans/versioning.md §4.2): every
 * installed app of every tenant against the build its catalog offers, the
 * mode it moves under and what keeps it where it is -- and the one action,
 * moving the outdated ones to the newest build, whoever introduced the lag.
 * Each move exports first, verifies after and rolls back by itself; the
 * rollout column says how the last one went.
 */
export function UpdatesSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [outcome, setOutcome] = useState<string | null>(null);

  const report = useQuery({ queryKey: ["admin", "cluster", "updates"], queryFn: fetchClusterUpdates });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin", "cluster", "updates"] });

  const move = useMutation({
    mutationFn: (entries: UpdateEntry[]) =>
      moveOutdated(
        entries.length === 0
          ? {}
          : { tenants: Array.from(new Set(entries.map((e) => e.tenant))), apps: Array.from(new Set(entries.map((e) => e.profile))) },
      ),
    onSuccess: (answer) => {
      setOutcome(t("updates.moved", { moved: answer.moved.length, skipped: answer.skipped.length }));
      setSelected(new Set());
      void refresh();
    },
    onError: (err: Error) => setOutcome(err.message),
  });

  const setMode = useMutation({
    mutationFn: ({ entry, mode }: { entry: UpdateEntry; mode: string }) => setAppUpdateMode(entry.tenant, entry.profile, mode),
    onSuccess: () => void refresh(),
    onError: (err: Error) => setOutcome(err.message),
  });

  if (report.isLoading) {
    return <p className="admin-console__loading">{t("updates.loading")}</p>;
  }
  if (report.isError || !report.data) {
    return <p className="admin-console__error">{t("updates.unavailable")}</p>;
  }
  const data = report.data;
  const outdated = data.entries.filter((e) => e.outdated);
  const key = (e: UpdateEntry) => `${e.tenant}/${e.profile}`;
  const chosen = outdated.filter((e) => selected.has(key(e)));

  const state = (e: UpdateEntry): string => {
    if (e.unmet) return t("updates.cannot", { why: e.unmet });
    if (e.rollout && (e.rollout.phase === "Exporting" || e.rollout.phase === "Rolling")) return t("updates.moving");
    if (e.outdated && e.held && e.held.length > 0) return t("updates.outdatedHeld");
    if (e.outdated) return t("updates.outdated");
    if (e.rollout && e.rollout.phase === "RolledBack") return t("updates.rolledBack", { reason: e.rollout.message ?? "" });
    return t("updates.current");
  };

  return (
    <section>
      <header className="admin-console__section-head">
        <div>
          <h2 className="admin-console__section-title">{t("updates.title")}</h2>
          <p className="admin-console__lead">{t("updates.lead")}</p>
          <p className="admin-console__meta">
            {t("updates.policy", {
              mode: data.policy.mode,
              window: data.policy.window?.start && data.policy.window?.end
                ? `${data.policy.window.start}–${data.policy.window.end} ${data.policy.window.timezone ?? "UTC"}`
                : t("updates.anyTime"),
            })}{" "}
            {data.windowOpen ? t("updates.windowOpen") : t("updates.windowClosed")}
          </p>
          {data.partial ? <p className="admin-console__error">{t("updates.partial", { detail: data.partial })}</p> : null}
        </div>
        <div className="admin-console__actions">
          <button
            type="button"
            className="admin-console__btn admin-console__btn--primary"
            disabled={move.isPending || outdated.length === 0}
            onClick={() => move.mutate(chosen)}
          >
            {chosen.length > 0 ? t("updates.moveSelected", { count: chosen.length }) : t("updates.moveAll", { count: outdated.length })}
          </button>
        </div>
      </header>
      {outcome ? <p className="admin-console__meta" role="status">{outcome}</p> : null}
      <table className="admin-console__table">
        <thead>
          <tr>
            <th />
            <th>{t("updates.tenant")}</th>
            <th>{t("updates.app")}</th>
            <th>{t("updates.pinned")}</th>
            <th>{t("updates.running")}</th>
            <th>{t("updates.newest")}</th>
            <th>{t("updates.mode")}</th>
            <th>{t("updates.state")}</th>
          </tr>
        </thead>
        <tbody>
          {data.entries.map((e) => (
            <tr key={key(e)}>
              <td>
                {e.outdated ? (
                  <input
                    type="checkbox"
                    aria-label={t("updates.select", { app: e.profile, tenant: e.tenant })}
                    checked={selected.has(key(e))}
                    onChange={(ev) => {
                      const next = new Set(selected);
                      if (ev.target.checked) next.add(key(e));
                      else next.delete(key(e));
                      setSelected(next);
                    }}
                  />
                ) : null}
              </td>
              <td>{e.tenant}</td>
              <td>
                {e.profile}
                {e.addonOf ? <div className="admin-console__meta">{t("updates.addonOf", { app: e.addonOf })}</div> : null}
              </td>
              <td><span className="admin-console__mono" title={e.pinned}>{shortDigest(e.pinned)}</span></td>
              <td><span className="admin-console__mono" title={e.running}>{shortDigest(e.running)}</span></td>
              <td>
                <span className="admin-console__mono" title={e.newest}>{shortDigest(e.newest)}</span>
                {e.newestVersion ? <div className="admin-console__meta">{e.newestVersion}</div> : null}
              </td>
              <td>
                {e.addonOf ? (
                  // An add-on moves with its app: its mode is the app's.
                  <span className="admin-console__meta">{t("updates.modeOfApp", { mode: e.mode, app: e.addonOf })}</span>
                ) : (
                  <select
                    aria-label={t("updates.modeFor", { app: e.profile, tenant: e.tenant })}
                    value={e.modeFrom === "tenant" ? e.mode : ""}
                    disabled={setMode.isPending}
                    onChange={(ev) => setMode.mutate({ entry: e, mode: ev.target.value })}
                  >
                    {MODES.map((m) => (
                      <option key={m} value={m}>
                        {m === ""
                          ? t("updates.modeDefault", { mode: e.modeFrom === "tenant" ? data.policy.apps?.[e.profile] ?? data.policy.mode : e.mode })
                          : t(`updates.mode${m.charAt(0).toUpperCase()}${m.slice(1)}`)}
                      </option>
                    ))}
                  </select>
                )}
              </td>
              <td>
                {state(e)}
                {e.held && e.held.length > 0 ? (
                  <ul className="admin-console__meta">
                    {e.held.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.unread && data.unread.length > 0 ? <p className="admin-console__meta">{t("updates.unread", { names: data.unread.join(", ") })}</p> : null}
    </section>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchClusterRelease, setClusterRelease, type ReleaseSpec } from "@/api/cluster";
import "./admin.css";

const MODES = ["none", "patch", "minor"] as const;

export const RELEASE_QUERY_KEY = ["admin", "cluster", "release"] as const;

/**
 * The platform release this cluster runs (gentian-os
 * docs/concepts/versioning.md §2.1): what the Cluster claim declares, what
 * the operator applied and what the release index offers under the
 * cluster's autoUpgrade mode. The one write is the director's set-release
 * action, a signed commit; the operator moves the cluster from there.
 */
export function ReleaseSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const [mode, setMode] = useState<string>("");
  const [track, setTrack] = useState("");

  const view = useQuery({ queryKey: RELEASE_QUERY_KEY, queryFn: fetchClusterRelease });
  const refresh = () => queryClient.invalidateQueries({ queryKey: RELEASE_QUERY_KEY });

  const set = useMutation({
    mutationFn: (want: ReleaseSpec) => setClusterRelease(want),
    onSuccess: (answer) => {
      setOutcome(answer.status === "unchanged" ? t("release.unchanged") : t("release.committed"));
      setVersion("");
      setTrack("");
      void refresh();
    },
    onError: (err: Error) => setOutcome(err.message),
  });

  if (view.isLoading) {
    return <p className="admin-console__loading">{t("release.loading")}</p>;
  }
  if (view.isError || !view.data) {
    return <p className="admin-console__error">{t("release.unavailable")}</p>;
  }
  const data = view.data;
  const spec = data.spec ?? {};
  const status = data.status ?? {};
  const currentMode = spec.autoUpgrade || "none";
  const window =
    data.window?.start && data.window?.end
      ? `${data.window.start}–${data.window.end} ${data.window.timezone ?? "UTC"}`
      : t("release.anyTime");

  return (
    <section>
      <header className="admin-console__section-head">
        <div>
          <h2 className="admin-console__section-title">{t("release.title")}</h2>
          <p className="admin-console__lead">{t("release.lead")}</p>
        </div>
      </header>
      {data.partial ? <p className="admin-console__error">{t("release.partial", { detail: data.partial })}</p> : null}
      {outcome ? <p className="admin-console__meta" role="status">{outcome}</p> : null}

      <dl className="admin-console__facts">
        <dt>{t("release.declared")}</dt>
        <dd>
          {spec.version
            ? t("release.runsVersion", { version: spec.version, mode: currentMode })
            : spec.track
              ? t("release.followsTrack", { track: spec.track })
              : t("release.undeclared")}
        </dd>
        <dt>{t("release.applied")}</dt>
        <dd>
          {status.revision ? (
            <>
              <span className="admin-console__mono">{status.revision}</span> ({status.image}){" "}
            </>
          ) : null}
          {status.state ? `${status.state}: ${status.message ?? ""}` : t("release.notYetApplied")}
        </dd>
        <dt>{t("release.operator")}</dt>
        <dd>
          {data.platform?.version ? (
            <>
              {data.platform.version} <span className="admin-console__mono">{data.platform.build}</span>
            </>
          ) : (
            "—"
          )}
        </dd>
        <dt>{t("release.window")}</dt>
        <dd>
          {window} {data.windowOpen ? t("release.windowOpen") : t("release.windowClosed")}
        </dd>
      </dl>

      {status.available ? (
        <p className="admin-console__meta">{t("release.available", { version: status.available, mode: currentMode })}</p>
      ) : null}
      {status.pending ? (
        <div className="admin-console__callout">
          <p>
            {t("release.pending", { version: status.pending })}{" "}
            {status.pendingNotes ? (
              <a href={status.pendingNotes} target="_blank" rel="noreferrer">
                {t("release.notes")}
              </a>
            ) : null}
          </p>
          <button
            type="button"
            className="admin-console__btn admin-console__btn--primary"
            disabled={set.isPending}
            onClick={() => set.mutate({ version: status.pending, autoUpgrade: currentMode })}
          >
            {t("release.take", { version: status.pending })}
          </button>
        </div>
      ) : null}

      <h3 className="admin-console__subtitle">{t("release.setTitle")}</h3>
      <form
        className="admin-console__form"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!version) return;
          set.mutate({ version, autoUpgrade: mode || currentMode });
        }}
      >
        <label>
          {t("release.versionLabel")}
          <input
            type="text"
            value={version}
            placeholder="v0.5.1"
            pattern="^v[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$"
            onChange={(ev) => setVersion(ev.target.value)}
          />
        </label>
        <label>
          {t("release.modeLabel")}
          <select value={mode || currentMode} onChange={(ev) => setMode(ev.target.value)}>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {t(`release.mode_${m}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="admin-console__btn" disabled={set.isPending || !version}>
          {t("release.set")}
        </button>
      </form>

      <h3 className="admin-console__subtitle">{t("release.trackTitle")}</h3>
      <p className="admin-console__meta">{t("release.trackLead")}</p>
      <form
        className="admin-console__form"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!track) return;
          set.mutate({ track });
        }}
      >
        <label>
          {t("release.trackLabel")}
          <input type="text" value={track} onChange={(ev) => setTrack(ev.target.value)} />
        </label>
        <button type="submit" className="admin-console__btn" disabled={set.isPending || !track}>
          {t("release.follow")}
        </button>
      </form>
    </section>
  );
}

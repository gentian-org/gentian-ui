/* SPDX-License-Identifier: Apache-2.0 */
import { useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";
import { fetchTenantExposures, type ExposureEntry } from "@/api/apps";
import "./admin.css";

const mono = { mono: <span className="admin-console__mono" /> };

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

const day = (value?: string) => (value ? new Date(value).toLocaleDateString() : "");

/**
 * Public addresses: what this app, and the add-ons switched on inside it,
 * ask to have on the internet, and whether that was approved.
 *
 * The director's answer, read from the app's profile and the tenant's
 * registry in git: for each entry the address it is published at, its paths,
 * whether anybody signs in, and its state -- requested, approved by whom and
 * until when, due for review, or expired.
 *
 * Read-only, and on purpose: nothing is approved or withdrawn from here, and
 * the console's backend has no route that would. Putting something on the
 * internet is the tenant's perimeter approver's decision, made with the
 * command the lead names.
 *
 * Not shown at all for an app that declares nothing for the internet, which
 * is most of them, and while that is not known yet.
 */
export function AppPublicAddresses({ app, addons }: { app: string; addons: string[] }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["admin", "apps", "exposures"],
    queryFn: () => fetchTenantExposures(),
  });

  const names = new Set([app, ...addons]);
  const entries = (query.data?.entries ?? []).filter((e) => names.has(e.install));

  if (query.isError) {
    return (
      <div className="admin-console__subsection">
        <h3 className="admin-console__subsection-title">{t("apps.publicTitle")}</h3>
        <p className="admin-console__error">
          {t("apps.publicUnavailable")} {messageOf(query.error)}
        </p>
      </div>
    );
  }
  if (entries.length === 0) return null;

  return (
    <div className="admin-console__subsection">
      <h3 className="admin-console__subsection-title">{t("apps.publicTitle")}</h3>
      <p className="admin-console__hint">
        <Trans i18nKey="apps.publicLead" components={mono} />
      </p>
      <div className="admin-console__table-wrap">
        <table className="admin-console__table">
          <thead>
            <tr>
              <th>{t("apps.publicAddress")}</th>
              <th>{t("apps.publicPaths")}</th>
              <th>{t("apps.publicSignIn")}</th>
              <th>{t("apps.publicState")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={`${entry.install}/${entry.exposureName}`}>
                <td>
                  <AddressCell entry={entry} app={app} />
                </td>
                <td>
                  <PathsCell entry={entry} />
                </td>
                <td>{signInOf(t, entry)}</td>
                <td>
                  <StateCell entry={entry} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddressCell({ entry, app }: { entry: ExposureEntry; app: string }) {
  const { t } = useTranslation();
  return (
    <>
      {entry.host ? (
        <span className="admin-console__mono">{`https://${entry.host}`}</span>
      ) : (
        <span>{t("apps.publicNoAddress")}</span>
      )}
      {entry.mainAddress ? (
        <div>
          <span className="admin-console__badge admin-console__badge--info">{t("apps.publicMainAddress")}</span>
        </div>
      ) : null}
      <div className="admin-console__hint">
        {entry.install === app ? (
          <Trans i18nKey="apps.publicEntry" values={{ entry: entry.exposureName }} components={mono} />
        ) : (
          <Trans
            i18nKey="apps.publicEntryOfAddon"
            values={{ entry: entry.exposureName, addon: entry.install }}
            components={mono}
          />
        )}
      </div>
      {/* Why it has no address: the director's own words. */}
      {!entry.host && entry.note && entry.state !== "unmatched" ? (
        <div className="admin-console__hint">{entry.note}</div>
      ) : null}
    </>
  );
}

function PathsCell({ entry }: { entry: ExposureEntry }) {
  const { t } = useTranslation();
  const paths = entry.paths ?? [];
  const denied = entry.denyPaths ?? [];
  if (paths.length === 0) return <span>{t("apps.publicNotKnown")}</span>;
  const whole = paths.includes("/");
  return (
    <>
      <span className="admin-console__mono">{paths.join("  ")}</span>
      <div className="admin-console__hint">
        {whole ? t("apps.publicWholeAddress") : t("apps.publicOnlyThese")}
      </div>
      {denied.length > 0 ? (
        <div className="admin-console__hint">
          <Trans i18nKey="apps.publicNeverPublished" values={{ paths: denied.join("  ") }} components={mono} />
        </div>
      ) : null}
    </>
  );
}

/** Who can reach the entry. The platform checks nobody at a public address. */
function signInOf(t: TFunction, entry: ExposureEntry) {
  if (!entry.authMode) return t("apps.publicNotKnown");
  if (entry.anyoneWithoutSignIn) return t("apps.publicAnyone");
  return t("apps.publicCheckedByApp", { mode: entry.authMode });
}

function StateCell({ entry }: { entry: ExposureEntry }) {
  const { t } = useTranslation();
  const approval = entry.approval;
  const approvedBy = approval ? (
    <div>
      <Trans
        i18nKey="apps.publicApprovedBy"
        values={{ who: approval.owner, when: day(approval.publishedAt) }}
        components={mono}
      />
    </div>
  ) : null;
  const reason = approval?.reason ? (
    <div className="admin-console__hint">{t("apps.publicReason", { reason: approval.reason })}</div>
  ) : null;

  switch (entry.state) {
    case "requested":
      return (
        <>
          <span className="admin-console__badge admin-console__badge--warn">{t("apps.publicRequested")}</span>
          <div>{t("apps.publicRequestedDetail")}</div>
        </>
      );
    case "approved":
      return (
        <>
          <span className="admin-console__badge admin-console__badge--ok">{t("apps.publicApproved")}</span>
          {approvedBy}
          <div>{t("apps.publicReviewBy", { review: day(approval?.reviewAt) })}</div>
          <div>
            {approval?.expiresAt
              ? t("apps.publicUntil", { until: day(approval.expiresAt) })
              : t("apps.publicNoEnd")}
          </div>
          {reason}
        </>
      );
    case "reviewDue":
      return (
        <>
          <span className="admin-console__badge admin-console__badge--warn">{t("apps.publicReviewDue")}</span>
          <div>{t("apps.publicReviewDueDetail", { review: day(approval?.reviewAt) })}</div>
          {approvedBy}
          <div>
            {approval?.expiresAt
              ? t("apps.publicUntil", { until: day(approval.expiresAt) })
              : t("apps.publicNoEnd")}
          </div>
          {reason}
        </>
      );
    case "expired":
      return (
        <>
          <span className="admin-console__badge admin-console__badge--danger">{t("apps.publicExpired")}</span>
          <div>{t("apps.publicExpiredDetail", { until: day(approval?.expiresAt) })}</div>
          {approvedBy}
          {reason}
        </>
      );
    case "unmatched":
      return (
        <>
          <span className="admin-console__badge admin-console__badge--warn">{t("apps.publicUnmatched")}</span>
          {/* The director's own words for why. */}
          {entry.note ? <div>{entry.note}</div> : null}
          {approvedBy}
        </>
      );
    default:
      // A state this screen does not know is shown as the director named it.
      return <span className="admin-console__mono">{entry.state}</span>;
  }
}

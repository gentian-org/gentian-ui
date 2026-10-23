import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { fetchApp, fetchMeta, fetchReports, type AppDetail, type Link as StoreLink, type Version } from "@/api/store";
import i18n from "@/lib/i18n";
import { coordinateParams } from "@/store/BrowsePage";
import { AddonSection, InstallButton, InstallScope, InstallStatus, type Resume } from "@/store/InstallPanel";
import { DateText, EditionBadge, ExternalLink, giveBackLink, Picture, PriceText, ProblemNote, StoreLinkItem, useStoreName } from "@/store/parts";
import { Reviews } from "@/store/Reviews";
import { StoreMarkdown } from "@/store/StoreMarkdown";
import { Support } from "@/store/Support";

function Reports({ coordinate }: { coordinate: string }) {
  const { t } = useTranslation();
  const query = useQuery({ queryKey: ["store", "reports", coordinate], queryFn: () => fetchReports(coordinate), retry: false });
  const items = query.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section className="admin-console__subsection">
      <h2 className="admin-console__subsection-title">{t("app.reports")}</h2>
      <p className="admin-console__lead">{t("app.reportsLead")}</p>
      <ul className="admin-console__cards">
        {items.map((report) => {
          const kind = `reportKind.${report.kind}`;
          return (
            <li key={report.id} className="admin-console__card">
              <div className="admin-console__card-main">
                <p className="admin-console__card-title">{report.title}</p>
                <p className="admin-console__card-meta">
                  <span className="admin-console__chip">{i18n.exists(kind) ? t(kind) : t("reportKind.other")}</span>{" "}
                  {report.issuer ? `${report.issuer} · ` : ""}
                  <DateText value={report.date} />
                  {report.version ? ` · ${report.version}` : ""}
                </p>
                <p className="admin-console__card-desc">{report.summary}</p>
              </div>
              <div className="admin-console__card-aside">
                <ExternalLink href={report.documentUrl}>{t("app.openDocument")}</ExternalLink>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The highest rung of the customization ladder the profile lists. */
function highestRung(rungs: string[]): string | null {
  return [...rungs].sort().at(-1) ?? null;
}

/**
 * The app at a glance: its edition, the store's maturity score, how far it
 * can be customized, its reviews' average and how many tenants have it.
 * What the store does not say is said to be missing, never guessed.
 */
function Scorecard({ detail }: { detail: AppDetail }) {
  const { t } = useTranslation();
  const rating = detail.rating;
  const rated = rating && rating.count > 0 && rating.average !== null;
  const customization = detail.customization;
  const rung = customization ? highestRung(customization.rungs) : null;
  return (
    <aside className="store-install store-scorecard">
      <h2 className="admin-console__subsection-title">{t("scorecard.title")}</h2>
      <dl className="store-scorecard__list">
        <dt>{t("scorecard.edition")}</dt>
        <dd>
          <EditionBadge edition={detail.edition} />
        </dd>
        <dt>{t("scorecard.maturity")}</dt>
        <dd>
          {typeof detail.maturityScore === "number" ? t("scorecard.maturityOf", { score: detail.maturityScore }) : t("scorecard.notScored")}
        </dd>
        <dt>{t("scorecard.customization")}</dt>
        <dd>
          {customization && customization.grade !== "unknown"
            ? rung
              ? t("scorecard.customizationGradeRung", { grade: customization.grade, rung })
              : t("scorecard.customizationGrade", { grade: customization.grade })
            : t("scorecard.notCharacterised")}
        </dd>
        <dt>{t("scorecard.rating")}</dt>
        <dd>
          {rated && rating.average !== null
            ? t("browse.rating", { average: rating.average.toFixed(1), count: rating.count })
            : t("scorecard.notRated")}
        </dd>
        {typeof detail.installations === "number" ? (
          <>
            <dt>{t("scorecard.installations")}</dt>
            <dd>{detail.installations.toLocaleString(i18n.resolvedLanguage)}</dd>
          </>
        ) : null}
      </dl>
    </aside>
  );
}

/**
 * What the app needs of the cluster, as the store states it for the latest
 * version: the least it reserves, the platform versions it runs on, and
 * anything else in a sentence. A description; the cluster reads the profile.
 */
function Requirements({ version }: { version: Version | undefined }) {
  const { t } = useTranslation();
  const needs = version?.requirements;
  const rows = [
    ["requirements.cpu", needs?.resources?.cpu],
    ["requirements.memory", needs?.resources?.memory],
    ["requirements.storage", needs?.resources?.storage],
    ["requirements.platform", needs?.platform],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  const notes = needs?.notes ?? [];
  return (
    <aside className="store-install store-scorecard">
      <h2 className="admin-console__subsection-title">{t("requirements.title")}</h2>
      {rows.length > 0 ? (
        <dl className="store-scorecard__list">
          {rows.map(([key, value]) => (
            <Fragment key={key}>
              <dt>{t(key)}</dt>
              <dd className="admin-console__mono">{value}</dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
      {notes.map((note, index) => (
        <p key={index} className="admin-console__meta">
          {note}
        </p>
      ))}
      {rows.length === 0 && notes.length === 0 ? <p className="admin-console__meta">{t("requirements.notStated")}</p> : null}
    </aside>
  );
}

/** Where to read more of the app: its homepage, its source, its videos. Support and donations are in Support. */
const NOT_RESOURCES = new Set(["donate", "support", "license", "privacy", "terms", "subscription"]);

function Resources({ links }: { links: StoreLink[] }) {
  const { t } = useTranslation();
  const order = ["homepage", "source", "video", "documentation"];
  const rank = (link: StoreLink) => {
    const at = order.indexOf(link.rel ?? "");
    return at < 0 ? order.length : at;
  };
  const shown = links.filter((link) => !NOT_RESOURCES.has(link.rel ?? "")).sort((a, b) => rank(a) - rank(b));
  if (shown.length === 0) return null;
  return (
    <aside className="store-install">
      <h2 className="admin-console__subsection-title">{t("app.resources")}</h2>
      <ul className="store-links">
        {shown.map((link, index) => (
          <li key={index}>
            <StoreLinkItem link={link} />
          </li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * Support Project: where to give back to the people who build an app that
 * is not sold, and the partners the store lists that offer support for it.
 * With no partner listed it is the project's own page; otherwise a dialog
 * with both.
 */
function SupportProject({ detail, storeName }: { detail: AppDetail; storeName: string }) {
  const { t } = useTranslation();
  const metaQuery = useQuery({ queryKey: ["store", "meta"], queryFn: fetchMeta, retry: false });
  const [open, setOpen] = useState(false);
  const giveBack = giveBackLink(detail.edition, detail.links);
  const partners = metaQuery.data?.features.includes("support") === true && (detail.support ?? []).length > 0;
  if (!partners && !giveBack) return null;
  if (!partners && giveBack) {
    return (
      <a className="admin-console__btn" href={giveBack.url} target="_blank" rel="noopener noreferrer" title={giveBack.label ?? undefined}>
        {t("install.supportAction")}
      </a>
    );
  }
  return (
    <>
      <button type="button" className="admin-console__btn" onClick={() => setOpen(true)}>
        {t("install.supportAction")}
      </button>
      {open ? (
        <SupportDialog title={t("install.supportAction")} onClose={() => setOpen(false)}>
          {giveBack ? (
            <div className="admin-console__actions">
              <a className="admin-console__btn admin-console__btn--primary" href={giveBack.url} target="_blank" rel="noopener noreferrer">
                {giveBack.rel === "donate" ? t("install.donate") : t("install.supportProject")}
              </a>
              {giveBack.label ? <span className="admin-console__meta">{giveBack.label}</span> : null}
            </div>
          ) : null}
          <Support detail={detail} meta={metaQuery.data} storeName={storeName} />
        </SupportDialog>
      ) : null}
    </>
  );
}

function SupportDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="admin-console__dialog"
      aria-labelledby="support-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="admin-console__dialog-body">
        <h3 id="support-title" className="admin-console__dialog-title">
          {title}
        </h3>
        {children}
        <div className="admin-console__dialog-footer">
          <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={onClose}>
            {t("app.close")}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function Details({ detail, storeName, resume, onResumed }: { detail: AppDetail; storeName: string; resume: Resume; onResumed: () => void }) {
  const { t } = useTranslation();
  const metaQuery = useQuery({ queryKey: ["store", "meta"], queryFn: fetchMeta, retry: false });
  const otherEditions = detail.editions.filter((entry) => entry.coordinate !== detail.coordinate);

  return (
    <InstallScope key={detail.coordinate} detail={detail} storeName={storeName} resume={resume} onResumed={onResumed}>
      <div className="store-app__columns">
        <div className="store-app__main">
          <header className={`store-app__head store-app__head--${detail.edition}`}>
            <Picture src={detail.iconUrl} alt="" className="store-app__icon" initialOf={detail.name} />
            <div className="store-app__title">
              <h1 id="store-details-title" className="admin-console__section-title">
                {detail.name}
              </h1>
              <p className="admin-console__meta">
                <ExternalLink href={detail.publisher.url}>{detail.publisher.name}</ExternalLink>
                {detail.license ? (
                  <>
                    {" · "}
                    {t("app.license")} <ExternalLink href={detail.license.url}>{detail.license.name}</ExternalLink>
                  </>
                ) : null}
                {" · "}
                {t("app.latestVersion", { version: detail.latestVersion })}
              </p>
              <p className="admin-console__meta">
                <PriceText price={detail.price} />
                {detail.price.model !== "free" ? ` · ${t("app.listPrice")}` : ""}
                {detail.price.note ? ` · ${detail.price.note}` : ""}
              </p>
              {otherEditions.length > 0 ? (
                <p className="admin-console__meta">
                  {t("app.otherEditions")}{" "}
                  {otherEditions.map((entry) => (
                    <Link
                      key={entry.coordinate}
                      to="/app/$catalogue/$app"
                      params={coordinateParams(entry.coordinate)}
                      className="admin-console__btn-link store-app__edition"
                    >
                      {t(`edition.${entry.edition}`)}
                    </Link>
                  ))}
                </p>
              ) : null}
              {detail.addonOf ? (
                <p className="admin-console__meta">
                  {t("app.addonOf")}{" "}
                  <Link to="/app/$catalogue/$app" params={coordinateParams(detail.addonOf)} className="admin-console__btn-link">
                    <span className="admin-console__mono">{detail.addonOf}</span>
                  </Link>
                </p>
              ) : null}
            </div>
          </header>

          <StoreMarkdown source={detail.description} />
          {detail.screenshots.length > 0 ? (
            <ul className="store-shots">
              {detail.screenshots.map((shot, index) => (
                <li key={index} className="store-shot">
                  <Picture src={shot.url} alt={shot.caption ?? ""} className="store-shot__image" />
                  {shot.caption ? <p className="admin-console__meta">{shot.caption}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}

          <AddonSection />
          <Reviews detail={detail} meta={metaQuery.data} storeName={storeName} />
          <Reports coordinate={detail.coordinate} />
        </div>

        <div className="store-app__side">
          <div className={`store-get store-get--${detail.edition}`}>
            <div className="store-get__actions">
              <InstallButton />
              <SupportProject detail={detail} storeName={storeName} />
            </div>
            <InstallStatus />
          </div>
          <Scorecard detail={detail} />
          <Requirements version={detail.versions[0]} />
          <Resources links={detail.links} />
        </div>
      </div>
    </InstallScope>
  );
}

/**
 * One entry of the store, in full, on top of the catalogue: the one place
 * an app is acquired and installed from.
 *
 * Everything here that describes the app is the store's word, shown as
 * data: text as text, two fields as store-markdown-1, pictures from this
 * app's own origin. What the cluster has of the app is in the column beside
 * it, and is the cluster's. Closing it goes back to the catalogue as it was.
 */
export function AppDetails() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { catalogue, app } = useParams({ strict: false }) as { catalogue: string; app: string };
  const search = useSearch({ strict: false }) as Resume;
  const coordinate = `${catalogue}/${app}`;
  const detailQuery = useQuery({ queryKey: ["store", "app", coordinate], queryFn: () => fetchApp(coordinate), retry: false });
  const metaQuery = useQuery({ queryKey: ["store", "meta"], queryFn: fetchMeta, retry: false });
  const storeName = useStoreName(metaQuery.data?.name);
  const ref = useRef<HTMLDialogElement>(null);
  const close = () => void navigate({ to: "/" });

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  // Another entry opened from inside: from its top.
  useEffect(() => {
    ref.current?.scrollTo?.({ top: 0 });
  }, [coordinate]);

  let body: React.ReactNode;
  if (detailQuery.isLoading) body = <p className="admin-console__loading">{t("app.loading")}</p>;
  else if (detailQuery.isError || !detailQuery.data) body = <ProblemNote error={detailQuery.error} />;
  else
    body = (
      <Details
        detail={detailQuery.data}
        storeName={storeName}
        resume={search}
        // Acted on: the address no longer says it, so a reload does not do it again.
        onResumed={() => void navigate({ to: "/app/$catalogue/$app", params: { catalogue, app }, search: {}, replace: true })}
      />
    );

  return (
    <dialog
      ref={ref}
      className="admin-console__dialog store-details"
      aria-labelledby="store-details-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="store-details__bar">
        <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={close}>
          {t("app.close")}
        </button>
      </div>
      <article className="store-app store-details__body">{body}</article>
    </dialog>
  );
}

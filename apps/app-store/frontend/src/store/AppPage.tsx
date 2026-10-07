import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { fetchApp, fetchMeta, fetchReports, fetchReviews, type AppDetail, type Version } from "@/api/store";
import i18n from "@/lib/i18n";
import { coordinateParams } from "@/store/BrowsePage";
import { InstallPanel } from "@/store/InstallPanel";
import { DateText, ExternalLink, Picture, PriceText, ProblemNote, StoreLinkItem, useStoreName } from "@/store/parts";
import { StoreMarkdown } from "@/store/StoreMarkdown";

function Requirements({ version }: { version: Version }) {
  const { t } = useTranslation();
  const { platform, resources, notes } = version.requirements;
  const parts = [
    platform ? t("app.requiresPlatform", { range: platform }) : null,
    resources?.cpu ? t("app.requiresCpu", { quantity: resources.cpu }) : null,
    resources?.memory ? t("app.requiresMemory", { quantity: resources.memory }) : null,
    resources?.storage ? t("app.requiresStorage", { quantity: resources.storage }) : null,
  ].filter(Boolean);
  if (parts.length === 0 && !(notes && notes.length)) return null;
  return (
    <div className="store-version__requirements">
      {parts.length > 0 ? <p className="admin-console__meta">{parts.join(" · ")}</p> : null}
      {(notes ?? []).map((note, index) => (
        <p key={index} className="admin-console__meta">
          {note}
        </p>
      ))}
    </div>
  );
}

function Versions({ detail }: { detail: AppDetail }) {
  const { t } = useTranslation();
  return (
    <section className="admin-console__subsection">
      <h2 className="admin-console__subsection-title">{t("app.versions")}</h2>
      <ul className="store-versions">
        {detail.versions.map((version) => (
          <li key={version.digest} className="store-version">
            <p className="store-version__head">
              <span className="store-version__number">{version.version}</span>
              <span className="admin-console__meta">
                <DateText value={version.releasedAt} />
              </span>
            </p>
            {/* The build an install of this version is pinned to. */}
            <p className="admin-console__mono admin-console__wrap store-version__digest">{version.digest}</p>
            <Requirements version={version} />
            {version.releaseNotes ? <StoreMarkdown source={version.releaseNotes} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

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

function Reviews({ coordinate }: { coordinate: string }) {
  const { t } = useTranslation();
  const query = useInfiniteQuery({
    queryKey: ["store", "reviews", coordinate],
    queryFn: ({ pageParam }) => fetchReviews(coordinate, pageParam || undefined),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const summary = query.data?.pages[0]?.summary;
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  if (!summary || summary.count === 0) return null;
  return (
    <section className="admin-console__subsection">
      <h2 className="admin-console__subsection-title">{t("app.reviews")}</h2>
      <p className="admin-console__lead">
        {summary.average !== null
          ? t("app.reviewSummary", { average: summary.average.toFixed(1), count: summary.count })
          : t("app.reviewCount", { count: summary.count })}
      </p>
      <ul className="admin-console__cards">
        {items.map((review) => (
          <li key={review.id} className="admin-console__card">
            <div className="admin-console__card-main">
              <p className="admin-console__card-title">
                {t("app.reviewRating", { rating: review.rating })}
                {review.title ? ` · ${review.title}` : ""}
              </p>
              <p className="admin-console__card-desc store-review__text">{review.text}</p>
              <p className="admin-console__card-meta">
                {review.author} · <DateText value={review.date} />
                {review.version ? ` · ${review.version}` : ""}
              </p>
            </div>
          </li>
        ))}
      </ul>
      {query.hasNextPage ? (
        <div className="admin-console__actions">
          <button type="button" className="admin-console__btn" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {t("app.moreReviews")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * One entry of the store, in full, and the one place an app is acquired and
 * installed from.
 *
 * Everything on this page that describes the app is the store's word, shown
 * as data: text as text, two fields as store-markdown-1, pictures from this
 * app's own origin. What the cluster has of the app is in the panel beside
 * it, and is the cluster's.
 */
export function AppPage() {
  const { t } = useTranslation();
  const { catalogue, app } = useParams({ strict: false }) as { catalogue: string; app: string };
  const coordinate = `${catalogue}/${app}`;
  const detailQuery = useQuery({ queryKey: ["store", "app", coordinate], queryFn: () => fetchApp(coordinate), retry: false });
  const metaQuery = useQuery({ queryKey: ["store", "meta"], queryFn: fetchMeta, retry: false });
  const storeName = useStoreName(metaQuery.data?.name);

  if (detailQuery.isLoading) return <p className="admin-console__loading">{t("app.loading")}</p>;
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <section>
        <ProblemNote error={detailQuery.error} />
        <div className="admin-console__actions">
          <Link to="/" className="admin-console__btn">
            {t("app.backToCatalogue")}
          </Link>
        </div>
      </section>
    );
  }
  const detail = detailQuery.data;
  const otherEditions = detail.editions.filter((entry) => entry.coordinate !== detail.coordinate);

  return (
    <article className="store-app">
      <p className="admin-console__meta">
        <Link to="/" className="admin-console__btn-link">
          {t("app.backToCatalogue")}
        </Link>
      </p>
      <header className="store-app__head">
        <Picture src={detail.iconUrl} alt="" className="store-app__icon" />
        <div className="store-app__title">
          <h1 className="admin-console__section-title">{detail.name}</h1>
          <p className="admin-console__lead">{detail.summary}</p>
          <p className="admin-console__meta">
            <ExternalLink href={detail.publisher.url}>{detail.publisher.name}</ExternalLink>
            {" · "}
            <span className="admin-console__mono">{detail.coordinate}</span>
            {" · "}
            {t("app.latestVersion", { version: detail.latestVersion })}
          </p>
          <p className="store-card__meta">
            <span className="admin-console__badge admin-console__badge--info">{t(`edition.${detail.edition}`)}</span>
            <span className="admin-console__chip">{t(`trustTier.${detail.trustTier}`)}</span>
            <span className="store-card__price">
              <PriceText price={detail.price} />
            </span>
          </p>
          {detail.price.note ? <p className="admin-console__meta">{detail.price.note}</p> : null}
          {detail.price.model !== "free" ? <p className="admin-console__meta">{t("app.listPrice")}</p> : null}
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

      <div className="store-app__columns">
        <div className="store-app__main">
          <StoreMarkdown source={detail.description} />

          {detail.screenshots.length > 0 ? (
            <section className="admin-console__subsection">
              <h2 className="admin-console__subsection-title">{t("app.screenshots")}</h2>
              <ul className="store-shots">
                {detail.screenshots.map((shot, index) => (
                  <li key={index} className="store-shot">
                    <Picture src={shot.url} alt={shot.caption ?? ""} className="store-shot__image" />
                    {shot.caption ? <p className="admin-console__meta">{shot.caption}</p> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {detail.addons.length > 0 ? (
            <section className="admin-console__subsection">
              <h2 className="admin-console__subsection-title">{t("app.addons")}</h2>
              <ul className="admin-console__cards">
                {detail.addons.map((addon) => (
                  <li key={addon.coordinate} className="admin-console__card">
                    <div className="admin-console__card-main">
                      <p className="admin-console__card-title">
                        <Link to="/app/$catalogue/$app" params={coordinateParams(addon.coordinate)} className="admin-console__btn-link">
                          {addon.name}
                        </Link>
                      </p>
                      <p className="admin-console__card-desc">{addon.summary}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <Versions detail={detail} />
          <Reports coordinate={coordinate} />
          <Reviews coordinate={coordinate} />
        </div>

        <div className="store-app__side">
          <InstallPanel key={coordinate} detail={detail} storeName={storeName} />
          {detail.links.length > 0 || detail.licence ? (
            <aside className="store-install">
              <h2 className="admin-console__subsection-title">{t("app.links")}</h2>
              <ul className="store-links">
                {detail.links.map((link, index) => (
                  <li key={index}>
                    <StoreLinkItem link={link} />
                  </li>
                ))}
                {detail.licence ? (
                  <li>
                    {t("app.licence")} <ExternalLink href={detail.licence.url}>{detail.licence.name}</ExternalLink>
                  </li>
                ) : null}
              </ul>
            </aside>
          ) : null}
        </div>
      </div>
    </article>
  );
}

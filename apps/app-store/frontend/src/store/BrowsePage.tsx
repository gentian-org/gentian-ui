import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchApps, fetchCategories, type AppSummary, type Edition } from "@/api/store";
import { Picture, PriceText, ProblemNote } from "@/store/parts";

const EDITIONS: Edition[] = ["ce", "me", "ee", "pe"];

export function coordinateParams(coordinate: string) {
  const [catalogue, app] = coordinate.split("/");
  return { catalogue, app };
}

function AppCard({ entry }: { entry: AppSummary }) {
  const { t } = useTranslation();
  return (
    <li className="store-card">
      <Link to="/app/$catalogue/$app" params={coordinateParams(entry.coordinate)} className="store-card__link">
        <Picture src={entry.iconUrl} alt="" className="store-card__icon" />
        <span className="store-card__main">
          <span className="store-card__name">{entry.name}</span>
          <span className="store-card__publisher">{entry.publisher.name}</span>
          <span className="store-card__summary">{entry.summary}</span>
          <span className="store-card__meta">
            <span className="admin-console__badge admin-console__badge--info">{t(`edition.${entry.edition}`)}</span>
            <span className="admin-console__chip">{t(`trustTier.${entry.trustTier}`)}</span>
            <span className="store-card__price">
              <PriceText price={entry.price} />
            </span>
            {entry.rating && entry.rating.count > 0 && entry.rating.average !== null ? (
              <span className="store-card__rating">
                {t("browse.rating", { average: entry.rating.average.toFixed(1), count: entry.rating.count })}
              </span>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * The catalogue. Shown at once, with no store account: the API reads it from
 * the store anonymously, and nothing here waits for a sign-in.
 */
export function BrowsePage() {
  const { t } = useTranslation();
  const [category, setCategory] = useState("");
  const [edition, setEdition] = useState("");
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");

  const categoriesQuery = useQuery({ queryKey: ["store", "categories"], queryFn: fetchCategories, retry: false });
  const filters = { category, edition, q };
  const appsQuery = useInfiniteQuery({
    queryKey: ["store", "apps", filters],
    queryFn: ({ pageParam }) => fetchApps(filters, pageParam || undefined),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const entries = appsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const omitted = appsQuery.data?.pages.reduce((sum, page) => sum + page.omitted, 0) ?? 0;

  return (
    <section>
      <form
        className="store-filters"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setQ(typed.trim());
        }}
      >
        <label className="admin-console__label">
          <span className="admin-console__label-text">{t("browse.search")}</span>
          <input
            type="search"
            className="store-input"
            value={typed}
            maxLength={200}
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        <label className="admin-console__label">
          <span className="admin-console__label-text">{t("browse.category")}</span>
          <select className="store-input" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">{t("browse.allCategories")}</option>
            {(categoriesQuery.data?.items ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-console__label">
          <span className="admin-console__label-text">{t("browse.edition")}</span>
          <select className="store-input" value={edition} onChange={(event) => setEdition(event.target.value)}>
            <option value="">{t("browse.allEditions")}</option>
            {EDITIONS.map((value) => (
              <option key={value} value={value}>
                {t(`edition.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="admin-console__btn">
          {t("browse.searchAction")}
        </button>
      </form>

      {appsQuery.isLoading ? <p className="admin-console__loading">{t("browse.loading")}</p> : null}
      {appsQuery.isError ? <ProblemNote error={appsQuery.error} /> : null}
      {appsQuery.isSuccess && entries.length === 0 ? <p className="admin-console__empty">{t("browse.nothing")}</p> : null}

      <ul className="store-cards">
        {entries.map((entry) => (
          <AppCard key={entry.coordinate} entry={entry} />
        ))}
      </ul>

      {omitted > 0 ? <p className="admin-console__meta">{t("browse.omitted", { count: omitted })}</p> : null}
      {appsQuery.hasNextPage ? (
        <div className="admin-console__actions">
          <button
            type="button"
            className="admin-console__btn"
            disabled={appsQuery.isFetchingNextPage}
            onClick={() => void appsQuery.fetchNextPage()}
          >
            {t("browse.more")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

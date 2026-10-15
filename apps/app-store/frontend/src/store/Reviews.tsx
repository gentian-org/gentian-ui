import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { problemOf } from "@/api/client";
import {
  deleteMyReview,
  fetchMyReview,
  fetchReviews,
  putMyReview,
  type AppDetail,
  type Review,
  type ReviewFilters,
  type ReviewRequest,
  type ReviewScores,
  type ReviewSummary,
  type ScoreName,
  type StoreMeta,
} from "@/api/store";
import i18n from "@/lib/i18n";
import { CompanyForm, useCompany } from "@/store/Company";
import { DateText, ProblemNote, StoreSignIn } from "@/store/parts";
import { useStoreSession } from "@/store/session";

/**
 * An app's reviews: what reviewers make of it, narrowed by the size and
 * industry of their company, and the person's own review.
 *
 * Reading them is an open read, like the rest of the catalogue. Writing one
 * is the person's own act at the store, in their own name, and needs their
 * sign-in there; it is offered only by a store that has it (`review-writing`
 * in its features). Everything a reviewer wrote is text, shown as text.
 */

const SCORES: ScoreName[] = ["features", "easeOfUse", "easeOfSetup", "support", "value"];

/** What a review of this edition rates: support and value for money only where they are sold. */
const scoresOf = (detail: AppDetail): ScoreName[] => (detail.edition === "ee" ? SCORES : SCORES.slice(0, 3));

const STARS = [1, 2, 3, 4, 5];

/** Stars for a value from 1 to 5, partly filled for a fraction; its words for a screen reader. */
function Stars({ value }: { value: number }) {
  const { t } = useTranslation();
  const shown = Math.max(0, Math.min(5, value));
  return (
    <span className="store-stars" role="img" aria-label={t("reviews.starsLabel", { value: shown.toFixed(1) })}>
      <span className="store-stars__off" aria-hidden="true">
        ★★★★★
      </span>
      <span className="store-stars__on" aria-hidden="true" style={{ width: `${(shown / 5) * 100}%` }}>
        ★★★★★
      </span>
    </span>
  );
}

function percent(part: number, whole: number): string {
  return new Intl.NumberFormat(i18n.resolvedLanguage, { style: "percent", maximumFractionDigits: 0 }).format(part / whole);
}

function Summary({ summary, scores }: { summary: ReviewSummary; scores: ScoreName[] }) {
  const { t } = useTranslation();
  const said = summary.recommend ? summary.recommend.yes + summary.recommend.no : 0;
  return (
    <div className="store-reviews__summary">
      <div className="store-reviews__overall">
        {summary.average !== null ? (
          <>
            <p className="store-reviews__average">{summary.average.toFixed(1)}</p>
            <Stars value={summary.average} />
          </>
        ) : null}
        <p className="admin-console__meta">{t("app.reviewCount", { count: summary.count })}</p>
        {summary.recommend && said > 0 ? (
          <p className="store-reviews__recommend">
            {t("reviews.recommendShare", { percent: percent(summary.recommend.yes, said), count: said })}
          </p>
        ) : null}
      </div>

      {summary.scores ? (
        <dl className="store-scores">
          {scores.map((name) => {
            const score = summary.scores?.[name];
            return (
              <div key={name} className="store-scores__row">
                <dt>{t(`score.${name}`)}</dt>
                <dd>
                  {score && score.average !== null ? (
                    <>
                      <Stars value={score.average} />
                      <span className="store-scores__value">{score.average.toFixed(1)}</span>
                    </>
                  ) : (
                    <span className="admin-console__meta">{t("reviews.noScore")}</span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}

      {summary.count > 0 ? (
        <ul className="store-distribution" aria-label={t("reviews.distribution")}>
          {[5, 4, 3, 2, 1].map((stars) => {
            const count = summary.distribution[String(stars) as "1"];
            return (
              <li key={stars} className="store-distribution__row">
                <span className="store-distribution__label">{t("reviews.distributionStars", { count: stars })}</span>
                <span className="store-distribution__bar" aria-hidden="true">
                  <span style={{ width: `${(count / summary.count) * 100}%` }} />
                </span>
                <span className="store-distribution__count">{count}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** A reviewer's company size and industry, by the store's own names for them. */
function reviewerWords(review: Review, meta: StoreMeta | undefined): string | null {
  if (!review.reviewer) return null;
  const size = meta?.companySizes.find((item) => item.id === review.reviewer?.size)?.name ?? review.reviewer.size;
  const industry = meta?.industries.find((item) => item.id === review.reviewer?.industry)?.name ?? review.reviewer.industry;
  return `${size} · ${industry}`;
}

function ReviewCard({
  review,
  meta,
  mine,
  children,
}: {
  review: Review;
  meta: StoreMeta | undefined;
  mine: boolean;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const reviewer = reviewerWords(review, meta);
  const given = review.scores
    ? SCORES.filter((name) => review.scores?.[name] !== null && review.scores?.[name] !== undefined)
    : [];
  return (
    <li className={`admin-console__card store-review${mine ? " store-review--mine" : ""}`}>
      <div className="admin-console__card-main">
        <p className="admin-console__card-title">
          <Stars value={review.rating} />
          {review.title ? <span>{review.title}</span> : null}
          {mine ? <span className="admin-console__badge admin-console__badge--info">{t("reviews.yours")}</span> : null}
        </p>
        {review.recommend !== null && review.recommend !== undefined ? (
          <p className={`store-review__recommend store-review__recommend--${review.recommend ? "yes" : "no"}`}>
            {review.recommend ? t("reviews.recommends") : t("reviews.doesNotRecommend")}
          </p>
        ) : null}
        {given.length > 0 ? (
          <ul className="store-review__scores">
            {given.map((name) => (
              <li key={name}>{t("reviews.scoreGiven", { score: t(`score.${name}`), stars: review.scores?.[name] })}</li>
            ))}
          </ul>
        ) : null}
        {review.text ? <p className="admin-console__card-desc store-review__text">{review.text}</p> : null}
        <p className="admin-console__card-meta">
          {review.author} · <DateText value={review.date} />
          {review.version ? ` · ${review.version}` : ""}
          {reviewer ? ` · ${reviewer}` : ""}
        </p>
        {children}
      </div>
    </li>
  );
}

/** Stars from 1 to 5 for one thing a review rates: a group of five radio buttons. */
function StarInput({ name, label, value, onChange }: { name: string; label: string; value: number; onChange: (n: number) => void }) {
  const { t } = useTranslation();
  return (
    <fieldset className="store-star-input">
      <legend className="admin-console__label-text">{label}</legend>
      <span className="store-star-input__stars">
        {STARS.map((n) => (
          <label key={n} className={`store-star-input__star${value >= n ? " store-star-input__star--on" : ""}`}>
            <input type="radio" name={name} value={n} checked={value === n} onChange={() => onChange(n)} />
            <span aria-hidden="true">★</span>
            <span className="store-hidden">{t("reviews.starsOption", { count: n })}</span>
          </label>
        ))}
      </span>
    </fieldset>
  );
}

function ReviewForm({
  detail,
  initial,
  busy,
  onSubmit,
  onCancel,
}: {
  detail: AppDetail;
  initial: Review | null;
  busy: boolean;
  onSubmit: (body: ReviewRequest) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const rated = scoresOf(detail);
  const [recommend, setRecommend] = useState<boolean | null>(initial?.recommend ?? null);
  const [scores, setScores] = useState<Record<ScoreName, number>>(() => {
    const out = { features: 0, easeOfUse: 0, easeOfSetup: 0, support: 0, value: 0 };
    for (const name of SCORES) out[name] = initial?.scores?.[name] ?? 0;
    return out;
  });
  const [title, setTitle] = useState(initial?.title ?? "");
  const [text, setText] = useState(initial?.text ?? "");
  const complete = recommend !== null && rated.every((name) => scores[name] >= 1);
  const sold = detail.edition === "ee";

  return (
    <form
      className="store-form store-review-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!complete || recommend === null) return;
        const given: ReviewScores = {
          features: scores.features,
          easeOfUse: scores.easeOfUse,
          easeOfSetup: scores.easeOfSetup,
          support: sold ? scores.support : null,
          value: sold ? scores.value : null,
        };
        onSubmit({ recommend, scores: given, title: title.trim() || null, text: text.trim(), version: initial?.version ?? null });
      }}
    >
      <fieldset className="store-star-input">
        <legend className="admin-console__label-text">{t("reviews.recommendQuestion")}</legend>
        <span className="store-yesno">
          <label className={`admin-console__choice${recommend === true ? " admin-console__choice--selected" : ""}`}>
            <input type="radio" name="recommend" checked={recommend === true} onChange={() => setRecommend(true)} />
            <span className="admin-console__choice-title">{t("reviews.yes")}</span>
          </label>
          <label className={`admin-console__choice${recommend === false ? " admin-console__choice--selected" : ""}`}>
            <input type="radio" name="recommend" checked={recommend === false} onChange={() => setRecommend(false)} />
            <span className="admin-console__choice-title">{t("reviews.no")}</span>
          </label>
        </span>
      </fieldset>
      {rated.map((name) => (
        <StarInput
          key={name}
          name={`score-${name}`}
          label={t(`score.${name}`)}
          value={scores[name]}
          onChange={(n) => setScores((current) => ({ ...current, [name]: n }))}
        />
      ))}
      <label className="admin-console__label">
        <span className="admin-console__label-text">{t("reviews.titleField")}</span>
        <input type="text" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="admin-console__label">
        <span className="admin-console__label-text">{t("reviews.textField")}</span>
        <textarea className="store-input store-textarea" value={text} maxLength={5000} rows={5} onChange={(event) => setText(event.target.value)} />
      </label>
      <p className="admin-console__hint">{t("reviews.shownWith")}</p>
      {!complete ? <p className="admin-console__hint">{t("reviews.incomplete")}</p> : null}
      <div className="admin-console__actions">
        <button type="submit" className="admin-console__btn admin-console__btn--primary" disabled={!complete || busy}>
          {initial ? t("reviews.saveChanges") : t("reviews.publish")}
        </button>
        <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={onCancel}>
          {t("reviews.cancel")}
        </button>
      </div>
    </form>
  );
}

/** The person's own review: write it, change it, withdraw it. */
function MyReview({ detail, meta, storeName }: { detail: AppDetail; meta: StoreMeta; storeName: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { session } = useStoreSession();
  const signedIn = session?.signedIn === true;
  const coordinate = detail.coordinate;
  const company = useCompany(meta);
  const [editing, setEditing] = useState(false);
  const [wantsSignIn, setWantsSignIn] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [pending, setPending] = useState<ReviewRequest | null>(null);

  const mineQuery = useQuery({
    queryKey: ["store", "myReview", coordinate, signedIn],
    queryFn: () => fetchMyReview(coordinate),
    enabled: signedIn,
    retry: false,
  });
  const mine = mineQuery.data?.review ?? null;

  const settled = (review: Review | null) => {
    queryClient.setQueryData(["store", "myReview", coordinate, signedIn], { review });
    void queryClient.invalidateQueries({ queryKey: ["store", "reviews", coordinate] });
  };
  const write = useMutation({
    mutationFn: (body: ReviewRequest) => putMyReview(coordinate, body),
    onSuccess: (answer) => {
      setPending(null);
      setEditing(false);
      settled(answer.review);
    },
    onError: (error) => {
      if (problemOf(error).code === "store-sign-in-required") {
        void queryClient.invalidateQueries({ queryKey: ["store", "session"] });
      }
    },
  });
  const withdraw = useMutation({
    mutationFn: () => deleteMyReview(coordinate),
    onSuccess: () => {
      setConfirmWithdraw(false);
      settled(null);
    },
  });

  const problem = write.error ? problemOf(write.error) : null;
  const companyMissing = problem?.code === "company-missing" && meta.companySizes.length > 0 && meta.industries.length > 0;

  if (!signedIn) {
    return (
      <div className="store-my-review">
        {wantsSignIn ? (
          <StoreSignIn reason={t("reviews.signInToWrite", { store: storeName })} storeName={storeName} />
        ) : (
          <div className="admin-console__actions">
            <button type="button" className="admin-console__btn" onClick={() => setWantsSignIn(true)}>
              {t("reviews.write")}
            </button>
          </div>
        )}
      </div>
    );
  }
  if (mineQuery.isLoading) return <p className="admin-console__loading">{t("reviews.loadingYours")}</p>;

  return (
    <div className="store-my-review">
      {mineQuery.isError ? <ProblemNote error={mineQuery.error} /> : null}
      {editing ? (
        <ReviewForm
          detail={detail}
          initial={mine}
          busy={write.isPending}
          onSubmit={(body) => {
            setPending(body);
            write.mutate(body);
          }}
          onCancel={() => {
            setEditing(false);
            write.reset();
          }}
        />
      ) : mine ? (
        <ul className="admin-console__cards">
          <ReviewCard review={mine} meta={meta} mine>
            {confirmWithdraw ? (
              <div className="admin-console__actions">
                <span className="admin-console__hint">{t("reviews.withdrawQuestion")}</span>
                <button type="button" className="admin-console__btn admin-console__btn--danger" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>
                  {t("reviews.withdraw")}
                </button>
                <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={() => setConfirmWithdraw(false)}>
                  {t("reviews.cancel")}
                </button>
              </div>
            ) : (
              <div className="admin-console__actions">
                <button type="button" className="admin-console__btn" onClick={() => setEditing(true)}>
                  {t("reviews.edit")}
                </button>
                <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={() => setConfirmWithdraw(true)}>
                  {t("reviews.withdraw")}
                </button>
              </div>
            )}
          </ReviewCard>
        </ul>
      ) : (
        <>
          <div className="admin-console__actions">
            <button type="button" className="admin-console__btn" onClick={() => setEditing(true)}>
              {t("reviews.write")}
            </button>
          </div>
          {meta.reviewing?.requireAcquisition ? <p className="admin-console__hint">{t("reviews.acquiredOnly")}</p> : null}
        </>
      )}
      {withdraw.error ? <ProblemNote error={withdraw.error} /> : null}
      {write.error ? <ProblemNote error={write.error} /> : null}
      {companyMissing ? (
        <div className="store-signin">
          <p className="admin-console__lead">{t("company.neededForReview")}</p>
          <CompanyForm
            meta={meta}
            initial={company.query.data?.company ?? null}
            onSaved={() => {
              // The review is sent again as it was written.
              if (pending) write.mutate(pending);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function Reviews({ detail, meta, storeName }: { detail: AppDetail; meta: StoreMeta | undefined; storeName: string }) {
  const { t } = useTranslation();
  const { session } = useStoreSession();
  const coordinate = detail.coordinate;
  const [filters, setFilters] = useState<ReviewFilters>({});
  const filtered = Boolean(filters.companySize || filters.industry);
  const query = useInfiniteQuery({
    queryKey: ["store", "reviews", coordinate, filters],
    queryFn: ({ pageParam }) => fetchReviews(coordinate, filters, pageParam || undefined),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  // The person's own review, as MyReview asked for it: the open list never
  // says whose a review is, so it is found by its id.
  const signedIn = session?.signedIn === true;
  const mineQuery = useQuery({
    queryKey: ["store", "myReview", coordinate, signedIn],
    queryFn: () => fetchMyReview(coordinate),
    enabled: false,
  });
  const myId = mineQuery.data?.review?.id ?? null;
  // Shown once: above, with what can be done with it, where the store lets
  // the person write.
  const summary = query.data?.pages[0]?.summary;
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const writes = meta?.features.includes("review-writing") === true;
  const listed = writes && myId ? items.filter((review) => review.id !== myId) : items;
  const filterable = (meta?.companySizes.length ?? 0) > 0 || (meta?.industries.length ?? 0) > 0;

  if (!summary && !writes) return null;
  if (summary && summary.count === 0 && !filtered && !writes) return null;

  return (
    <section className="admin-console__subsection store-reviews">
      <h2 className="admin-console__subsection-title">{t("app.reviews")}</h2>

      {filterable && meta ? (
        <div className="store-filters store-filters--reviews">
          {meta.companySizes.length > 0 ? (
            <label className="admin-console__label">
              <span className="admin-console__label-text">{t("reviews.companySize")}</span>
              <select
                className="store-input"
                value={filters.companySize ?? ""}
                onChange={(event) => setFilters((current) => ({ ...current, companySize: event.target.value || undefined }))}
              >
                <option value="">{t("reviews.allSizes")}</option>
                {meta.companySizes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {meta.industries.length > 0 ? (
            <label className="admin-console__label">
              <span className="admin-console__label-text">{t("reviews.industry")}</span>
              <select
                className="store-input"
                value={filters.industry ?? ""}
                onChange={(event) => setFilters((current) => ({ ...current, industry: event.target.value || undefined }))}
              >
                <option value="">{t("reviews.allIndustries")}</option>
                {meta.industries.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      {query.isError ? <ProblemNote error={query.error} /> : null}
      {summary && summary.count > 0 ? <Summary summary={summary} scores={scoresOf(detail)} /> : null}
      {summary && summary.count === 0 ? (
        <p className="admin-console__empty">{filtered ? t("reviews.noneForFilter") : t("reviews.none")}</p>
      ) : null}

      {writes && meta ? <MyReview detail={detail} meta={meta} storeName={storeName} /> : null}

      {listed.length > 0 ? (
        <ul className="admin-console__cards store-reviews__list">
          {listed.map((review) => (
            <ReviewCard key={review.id} review={review} meta={meta} mine={review.mine === true} />
          ))}
        </ul>
      ) : null}
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

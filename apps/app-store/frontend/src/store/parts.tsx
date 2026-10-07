import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type Problem, problemOf } from "@/api/client";
import type { Link as StoreLink, Price } from "@/api/store";
import i18n from "@/lib/i18n";
import { useStoreSession } from "@/store/session";

/**
 * A link to somewhere outside this app: a store's page, a publisher's, a
 * document. Always in a separate window, with no opener and no referrer, and
 * only ever to an https address -- anything else is shown as text.
 */
export function ExternalLink({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  if (!href || !href.startsWith("https://")) return <>{children}</>;
  return (
    <a className="admin-console__btn-link" href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** A store's link, called what the store calls it, or by its address. */
export function StoreLinkItem({ link }: { link: StoreLink }) {
  const { t } = useTranslation();
  const key = `links.${link.rel ?? ""}`;
  const label = link.label || (link.rel && i18n.exists(key) ? t(key) : link.url);
  return <ExternalLink href={link.url}>{label}</ExternalLink>;
}

/**
 * A store's picture, from this app's own origin.
 *
 * `src` is the API's address for it, or null when the store named none this
 * app will show: not on an origin the store's meta lists, or no picture at
 * all. Then, and when the API refuses the bytes -- not PNG, JPEG or WebP, or
 * too large -- a placeholder is shown instead. No referrer is sent with the
 * request.
 */
export function Picture({ src, alt, className }: { src: string | null; alt: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || !src.startsWith("/api/v1/media?") || failed) {
    return <span className={`${className} store-picture--none`} role="img" aria-label={alt} />;
  }
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

const PRICE_KEYS: Record<string, string> = {
  "one-time::": "price.oneTime",
  "one-time:user:": "price.oneTimePerUser",
  "one-time:tenant:": "price.oneTimePerTenant",
  "subscription::month": "price.perMonth",
  "subscription:user:month": "price.perUserMonth",
  "subscription:tenant:month": "price.perTenantMonth",
  "subscription::year": "price.perYear",
  "subscription:user:year": "price.perUserYear",
  "subscription:tenant:year": "price.perTenantYear",
};

/** The list price, in words. Shown, never computed with. */
export function PriceText({ price }: { price: Price }) {
  const { t } = useTranslation();
  if (price.model === "free") return <>{t("price.free")}</>;
  if (price.model === "quote" || !price.amount || !price.currency) return <>{t("price.quote")}</>;
  const key = PRICE_KEYS[`${price.model}:${price.per ?? ""}:${price.model === "subscription" ? (price.period ?? "") : ""}`];
  const amount = `${price.amount} ${price.currency}`;
  return <>{key ? t(key, { amount }) : amount}</>;
}

/** A date a store wrote, in the reader's own form; as written when it is not one. */
export function DateText({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <>{value}</>;
  return <time dateTime={value}>{date.toLocaleDateString(i18n.resolvedLanguage)}</time>;
}

/** The first characters of a digest, for a line; the whole of it on hover and in the dialog. */
export function shortDigest(digest: string | null | undefined): string {
  if (!digest) return "";
  return digest.length > 19 ? `${digest.slice(0, 19)}…` : digest;
}

/**
 * A refusal, shown as it was said.
 *
 * One line in this app's words for what kind of thing happened, then the
 * refusing party's own title and detail, untouched: the store's, the
 * director's, the custodian's or the usher's. They are text and are shown as
 * text.
 */
export function ProblemNote({ problem, error }: { problem?: Problem | null; error?: unknown }) {
  const { t } = useTranslation();
  const shown = problem ?? (error ? problemOf(error) : null);
  if (!shown) return null;
  const byCode = `problem.${shown.code}`;
  const bySource = `problemSource.${shown.source}`;
  const lead = i18n.exists(byCode) ? t(byCode) : i18n.exists(bySource) ? t(bySource, { status: shown.status ?? "" }) : t("problem.failed");
  return (
    <div className="admin-console__error store-problem" role="alert">
      <p className="store-problem__lead">{lead}</p>
      {shown.title ? <p className="store-problem__said">{shown.title}</p> : null}
      {shown.detail ? <p className="store-problem__said">{shown.detail}</p> : null}
      {shown.retryAfter ? <p className="admin-console__meta">{t("problem.retryAfter", { count: shown.retryAfter })}</p> : null}
    </div>
  );
}

/**
 * Asks for the sign-in to the store, when something needs it.
 *
 * Two steps on purpose. The first asks the API to prepare the sign-in; the
 * second is a plain link the person follows, which a browser opens in a new
 * window without asking -- a window opened by script after a request has
 * come back is what pop-up blockers stop.
 */
export function StoreSignIn({ reason, storeName }: { reason: string; storeName: string }) {
  const { t } = useTranslation();
  const { session, signInUrl, starting, startError, begin } = useStoreSession();
  if (session?.signedIn) return null;
  let host = "";
  if (signInUrl) {
    try {
      host = new URL(signInUrl).host;
    } catch {
      host = "";
    }
  }
  return (
    <div className="store-signin">
      <p className="admin-console__lead">{reason}</p>
      {signInUrl ? (
        <>
          <p className="admin-console__hint">
            {t("session.opensAt")} <span className="admin-console__mono">{host}</span>
          </p>
          <div className="admin-console__actions">
            <a className="admin-console__btn admin-console__btn--primary" href={signInUrl} target="_blank" rel="noopener noreferrer">
              {t("session.openSignIn", { store: storeName })}
            </a>
          </div>
          <p className="admin-console__meta">{t("session.waitingForSignIn")}</p>
        </>
      ) : (
        <div className="admin-console__actions">
          <button type="button" className="admin-console__btn admin-console__btn--primary" disabled={starting} onClick={begin}>
            {t("session.signIn", { store: storeName })}
          </button>
        </div>
      )}
      {startError ? <ProblemNote error={startError} /> : null}
    </div>
  );
}

/** The name the app shows for a store before, or without, its own. */
export function useStoreName(name: string | undefined): string {
  const { t } = useTranslation();
  return name || t("shell.theStore");
}

/* SPDX-License-Identifier: Apache-2.0 */
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { fetchContext, fetchMeta, type Notice } from "@/api/store";
import { ExternalLink, ProblemNote, StoreLinkItem, useStoreName } from "@/store/parts";
import { StoreSessionProvider, useStoreSession } from "@/store/session";
import "./console.css";
import "./store.css";

/**
 * The App Store app: the store's interface, on the cluster.
 *
 * It is for people who may install apps in this tenant. Whether this person
 * may is the director's answer, asked on load, and the page is built from
 * it; a person who may not is told so and shown nothing else. That is not
 * what stops anybody -- every step of an install is asked of the cluster's
 * services again -- it is only what this page is for.
 */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-console admin-console--embedded">
      <div className="admin-console__frame">{children}</div>
    </div>
  );
}

/** A page that says one thing and offers nothing. */
function Plain({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <Frame>
      <div className="admin-console__body store-plain">
        <h1 className="admin-console__section-title">{title}</h1>
        {children}
      </div>
    </Frame>
  );
}

export function AppStore() {
  const { t } = useTranslation();
  const contextQuery = useQuery({ queryKey: ["context"], queryFn: fetchContext, retry: false });

  if (contextQuery.isLoading) {
    return (
      <Frame>
        <div className="admin-console__body">
          <p className="admin-console__loading">{t("shell.loading")}</p>
        </div>
      </Frame>
    );
  }
  if (contextQuery.isError || !contextQuery.data) {
    return (
      <Plain title={t("gate.unavailableTitle")}>
        <p className="admin-console__lead">{t("gate.unavailableBody")}</p>
        <ProblemNote error={contextQuery.error} />
      </Plain>
    );
  }
  const context = contextQuery.data;
  if (!context.mayInstall) {
    return (
      <Plain title={t("gate.mayNotInstallTitle")}>
        <p className="admin-console__lead">{t("gate.mayNotInstallBody", { tenant: context.tenant })}</p>
      </Plain>
    );
  }
  if (context.appStore && !context.appStore.available) {
    return (
      <Plain title={t("gate.notOfferedTitle")}>
        <p className="admin-console__lead">
          {context.appStore.reason === "licence-report-disabled" ? t("gate.notOfferedNoReport") : t("gate.notOfferedBody")}
        </p>
        <p className="admin-console__lead">
          {t("gate.installByCommand")} <code>kubectl gentian apps install</code>
        </p>
      </Plain>
    );
  }
  if (!context.storeConfigured) {
    return (
      <Plain title={t("gate.noStoreTitle")}>
        <p className="admin-console__lead">
          {t("gate.noStoreBody")} <code>kubectl gentian apps install</code>
        </p>
      </Plain>
    );
  }
  return (
    <StoreSessionProvider>
      <Shell tenant={context.tenant} />
    </StoreSessionProvider>
  );
}

function NoticeCard({ notice }: { notice: Notice }) {
  // An unknown type is shown like a plain message: the text is what counts.
  return (
    <div className={notice.severity === "warning" ? "admin-console__warning" : "store-notice"} role="note">
      {notice.title ? <p className="store-notice__title">{notice.title}</p> : null}
      <p className="store-notice__text">{notice.text}</p>
      {notice.link ? (
        <p className="store-notice__text">
          <StoreLinkItem link={notice.link} />
        </p>
      ) : null}
    </div>
  );
}

/** How the store regards this tenant: learned at sign-in, shown from then on. */
function Standing() {
  const { t } = useTranslation();
  const { session } = useStoreSession();
  const standing = session?.signedIn ? session.standing : null;
  if (!standing) return null;
  const refusalKey = standing.refusal ? `standing.${standing.refusal.reason}` : "";
  return (
    <div className="store-standing">
      {!standing.served ? (
        <div className="admin-console__warning" role="note">
          <p className="store-notice__title">{t("standing.notServed")}</p>
          {/* The reason in this app's words where it is one the definition
              names, and always the store's own beside it. */}
          {standing.refusal && t(refusalKey, { defaultValue: "" }) ? (
            <p className="store-notice__text">{t(refusalKey, { tenantUrl: standing.tenantUrl })}</p>
          ) : null}
          {standing.refusal ? <p className="store-notice__text">{standing.refusal.detail}</p> : null}
          {standing.refusal?.link ? (
            <p className="store-notice__text">
              <StoreLinkItem link={standing.refusal.link} />
            </p>
          ) : null}
          <p className="store-notice__text">{t("standing.browsingStays")}</p>
        </div>
      ) : null}
      {standing.notices.map((notice, index) => (
        <NoticeCard key={index} notice={notice} />
      ))}
    </div>
  );
}

function Shell({ tenant }: { tenant: string }) {
  const { t } = useTranslation();
  const metaQuery = useQuery({ queryKey: ["store", "meta"], queryFn: fetchMeta, retry: false });
  const { session, signOut } = useStoreSession();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const storeName = useStoreName(metaQuery.data?.name);
  const onInstalled = path.startsWith("/installed");
  const links = metaQuery.data?.links;

  return (
    <Frame>
      <header className="admin-console__header">
        <div className="admin-console__identity">
          {t("shell.title")}
          {metaQuery.data ? ` · ${metaQuery.data.name}` : ""}
        </div>
        <div className="store-header__session">
          <span className="admin-console__identity admin-console__identity--muted">
            {t("shell.tenant", { tenant })}
          </span>
          {session?.signedIn ? (
            <>
              <span className="admin-console__badge admin-console__badge--ok">{t("session.signedIn", { store: storeName })}</span>
              <button type="button" className="admin-console__btn admin-console__btn--quiet" onClick={signOut}>
                {t("session.signOut")}
              </button>
            </>
          ) : null}
        </div>
      </header>

      <nav className="admin-console__tabs" aria-label={t("shell.sections")}>
        <Link to="/" className={`admin-console__tab${onInstalled ? "" : " admin-console__tab--active"}`}>
          {t("shell.tabBrowse")}
        </Link>
        <Link to="/installed" className={`admin-console__tab${onInstalled ? " admin-console__tab--active" : ""}`}>
          {t("shell.tabInstalled")}
        </Link>
      </nav>

      <div className="admin-console__body">
        {metaQuery.isError ? (
          <div className="store-standing">
            <ProblemNote error={metaQuery.error} />
            <p className="admin-console__meta">{t("shell.storeAwayClusterStays")}</p>
          </div>
        ) : null}
        <Standing />
        <Outlet />
        {links && (links.terms || links.privacy || links.support || links.account) ? (
          <footer className="store-footer">
            <span>{storeName}</span>
            {links.terms ? <ExternalLink href={links.terms}>{t("links.terms")}</ExternalLink> : null}
            {links.privacy ? <ExternalLink href={links.privacy}>{t("links.privacy")}</ExternalLink> : null}
            {links.support ? <ExternalLink href={links.support}>{t("links.support")}</ExternalLink> : null}
            {links.account ? <ExternalLink href={links.account}>{t("links.account")}</ExternalLink> : null}
          </footer>
        ) : null}
      </div>
    </Frame>
  );
}

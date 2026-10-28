export type AppLaunchUrlOptions = {
  username?: string;
  linkTarget?: string | null;
  authMode?: string | null;
  /**
   * Force the IdP to re-authenticate instead of reusing its SSO session.
   *
   * Only for the deliberate gesture (Ctrl/Cmd+click, "open as another user"). This
   * used to be inferred from linkTarget === "newwindow", but the backend defaults
   * linkTarget to "newwindow" for every tile that does not say otherwise, so the
   * inference turned an ordinary click on most tiles into a forced login prompt.
   */
  forceLogin?: boolean;
  /**
   * The desktop's language, handed to the app as `lang`.
   *
   * An app on another host cannot read the desktop's settings, and taking
   * its language from the browser shows it in a language other than the one
   * chosen here. The platform's own apps read `lang` first; an app that does
   * not know the parameter ignores it.
   */
  language?: string;
};

/**
 * Decorate an app tile URL so OIDC apps authenticate as the current portal user.
 *
 * Portal login uses the kernel or tenant Keycloak realm; apps like Element use the
 * tenant realm. Without hints, a stale tenant-realm SSO cookie or cached Matrix
 * session can show the wrong user after switching accounts in the portal.
 */
export function buildAppLaunchUrl(
  rawLink: string,
  options: AppLaunchUrlOptions = {},
): string {
  if (!rawLink) {
    return rawLink;
  }

  const { username, linkTarget, authMode, forceLogin, language } = options;
  const hinted = Boolean(username) && authMode === "oidc"
    && (linkTarget === "newwindow" || linkTarget === "embedded");
  if (!hinted && !language) {
    return rawLink;
  }

  try {
    const url = new URL(rawLink);
    if (language) {
      url.searchParams.set("lang", language);
    }
    if (!hinted) {
      return url.toString();
    }
    if (username) {
      url.searchParams.set("login_hint", username);
    }
    // Only the explicit gesture forces re-authentication. Every other launch lets
    // the IdP reuse its SSO session, which is the whole point of having one.
    if (forceLogin) {
      url.searchParams.set("prompt", "login");
    }

    return url.toString();
  } catch {
    return rawLink;
  }
}

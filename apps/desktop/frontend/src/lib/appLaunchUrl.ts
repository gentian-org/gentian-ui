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

  const { username, linkTarget, authMode, forceLogin } = options;
  if (!username || authMode !== "oidc") {
    return rawLink;
  }
  if (linkTarget !== "newwindow" && linkTarget !== "embedded") {
    return rawLink;
  }

  try {
    const url = new URL(rawLink);
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

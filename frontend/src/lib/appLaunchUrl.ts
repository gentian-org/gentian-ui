export type AppLaunchUrlOptions = {
  username?: string;
  linkTarget?: string | null;
  authMode?: string | null;
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

  const { username, linkTarget, authMode } = options;
  if (!username || authMode !== "oidc") {
    return rawLink;
  }
  if (linkTarget !== "newwindow" && linkTarget !== "embedded") {
    return rawLink;
  }

  try {
    const url = new URL(rawLink);
    if (username.includes("@")) {
      url.searchParams.set("login_hint", username);
    }
    // Embedded tiles: allow silent SSO in the iframe (broker / tenant-realm cookie).
    // Ctrl/Cmd+click opens a new tab with linkTarget newwindow and forces re-auth.
    if (linkTarget === "newwindow") {
      url.searchParams.set("prompt", "login");
    }

    return url.toString();
  } catch {
    return rawLink;
  }
}

/**
 * OIDC configuration from Vite env (M1, M3).
 * Public client + PKCE — no client secret in the browser.
 */
import { loginPathWithReturnTo } from "@/lib/returnTo";

export type OidcConfig = {
  issuer: string;
  clientId: string;
  redirectUri: string;
  scopes: string;
  authDisabled: boolean;
};

const TOKEN_STORAGE_KEY = "gentian.access_token";
const ID_TOKEN_STORAGE_KEY = "gentian.id_token";
const PKCE_VERIFIER_KEY = "gentian.pkce_verifier";
// The realm a user authenticates in depends on their email, so the issuer is not
// known until /auth/login-route has answered. The callback must exchange the code
// against that same realm's token endpoint, and by then the redirect has wiped
// everything but storage — so it is recorded here alongside the verifier.
const ISSUER_KEY = "gentian.oidc_issuer";

type JwtClaims = {
  iss?: string;
  azp?: string;
  exp?: number;
};

function decodeJwtPayload(token: string): JwtClaims | null {
  try {
    const part = token.split(".")[1];
    if (!part) {
      return null;
    }
    const padded = part + "=".repeat((4 - (part.length % 4)) % 4);
    const json = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}

function realmFromIssuer(issuer: string): string | null {
  const match = issuer.replace(/\/$/, "").match(/\/realms\/([^/]+)$/);
  return match?.[1] ?? null;
}

/**
 * The kernel domain, derived from the configured issuer.
 *
 * Not a guess: the backend builds the browser-facing issuer as
 * `https://id.<kernel-domain>/auth/realms/<realm>` (Settings.idp_public_base_url),
 * so dropping the leading `id.` label is exact. Deriving it here rather than
 * counting labels avoids assuming how deep the domain is.
 */
function kernelDomainFromIssuer(): string | null {
  const issuer = getOidcConfig().issuer;
  if (!issuer) {
    return null;
  }
  try {
    const host = new URL(issuer).hostname;
    return host.startsWith("id.") ? host.slice(3) : null;
  } catch {
    return null;
  }
}

/**
 * Where sign-out should land, for a session in this realm.
 *
 * A tenant member goes back to their own entry — the absolute
 * `https://<tenant>.<kernel-domain>/`, not a path on whichever host happened to
 * be showing. Returning to the apex asks them for an email again, turning every
 * sign-out into a two-stage sign-in, and the realm is already in the token so
 * there is nothing to ask. Platform operators authenticate in the kernel realm
 * and belong on the plain login page.
 */
function logoutLandingForRealm(realm: string | null): string {
  const kernelRealm = realmFromIssuer(getOidcConfig().issuer);
  if (!realm || realm === kernelRealm) {
    return `${window.location.origin}/login`;
  }
  const kernelDomain = getKernelDomain();
  if (!kernelDomain) {
    // Fall back to this origin's login rather than building a bad hostname; the
    // server resolves the realm from whichever host that turns out to be.
    return `${window.location.origin}/login`;
  }
  return `https://${realm}.${kernelDomain}/`;
}

/**
 * Where an already-authenticated session should actually be, if not here.
 *
 * demo.desk.gentian.org (and every tenant host) is canonical for its members.
 * A session can still exist on the shared portal host from before that was
 * true, or from a bookmark, or from a link someone shares out of habit.
 * Rather than leave it there, an authenticated tenant session found
 * on the wrong host is walked over to the right one, carrying the current path so
 * the visit is not lost — cheap to do, since the SSO cookie makes the resulting
 * re-login on the new origin silent.
 *
 * Returns null when there is nothing to do: no session, a platform operator (no
 * tenant host to prefer), or already on the right host.
 */
export function nonCanonicalRedirectTarget(): string | null {
  const config = getOidcConfig();
  if (config.authDisabled) {
    return null;
  }
  const token = sessionStorage.getItem(ID_TOKEN_STORAGE_KEY) ?? sessionStorage.getItem(TOKEN_STORAGE_KEY);
  if (!token) {
    return null;
  }
  const claims = decodeJwtPayload(token);
  const issuer = typeof claims?.iss === "string" ? claims.iss : null;
  if (!issuer) {
    return null;
  }
  const realm = realmFromIssuer(issuer);
  const kernelRealm = realmFromIssuer(config.issuer);
  if (!realm || realm === kernelRealm) {
    return null;
  }
  const kernelDomain = getKernelDomain();
  if (!kernelDomain) {
    return null;
  }
  const canonicalHost = `${realm}.${kernelDomain}`;
  if (window.location.hostname === canonicalHost) {
    return null;
  }
  return `https://${canonicalHost}${window.location.pathname}${window.location.search}`;
}

/** Map in-cluster Keycloak issuers to the browser-facing id.* URL. */
function externalLogoutIssuer(issuer: string): string {
  const normalized = issuer.replace(/\/$/, "");
  const config = getOidcConfig();
  const kernelIssuer = (config.issuer || "").replace(/\/$/, "");
  if (!kernelIssuer || !normalized.includes("/realms/")) {
    return normalized;
  }
  if (!normalized.includes(".svc.cluster.local") && !normalized.includes("://gentian-idp")) {
    return normalized;
  }
  const realm = realmFromIssuer(normalized);
  const kernelBase = kernelIssuer.replace(/\/realms\/[^/]+$/, "");
  return realm ? `${kernelBase}/realms/${realm}` : normalized;
}

/**
 * Build a Keycloak end-session URL when browser logout is supported.
 * Returns null for BFF password-login sessions (confidential client / tenant realm).
 */
export function resolveLogoutUrl(
  idToken: string | null,
  accessToken: string | null,
): string | null {
  const config = getOidcConfig();
  const token = idToken ?? accessToken;
  if (!token || !config.issuer || !config.clientId) {
    return null;
  }

  const claims = decodeJwtPayload(token);
  if (!claims) {
    return null;
  }

  const issuer = typeof claims.iss === "string" ? claims.iss : config.issuer;
  const clientId = typeof claims.azp === "string" ? claims.azp : config.clientId;

  const params = new URLSearchParams({
    client_id: clientId,
    post_logout_redirect_uri: logoutLandingForRealm(realmFromIssuer(issuer)),
  });
  if (idToken) {
    params.set("id_token_hint", idToken);
  }

  return `${externalLogoutIssuer(issuer)}/protocol/openid-connect/logout?${params.toString()}`;
}

/**
 * Deployment configuration, supplied at RUNTIME.
 *
 * window.__GENTIAN_CONFIG__ is written into /config.js by the container's
 * entrypoint from environment variables, and index.html loads it before this
 * bundle. Nothing cluster-, tenant- or app-specific may be read from
 * import.meta.env in production: Vite freezes those at build time, and one image
 * is deployed to every cluster.
 *
 * That is not hypothetical. VITE_OIDC_ISSUER was baked in as the test cluster's
 * https://id.desk.gentian.org/auth/realms/kernel, so every other cluster ran a
 * portal that derived "desk.gentian.org" as its kernel domain and sent tenant
 * sessions from corp.gtn.host to corp.desk.gentian.org — a different deployment.
 *
 * import.meta.env remains only as a fallback for `vite dev`, where no container
 * entrypoint runs and values come from .env.local.
 */
type RuntimeConfig = {
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcScopes?: string;
  authDisabled?: string;
  kernelDomain?: string;
};

function runtimeConfig(): RuntimeConfig {
  return (window as unknown as { __GENTIAN_CONFIG__?: RuntimeConfig }).__GENTIAN_CONFIG__ ?? {};
}

/**
 * The cluster's kernel domain, e.g. "gtn.host".
 *
 * Prefers the value the deployment supplies directly. Falls back to deriving it
 * from the issuer host (id.<kernel-domain>) so a deployment that sets only
 * OIDC_ISSUER still behaves correctly.
 */
export function getKernelDomain(): string | null {
  const explicit = runtimeConfig().kernelDomain;
  if (explicit) {
    return explicit;
  }
  return kernelDomainFromIssuer();
}

export function getOidcConfig(): OidcConfig {
  const runtime = runtimeConfig();
  return {
    issuer: runtime.oidcIssuer || import.meta.env.VITE_OIDC_ISSUER || "",
    clientId: runtime.oidcClientId || import.meta.env.VITE_OIDC_CLIENT_ID || "",
    // Always this origin's own /login, never a build-time constant.
    //
    // The portal is served on several hostnames — the shared one and every
    // tenant's own — and a single baked-in value can only ever be correct for
    // one of them. It used to be VITE_OIDC_REDIRECT_URI, fixed at build time to
    // https://portal.<kernel-domain>/login, so a login that started on
    // <tenant>.<kernel-domain> sent that redirect_uri to Keycloak anyway and
    // finished back on the shared host — the tenant host was never actually
    // canonical, it only looked that way until the token exchange landed
    // somewhere else. The Keycloak client is registered with both the shared
    // origin and every tenant origin (keycloak_portal_client.go), so whichever
    // host initiates the flow is a valid place for it to finish.
    redirectUri: `${window.location.origin}/login`,
    scopes: runtime.oidcScopes || import.meta.env.VITE_OIDC_SCOPES || "openid profile email groups",
    authDisabled:
      (runtime.authDisabled ?? import.meta.env.VITE_AUTH_DISABLED) === "true",
  };
}

function randomUrlSafeString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function pkceChallengeFromVerifier(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function isAccessTokenExpired(token: string): boolean {
  const claims = decodeJwtPayload(token);
  const exp = claims?.exp;
  if (typeof exp !== "number") {
    return false;
  }
  return Date.now() >= exp * 1000;
}

export function getAccessTokenExpiryMs(token: string): number | null {
  const claims = decodeJwtPayload(token);
  const exp = claims?.exp;
  if (typeof exp !== "number") {
    return null;
  }
  return exp * 1000;
}

/** Clear portal tokens and send the user back to login (unless already there). */
export function redirectToLoginForExpiredSession(): void {
  clearAccessToken();
  if (window.location.pathname.startsWith("/login")) {
    return;
  }
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.replace(loginPathWithReturnTo(returnTo));
}

/** Return a stored access token, clearing it when missing or expired. */
export function getAccessToken(): string | null {
  const config = getOidcConfig();
  if (config.authDisabled) {
    return null;
  }
  const token = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  if (!token) {
    return null;
  }
  if (isAccessTokenExpired(token)) {
    clearAccessToken();
    return null;
  }
  return token;
}

export function setAccessToken(token: string): void {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function setIdToken(token: string): void {
  sessionStorage.setItem(ID_TOKEN_STORAGE_KEY, token);
}

export function clearAccessToken(): void {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(ID_TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(ISSUER_KEY);
}

export type LoginRedirectOptions = {
  returnTo?: string;
  loginHint?: string;
  idpHint?: string;
  /**
   * Realm issuer to authenticate against, overriding the build-time default.
   *
   * The portal resolves this from the email via /auth/login-route: a tenant
   * member signs in to their own realm, which is where their account and every
   * per-app OIDC client live, and therefore where the SSO session must exist for
   * app launches to reuse it.
   */
  issuer?: string;
};

/**
 * Browser OIDC authorization redirect — how every portal sign-in happens.
 *
 * This is what gives the browser a real Keycloak session cookie. The portal used
 * to post credentials to its own backend and exchange them server-side, which
 * left no session for any other application to reuse, so every OIDC app had to
 * authenticate from scratch.
 */
export async function loginRedirect(options: LoginRedirectOptions | string = "/desktop"): Promise<void> {
  const normalized =
    typeof options === "string" ? { returnTo: options } : options;
  const returnTo = normalized.returnTo ?? "/desktop";
  const config = getOidcConfig();
  if (config.authDisabled || !config.issuer || !config.clientId) {
    return;
  }

  const issuer = (normalized.issuer || config.issuer).replace(/\/$/, "");
  const verifier = randomUrlSafeString(32);
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(ISSUER_KEY, issuer);
  const challenge = await pkceChallengeFromVerifier(verifier);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: config.scopes,
    state: returnTo,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (normalized.loginHint) {
    params.set("login_hint", normalized.loginHint);
  }
  if (normalized.idpHint) {
    params.set("kc_idp_hint", normalized.idpHint);
  }

  window.location.href = `${issuer}/protocol/openid-connect/auth?${params}`;
}

export async function logoutRedirect(): Promise<void> {
  const accessToken = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  const idToken = sessionStorage.getItem(ID_TOKEN_STORAGE_KEY);
  if (accessToken) {
    try {
      await fetch("/api/v1/auth/logout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
    } catch (e) {
      console.error("Backchannel logout failed", e);
    }
  }
  // Read the realm before clearing, or the token that names it is already gone.
  // Either token carries iss; the id token is not always present.
  const claims = decodeJwtPayload(idToken ?? accessToken ?? "");
  const realm = typeof claims?.iss === "string" ? realmFromIssuer(claims.iss) : null;
  clearAccessToken();
  window.location.replace(logoutLandingForRealm(realm));
}


export function isAuthenticated(): boolean {
  const config = getOidcConfig();
  if (config.authDisabled) {
    return true;
  }
  return getAccessToken() !== null;
}

export async function handleOAuthCallback(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) {
    return false;
  }

  const config = getOidcConfig();
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (!config.issuer || !config.clientId || !verifier) {
    return false;
  }

  // The realm that issued the code is the one that must redeem it; falling back
  // to the build-time issuer would send a tenant user's code to the kernel realm.
  const issuer = (sessionStorage.getItem(ISSUER_KEY) || config.issuer).replace(/\/$/, "");
  const tokenUrl = `${issuer}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    sessionStorage.removeItem(ISSUER_KEY);
    return false;
  }

  const payload = (await response.json()) as { access_token?: string; id_token?: string };
  if (!payload.access_token) {
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    sessionStorage.removeItem(ISSUER_KEY);
    return false;
  }

  setAccessToken(payload.access_token);
  if (payload.id_token) {
    setIdToken(payload.id_token);
  }
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(ISSUER_KEY);

  const state = params.get("state") ?? "/desktop";
  window.history.replaceState({}, "", state.startsWith("/") ? state : `/${state}`);
  return true;
}

/**
 * OIDC configuration from Vite env (M1, M3).
 * Public client + PKCE — no client secret in the browser.
 */
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

export function getOidcConfig(): OidcConfig {
  return {
    issuer: import.meta.env.VITE_OIDC_ISSUER ?? "",
    clientId: import.meta.env.VITE_OIDC_CLIENT_ID ?? "",
    redirectUri: import.meta.env.VITE_OIDC_REDIRECT_URI ?? `${window.location.origin}/login`,
    scopes: import.meta.env.VITE_OIDC_SCOPES ?? "openid profile email groups",
    authDisabled: import.meta.env.VITE_AUTH_DISABLED === "true",
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

export function getAccessToken(): string | null {
  const config = getOidcConfig();
  if (config.authDisabled) {
    return null;
  }
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
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
}

export async function loginRedirect(returnTo = "/desktop"): Promise<void> {
  const config = getOidcConfig();
  if (config.authDisabled || !config.issuer || !config.clientId) {
    return;
  }

  const verifier = randomUrlSafeString(32);
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
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

  window.location.href = `${config.issuer.replace(/\/$/, "")}/protocol/openid-connect/auth?${params}`;
}

export function logoutRedirect(): void {
  const config = getOidcConfig();
  const idToken = sessionStorage.getItem(ID_TOKEN_STORAGE_KEY);
  clearAccessToken();
  if (!config.issuer || !config.clientId) {
    window.location.replace("/login");
    return;
  }
  const params = new URLSearchParams({
    client_id: config.clientId,
    post_logout_redirect_uri: config.redirectUri,
  });
  if (idToken) {
    params.set("id_token_hint", idToken);
  }
  window.location.replace(
    `${config.issuer.replace(/\/$/, "")}/protocol/openid-connect/logout?${params}`,
  );
}

export function isAuthenticated(): boolean {
  const config = getOidcConfig();
  if (config.authDisabled) {
    return true;
  }
  return Boolean(getAccessToken());
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

  const tokenUrl = `${config.issuer.replace(/\/$/, "")}/protocol/openid-connect/token`;
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
    return false;
  }

  const payload = (await response.json()) as { access_token?: string; id_token?: string };
  if (!payload.access_token) {
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    return false;
  }

  setAccessToken(payload.access_token);
  if (payload.id_token) {
    setIdToken(payload.id_token);
  }
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);

  const state = params.get("state") ?? "/desktop";
  window.history.replaceState({}, "", state.startsWith("/") ? state : `/${state}`);
  return true;
}

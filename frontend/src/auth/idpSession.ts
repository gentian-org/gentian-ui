import { apiFetch } from "@/api/client";
import { getAccessToken } from "@/auth/oidc";

type IdpSessionResponse = {
  redirectUrl?: string | null;
  skipped?: boolean;
};

let bootstrapPromise: Promise<void> | null = null;

const BOOTSTRAP_IFRAME_MS = 8000;

/** Fetch the Keycloak impersonation URL that establishes a browser SSO session. */
export async function fetchIdpSessionRedirect(): Promise<string | null> {
  if (!getAccessToken()) {
    return null;
  }
  try {
    const response = await apiFetch<IdpSessionResponse>("/auth/idp-session", {
      method: "POST",
    });
    if (response?.skipped) {
      return null;
    }
    return response?.redirectUrl ?? null;
  } catch {
    return null;
  }
}

async function requestStorageAccessIfNeeded(): Promise<void> {
  if (typeof document.hasStorageAccess !== "function") {
    return;
  }
  try {
    if (await document.hasStorageAccess()) {
      return;
    }
    if (typeof document.requestStorageAccess === "function") {
      await document.requestStorageAccess();
    }
  } catch {
    // Non-fatal: silent SSO may still work when the browser already has an IdP cookie.
  }
}

function bootstrapViaHiddenIframe(redirectUrl: string): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.hidden = true;
    iframe.title = "Identity session";
    iframe.src = redirectUrl;
    iframe.onload = () => {
      window.setTimeout(() => iframe.remove(), 500);
      resolve();
    };
    iframe.onerror = () => {
      iframe.remove();
      resolve();
    };
    document.body.appendChild(iframe);
    window.setTimeout(() => {
      if (iframe.isConnected) {
        iframe.remove();
      }
      resolve();
    }, BOOTSTRAP_IFRAME_MS);
  });
}

async function warmIdpBrowserSession(redirectUrl: string): Promise<void> {
  await requestStorageAccessIfNeeded();
  await bootstrapViaHiddenIframe(redirectUrl);
}

/**
 * Establish the tenant-realm Keycloak browser session used by embedded OIDC apps.
 * Uses a hidden iframe only — never opens a popup without an explicit user gesture.
 */
export async function bootstrapIdpSession(): Promise<void> {
  if (!getAccessToken()) {
    return;
  }
  if (bootstrapPromise) {
    await bootstrapPromise;
    return;
  }

  bootstrapPromise = (async () => {
    try {
      const redirectUrl = await fetchIdpSessionRedirect();
      if (!redirectUrl) {
        return;
      }
      await warmIdpBrowserSession(redirectUrl);
    } catch {
      // Non-fatal: login_hint may still help when a browser session already exists.
    } finally {
      bootstrapPromise = null;
    }
  })();

  return bootstrapPromise;
}

/** Call before opening an embedded OIDC app tile (not used for Element matrix-bridge). */
export async function prepareEmbeddedOidcSession(): Promise<void> {
  await bootstrapIdpSession();
}

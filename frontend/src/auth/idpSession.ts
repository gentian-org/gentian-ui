import { apiFetch } from "@/api/client";
import { getAccessToken } from "@/auth/oidc";

type IdpSessionResponse = {
  redirectUrl?: string | null;
  skipped?: boolean;
};

let bootstrapPromise: Promise<void> | null = null;

const BOOTSTRAP_POPUP_MS = 3500;
const BOOTSTRAP_IFRAME_MS = 8000;
// Off-screen 1×1 popup: first-party IdP cookies without a visible Keycloak window.
const POPUP_FEATURES =
  "popup=yes,width=1,height=1,left=-10000,top=-10000,toolbar=no,menubar=no,location=no,status=no";

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

function waitForPopupBootstrap(popup: Window | null): Promise<void> {
  if (!popup) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      try {
        popup.close();
      } catch {
        /* ignore */
      }
      resolve();
    };

    const timeout = window.setTimeout(finish, BOOTSTRAP_POPUP_MS);
    const interval = window.setInterval(() => {
      if (popup.closed) {
        finish();
      }
    }, 200);
  });
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

/**
 * Open a popup synchronously in the click handler (required to avoid blockers).
 * Must be called before any await in the same user-gesture turn.
 */
export function openIdpBootstrapPopup(): Window | null {
  try {
    return window.open("about:blank", "gentian-idp-bootstrap", POPUP_FEATURES);
  } catch {
    return null;
  }
}

async function warmIdpBrowserSession(
  redirectUrl: string,
  popup: Window | null = null,
): Promise<void> {
  await requestStorageAccessIfNeeded();

  if (popup && !popup.closed) {
    popup.location.replace(redirectUrl);
    await waitForPopupBootstrap(popup);
    return;
  }

  await bootstrapViaHiddenIframe(redirectUrl);
}

/**
 * Establish the tenant-realm Keycloak browser session used by embedded OIDC apps.
 * Portal password login uses the BFF (no browser redirect), so this step is required
 * before opening apps like Nextcloud in a WinBox iframe.
 */
export async function bootstrapIdpSession(popup: Window | null = null): Promise<void> {
  if (!getAccessToken()) {
    popup?.close();
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
        popup?.close();
        return;
      }
      await warmIdpBrowserSession(redirectUrl, popup);
    } catch {
      popup?.close();
    } finally {
      bootstrapPromise = null;
    }
  })();

  return bootstrapPromise;
}

/** Call from a user gesture before opening an embedded OIDC app tile. */
export async function prepareEmbeddedOidcSession(popup: Window | null = null): Promise<void> {
  await bootstrapIdpSession(popup);
}

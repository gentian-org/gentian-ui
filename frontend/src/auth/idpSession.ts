import { apiFetch } from "@/api/client";
import { getAccessToken } from "@/auth/oidc";

type IdpSessionResponse = {
  redirectUrl?: string | null;
  skipped?: boolean;
};

let bootstrapPromise: Promise<void> | null = null;

/** Fetch the Keycloak impersonation URL that establishes a browser SSO session. */
export async function fetchIdpSessionRedirect(): Promise<string | null> {
  if (!getAccessToken()) {
    return null;
  }
  try {
    const response = await apiFetch<IdpSessionResponse>("/auth/idp-session", {
      method: "POST",
    });
    return response?.redirectUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Warm the IdP session in a hidden iframe on the portal origin.
 * Embedded OIDC apps still need the WinBox two-step navigation (see WindowManager).
 */
export async function bootstrapIdpSession(): Promise<void> {
  if (!getAccessToken()) {
    return;
  }
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  bootstrapPromise = (async () => {
    try {
      const redirectUrl = await fetchIdpSessionRedirect();
      if (!redirectUrl) {
        return;
      }

      await new Promise<void>((resolve) => {
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
        }, 8000);
      });
    } catch {
      // Non-fatal: login_hint may still help when a browser session already exists.
    } finally {
      bootstrapPromise = null;
    }
  })();

  return bootstrapPromise;
}

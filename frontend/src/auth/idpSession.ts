import { apiFetch } from "@/api/client";
import { getAccessToken } from "@/auth/oidc";

type IdpSessionResponse = {
  redirectUrl?: string | null;
  skipped?: boolean;
};

let bootstrapPromise: Promise<void> | null = null;

/**
 * Load Keycloak's impersonation redirect in a hidden iframe so embedded OIDC apps
 * can complete silent SSO after a portal password (BFF) login.
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
      const response = await apiFetch<IdpSessionResponse>("/auth/idp-session", {
        method: "POST",
      });
      const redirectUrl = response?.redirectUrl;
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

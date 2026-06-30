import { useEffect } from "react";
import { bootstrapIdpSession } from "@/auth/idpSession";
import { getOidcConfig } from "@/auth/oidc";

/** Hidden iframe bootstrap so embedded OIDC apps can SSO after BFF password login. */
export function IdpSessionBootstrap() {
  const config = getOidcConfig();

  useEffect(() => {
    if (config.authDisabled) {
      return;
    }
    void bootstrapIdpSession();
  }, [config.authDisabled]);

  return null;
}

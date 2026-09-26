import "@/styles/shell-panel.css";

/**
 * This desktop does not sign anybody in.
 *
 * It had a login page, which asked the backend which realm an address belonged
 * to, started a browser OIDC flow, and offered a "forgot password" that the
 * backend served through Keycloak's administrator API. All three are gone: the
 * Gateway signs people in before this bundle is ever served, so by the time
 * anything here runs the session exists, and the realm was decided by the host
 * (gentian-os S7A.6).
 *
 * The route stays so a bookmark does not land on nothing, and says what to do.
 */
export function SignInElsewhere() {
  return (
    <div className="shell-panel" style={{ maxWidth: "32rem", margin: "4rem auto" }}>
      <h1 className="shell-panel__title">Sign in at the front door</h1>
      <p className="shell-panel__hint">
        This desktop is served behind the platform gateway, which signs you in before it
        hands the page over. Open the desktop's own address and you will be taken through
        sign-in on the way.
      </p>
      <p className="shell-panel__hint">
        If you arrived here and are not signed in, the gateway is not in front of this
        page — which is a deployment fault rather than something to fix from here.
      </p>
    </div>
  );
}

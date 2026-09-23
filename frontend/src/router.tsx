import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { getAccessToken, getOidcConfig, isEdgeSession } from "@/auth/oidc";
import { RequireAuth } from "@/auth/RequireAuth";
import { defaultBasePath } from "@/lib/device";
import { safeReturnTo } from "@/lib/returnTo";
import { DesktopPage } from "@/pages/DesktopPage";
import { LoginPage } from "@/pages/LoginPage";
import { MobilePage } from "@/pages/MobilePage";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    // Behind the edge this bundle is only ever served to someone the Gateway
    // has already signed in, so there is no sign-in to send them to: the
    // shell is the answer to "/". Sending them to /login instead was a loop
    // the user could not leave — the login page bounces an authenticated
    // visitor to the shell, and the shell bounced back for want of a token
    // this mode deliberately does not hold.
    if (isEdgeSession()) {
      throw redirect({ to: defaultBasePath() });
    }
    throw redirect({ to: "/login", search: { returnTo: undefined, email: undefined } });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (search: Record<string, unknown>) => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
    // Carried from the apex portal once the email has been entered there, so the
    // Keycloak form arrives pre-filled and only asks for a password.
    email: typeof search.email === "string" ? search.email : undefined,
  }),
  // The edge owns the sign-in, so there is no login page behind it. A link or
  // a bookmark that still points here lands on the shell instead.
  beforeLoad: ({ search }) => {
    if (isEdgeSession()) {
      throw redirect({ to: safeReturnTo(search.returnTo) });
    }
  },
  component: LoginPage,
});

// Legacy gentian-login paths → new shell routes (Stage 1 portal).
const legacyDesktopRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/u/gentian-desktop",
  beforeLoad: () => {
    throw redirect({ to: "/desktop" });
  },
});

const legacyMobileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/u/gentian-mobile",
  beforeLoad: () => {
    throw redirect({ to: "/mobile" });
  },
});

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  beforeLoad: ({ location }) => {
    const config = getOidcConfig();
    if (config.authDisabled) {
      return;
    }
    // Behind the edge the session is the Gateway's cookie, not a token in
    // this bundle: getAccessToken() is null by design and asking it whether
    // the visitor is signed in can only ever answer no.
    if (config.authMode === "edge") {
      return;
    }
    if (!config.issuer || !config.clientId) {
      return;
    }
    if (!getAccessToken()) {
      throw redirect({
        to: "/login",
        search: { returnTo: location.pathname, email: undefined },
      });
    }
  },
  component: () => (
    <RequireAuth>
      <Outlet />
    </RequireAuth>
  ),
});

const desktopRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/desktop",
  component: DesktopPage,
});

const mobileRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/mobile",
  component: MobilePage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  legacyDesktopRoute,
  legacyMobileRoute,
  shellRoute.addChildren([desktopRoute, mobileRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

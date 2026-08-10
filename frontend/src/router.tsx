import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { getAccessToken, getOidcConfig } from "@/auth/oidc";
import { RequireAuth } from "@/auth/RequireAuth";
import { basePathFromLegacyRouter } from "@/lib/device";
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
  component: LoginPage,
});

// Legacy OpenDesk / gentian-login paths → new shell routes (Stage 1 portal).
const legacyBaseRouterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/u/base-router",
  validateSearch: (search: Record<string, unknown>) => ({
    pointer_coarse:
      typeof search.pointer_coarse === "string" ? search.pointer_coarse : undefined,
    viewport_width:
      typeof search.viewport_width === "string" ? search.viewport_width : undefined,
    base: typeof search.base === "string" ? search.base : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: basePathFromLegacyRouter(search) });
  },
});

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

const legacyUniventionOidcRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/univention/oidc",
  beforeLoad: () => {
    throw redirect({ to: "/login", search: { returnTo: undefined, email: undefined } });
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
  legacyBaseRouterRoute,
  legacyDesktopRoute,
  legacyMobileRoute,
  legacyUniventionOidcRoute,
  shellRoute.addChildren([desktopRoute, mobileRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

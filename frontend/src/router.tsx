import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { RequireAuth } from "@/auth/RequireAuth";
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
    throw redirect({ to: "/login" });
  },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
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
  shellRoute.addChildren([desktopRoute, mobileRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
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

const desktopRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/desktop",
  component: DesktopPage,
});

const mobileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/mobile",
  component: MobilePage,
});

const routeTree = rootRoute.addChildren([indexRoute, loginRoute, desktopRoute, mobileRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

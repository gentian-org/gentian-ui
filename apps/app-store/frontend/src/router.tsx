import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { RequireAuth } from "@/auth/RequireAuth";
import { AppPage } from "@/store/AppPage";
import { AppStore } from "@/store/AppStore";
import { BrowsePage } from "@/store/BrowsePage";
import { InstalledPage } from "@/store/InstalledPage";
import { SignedInPage } from "@/store/SignedInPage";

const rootRoute = createRootRoute({
  component: () => (
    <RequireAuth>
      <Outlet />
    </RequireAuth>
  ),
});

// The app itself: the gate, then the shell, then one of three pages.
const storeRoute = createRoute({ getParentRoute: () => rootRoute, id: "store", component: AppStore });
const browseRoute = createRoute({ getParentRoute: () => storeRoute, path: "/", component: BrowsePage });
const appRoute = createRoute({
  getParentRoute: () => storeRoute,
  path: "/app/$catalogue/$app",
  component: AppPage,
});
const installedRoute = createRoute({ getParentRoute: () => storeRoute, path: "/installed", component: InstalledPage });

// Where the window of a store sign-in ends. Outside the shell: it asks the
// cluster and the store nothing.
const signedInRoute = createRoute({ getParentRoute: () => rootRoute, path: "/signed-in", component: SignedInPage });

const routeTree = rootRoute.addChildren([
  storeRoute.addChildren([browseRoute, appRoute, installedRoute]),
  signedInRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { RequireAuth } from "@/auth/RequireAuth";
import { AppDetails } from "@/store/AppPage";
import { AppStore } from "@/store/AppStore";
import { BrowsePage } from "@/store/BrowsePage";
import { SignedInPage } from "@/store/SignedInPage";

const rootRoute = createRootRoute({
  component: () => (
    <RequireAuth>
      <Outlet />
    </RequireAuth>
  ),
});

// The app itself: the gate, then the shell, then the catalogue. An app's
// details open on top of the catalogue, which stays where it was beneath.
const storeRoute = createRoute({ getParentRoute: () => rootRoute, id: "store", component: AppStore });
const browseRoute = createRoute({ getParentRoute: () => storeRoute, path: "/", component: BrowsePage });
const appRoute = createRoute({
  getParentRoute: () => browseRoute,
  path: "app/$catalogue/$app",
  // `install`: opened by a tile's Install or Buy, which asks for the install at once.
  validateSearch: (search: Record<string, unknown>): { install?: boolean } =>
    search.install === true || search.install === "true" || search.install === 1 ? { install: true } : {},
  component: AppDetails,
});

// Where the window of a store sign-in ends. Outside the shell: it asks the
// cluster and the store nothing.
const signedInRoute = createRoute({ getParentRoute: () => rootRoute, path: "/signed-in", component: SignedInPage });

const routeTree = rootRoute.addChildren([storeRoute.addChildren([browseRoute.addChildren([appRoute])]), signedInRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

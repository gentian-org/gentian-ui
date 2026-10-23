import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { RequireAuth } from "@/auth/RequireAuth";
import { AppDetails } from "@/store/AppPage";
import type { Resume } from "@/store/InstallPanel";
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
// A layout without a path: a "/" route is an index route, which can have no
// children, and the details would then match nothing.
const browseRoute = createRoute({ getParentRoute: () => storeRoute, id: "browse", component: BrowsePage });
const catalogueRoute = createRoute({ getParentRoute: () => browseRoute, path: "/" });
const appRoute = createRoute({
  getParentRoute: () => browseRoute,
  path: "app/$catalogue/$app",
  // What the details go on with (InstallPanel's Resume): `install` from a
  // tile's Install or Buy, and the way back from a store sign-in.
  validateSearch: (search: Record<string, unknown>): Resume => {
    const flag = (value: unknown) => (value === true || value === "true" ? true : value === false || value === "false" ? false : undefined);
    const out: Resume = {};
    if (flag(search.install)) out.install = true;
    const everyone = flag(search.everyone);
    if (everyone !== undefined) out.everyone = everyone;
    if (typeof search.addons === "string" && /^[a-z0-9/,-]{1,600}$/.test(search.addons)) out.addons = search.addons;
    // The people chosen for an install for selected users, by registrar id.
    if (typeof search.users === "string" && /^[A-Za-z0-9,-]{1,4000}$/.test(search.users)) out.users = search.users;
    return out;
  },
  component: AppDetails,
});

// Where the window of a store sign-in ends. Outside the shell: it asks the
// cluster and the store nothing.
const signedInRoute = createRoute({ getParentRoute: () => rootRoute, path: "/signed-in", component: SignedInPage });

const routeTree = rootRoute.addChildren([storeRoute.addChildren([browseRoute.addChildren([catalogueRoute, appRoute])]), signedInRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

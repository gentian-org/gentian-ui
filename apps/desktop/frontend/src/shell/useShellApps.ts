import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  apiFetch,
  type ClusterTilesResponse,
  type MeResponse,
  type ShellApp,
} from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import { localisedLabel } from "@/lib/locale";
import { getAccessToken, isEdgeSession } from "@/auth/oidc";

/** The usher's tiles, in the shape the desktop renders. */
function kernelConsoleApps(data: ClusterTilesResponse | undefined): ShellApp[] {
  return (data?.tiles ?? []).map((tile) => ({
    id: `kernel-${tile.name}`,
    title: localisedLabel(tile.displayName, tile.displayNames),
    icon: tile.icon,
    launchUrl: tile.url,
    // In a window on the desktop, like every other tile. These are separate
    // origins, but they are all under the kernel domain and all sign in
    // against the same realm, so the session the person already holds carries
    // into the frame.
    linkTarget: "embedded",
    // No login hint. Each console runs its own OIDC flow against the same
    // realm, and the session the person already holds is what carries them
    // through it.
    authMode: null,
    preopen: false,
    builtin: false,
  }));
}

// No built-in administration console any more.
//
// It used to be a tile this file invented for anybody who looked like an
// administrator, opening a copy of the console bundled into this image. The
// console is a component now, installed for every tenant from its own
// ComponentProfile and reached at admin.<zone>, so its tile arrives the way
// every other tile does -- from the director, against a relation the caller
// actually holds, rather than from a guess made here about who is an admin.
function shellAppsFromMe(me: MeResponse | undefined): ShellApp[] {
  return me?.shellApps ?? [];
}

export function useShellApps() {
  const { isAuthenticated, isLoading: authLoading, authDisabled } = useAuth();
  const sessionReady = authDisabled || (!authLoading && isAuthenticated);
  const hasToken = authDisabled || isEdgeSession() || Boolean(getAccessToken());

  const {
    data: me,
    isLoading: meLoading,
    isFetching,
    isFetched,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<MeResponse>("/session/me"),
    enabled: sessionReady && hasToken,
    staleTime: 0,
    refetchOnMount: "always",
    retry: 1,
  });

  // The tiles this person may open here, from the usher. Asked separately
  // because the answer is not the desktop's to compute: the usher decides it
  // from this person's relations, tile by tile.
  //
  // A failure here is a failure of the desktop and is shown as one. Someone
  // who may open nothing gets an empty list with a 200; an error is a
  // different thing, and rendering it as an empty desktop would hide it.
  const {
    data: clusterTiles,
    isError: tilesFailed,
    refetch: refetchTiles,
  } = useQuery({
    queryKey: ["cluster-tiles"],
    queryFn: () => apiFetch<ClusterTilesResponse>("/cluster/tiles"),
    enabled: sessionReady && hasToken,
    staleTime: 60_000,
    retry: false,
  });

  const apps = useMemo(() => {
    const list = [...shellAppsFromMe(me), ...kernelConsoleApps(clusterTiles)];

    // The administration tiles first, in the order a platform administrator
    // works through them: the console that configures, the one that looks
    // after, then the three kernel consoles -- what the cluster runs, what git
    // says it should, and who may sign in. Subscriptions follow, then every
    // app.
    const ADMIN_ORDER = [
      "kernel-platform/admin-console/web",
      "kernel-platform/operations-console/web",
      "kernel-headlamp",
      "kernel-argocd",
      "kernel-keycloak",
    ];
    const getSortIndex = (id: string) => {
      // A tenant's own consoles carry its name in place of "platform".
      const generic = id.replace(/^kernel-[^/]+\/(admin-console|operations-console)\//, "kernel-platform/$1/");
      const pinned = ADMIN_ORDER.indexOf(generic);
      if (pinned !== -1) return pinned;
      if (
        id === "subscriptions" ||
        id.startsWith("subscriptions-") ||
        id === "gentian-subscriptions" ||
        id.startsWith("gentian-subscriptions-")
      ) {
        return ADMIN_ORDER.length;
      }
      return -1;
    };

    const adminApps = list.filter((a) => getSortIndex(a.id) !== -1);
    const userApps = list.filter((a) => getSortIndex(a.id) === -1);

    adminApps.sort((a, b) => getSortIndex(a.id) - getSortIndex(b.id));

    return [...adminApps, ...userApps];
  }, [me, clusterTiles]);

  const isAdminUser = Boolean(me?.isPlatformAdmin || me?.isTenantAdmin);
  // An administrator whose only tile is the administration console. Named by
  // the component's own id now that the tile comes from the director rather
  // than from a constant in this file.
  const adminOnly =
    isAdminUser && apps.length > 0 && apps.every((app) => app.id.endsWith("admin-console"));

  return {
    me,
    apps,
    isAdminUser,
    adminOnly,
    // The session request or the tiles request failed. Distinct from "this user has no apps": both
    // leave `apps` empty, and rendering them the same way turns any backend or
    // edge fault into a silent, plausible-looking empty desktop.
    loadFailed: isError || tilesFailed,
    reload: () => {
      void refetch();
      void refetchTiles();
    },
    isLoading: !sessionReady || !hasToken || meLoading || (isFetching && !isFetched),
  };
}

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  apiFetch,
  type ClusterTilesResponse,
  type MeResponse,
  type ShellApp,
} from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import { getAccessToken, isEdgeSession } from "@/auth/oidc";

const ADMIN_APP: ShellApp = {
  id: "admin",
  title: "Admin Console",
  icon: "admin",
  launchUrl: null,
  builtin: true,
};

/** The director's tiles, in the shape the desktop renders. */
function kernelConsoleApps(data: ClusterTilesResponse | undefined): ShellApp[] {
  return (data?.tiles ?? []).map((tile) => ({
    id: `kernel-${tile.name}`,
    title: tile.displayName,
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

function shellAppsFromMe(me: MeResponse | undefined): ShellApp[] {
  if (me?.shellApps && me.shellApps.length > 0) {
    return me.shellApps;
  }
  if (me?.isPlatformAdmin || me?.isTenantAdmin) {
    return [ADMIN_APP];
  }
  return [];
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

  // The cluster's own consoles, from the director. Asked separately because
  // the answer is not the console's to compute: the director decides it from
  // this person's relations to the cluster, so a tenant administrator and a
  // platform administrator get different lists and neither is "everyone who
  // is an admin".
  //
  // A failure here is not a failure of the desktop. Someone with no cluster
  // relation gets an empty list, which is the same shape as a director that
  // cannot be reached, and the apps this person does hold still render.
  const { data: clusterTiles } = useQuery({
    queryKey: ["cluster-tiles"],
    queryFn: () => apiFetch<ClusterTilesResponse>("/cluster/tiles"),
    enabled: sessionReady && hasToken,
    staleTime: 60_000,
    retry: false,
  });

  const apps = useMemo(() => {
    const list = [...shellAppsFromMe(me), ...kernelConsoleApps(clusterTiles)];
    
    const getSortIndex = (id: string) => {
      if (id === "admin") return 0;
      if (id === "app-store" || id.startsWith("app-store-")) return 1;
      if (
        id === "subscriptions" ||
        id.startsWith("subscriptions-") ||
        id === "gentian-subscriptions" ||
        id.startsWith("gentian-subscriptions-")
      ) {
        return 2;
      }
      return -1;
    };
    
    const adminApps = list.filter((a) => getSortIndex(a.id) !== -1);
    const userApps = list.filter((a) => getSortIndex(a.id) === -1);
    
    adminApps.sort((a, b) => getSortIndex(a.id) - getSortIndex(b.id));
    
    return [...adminApps, ...userApps];
  }, [me, clusterTiles]);

  const isAdminUser = Boolean(me?.isPlatformAdmin || me?.isTenantAdmin);
  const adminOnly =
    isAdminUser && apps.length > 0 && apps.every((app) => app.id === "admin");

  return {
    me,
    apps,
    isAdminUser,
    adminOnly,
    // The session request failed. Distinct from "this user has no apps": both
    // leave `apps` empty, and rendering them the same way turns any backend or
    // edge fault into a silent, plausible-looking empty desktop.
    loadFailed: isError,
    reload: refetch,
    isLoading: !sessionReady || !hasToken || meLoading || (isFetching && !isFetched),
  };
}

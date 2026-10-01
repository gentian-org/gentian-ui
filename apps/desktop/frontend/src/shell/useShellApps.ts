import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  apiFetch,
  type ClusterTilesResponse,
  type MeResponse,
  type ShellApp,
} from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import { localisedLabel } from "@/lib/locale";
import { getAccessToken, isEdgeSession } from "@/auth/oidc";
import type { StoreContext } from "@/shell/storeBridge";

/** The director's tiles, in the shape the desktop renders. */
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

/**
 * The App Store, for whoever may install.
 *
 * Not a component of the tenant's and not a profile: the store runs outside
 * the cluster (AD-3), so there is nothing here to install. The tile exists
 * when the Cluster claim names a store, and is shown to whoever holds
 * can_install_app on this tenant -- both of which the director answered, so
 * this decides nothing about who is an administrator.
 *
 * The address carries the tenant and the cluster so the page can say whose
 * store it is before the bridge has answered. They are labels: what the store
 * may do here is decided by the bridge, from the origin, not from a URL.
 */
function storeApp(context: StoreContext | undefined, title: string): ShellApp[] {
  if (!context?.storeUrl || !context.storeOrigin) return [];
  if (!context.relations?.can_install_app) return [];
  const url = new URL(context.storeUrl);
  url.searchParams.set("embedded", "1");
  url.searchParams.set("tenant", context.tenant);
  if (context.cluster) url.searchParams.set("cluster", context.cluster);
  return [
    {
      id: "app-store",
      title,
      icon: "store",
      launchUrl: url.toString(),
      linkTarget: "embedded",
      authMode: null,
      preopen: false,
      builtin: false,
    },
  ];
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
  const { t } = useTranslation();
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

  // Which store this cluster listens to, and whether this person may install.
  // The same answer the bridge pins its origin from, so the tile and the
  // bridge cannot disagree about which store it is.
  const { data: storeContext } = useQuery({
    queryKey: ["store-context"],
    queryFn: () => apiFetch<StoreContext>("/store/context"),
    enabled: sessionReady && hasToken,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const storeTitle = t("store.title");

  const apps = useMemo(() => {
    const list = [
      ...storeApp(storeContext, storeTitle),
      ...shellAppsFromMe(me),
      ...kernelConsoleApps(clusterTiles),
    ];
    
    const getSortIndex = (id: string) => {
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
  }, [me, clusterTiles, storeContext, storeTitle]);

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
    // The session request failed. Distinct from "this user has no apps": both
    // leave `apps` empty, and rendering them the same way turns any backend or
    // edge fault into a silent, plausible-looking empty desktop.
    loadFailed: isError,
    reload: refetch,
    isLoading: !sessionReady || !hasToken || meLoading || (isFetching && !isFetched),
  };
}

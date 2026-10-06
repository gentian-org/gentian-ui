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

/** Whether the store is offered here, as far as the usher has said. */
type StoreOffer =
  | { state: "pending" }
  | { state: "offered" }
  | { state: "withheld"; why: string };

const LICENCE_REPORT_DISABLED = "licence-report-disabled";

/**
 * What the usher said about the App Store, beside the tiles.
 *
 * Only an explicit yes offers the store. An answer without the field -- an
 * usher that predates it -- and a tiles request that failed are both "the
 * desktop was not told", and are said as that rather than taken for a yes.
 */
function storeOffer(
  data: ClusterTilesResponse | undefined,
  failed: boolean,
  t: (key: string, options?: Record<string, unknown>) => string,
): StoreOffer {
  if (!data) {
    return failed ? { state: "withheld", why: t("store.unavailable.unknown") } : { state: "pending" };
  }
  const answer = data.appStore;
  if (!answer || typeof answer.available !== "boolean") {
    return { state: "withheld", why: t("store.unavailable.unknown") };
  }
  if (answer.available) return { state: "offered" };
  if (answer.reason === LICENCE_REPORT_DISABLED) {
    return { state: "withheld", why: t("store.unavailable.licenceReport") };
  }
  return { state: "withheld", why: t("store.unavailable.other", { reason: answer.reason ?? "" }) };
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
function storeApp(
  context: StoreContext | undefined,
  title: string,
  offer: StoreOffer,
): ShellApp[] {
  if (!context?.storeUrl || !context.storeOrigin) return [];
  if (!context.relations?.can_install_app) return [];
  // Nothing to show until the usher has been asked: a tile that opened the
  // store first and was withdrawn a moment later would have loaded the frame.
  if (offer.state === "pending") return [];
  if (offer.state === "withheld") {
    // The entry stays, so that whoever expects the store is told why it is
    // not there, and carries no address: there is nothing to load.
    return [
      {
        id: "app-store",
        title,
        icon: "store",
        launchUrl: null,
        linkTarget: "embedded",
        authMode: null,
        preopen: false,
        builtin: false,
        unavailable: offer.why,
      },
    ];
  }
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
  const offer = storeOffer(clusterTiles, tilesFailed, t);
  const offerState = offer.state;
  const offerWhy = offer.state === "withheld" ? offer.why : "";

  const apps = useMemo(() => {
    const list = [
      ...storeApp(
        storeContext,
        storeTitle,
        offerState === "withheld" ? { state: offerState, why: offerWhy } : { state: offerState },
      ),
      ...shellAppsFromMe(me),
      ...kernelConsoleApps(clusterTiles),
    ];
    
    // The administration tiles first, in the order a platform administrator
    // works through them: the console that configures, the one that looks
    // after, then the three kernel consoles -- what the cluster runs, what git
    // says it should, and who may sign in. The store and subscriptions follow,
    // then every app.
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
      if (id === "app-store" || id.startsWith("app-store-")) return ADMIN_ORDER.length;
      if (
        id === "subscriptions" ||
        id.startsWith("subscriptions-") ||
        id === "gentian-subscriptions" ||
        id.startsWith("gentian-subscriptions-")
      ) {
        return ADMIN_ORDER.length + 1;
      }
      return -1;
    };

    const adminApps = list.filter((a) => getSortIndex(a.id) !== -1);
    const userApps = list.filter((a) => getSortIndex(a.id) === -1);

    adminApps.sort((a, b) => getSortIndex(a.id) - getSortIndex(b.id));

    return [...adminApps, ...userApps];
  }, [me, clusterTiles, storeContext, storeTitle, offerState, offerWhy]);

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
    // Whether the usher said the App Store is offered on this cluster. The
    // bridge listens only then: a store that is not offered is not answered.
    storeOffered: offerState === "offered",
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

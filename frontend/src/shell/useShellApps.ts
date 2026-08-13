import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiFetch, type MeResponse, type ShellApp } from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import { getAccessToken } from "@/auth/oidc";

const ADMIN_APP: ShellApp = {
  id: "admin",
  title: "Admin Console",
  icon: "admin",
  launchUrl: null,
  builtin: true,
};

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
  const hasToken = authDisabled || Boolean(getAccessToken());

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

  const apps = useMemo(() => {
    const list = shellAppsFromMe(me);
    
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
  }, [me]);

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

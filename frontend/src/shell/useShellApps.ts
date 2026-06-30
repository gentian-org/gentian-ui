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
  } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<MeResponse>("/session/me"),
    enabled: sessionReady && hasToken,
    staleTime: 0,
    refetchOnMount: "always",
    retry: 1,
  });

  const apps = useMemo(() => shellAppsFromMe(me), [me]);

  const isAdminUser = Boolean(me?.isPlatformAdmin || me?.isTenantAdmin);
  const adminOnly =
    isAdminUser && apps.length > 0 && apps.every((app) => app.id === "admin");

  return {
    me,
    apps,
    isAdminUser,
    adminOnly,
    isLoading: !sessionReady || !hasToken || meLoading || (isFetching && !isFetched),
  };
}

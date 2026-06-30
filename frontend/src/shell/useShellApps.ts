import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { apiFetch, type AppsResponse, type MeResponse, type ShellApp } from "@/api/client";
import { useAppsStore } from "@/stores/apps";

const ADMIN_APP: ShellApp = {
  id: "admin",
  title: "Admin Console",
  icon: "admin",
  launchUrl: null,
  builtin: true,
};

export function useShellApps() {
  const { data: me, isLoading: meLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<MeResponse>("/session/me"),
  });
  const { data: appsData, isLoading: appsLoading } = useQuery({
    queryKey: ["apps"],
    queryFn: () => apiFetch<AppsResponse>("/apps/"),
    retry: false,
  });

  const apps = useMemo(() => {
    const fromApi = appsData?.apps ?? [];
    if (fromApi.length > 0) {
      return fromApi;
    }
    if (me?.isPlatformAdmin || me?.isTenantAdmin) {
      return [ADMIN_APP];
    }
    return fromApi;
  }, [appsData?.apps, me?.isPlatformAdmin, me?.isTenantAdmin]);

  const isAdminUser = Boolean(me?.isPlatformAdmin || me?.isTenantAdmin);
  const adminOnly =
    isAdminUser && apps.length > 0 && apps.every((app) => app.id === "admin");

  return {
    me,
    apps,
    isAdminUser,
    adminOnly,
    isLoading: meLoading || appsLoading,
  };
}

/** Tenant/platform admins land in Admin Console (design: sign in → Admin Console). */
export function useAutoOpenAdminConsole(apps: ShellApp[], enabled: boolean) {
  const activeAppId = useAppsStore((s) => s.activeAppId);
  const setActiveAppId = useAppsStore((s) => s.setActiveAppId);

  useEffect(() => {
    if (!enabled || activeAppId === "admin") {
      return;
    }
    const hasAdmin = apps.some((app) => app.id === "admin");
    const onlyAdmin = hasAdmin && apps.every((app) => app.id === "admin");
    if (onlyAdmin) {
      setActiveAppId("admin");
    }
  }, [enabled, apps, activeAppId, setActiveAppId]);
}

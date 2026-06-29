import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiFetch, type AppsResponse, type MeResponse, type PrefsResponse, type ShellApp } from "@/api/client";
import { AppMenu } from "@/shell/AppMenu";
import { Background } from "@/shell/Background";
import { AdminConsole } from "@/admin/AdminConsole";
import { useAppsStore } from "@/stores/apps";
import { useWindowsStore } from "@/stores/windows";
import { WindowManager } from "@/windows/WindowManager";

export function DesktopPage() {
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<MeResponse>("/session/me"),
  });
  const { data: prefs } = useQuery({
    queryKey: ["prefs"],
    queryFn: () => apiFetch<PrefsResponse>("/prefs/"),
  });
  const { data: appsData } = useQuery({
    queryKey: ["apps"],
    queryFn: () => apiFetch<AppsResponse>("/apps/"),
  });

  const apps = useMemo(() => {
    const fromApi = appsData?.apps ?? [];
    if (fromApi.length > 0) {
      return fromApi;
    }
    if (me?.isPlatformAdmin || me?.isTenantAdmin) {
      return [
        {
          id: "admin",
          title: "Admin Console",
          icon: "admin",
          launchUrl: null,
          builtin: true,
        },
      ] satisfies ShellApp[];
    }
    return fromApi;
  }, [appsData?.apps, me?.isPlatformAdmin, me?.isTenantAdmin]);

  const activeAppId = useAppsStore((s) => s.activeAppId);
  const setActiveAppId = useAppsStore((s) => s.setActiveAppId);
  const openWindow = useWindowsStore((s) => s.openWindow);

  const adminOpen = activeAppId === "admin";
  const launcherApps = useMemo(() => apps, [apps]);

  function handleSelect(app: (typeof apps)[number]) {
    setActiveAppId(app.id);
    if (app.builtin && app.id === "admin") {
      return;
    }
    if (!app.launchUrl) {
      return;
    }
    openWindow({
      id: crypto.randomUUID(),
      appId: app.id,
      title: app.title,
      url: app.launchUrl,
    });
  }

  return (
    <div className="gentian-shell shell-surface relative min-h-full">
      <Background imageUrl={prefs?.backgroundUrl} />
      {adminOpen && (
        <div className="relative z-20">
          <AdminConsole />
        </div>
      )}
      <WindowManager />
      <AppMenu
        apps={launcherApps}
        activeAppId={activeAppId}
        username={me?.username}
        onSelect={handleSelect}
      />
    </div>
  );
}

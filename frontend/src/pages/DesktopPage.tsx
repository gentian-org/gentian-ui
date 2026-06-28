import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiFetch, type AppsResponse, type MeResponse, type PrefsResponse } from "@/api/client";
import { AppMenu } from "@/shell/AppMenu";
import { Background } from "@/shell/Background";
import { UserMenu } from "@/shell/UserMenu";
import { SettingsPanel } from "@/settings/SettingsPanel";
import { useAppsStore } from "@/stores/apps";
import { useWindowsStore } from "@/stores/windows";
import { WindowManager } from "@/windows/WindowManager";

export function DesktopPage() {
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<MeResponse>("/session/me") });
  const { data: prefs } = useQuery({
    queryKey: ["prefs"],
    queryFn: () => apiFetch<PrefsResponse>("/prefs/"),
  });
  const { data: appsData } = useQuery({
    queryKey: ["apps"],
    queryFn: () => apiFetch<AppsResponse>("/apps/"),
  });

  const apps = appsData?.apps ?? [];
  const activeAppId = useAppsStore((s) => s.activeAppId);
  const setActiveAppId = useAppsStore((s) => s.setActiveAppId);
  const openWindow = useWindowsStore((s) => s.openWindow);

  const settingsOpen = activeAppId === "settings";

  const launcherApps = useMemo(() => apps, [apps]);

  function handleSelect(app: (typeof apps)[number]) {
    setActiveAppId(app.id);
    if (app.builtin && app.id === "settings") {
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
      geometry: { x: 80, y: 80, w: 960, h: 640 },
    });
  }

  return (
    <div className="gentian-shell relative min-h-full pt-16">
      <Background imageUrl={prefs?.backgroundUrl} />
      {me && (
        <UserMenu username={me.username} onLogout={() => (window.location.href = "/login")} />
      )}
      <AppMenu
        mode="desktop"
        apps={launcherApps}
        activeAppId={activeAppId}
        onSelect={handleSelect}
      />
      {settingsOpen && (
        <div className="relative z-20 flex min-h-[calc(100vh-4rem)] items-center justify-center p-6">
          <SettingsPanel />
        </div>
      )}
      <WindowManager />
    </div>
  );
}

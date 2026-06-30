import { useQuery } from "@tanstack/react-query";
import { apiFetch, type PrefsResponse } from "@/api/client";
import { bootstrapIdpSession } from "@/auth/idpSession";
import { AppMenu } from "@/shell/AppMenu";
import { Background } from "@/shell/Background";
import { AdminConsole } from "@/admin/AdminConsole";
import { useShellApps } from "@/shell/useShellApps";
import { useAppsStore } from "@/stores/apps";
import { useWindowsStore } from "@/stores/windows";
import { buildAppLaunchUrl } from "@/lib/appLaunchUrl";
import { WindowManager } from "@/windows/WindowManager";

export function DesktopPage() {
  const { me, apps } = useShellApps();

  const { data: prefs } = useQuery({
    queryKey: ["prefs"],
    queryFn: () => apiFetch<PrefsResponse>("/prefs/"),
  });

  const activeAppId = useAppsStore((s) => s.activeAppId);
  const setActiveAppId = useAppsStore((s) => s.setActiveAppId);
  const openWindow = useWindowsStore((s) => s.openWindow);

  const adminOpen = activeAppId === "admin";

  function handleSelect(app: (typeof apps)[number], options?: { forceLogin?: boolean }) {
    setActiveAppId(app.id);
    if (app.builtin && app.id === "admin") {
      return;
    }
    if (!app.launchUrl) {
      return;
    }
    const launchUrl = app.launchUrl;
    void bootstrapIdpSession().finally(() => {
      const linkTarget = options?.forceLogin ? "newwindow" : app.linkTarget;
      const url = buildAppLaunchUrl(launchUrl, {
        username: me?.username,
        linkTarget,
        authMode: app.authMode,
      });
      openWindow({
        id: crypto.randomUUID(),
        appId: app.id,
        title: app.title,
        url,
      });
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
        apps={apps}
        activeAppId={activeAppId}
        username={me?.username}
        onSelect={handleSelect}
      />
    </div>
  );
}

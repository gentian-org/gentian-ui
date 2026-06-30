import { useQuery } from "@tanstack/react-query";
import { apiFetch, type PrefsResponse } from "@/api/client";
import { fetchIdpSessionRedirect } from "@/auth/idpSession";
import { fetchMatrixBridgeTicket, matrixBridgeLaunchUrl } from "@/auth/matrixBridge";
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
    const appLaunchBase = app.launchUrl;
    void (async () => {
      const linkTarget = options?.forceLogin ? "newwindow" : app.linkTarget;
      const appUrl = buildAppLaunchUrl(appLaunchBase, {
        username: me?.username,
        linkTarget,
        authMode: app.authMode,
      });
      const useMatrixBridge =
        app.authMode === "matrix-bridge" && app.linkTarget === "embedded" && !options?.forceLogin;
      const useIdpBootstrap =
        app.authMode === "oidc" && app.linkTarget === "embedded" && !options?.forceLogin;

      let launchUrl = appUrl;
      let pendingUrl: string | undefined;
      if (useMatrixBridge) {
        const ticket = await fetchMatrixBridgeTicket();
        if (ticket) {
          launchUrl = matrixBridgeLaunchUrl(new URL(appUrl).origin, ticket);
        }
      } else if (useIdpBootstrap) {
        const idpUrl = await fetchIdpSessionRedirect();
        if (idpUrl) {
          launchUrl = idpUrl;
          pendingUrl = appUrl;
        }
      }

      openWindow({
        id: crypto.randomUUID(),
        appId: app.id,
        title: app.title,
        url: launchUrl,
        pendingUrl,
      });
    })();
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

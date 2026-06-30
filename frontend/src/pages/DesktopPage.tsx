import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, type PrefsResponse } from "@/api/client";
import { openIdpBootstrapPopup, prepareEmbeddedOidcSession } from "@/auth/idpSession";
import { fetchMatrixBridgeTicket, matrixBridgeLaunchUrl } from "@/auth/matrixBridge";
import {
  fetchNextcloudBridgeTicket,
  nextcloudBridgeLaunchUrl,
} from "@/auth/nextcloudBridge";
import { AppMenu } from "@/shell/AppMenu";
import { Background } from "@/shell/Background";
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
  const windows = useWindowsStore((s) => s.windows);
  const openOrFocusWindow = useWindowsStore((s) => s.openOrFocusWindow);
  const openWindow = useWindowsStore((s) => s.openWindow);

  useEffect(() => {
    if (activeAppId === "admin" && !windows.some((win) => win.appId === "admin")) {
      setActiveAppId(null);
    }
  }, [activeAppId, setActiveAppId, windows]);

  function handleSelect(app: (typeof apps)[number], options?: { forceLogin?: boolean }) {
    setActiveAppId(app.id);
    if (app.builtin && app.id === "admin") {
      openOrFocusWindow({
        id: "admin-console",
        appId: app.id,
        title: app.title,
        builtinComponent: "admin",
      });
      return;
    }
    if (!app.launchUrl) {
      return;
    }
    const appLaunchBase = app.launchUrl;
    const useMatrixBridge =
      app.authMode === "matrix-bridge" && app.linkTarget === "embedded" && !options?.forceLogin;
    const useNextcloudBridge =
      app.authMode === "nextcloud-bridge" &&
      app.linkTarget === "embedded" &&
      !options?.forceLogin;
    const useIdpBootstrap =
      app.authMode === "oidc" && app.linkTarget === "embedded" && !options?.forceLogin;
    const idpPopup = useIdpBootstrap ? openIdpBootstrapPopup() : null;
    void (async () => {
      const linkTarget = options?.forceLogin ? "newwindow" : app.linkTarget;
      const appUrl = buildAppLaunchUrl(appLaunchBase, {
        username: me?.username,
        linkTarget,
        authMode: app.authMode,
      });

      let launchUrl = appUrl;
      if (useMatrixBridge) {
        const ticket = await fetchMatrixBridgeTicket();
        if (ticket) {
          launchUrl = matrixBridgeLaunchUrl(new URL(appUrl).origin, ticket);
        }
      } else if (useNextcloudBridge) {
        const ticket = await fetchNextcloudBridgeTicket();
        if (ticket) {
          launchUrl = nextcloudBridgeLaunchUrl(new URL(appUrl).origin, ticket);
        }
      } else if (useIdpBootstrap) {
        await prepareEmbeddedOidcSession(idpPopup);
      }

      openWindow({
        id: crypto.randomUUID(),
        appId: app.id,
        title: app.title,
        url: launchUrl,
      });
    })();
  }

  return (
    <div className="gentian-shell shell-surface relative min-h-full">
      <Background imageUrl={prefs?.backgroundUrl} />
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

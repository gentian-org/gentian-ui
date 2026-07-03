import { useEffect } from "react";
import { openIdpBootstrapPopup, prepareEmbeddedOidcSession } from "@/auth/idpSession";
import { fetchMatrixBridgeTicket, matrixBridgeLaunchUrl } from "@/auth/matrixBridge";
import {
  fetchNextcloudBridgeTicket,
  nextcloudBridgeLaunchUrl,
} from "@/auth/nextcloudBridge";
import {
  fetchOpenprojectBridgeTicket,
  openprojectBridgeLaunchUrl,
} from "@/auth/openprojectBridge";
import { AppMenu } from "@/shell/AppMenu";
import { Background } from "@/shell/Background";
import { useShellApps } from "@/shell/useShellApps";
import { useShellBackgroundUrl } from "@/shell/useShellBackground";
import { useAppsStore } from "@/stores/apps";
import { useWindowsStore } from "@/stores/windows";
import { buildAppLaunchUrl } from "@/lib/appLaunchUrl";
import { WindowManager } from "@/windows/WindowManager";

export function DesktopPage() {
  const { me, apps } = useShellApps();
  const backgroundUrl = useShellBackgroundUrl();

  const activeAppId = useAppsStore((s) => s.activeAppId);
  const setActiveAppId = useAppsStore((s) => s.setActiveAppId);
  const windows = useWindowsStore((s) => s.windows);
  const openOrFocusWindow = useWindowsStore((s) => s.openOrFocusWindow);
  const openWindow = useWindowsStore((s) => s.openWindow);
  const closeWindow = useWindowsStore((s) => s.closeWindow);
  const setWindowUrl = useWindowsStore((s) => s.setWindowUrl);

  useEffect(() => {
    const builtinIds = ["admin", "account", "settings"] as const;
    if (
      activeAppId &&
      (builtinIds as readonly string[]).includes(activeAppId) &&
      !windows.some((win) => win.appId === activeAppId)
    ) {
      setActiveAppId(null);
    }
  }, [activeAppId, setActiveAppId, windows]);

  function openBuiltinPanel(
    id: "account" | "settings",
    title: string,
    builtinComponent: "account" | "settings",
  ) {
    setActiveAppId(id);
    openOrFocusWindow({
      id,
      appId: id,
      title,
      builtinComponent,
    });
  }

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
    const useOpenprojectBridge =
      app.authMode === "openproject-bridge" &&
      app.linkTarget === "embedded" &&
      !options?.forceLogin;
    const useIdpBootstrap =
      app.authMode === "oidc" && app.linkTarget === "embedded" && !options?.forceLogin;
    const idpPopup = useIdpBootstrap ? openIdpBootstrapPopup() : null;
    const loadingPage =
      "data:text/html;charset=utf-8," +
      encodeURIComponent(
        "<!DOCTYPE html><html><head><meta charset='utf-8'></head><body style='font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#1a2e28'><p>Opening " +
          app.title.replace(/</g, "") +
          "…</p></body></html>",
      );
    void (async () => {
      const linkTarget = options?.forceLogin ? "newwindow" : app.linkTarget;
      const appUrl = buildAppLaunchUrl(appLaunchBase, {
        username: me?.username,
        linkTarget,
        authMode: app.authMode,
      });

      let launchUrl = appUrl;
      const needsBridgeTicket = useMatrixBridge || useNextcloudBridge || useOpenprojectBridge;
      const winId = crypto.randomUUID();
      if (needsBridgeTicket && !options?.forceLogin) {
        openWindow({
          id: winId,
          appId: app.id,
          title: app.title,
          url: loadingPage,
        });
      }

      document.body.style.cursor = "wait";
      try {
      if (useMatrixBridge) {
        const ticket = await fetchMatrixBridgeTicket();
        if (ticket) {
          launchUrl = matrixBridgeLaunchUrl(new URL(appUrl).origin, ticket);
        } else if (needsBridgeTicket) {
          closeWindow(winId);
          return;
        }
      } else if (useNextcloudBridge) {
        const ticket = await fetchNextcloudBridgeTicket();
        if (ticket) {
          const parsed = new URL(appUrl);
          launchUrl = nextcloudBridgeLaunchUrl(
            parsed.origin,
            ticket,
            parsed.searchParams.get("open"),
          );
        } else {
          if (needsBridgeTicket) closeWindow(winId);
          window.alert("Could not open Files. Try signing in again.");
          return;
        }
      } else if (useOpenprojectBridge) {
        const ticket = await fetchOpenprojectBridgeTicket();
        if (ticket) {
          launchUrl = openprojectBridgeLaunchUrl(new URL(appUrl).origin, ticket);
        } else {
          if (needsBridgeTicket) closeWindow(winId);
          if (!window.location.pathname.startsWith("/login")) {
            window.alert("Could not open Projects. Try signing in again.");
          }
          return;
        }
      } else if (useIdpBootstrap) {
        await prepareEmbeddedOidcSession(idpPopup);
      }

      if (needsBridgeTicket && !options?.forceLogin) {
        setWindowUrl(winId, launchUrl);
        return;
      }

      openWindow({
        id: winId,
        appId: app.id,
        title: app.title,
        url: launchUrl,
      });
      } finally {
        document.body.style.cursor = "";
      }
    })();
  }

  return (
    <div className="gentian-shell shell-surface relative min-h-full">
      <Background imageUrl={backgroundUrl} />
      <WindowManager />
      <AppMenu
        apps={apps}
        activeAppId={activeAppId}
        username={me?.username}
        onSelect={handleSelect}
        onOpenAccount={() => openBuiltinPanel("account", "Account", "account")}
        onOpenSettings={() => openBuiltinPanel("settings", "Settings", "settings")}
      />
    </div>
  );
}

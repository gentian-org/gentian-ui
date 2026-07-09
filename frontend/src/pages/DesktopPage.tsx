import { useEffect } from "react";
import { prepareEmbeddedOidcSession } from "@/auth/idpSession";
import { fetchMatrixBridgeTicket, matrixBridgeLaunchUrl } from "@/auth/matrixBridge";
import {
  fetchPortalBridgeTicket,
  portalBridgeLaunchUrl,
} from "@/auth/portalBridge";
import { AppMenu } from "@/shell/AppMenu";
import { Background } from "@/shell/Background";
import { useShellApps } from "@/shell/useShellApps";
import { useShellBackgroundUrl } from "@/shell/useShellBackground";
import { useAppsStore } from "@/stores/apps";
import { useWindowsStore } from "@/stores/windows";
import { usePrefsStore, type DesktopTile } from "@/stores/prefs";
import { buildAppLaunchUrl } from "@/lib/appLaunchUrl";
import { WindowManager } from "@/windows/WindowManager";
import { DesktopShortcuts } from "@/shell/DesktopShortcuts";

const GRID_X = 100;
const GRID_Y = 110;

function snapToGrid(x: number, y: number) {
  const minX = 20;
  const minY = 20;
  const snappedX = Math.max(minX, Math.round((x - minX) / GRID_X) * GRID_X + minX);
  const snappedY = Math.max(minY, Math.round((y - minY) / GRID_Y) * GRID_Y + minY);
  return { x: snappedX, y: snappedY };
}

export function DesktopPage() {
  const { me, apps } = useShellApps();
  const backgroundUrl = useShellBackgroundUrl();

  const activeAppId = useAppsStore((s) => s.activeAppId);
  const setActiveAppId = useAppsStore((s) => s.setActiveAppId);
  const windows = useWindowsStore((s) => s.windows);
  const openOrFocusWindow = useWindowsStore((s) => s.openOrFocusWindow);
  const focusWindow = useWindowsStore((s) => s.focusWindow);
  const openWindow = useWindowsStore((s) => s.openWindow);
  const closeWindow = useWindowsStore((s) => s.closeWindow);
  const setWindowUrl = useWindowsStore((s) => s.setWindowUrl);

  const loadPrefs = usePrefsStore((s) => s.loadPrefs);
  const customPrefs = usePrefsStore((s) => s.customPrefs);
  const updateCustomPrefs = usePrefsStore((s) => s.updateCustomPrefs);

  useEffect(() => {
    void loadPrefs();
  }, []);

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

  useEffect(() => {
    // Warm up Keycloak OIDC sessions silently in the background on load
    void prepareEmbeddedOidcSession(null);
  }, []);

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

  function handleSelect(
    app: (typeof apps)[number],
    options?: { forceLogin?: boolean; forceNewWindow?: boolean },
  ) {
    // Check if there is already an open window for this app, unless Ctrl+Click forces new tab
    if (!options?.forceNewWindow) {
      const existingWindow = windows.find((w) => w.appId === app.id);
      if (existingWindow) {
        focusWindow(existingWindow.id);
        setActiveAppId(app.id);
        return;
      }
    }

    setActiveAppId(app.id);
    if (app.builtin && app.id === "admin") {
      if (options?.forceNewWindow) {
        // Builtins can't run in separate browser tab directly without routing wrapper, so we focus or open normal
        openOrFocusWindow({
          id: "admin-console",
          appId: app.id,
          title: app.title,
          builtinComponent: "admin",
        });
      } else {
        openOrFocusWindow({
          id: "admin-console",
          appId: app.id,
          title: app.title,
          builtinComponent: "admin",
        });
      }
      return;
    }
    if (!app.launchUrl) {
      return;
    }
    const appLaunchBase = app.launchUrl;
    const useMatrixBridge =
      app.authMode === "matrix-bridge" && app.linkTarget === "embedded" && !options?.forceLogin;
    const usePortalBridge =
      app.authMode === "portal-bridge" &&
      app.linkTarget === "embedded" &&
      !options?.forceLogin;
    const useIdpBootstrap =
      app.authMode === "oidc" && app.linkTarget === "embedded" && !options?.forceLogin;
    
    // Silent bootstrap loader template
    const loadingPage =
      "data:text/html;charset=utf-8," +
      encodeURIComponent(
        "<!DOCTYPE html><html><head><meta charset='utf-8'></head><body style='font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#1a2e28'><p>Opening " +
          app.title.replace(/</g, "") +
          "…</p></body></html>",
      );

    void (async () => {
      const linkTarget = (options?.forceLogin || options?.forceNewWindow) ? "newwindow" : app.linkTarget;
      const appUrl = buildAppLaunchUrl(appLaunchBase, {
        username: me?.username,
        linkTarget,
        authMode: app.authMode,
      });

      let launchUrl = appUrl;

      // If opening in a new window/tab, redirect top-level or open window immediately
      const openInNewTab = options?.forceNewWindow || linkTarget === "newwindow";
      if (openInNewTab) {
        window.open(appUrl, "_blank");
        return;
      }

      const needsBridgeTicket = useMatrixBridge || usePortalBridge;
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
        } else if (usePortalBridge) {
          const ticket = await fetchPortalBridgeTicket();
          if (ticket) {
            const parsed = new URL(appUrl);
            launchUrl = portalBridgeLaunchUrl(
              parsed.origin,
              ticket,
              parsed.searchParams.get("open"),
            );
          } else {
            if (needsBridgeTicket) closeWindow(winId);
            window.alert(`Could not open ${app.title}. Try signing in again.`);
            return;
          }
        } else if (useIdpBootstrap) {
          await prepareEmbeddedOidcSession(null);
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

  function handleOpenLinkWindow(tile: DesktopTile) {
    if (!tile.url) return;
    openOrFocusWindow({
      id: `link-${tile.id}`,
      appId: `link-${tile.id}`,
      title: tile.title,
      url: tile.url,
    });
  }

  function handleDesktopDrop(e: React.DragEvent) {
    e.preventDefault();
    const containerRect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - containerRect.left;
    const y = e.clientY - containerRect.top;

    try {
      let rawData = e.dataTransfer.getData("application/json");
      if (!rawData) {
        rawData = e.dataTransfer.getData("text/plain");
      }
      if (!rawData) return;
      const data = JSON.parse(rawData);

      if (data.type === "app" || data.type === "menu-app") {
        if (data.type === "menu-app" && data.id.startsWith("link:")) {
          const tileId = data.id.substring(5);
          const snapped = snapToGrid(x - 46, y - 49);
          void updateCustomPrefs((prev) => {
            let nextMenuAppIds = prev.menuAppIds;
            if (nextMenuAppIds) {
              nextMenuAppIds = nextMenuAppIds.filter((id) => id !== data.id);
            }
            return {
              ...prev,
              desktopTiles: (prev.desktopTiles || []).map((t) =>
                t.id === tileId ? { ...t, position: snapped } : t
              ),
              menuAppIds: nextMenuAppIds,
            };
          });
          return;
        }

        const app = apps.find((a) => a.id === data.id);
        if (!app) return;

        const snapped = snapToGrid(x - 46, y - 49);

        // Check if there is already a shortcut for this app on the desktop
        const existing = (customPrefs.desktopTiles || []).find((t) => t.appId === app.id);
        if (existing) {
          void updateCustomPrefs((prev) => {
            let nextMenuAppIds = prev.menuAppIds;
            if (data.type === "menu-app" && nextMenuAppIds) {
              nextMenuAppIds = nextMenuAppIds.filter((id) => id !== app.id);
            }
            return {
              ...prev,
              desktopTiles: (prev.desktopTiles || []).map((t) =>
                t.id === existing.id ? { ...t, position: snapped } : t
              ),
              menuAppIds: nextMenuAppIds,
            };
          });
        } else {
          const newTile: DesktopTile = {
            id: crypto.randomUUID(),
            appId: app.id,
            type: "app",
            title: app.title,
            icon: app.icon,
            position: snapped,
          };
          void updateCustomPrefs((prev) => {
            let nextMenuAppIds = prev.menuAppIds;
            if (data.type === "menu-app" && nextMenuAppIds) {
              nextMenuAppIds = nextMenuAppIds.filter((id) => id !== app.id);
            }
            return {
              ...prev,
              desktopTiles: [...(prev.desktopTiles || []), newTile],
              menuAppIds: nextMenuAppIds,
            };
          });
        }
      } else if (data.type === "existing") {
        const snapped = snapToGrid(x - 46, y - 49);
        void updateCustomPrefs((prev) => ({
          ...prev,
          desktopTiles: (prev.desktopTiles || []).map((t) =>
            t.id === data.id ? { ...t, position: snapped } : t
          ),
        }));
      }
    } catch (err) {
      console.error("Failed to parse drag data:", err);
    }
  }

  return (
    <div
      className="gentian-shell shell-surface relative min-h-full"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDesktopDrop}
    >
      <Background imageUrl={backgroundUrl} />
      <DesktopShortcuts
        apps={apps}
        onSelectApp={handleSelect}
        onOpenLinkWindow={handleOpenLinkWindow}
      />
      <WindowManager />
      <AppMenu
        apps={apps}
        activeAppId={activeAppId}
        username={me?.username}
        onSelect={handleSelect}
        onOpenLinkWindow={handleOpenLinkWindow}
        onOpenAccount={() => openBuiltinPanel("account", "Account", "account")}
        onOpenSettings={() => openBuiltinPanel("settings", "Settings", "settings")}
      />
    </div>
  );
}

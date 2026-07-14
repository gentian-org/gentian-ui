import { useEffect, useState } from "react";
import { prepareEmbeddedOidcSession, openIdpBootstrapPopup } from "@/auth/idpSession";
import { fetchMatrixBridgeTicket, matrixBridgeLaunchUrl } from "@/auth/matrixBridge";
import {
  fetchPortalBridgeTicket,
  portalBridgeLaunchUrl,
} from "@/auth/portalBridge";
import { AccountPanel } from "@/account/AccountPanel";
import { AdminConsole } from "@/admin/AdminConsole";
import { AppMenu } from "@/shell/AppMenu";
import { Background } from "@/shell/Background";
import { MobileAppLayer } from "@/shell/MobileAppLayer";
import { useShellApps } from "@/shell/useShellApps";
import { useShellBackgroundUrl } from "@/shell/useShellBackground";
import { SettingsPanel } from "@/settings/SettingsPanel";
import { useAppsStore } from "@/stores/apps";
import { buildAppLaunchUrl } from "@/lib/appLaunchUrl";

type MobileOverlay = "admin" | "account" | "settings" | null;

export function MobilePage() {
  const { me, apps } = useShellApps();
  const backgroundUrl = useShellBackgroundUrl();

  const activeAppId = useAppsStore((s) => s.activeAppId);
  const setActiveAppId = useAppsStore((s) => s.setActiveAppId);

  const activeApp = apps.find((app) => app.id === activeAppId) ?? null;
  const [overlay, setOverlay] = useState<MobileOverlay>(null);
  const [activeLaunchUrl, setActiveLaunchUrl] = useState<string | null>(null);

  useEffect(() => {
    if (activeAppId === "admin") {
      setOverlay("admin");
    } else if (activeAppId === "account") {
      setOverlay("account");
    } else if (activeAppId === "settings") {
      setOverlay("settings");
    } else if (!activeApp?.launchUrl) {
      setOverlay(null);
    }
  }, [activeApp?.launchUrl, activeAppId]);

  useEffect(() => {
    if (!activeApp?.launchUrl || overlay) {
      if (overlay) {
        setActiveLaunchUrl(null);
      }
      return;
    }

    const useMatrixBridge =
      activeApp.authMode === "matrix-bridge" && activeApp.linkTarget === "embedded";
    const usePortalBridge =
      activeApp.authMode === "portal-bridge" && activeApp.linkTarget === "embedded";

    void (async () => {
      const launchBase = activeApp.launchUrl;
      if (!launchBase) {
        setActiveLaunchUrl(null);
        return;
      }

      const appUrl = buildAppLaunchUrl(launchBase, {
        username: me?.username,
        linkTarget: activeApp.linkTarget,
        authMode: activeApp.authMode,
      });

      let launchUrl = appUrl;
      if (useMatrixBridge) {
        const ticket = await fetchMatrixBridgeTicket();
        if (ticket) {
          launchUrl = matrixBridgeLaunchUrl(new URL(appUrl).origin, ticket);
        }
      } else if (usePortalBridge) {
        const ticket = await fetchPortalBridgeTicket();
        if (ticket) {
          const parsed = new URL(appUrl);
          launchUrl = portalBridgeLaunchUrl(
            parsed.origin,
            ticket,
            parsed.searchParams.get("open"),
            parsed.searchParams.get("app"),
          );
        } else {
          return;
        }
      }

      setActiveLaunchUrl(launchUrl);
    })();
  }, [activeApp, me?.username, overlay]);

  function handleSelect(app: (typeof apps)[number]) {
    setActiveAppId(app.id);
    if (app.id === "admin") {
      setOverlay("admin");
      return;
    }
    if (app.authMode === "oidc" && app.linkTarget === "embedded") {
      // Open the 1x1 off-screen popup during the user gesture to avoid popup blockers,
      // and use it to bootstrap the first-party Keycloak session on mobile.
      const popup = openIdpBootstrapPopup();
      void prepareEmbeddedOidcSession(popup);
    }
  }

  function openOverlay(panel: MobileOverlay) {
    if (panel) {
      setActiveAppId(panel);
      setOverlay(panel);
    }
  }

  function closeOverlay() {
    setOverlay(null);
    setActiveAppId(null);
  }

  return (
    <div className="gentian-shell shell-surface relative min-h-full">
      <Background imageUrl={backgroundUrl} />
      {overlay === "admin" && (
        <div className="relative z-20">
          <AdminConsole />
        </div>
      )}
      {overlay === "account" && (
        <div className="fixed inset-0 z-20 overflow-auto bg-[var(--gtn-paper-3)]">
          <AccountPanel />
        </div>
      )}
      {overlay === "settings" && (
        <div className="fixed inset-0 z-20 overflow-auto bg-[var(--gtn-paper-3)]">
          <SettingsPanel />
        </div>
      )}
      {!activeAppId && !overlay && (
        <div className="gentian-mobile__welcome" aria-live="polite">
          <p className="gentian-mobile__welcome-text">Tap an app below to get started</p>
        </div>
      )}
      {activeLaunchUrl && !overlay && (
        <MobileAppLayer url={activeLaunchUrl} title={activeApp?.title ?? "App"} />
      )}
      <AppMenu
        apps={apps}
        activeAppId={activeAppId}
        username={me?.username}
        onSelect={handleSelect}
        onOpenAccount={() => openOverlay("account")}
        onOpenSettings={() => openOverlay("settings")}
      />
      {overlay && overlay !== "admin" && (
        <button
          type="button"
          className="fixed top-4 right-4 z-30 shell-panel__btn"
          onClick={closeOverlay}
        >
          Close
        </button>
      )}
    </div>
  );
}

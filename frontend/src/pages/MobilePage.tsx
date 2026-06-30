import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, type PrefsResponse } from "@/api/client";
import { openIdpBootstrapPopup, prepareEmbeddedOidcSession } from "@/auth/idpSession";
import { fetchMatrixBridgeTicket, matrixBridgeLaunchUrl } from "@/auth/matrixBridge";
import {
  fetchNextcloudBridgeTicket,
  nextcloudBridgeLaunchUrl,
} from "@/auth/nextcloudBridge";
import { AdminConsole } from "@/admin/AdminConsole";
import { AppMenu } from "@/shell/AppMenu";
import { Background } from "@/shell/Background";
import { MobileAppLayer } from "@/shell/MobileAppLayer";
import { useShellApps } from "@/shell/useShellApps";
import { useAppsStore } from "@/stores/apps";
import { buildAppLaunchUrl } from "@/lib/appLaunchUrl";

export function MobilePage() {
  const { me, apps } = useShellApps();

  const { data: prefs } = useQuery({
    queryKey: ["prefs"],
    queryFn: () => apiFetch<PrefsResponse>("/prefs/"),
  });

  const activeAppId = useAppsStore((s) => s.activeAppId);
  const setActiveAppId = useAppsStore((s) => s.setActiveAppId);

  const activeApp = apps.find((app) => app.id === activeAppId) ?? null;
  const adminOpen = activeAppId === "admin";
  const [activeLaunchUrl, setActiveLaunchUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!activeApp?.launchUrl) {
      setActiveLaunchUrl(null);
      return;
    }

    const useMatrixBridge =
      activeApp.authMode === "matrix-bridge" && activeApp.linkTarget === "embedded";
    const useNextcloudBridge =
      activeApp.authMode === "nextcloud-bridge" && activeApp.linkTarget === "embedded";

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
      } else if (useNextcloudBridge) {
        const ticket = await fetchNextcloudBridgeTicket();
        if (ticket) {
          launchUrl = nextcloudBridgeLaunchUrl(new URL(appUrl).origin, ticket);
        } else {
          return;
        }
      }

      setActiveLaunchUrl(launchUrl);
    })();
  }, [activeApp, me?.username]);

  function handleSelect(app: (typeof apps)[number]) {
    setActiveAppId(app.id);
    if (app.authMode === "oidc" && app.linkTarget === "embedded") {
      const popup = openIdpBootstrapPopup();
      void prepareEmbeddedOidcSession(popup);
    }
  }

  return (
    <div className="gentian-shell shell-surface relative min-h-full">
      <Background imageUrl={prefs?.backgroundUrl} />
      {adminOpen && (
        <div className="relative z-20">
          <AdminConsole />
        </div>
      )}
      {!activeAppId && (
        <div className="gentian-mobile__welcome" aria-live="polite">
          <p className="gentian-mobile__welcome-text">Tap an app below to get started</p>
        </div>
      )}
      {activeLaunchUrl && (
        <MobileAppLayer url={activeLaunchUrl} title={activeApp?.title ?? "App"} />
      )}
      <AppMenu
        apps={apps}
        activeAppId={activeAppId}
        username={me?.username}
        onSelect={handleSelect}
      />
    </div>
  );
}

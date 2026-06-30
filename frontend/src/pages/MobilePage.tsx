import { useQuery } from "@tanstack/react-query";
import { apiFetch, type PrefsResponse } from "@/api/client";
import { bootstrapIdpSession } from "@/auth/idpSession";
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
  const activeLaunchUrl =
    activeApp?.launchUrl && me?.username
      ? buildAppLaunchUrl(activeApp.launchUrl, {
          username: me.username,
          linkTarget: activeApp.linkTarget,
          authMode: activeApp.authMode,
        })
      : activeApp?.launchUrl ?? null;

  function handleSelect(app: (typeof apps)[number]) {
    setActiveAppId(app.id);
    void bootstrapIdpSession();
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

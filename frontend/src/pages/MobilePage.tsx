import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { apiFetch, type AppsResponse, type MeResponse, type PrefsResponse } from "@/api/client";
import { AppMenu } from "@/shell/AppMenu";
import { Background } from "@/shell/Background";
import { MobileAppLayer } from "@/shell/MobileAppLayer";
import { UserMenu } from "@/shell/UserMenu";
import { SettingsPanel } from "@/settings/SettingsPanel";

export function MobilePage() {
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
  const [activeAppId, setActiveAppId] = useState<string | null>(null);

  const activeApp = useMemo(
    () => apps.find((a) => a.id === activeAppId) ?? null,
    [apps, activeAppId],
  );

  function handleSelect(app: (typeof apps)[number]) {
    setActiveAppId(app.id);
  }

  const showSettings = activeAppId === "settings";

  return (
    <div className="gentian-shell relative min-h-full pb-24">
      <Background imageUrl={prefs?.backgroundUrl} />
      {me && (
        <UserMenu username={me.username} onLogout={() => (window.location.href = "/login")} />
      )}
      {!activeAppId && (
        <div className="flex min-h-full items-center justify-center p-8 text-center text-white/90">
          <p>Tap an app below to get started</p>
        </div>
      )}
      {showSettings && (
        <div className="relative z-20 p-4 pt-16">
          <SettingsPanel />
        </div>
      )}
      {!showSettings && activeApp?.launchUrl && (
        <MobileAppLayer url={activeApp.launchUrl} title={activeApp.title} />
      )}
      <AppMenu mode="mobile" apps={apps} activeAppId={activeAppId} onSelect={handleSelect} />
    </div>
  );
}

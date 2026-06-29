import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { apiFetch, type AppsResponse, type MeResponse, type PrefsResponse } from "@/api/client";
import { AppMenu } from "@/shell/AppMenu";
import { Background } from "@/shell/Background";
import { MobileAppLayer } from "@/shell/MobileAppLayer";
export function MobilePage() {
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<MeResponse>("/session/me"),
  });
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

  return (
    <div className="gentian-shell shell-surface relative min-h-full">
      <Background imageUrl={prefs?.backgroundUrl} />
      {!activeAppId && (
        <div className="gentian-mobile__welcome" aria-live="polite">
          <p className="gentian-mobile__welcome-text">Tap an app below to get started</p>
        </div>
      )}
      {activeApp?.launchUrl && (
        <MobileAppLayer url={activeApp.launchUrl} title={activeApp.title} />
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

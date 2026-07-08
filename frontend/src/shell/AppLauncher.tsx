import type { ShellApp } from "@/api/client";
import { tileIconUrl } from "@/lib/tiles";
import { usePrefsStore } from "@/stores/prefs";

type AppLauncherProps = {
  apps: ShellApp[];
  onSelect: (app: ShellApp, options?: { forceNewWindow?: boolean }) => void;
  onClose: () => void;
};

export function AppLauncher({ apps, onSelect, onClose }: AppLauncherProps) {
  const tileCustomizations = usePrefsStore((s) => s.customPrefs.tileCustomizations || {});

  return (
    <div
      className="app-launcher"
      role="dialog"
      aria-label="Apps"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="app-launcher__panel">
        <div className="app-launcher__grid">
          {apps.map((app) => {
            const custom = tileCustomizations[app.id];
            const displayTitle = custom?.title || app.title;
            const displayIcon = custom?.icon || app.icon;

            return (
              <button
                key={app.id}
                type="button"
                className="app-launcher__tile"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    "application/json",
                    JSON.stringify({ type: "app", id: app.id }),
                  );
                }}
                onClick={(e) => {
                  const forceNewWindow = e.ctrlKey || e.metaKey;
                  onSelect(app, { forceNewWindow });
                  onClose();
                }}
              >
                <img
                  className="app-launcher__icon"
                  src={displayIcon.startsWith("data:") ? displayIcon : tileIconUrl(displayIcon)}
                  alt=""
                  draggable={false}
                />
                <span className="app-launcher__label">{displayTitle}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

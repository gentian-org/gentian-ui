import type { ShellApp } from "@/api/client";
import { tileIconUrl } from "@/lib/tiles";

type AppLauncherProps = {
  apps: ShellApp[];
  onSelect: (app: ShellApp) => void;
  onClose: () => void;
};

export function AppLauncher({ apps, onSelect, onClose }: AppLauncherProps) {
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
          {apps.map((app) => (
            <button
              key={app.id}
              type="button"
              className="app-launcher__tile"
              onClick={() => {
                onSelect(app);
                onClose();
              }}
            >
              <img
                className="app-launcher__icon"
                src={tileIconUrl(app.icon)}
                alt=""
              />
              <span className="app-launcher__label">{app.title}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

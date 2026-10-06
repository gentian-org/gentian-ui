import type { ShellApp } from "@/api/client";
import { tileIconUrl } from "@/lib/tiles";
import { usePrefsStore } from "@/stores/prefs";

import { useTranslation } from "react-i18next";
type AppLauncherProps = {
  apps: ShellApp[];
  onSelect: (app: ShellApp, options?: { forceNewWindow?: boolean }) => void;
  onClose: () => void;
  /** The session request failed, so `apps` is empty for lack of an answer. */
  loadFailed?: boolean;
  onReload?: () => void;
};

export function AppLauncher({ apps, onSelect, onClose, loadFailed, onReload }: AppLauncherProps) {
  const { t } = useTranslation();
  const customizations = usePrefsStore((s) => s.customPrefs.tileCustomizations);

  return (
    <div
      className="app-launcher"
      role="dialog"
      aria-label={t("shell.apps")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="app-launcher__panel">
        {loadFailed ? (
          <div className="app-launcher__status" role="alert">
            <p className="app-launcher__status-title">{t("shell.appsLoadFailed")}</p>
            <p className="app-launcher__status-detail">
              The portal could not reach the session service. This is a connection
              problem, not a change to your access.
            </p>
            {onReload ? (
              <button type="button" className="app-launcher__retry" onClick={() => onReload()}>
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
        {!loadFailed && apps.length === 0 ? (
          <div className="app-launcher__status">
            <p className="app-launcher__status-title">{t("shell.appsEmpty")}</p>
            <p className="app-launcher__status-detail">
              Ask your tenant administrator to grant you access to an app.
            </p>
          </div>
        ) : null}
        <div className="app-launcher__grid">
          {apps.map((app) => {
            const custom = customizations?.[app.id];
            const displayTitle = custom?.title || app.title;
            const displayIcon = custom?.icon || app.icon;

            return (
              <button
                key={app.id}
                type="button"
                className="app-launcher__tile"
                draggable
                onDragStart={(e) => {
                  const payload = JSON.stringify({ type: "app", id: app.id });
                  e.dataTransfer.setData("application/json", payload);
                  e.dataTransfer.setData("text/plain", payload);
                  e.dataTransfer.effectAllowed = "copyMove";
                  // Close the launcher so its full-screen overlay doesn't block
                  // the subsequent dragover/drop events on the desktop and menu bar.
                  // The drag ghost remains active after the launcher unmounts.
                  setTimeout(onClose, 0);
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

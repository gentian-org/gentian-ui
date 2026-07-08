import type { ShellApp } from "@/api/client";
import { tileIconUrl } from "@/lib/tiles";
import { usePrefsStore } from "@/stores/prefs";

type AppMenuSlotProps = {
  app: ShellApp;
  isActive: boolean;
  onSelect: (app: ShellApp, options?: { forceNewWindow?: boolean }) => void;
};

export function AppMenuSlot({ app, isActive, onSelect }: AppMenuSlotProps) {
  const tileCustomizations = usePrefsStore((s) => s.customPrefs.tileCustomizations || {});
  const custom = tileCustomizations[app.id];
  const displayTitle = custom?.title || app.title;
  const displayIcon = custom?.icon || app.icon;

  return (
    <button
      type="button"
      className={`app-menu-slot${isActive ? " app-menu-slot--active" : ""}`}
      aria-label={displayTitle}
      title={displayTitle}
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
      }}
    >
      <img
        className="app-menu-slot__icon"
        src={displayIcon.startsWith("data:") ? displayIcon : tileIconUrl(displayIcon)}
        alt=""
        draggable={false}
      />
    </button>
  );
}

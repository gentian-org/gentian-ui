import type { ShellApp } from "@/api/client";
import { tileIconUrl } from "@/lib/tiles";

type AppMenuSlotProps = {
  app: ShellApp;
  isActive: boolean;
  onSelect: (app: ShellApp) => void;
};

export function AppMenuSlot({ app, isActive, onSelect }: AppMenuSlotProps) {
  return (
    <button
      type="button"
      className={`app-menu-slot${isActive ? " app-menu-slot--active" : ""}`}
      aria-label={app.title}
      title={app.title}
      onClick={() => onSelect(app)}
    >
      <img className="app-menu-slot__icon" src={tileIconUrl(app.icon)} alt="" />
    </button>
  );
}

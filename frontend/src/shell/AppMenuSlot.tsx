import { useEffect, useState } from "react";
import type { ShellApp } from "@/api/client";
import { tileIconUrl } from "@/lib/tiles";
import { usePrefsStore } from "@/stores/prefs";
import type { MenuItem } from "@/shell/AppMenu";

type AppMenuSlotProps = {
  item: MenuItem;
  isActive: boolean;
  onSelect: (app: ShellApp, options?: { forceNewWindow?: boolean }) => void;
  onUnpin: () => void;
};

export function AppMenuSlot({ item, isActive, onSelect, onUnpin }: AppMenuSlotProps) {
  const customizations = usePrefsStore((s) => s.customPrefs.tileCustomizations);
  const custom = item.isLink ? null : customizations?.[item.id];
  const displayTitle = custom?.title || item.title;
  const displayIcon = custom?.icon || item.icon;

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }

  useEffect(() => {
    if (!contextMenu) return;
    function closeMenu() {
      setContextMenu(null);
    }
    document.addEventListener("click", closeMenu);
    return () => document.removeEventListener("click", closeMenu);
  }, [contextMenu]);

  return (
    <div
      className="app-menu-slot"
      data-id={item.id}
      style={{ position: "relative", display: "inline-block" }}
    >
      <button
        type="button"
        className={`app-menu-slot-btn${isActive ? " app-menu-slot--active" : ""}`}
        aria-label={displayTitle}
        title={displayTitle}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(
            "application/json",
            JSON.stringify({ type: "menu-app", id: item.id }),
          );
        }}
        onContextMenu={handleContextMenu}
        onClick={(e) => {
          const forceNewWindow = e.ctrlKey || e.metaKey;
          onSelect(item.app as ShellApp, { forceNewWindow });
        }}
        style={{
          width: "var(--app-menu-slot-width, 44px)",
          height: "var(--app-menu-slot-size, 40px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          borderRadius: "var(--gtn-r1)",
          cursor: "pointer",
        }}
      >
        <img
          className="app-menu-slot__icon"
          src={displayIcon.startsWith("data:") ? displayIcon : tileIconUrl(displayIcon)}
          alt=""
          draggable={false}
          style={{
            width: "var(--app-menu-slot-size, 40px)",
            height: "var(--app-menu-slot-size, 40px)",
            borderRadius: "var(--gtn-r1)",
            objectFit: "cover",
          }}
        />
      </button>

      {contextMenu && (
        <div
          className="desktop-context-menu"
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y - 45, // offset up to display above bottom bar
            zIndex: 1000,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setContextMenu(null);
              onUnpin();
            }}
          >
            Unpin from menu bar
          </button>
        </div>
      )}
    </div>
  );
}

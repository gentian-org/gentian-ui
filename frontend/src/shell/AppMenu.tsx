import { useEffect, useRef, useState } from "react";
import type { ShellApp } from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import { AppLauncher } from "@/shell/AppLauncher";
import { AppMenuSlot } from "@/shell/AppMenuSlot";
import { NotificationInbox } from "@/shell/NotificationInbox";
import { AiWidget } from "@/shell/AiWidget";
import { AppsGridIcon, MenuIcon, TrayButton } from "@/shell/TrayButton";
import { usePrefsStore, type DesktopTile } from "@/stores/prefs";

type AppMenuProps = {
  apps: ShellApp[];
  activeAppId: string | null;
  username?: string;
  onSelect: (app: ShellApp, options?: { forceNewWindow?: boolean }) => void;
  onOpenLinkWindow?: (tile: DesktopTile) => void;
  onOpenAccount?: () => void;
  onOpenSettings?: () => void;
};

export type MenuItem = {
  id: string;
  title: string;
  icon: string;
  isLink: boolean;
  url?: string;
  openMode?: "iframe" | "tab";
  app?: ShellApp;
};

export function AppMenu({
  apps,
  activeAppId,
  username,
  onSelect,
  onOpenLinkWindow,
  onOpenAccount,
  onOpenSettings,
}: AppMenuProps) {
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  // dragOverIndex: insertion position (0 = before first slot, N = after last slot)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const { logout } = useAuth();

  const menuAppIds = usePrefsStore((s) => s.customPrefs.menuAppIds);
  const updateCustomPrefs = usePrefsStore((s) => s.updateCustomPrefs);
  const desktopTiles = usePrefsStore((s) => s.customPrefs.desktopTiles) || [];

  const visibleItems: MenuItem[] = menuAppIds
    ? menuAppIds
        .map((id): MenuItem | null => {
          if (id.startsWith("link:")) {
            const tileId = id.substring(5);
            const tile = desktopTiles.find((t) => t.id === tileId);
            if (tile) {
              return {
                id,
                title: tile.title,
                icon: tile.icon,
                isLink: true,
                url: tile.url,
                openMode: tile.openMode,
              };
            }
            return null;
          } else {
            const app = apps.find((a) => a.id === id);
            if (app) {
              return {
                id: app.id,
                title: app.title,
                icon: app.icon,
                isLink: false,
                app,
              };
            }
            return null;
          }
        })
        .filter((item): item is MenuItem => item !== null)
    : apps.map((app) => ({
        id: app.id,
        title: app.title,
        icon: app.icon,
        isLink: false,
        app,
      }));

  useEffect(() => {
    if (!userMenuOpen) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [userMenuOpen]);

  function closeUserMenu() {
    setUserMenuOpen(false);
  }

  /** Compute which insertion index (0..N) corresponds to the current mouse X in the track. */
  function computeDropIndex(clientX: number): number {
    if (!trackRef.current) return visibleItems.length;
    const slots = Array.from(trackRef.current.querySelectorAll<HTMLElement>(".app-menu-slot"));
    for (let i = 0; i < slots.length; i++) {
      const rect = slots[i].getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      if (clientX < mid) return i;
    }
    return slots.length;
  }

  function handleTrackDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(computeDropIndex(e.clientX));
  }

  function handleTrackDragLeave(e: React.DragEvent) {
    e.stopPropagation();
    // Only clear if leaving the track entirely (not entering a child)
    if (!trackRef.current?.contains(e.relatedTarget as Node)) {
      setDragOverIndex(null);
    }
  }

  function handleTrackDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      let rawData = e.dataTransfer.getData("application/json");
      if (!rawData) {
        rawData = e.dataTransfer.getData("text/plain");
      }
      if (!rawData) return;
      const data = JSON.parse(rawData);

      // Compute insertion index from pointer position
      const insertAt = computeDropIndex(e.clientX);

      if (data.type === "app") {
        // Drag from app launcher → quick bar: COPY (app stays in launcher)
        const itemId = data.id;

        void updateCustomPrefs((prev) => {
          const currentIds = [...(prev.menuAppIds || apps.map((a) => a.id))];
          const existingIdx = currentIds.indexOf(itemId);
          let adjustedInsert = insertAt;
          if (existingIdx !== -1) {
            currentIds.splice(existingIdx, 1);
            if (existingIdx < adjustedInsert) adjustedInsert--;
          }
          currentIds.splice(Math.min(adjustedInsert, currentIds.length), 0, itemId);
          return { ...prev, menuAppIds: currentIds };
        });
      } else if (data.type === "existing") {
        // Drag from desktop → quick bar: MOVE (remove desktop tile, pin to bar)
        const tile = desktopTiles.find((t) => t.id === data.id);
        if (!tile) return;
        const itemId = tile.type === "app" && tile.appId ? tile.appId : `link:${tile.id}`;

        void updateCustomPrefs((prev) => {
          const currentIds = [...(prev.menuAppIds || apps.map((a) => a.id))];
          const existingIdx = currentIds.indexOf(itemId);
          let adjustedInsert = insertAt;
          if (existingIdx !== -1) {
            currentIds.splice(existingIdx, 1);
            if (existingIdx < adjustedInsert) adjustedInsert--;
          }
          currentIds.splice(Math.min(adjustedInsert, currentIds.length), 0, itemId);
          // Remove from desktop (MOVE semantics)
          const nextDesktopTiles = (prev.desktopTiles || []).filter((t) => t.id !== data.id);
          return { ...prev, menuAppIds: currentIds, desktopTiles: nextDesktopTiles };
        });
      } else if (data.type === "menu-app") {
        // Reordering existing slot inside the menu bar
        const dragId = data.id;

        void updateCustomPrefs((prev) => {
          const currentIds = [...(prev.menuAppIds || apps.map((a) => a.id))];
          const dragIdx = currentIds.indexOf(dragId);
          if (dragIdx === -1) return prev;

          let adjustedInsert = insertAt;
          currentIds.splice(dragIdx, 1);
          if (dragIdx < adjustedInsert) adjustedInsert--;
          currentIds.splice(Math.min(adjustedInsert, currentIds.length), 0, dragId);

          return {
            ...prev,
            menuAppIds: currentIds,
          };
        });
      }
    } catch (err) {
      console.error("Failed to handle track drop:", err);
    } finally {
      setDragOverIndex(null);
    }
  }

  function handleUnpin(itemId: string) {
    void updateCustomPrefs((prev) => {
      const currentIds = prev.menuAppIds || apps.map((a) => a.id);
      return {
        ...prev,
        menuAppIds: currentIds.filter((id) => id !== itemId),
      };
    });
  }

  return (
    <>
      <nav className="app-menu" aria-label="App launcher">
        <button
          type="button"
          className="app-menu__apps-btn"
          aria-label="Apps"
          aria-expanded={launcherOpen}
          onClick={() => setLauncherOpen(true)}
        >
          <AppsGridIcon />
        </button>

        <div
          ref={trackRef}
          className="app-menu__track"
          onDragOver={handleTrackDragOver}
          onDragLeave={handleTrackDragLeave}
          onDrop={handleTrackDrop}
        >
          {visibleItems.map((item, idx) => (
            <>
              {/* Drop indicator: rendered before each slot when dragging */}
              {dragOverIndex === idx && (
                <div className="app-menu__drop-indicator" key={`indicator-${idx}`} />
              )}
              {item.id === "open-webui-open-webui" ? (
                <div
                  key={item.id}
                  className="app-menu-slot"
                  data-id={item.id}
                  draggable
                  onDragStart={(e) => {
                    const payload = JSON.stringify({ type: "menu-app", id: item.id });
                    e.dataTransfer.setData("application/json", payload);
                    e.dataTransfer.setData("text/plain", payload);
                    e.dataTransfer.effectAllowed = "copyMove";
                  }}
                  style={{ display: "inline-block", verticalAlign: "top" }}
                >
                  <AiWidget
                    isDesktop={false}
                    onExpand={(prompt) => {
                      if (item.app) {
                        const app = { ...item.app };
                        if (prompt && app.launchUrl) {
                          const separator = app.launchUrl.includes("?") ? "&" : "?";
                          app.launchUrl += `${separator}q=${encodeURIComponent(prompt)}`;
                        }
                        onSelect(app);
                      }
                    }}
                  />
                </div>
              ) : (
                <AppMenuSlot
                  key={item.id}
                  item={item}
                  isActive={item.isLink ? false : activeAppId === item.id}
                  onSelect={(_app, options) => {
                    if (item.isLink && item.url) {
                      if (item.openMode === "tab" || options?.forceNewWindow || !onOpenLinkWindow) {
                        window.open(item.url, "_blank");
                      } else {
                        onOpenLinkWindow({
                          id: item.id.substring(5),
                          type: "link",
                          title: item.title,
                          icon: item.icon,
                          url: item.url,
                          openMode: item.openMode,
                          position: { x: 0, y: 0 },
                        });
                      }
                    } else if (item.app) {
                      onSelect(item.app, options);
                    }
                  }}
                  onUnpin={() => handleUnpin(item.id)}
                />
              )}
            </>
          ))}
          {/* Drop indicator at the end of the list */}
          {dragOverIndex === visibleItems.length && (
            <div className="app-menu__drop-indicator" />
          )}
        </div>

        <div className="app-menu__tray" ref={menuRef}>
          <NotificationInbox />
          <TrayButton
            label={username ? `Menu (${username})` : "Menu"}
            onClick={() => setUserMenuOpen((v) => !v)}
          >
            <MenuIcon />
          </TrayButton>

          {userMenuOpen && (
            <div className="user-menu" role="menu">
              {username && <p className="user-menu__label">{username}</p>}
              <button
                type="button"
                role="menuitem"
                className="user-menu__item"
                onClick={() => {
                  closeUserMenu();
                  onOpenAccount?.();
                }}
              >
                Account
              </button>
              <button
                type="button"
                role="menuitem"
                className="user-menu__item"
                onClick={() => {
                  closeUserMenu();
                  onOpenSettings?.();
                }}
              >
                Settings
              </button>
              <div className="user-menu__separator" />
              <button
                type="button"
                role="menuitem"
                className="user-menu__item user-menu__item--bold"
                onClick={() => {
                  closeUserMenu();
                  logout();
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </nav>

      {launcherOpen && (
        <AppLauncher apps={apps} onSelect={onSelect} onClose={() => setLauncherOpen(false)} />
      )}
    </>
  );
}

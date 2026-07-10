import { useEffect, useRef, useState } from "react";
import type { ShellApp } from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import { AppLauncher } from "@/shell/AppLauncher";
import { AppMenuSlot } from "@/shell/AppMenuSlot";
import { NotificationInbox } from "@/shell/NotificationInbox";
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

  function handleTrackDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleTrackDrop(e: React.DragEvent) {
    e.preventDefault();
    try {
      let rawData = e.dataTransfer.getData("application/json");
      if (!rawData) {
        rawData = e.dataTransfer.getData("text/plain");
      }
      if (!rawData) return;
      const data = JSON.parse(rawData);

      if (data.type === "app" || data.type === "existing") {
        const itemId = data.type === "app"
          ? data.id
          : (() => {
              const tile = desktopTiles.find((t) => t.id === data.id);
              return tile ? (tile.type === "app" && tile.appId ? tile.appId : `link:${tile.id}`) : null;
            })();
        if (!itemId) return;

        // Check if dropped on a specific menu item slot
        const targetElement = (e.target as HTMLElement).closest(".app-menu-slot");
        const targetId = targetElement ? targetElement.getAttribute("data-id") : null;

        void updateCustomPrefs((prev) => {
          const currentIds = [...(prev.menuAppIds || apps.map((a) => a.id))];

          // If it already exists in the menu, remove it so we can insert/reposition it
          const existingIdx = currentIds.indexOf(itemId);
          if (existingIdx !== -1) {
            currentIds.splice(existingIdx, 1);
          }

          if (targetId) {
            const targetIdx = currentIds.indexOf(targetId);
            if (targetIdx !== -1) {
              currentIds.splice(targetIdx, 0, itemId);
            } else {
              currentIds.push(itemId);
            }
          } else {
            currentIds.push(itemId);
          }

          // If the item was dragged from the desktop ("existing"), we keep it in desktopTiles
          // so its metadata is preserved, but it is filtered out of DesktopShortcuts rendering
          // since its ID is now in menuAppIds.
          const nextDesktopTiles = prev.desktopTiles || [];

          return {
            ...prev,
            desktopTiles: nextDesktopTiles,
            menuAppIds: currentIds,
          };
        });
      } else if (data.type === "menu-app") {
        // Dragging existing slot inside the menu bar to reorder
        const dragId = data.id;
        const targetElement = (e.target as HTMLElement).closest(".app-menu-slot");
        if (!targetElement) return;
        const targetId = targetElement.getAttribute("data-id");
        if (!targetId || targetId === dragId) return;

        void updateCustomPrefs((prev) => {
          const currentIds = [...(prev.menuAppIds || apps.map((a) => a.id))];
          const dragIdx = currentIds.indexOf(dragId);
          const targetIdx = currentIds.indexOf(targetId);
          if (dragIdx === -1 || targetIdx === -1) return prev;

          currentIds.splice(dragIdx, 1);
          currentIds.splice(targetIdx, 0, dragId);

          return {
            ...prev,
            menuAppIds: currentIds,
          };
        });
      }
    } catch (err) {
      console.error("Failed to handle track drop:", err);
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
          className="app-menu__track"
          onDragOver={handleTrackDragOver}
          onDrop={handleTrackDrop}
        >
          {visibleItems.map((item) => (
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
          ))}
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

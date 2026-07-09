import { useEffect, useRef, useState } from "react";
import type { ShellApp } from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import { AppLauncher } from "@/shell/AppLauncher";
import { AppMenuSlot } from "@/shell/AppMenuSlot";
import { NotificationInbox } from "@/shell/NotificationInbox";
import { AppsGridIcon, MenuIcon, TrayButton } from "@/shell/TrayButton";
import { usePrefsStore } from "@/stores/prefs";

type AppMenuProps = {
  apps: ShellApp[];
  activeAppId: string | null;
  username?: string;
  onSelect: (app: ShellApp, options?: { forceNewWindow?: boolean }) => void;
  onOpenAccount?: () => void;
  onOpenSettings?: () => void;
};

export function AppMenu({
  apps,
  activeAppId,
  username,
  onSelect,
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

  // If menuAppIds is defined, show only those apps in specified order.
  // Otherwise, show all apps by default.
  const visibleApps = menuAppIds
    ? menuAppIds
        .map((id) => apps.find((a) => a.id === id))
        .filter((a): a is ShellApp => Boolean(a))
    : apps;

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
      const rawData = e.dataTransfer.getData("application/json");
      if (!rawData) return;
      const data = JSON.parse(rawData);

      if (data.type === "app") {
        const appId = data.id;
        void updateCustomPrefs((prev) => {
          const currentIds = prev.menuAppIds || apps.map((a) => a.id);
          if (currentIds.includes(appId)) return prev;
          return {
            ...prev,
            menuAppIds: [...currentIds, appId],
          };
        });
      } else if (data.type === "existing") {
        const tileId = data.id;
        const tile = desktopTiles.find((t) => t.id === tileId);
        if (tile && tile.type === "app" && tile.appId) {
          const appId = tile.appId;
          void updateCustomPrefs((prev) => {
            const currentIds = prev.menuAppIds || apps.map((a) => a.id);
            if (currentIds.includes(appId)) return prev;
            return {
              ...prev,
              menuAppIds: [...currentIds, appId],
            };
          });
        }
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

  function handleUnpin(appId: string) {
    void updateCustomPrefs((prev) => {
      const currentIds = prev.menuAppIds || apps.map((a) => a.id);
      return {
        ...prev,
        menuAppIds: currentIds.filter((id) => id !== appId),
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
          {visibleApps.map((app) => (
            <AppMenuSlot
              key={app.id}
              app={app}
              isActive={activeAppId === app.id}
              onSelect={onSelect}
              onUnpin={() => handleUnpin(app.id)}
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

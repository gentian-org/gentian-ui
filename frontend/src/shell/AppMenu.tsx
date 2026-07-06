import { useEffect, useRef, useState } from "react";
import type { ShellApp } from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import { AppLauncher } from "@/shell/AppLauncher";
import { AppMenuSlot } from "@/shell/AppMenuSlot";
import { NotificationInbox } from "@/shell/NotificationInbox";
import { AppsGridIcon, MenuIcon, TrayButton } from "@/shell/TrayButton";

type AppMenuProps = {
  apps: ShellApp[];
  activeAppId: string | null;
  username?: string;
  onSelect: (app: ShellApp) => void;
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

        <div className="app-menu__track">
          {apps.map((app) => (
            <AppMenuSlot
              key={app.id}
              app={app}
              isActive={activeAppId === app.id}
              onSelect={onSelect}
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

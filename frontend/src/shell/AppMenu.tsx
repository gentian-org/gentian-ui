import { useState } from "react";
import type { ShellApp } from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import { AppLauncher } from "@/shell/AppLauncher";
import { AppMenuSlot } from "@/shell/AppMenuSlot";
import {
  AppsGridIcon,
  BellIcon,
  MenuIcon,
  TrayButton,
} from "@/shell/TrayButton";

type AppMenuProps = {
  apps: ShellApp[];
  activeAppId: string | null;
  username?: string;
  onSelect: (app: ShellApp) => void;
};

export function AppMenu({ apps, activeAppId, username, onSelect }: AppMenuProps) {
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const { logout } = useAuth();

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

        <div className="app-menu__tray">
          <TrayButton label="Notifications">
            <BellIcon />
          </TrayButton>
          <TrayButton
            label={username ? `Menu (${username})` : "Menu"}
            onClick={() => setUserMenuOpen((v) => !v)}
          >
            <MenuIcon />
          </TrayButton>
        </div>
      </nav>

      {launcherOpen && (
        <AppLauncher
          apps={apps}
          onSelect={onSelect}
          onClose={() => setLauncherOpen(false)}
        />
      )}

      {userMenuOpen && (
        <div
          className="fixed bottom-[calc(var(--app-menu-height)+8px)] right-4 z-[210] min-w-40 rounded-[var(--gtn-r2)] border border-[var(--gtn-border)] bg-[var(--gtn-paper-3)] py-1 shadow-[var(--gtn-shadow-2)]"
          role="menu"
        >
          {username && (
            <p className="border-b border-[var(--gtn-border)] px-3 py-2 text-xs text-[var(--gtn-ink-3)]">
              {username}
            </p>
          )}
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-2 text-left text-sm hover:bg-[var(--gtn-50)]"
            onClick={() => {
              setUserMenuOpen(false);
              logout();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </>
  );
}

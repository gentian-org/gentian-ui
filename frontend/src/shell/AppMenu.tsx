import type { ShellApp } from "@/api/client";

type AppMenuProps = {
  apps: ShellApp[];
  activeAppId: string | null;
  onSelect: (app: ShellApp) => void;
  mode: "desktop" | "mobile";
};

export function AppMenu({ apps, activeAppId, onSelect, mode }: AppMenuProps) {
  const position =
    mode === "mobile"
      ? "fixed bottom-0 left-0 right-0 border-t border-[var(--gtn-border)] bg-[var(--gtn-paper-3)]/95 backdrop-blur"
      : "fixed top-0 left-0 right-0 border-b border-[var(--gtn-border)] bg-[var(--gtn-paper-3)]/95 backdrop-blur";

  return (
    <nav className={position} aria-label="App launcher">
      <ul className="mx-auto flex max-w-5xl list-none gap-2 overflow-x-auto p-3">
        {apps.map((app) => (
          <li key={app.id}>
            <button
              type="button"
              onClick={() => onSelect(app)}
              className={`min-w-16 rounded-[var(--gtn-r2)] px-3 py-2 text-sm transition ${
                activeAppId === app.id
                  ? "bg-[var(--gtn-500)] text-white"
                  : "bg-[var(--gtn-paper-0)] text-[var(--gtn-ink-1)] hover:bg-white"
              }`}
            >
              {app.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

import { useWindowsStore } from "@/stores/windows";

export function WindowManager() {
  const windows = useWindowsStore((s) => s.windows);
  const focusWindow = useWindowsStore((s) => s.focusWindow);
  const closeWindow = useWindowsStore((s) => s.closeWindow);

  return (
    <>
      {windows.map((win) => (
        <div
          key={win.id}
          role="dialog"
          aria-label={win.title}
          className="fixed overflow-hidden rounded-[var(--gtn-r2)] border border-[var(--gtn-border)] bg-white shadow-[var(--gtn-shadow-3)]"
          style={{
            left: win.geometry.x,
            top: win.geometry.y + 56,
            width: win.geometry.w,
            height: win.geometry.h,
            zIndex: win.zIndex,
          }}
          onMouseDown={() => focusWindow(win.id)}
        >
          <header className="flex items-center justify-between border-b border-[var(--gtn-border)] bg-[var(--gtn-paper-0)] px-3 py-2 text-sm">
            <span>{win.title}</span>
            <button type="button" onClick={() => closeWindow(win.id)} aria-label="Close">
              ×
            </button>
          </header>
          <iframe
            title={win.title}
            src={win.url}
            className="h-[calc(100%-2.5rem)] w-full border-0"
            allow="geolocation; microphone; camera; encrypted-media; storage-access *"
          />
        </div>
      ))}
    </>
  );
}

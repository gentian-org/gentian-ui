import { useWindowsStore } from "@/stores/windows";
import { APP_MENU_HEIGHT, WINDOW_HEADER_HEIGHT } from "@/lib/windows";
import { useWindowDrag } from "@/windows/useWindowDrag";

function WindowChromeButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className="shell-window__control" aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

export function WindowManager() {
  const windows = useWindowsStore((s) => s.windows);
  const focusWindow = useWindowsStore((s) => s.focusWindow);
  const closeWindow = useWindowsStore((s) => s.closeWindow);
  const minimizeWindow = useWindowsStore((s) => s.minimizeWindow);
  const maximizeWindow = useWindowsStore((s) => s.maximizeWindow);
  const {
    onHeaderPointerDown,
    onHeaderPointerMove,
    onHeaderPointerUp,
    onHeaderPointerCancel,
  } = useWindowDrag();

  const minimized = windows.filter((w) => w.state === "minimized");
  const visible = windows.filter((w) => w.state !== "minimized");

  return (
    <>
      {visible.map((win) => (
        <div
          key={win.id}
          role="dialog"
          aria-label={win.title}
          className={`shell-window${win.focused ? " shell-window--focused" : ""}${
            win.state === "maximized" ? " shell-window--maximized" : ""
          }`}
          style={{
            left: win.geometry.x,
            top: win.geometry.y,
            width: win.geometry.w,
            height: win.geometry.h,
            zIndex: win.zIndex,
          }}
          onMouseDown={() => focusWindow(win.id)}
        >
          <header
            className="shell-window__header"
            onPointerDown={(event) => onHeaderPointerDown(event, win)}
            onPointerMove={onHeaderPointerMove}
            onPointerUp={onHeaderPointerUp}
            onPointerCancel={onHeaderPointerCancel}
          >
            <span className="shell-window__title">{win.title}</span>
            <div className="shell-window__controls">
              <WindowChromeButton label="Minimize" onClick={() => minimizeWindow(win.id)}>
                −
              </WindowChromeButton>
              <WindowChromeButton
                label={win.state === "maximized" ? "Restore" : "Maximize"}
                onClick={() => maximizeWindow(win.id)}
              >
                {win.state === "maximized" ? "⧉" : "□"}
              </WindowChromeButton>
              <WindowChromeButton label="Close" onClick={() => closeWindow(win.id)}>
                ×
              </WindowChromeButton>
            </div>
          </header>
          <iframe
            title={win.title}
            src={win.url}
            className="shell-window__body"
            style={{ height: `calc(100% - ${WINDOW_HEADER_HEIGHT}px)` }}
            allow="geolocation; microphone; camera; encrypted-media; storage-access *"
          />
        </div>
      ))}

      {minimized.length > 0 && (
        <div
          className="shell-window-taskbar"
          style={{ bottom: APP_MENU_HEIGHT }}
          aria-label="Minimized windows"
        >
          {minimized.map((win) => (
            <button
              key={win.id}
              type="button"
              className="shell-window-taskbar__item"
              onClick={() => focusWindow(win.id)}
            >
              {win.title}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

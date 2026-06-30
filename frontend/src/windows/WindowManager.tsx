import { useWindowsStore, type ShellWindow } from "@/stores/windows";
import { APP_MENU_HEIGHT } from "@/lib/windows";
import { useWindowDrag } from "@/windows/useWindowDrag";
import { useWindowResize } from "@/windows/useWindowResize";
import {
  WindowCloseIcon,
  WindowMaximizeIcon,
  WindowMinimizeIcon,
  WindowRestoreIcon,
} from "@/windows/WindowChromeIcons";
import { WindowResizeHandles } from "@/windows/WindowResizeHandles";
import { WindowBody } from "@/windows/WindowBody";

function handleIframeLoad(win: ShellWindow, advanceWindowNavigation: (id: string) => void) {
  if (!win.pendingUrl) {
    return;
  }
  advanceWindowNavigation(win.id);
}

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
  const advanceWindowNavigation = useWindowsStore((s) => s.advanceWindowNavigation);
  const {
    onHeaderPointerDown,
    onHeaderPointerMove,
    onHeaderPointerUp,
    onHeaderPointerCancel,
  } = useWindowDrag();
  const {
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp,
    onHandlePointerCancel,
  } = useWindowResize();

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
                <WindowMinimizeIcon className="shell-window__control-icon" />
              </WindowChromeButton>
              <WindowChromeButton
                label={win.state === "maximized" ? "Restore" : "Maximize"}
                onClick={() => maximizeWindow(win.id)}
              >
                {win.state === "maximized" ? (
                  <WindowRestoreIcon className="shell-window__control-icon" />
                ) : (
                  <WindowMaximizeIcon className="shell-window__control-icon" />
                )}
              </WindowChromeButton>
              <WindowChromeButton label="Close" onClick={() => closeWindow(win.id)}>
                <WindowCloseIcon className="shell-window__control-icon shell-window__control-icon--close" />
              </WindowChromeButton>
            </div>
          </header>
          <WindowBody
            win={win}
            onIframeLoad={() => handleIframeLoad(win, advanceWindowNavigation)}
          />
          <WindowResizeHandles
            win={win}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerCancel}
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

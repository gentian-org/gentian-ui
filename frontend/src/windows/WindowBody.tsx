import { AdminConsole } from "@/admin/AdminConsole";
import type { ShellWindow } from "@/stores/windows";
import { WINDOW_HEADER_HEIGHT } from "@/lib/windows";

type WindowBodyProps = {
  win: ShellWindow;
  onIframeLoad: () => void;
};

export function WindowBody({ win, onIframeLoad }: WindowBodyProps) {
  const bodyStyle = { height: `calc(100% - ${WINDOW_HEADER_HEIGHT}px)` };

  if (win.builtinComponent === "admin") {
    return (
      <div
        className="shell-window__body shell-window__body--component"
        style={bodyStyle}
      >
        <AdminConsole embedded />
      </div>
    );
  }

  if (!win.url) {
    return null;
  }

  return (
    <iframe
      key={win.url}
      title={win.title}
      src={win.url}
      className="shell-window__body"
      style={bodyStyle}
      allow="geolocation; microphone; camera; encrypted-media; storage-access *"
      onLoad={onIframeLoad}
    />
  );
}

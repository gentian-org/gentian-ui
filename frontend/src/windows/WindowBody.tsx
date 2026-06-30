import { AdminConsole } from "@/admin/AdminConsole";
import type { ShellWindow } from "@/stores/windows";

type WindowBodyProps = {
  win: ShellWindow;
  onIframeLoad: () => void;
};

export function WindowBody({ win, onIframeLoad }: WindowBodyProps) {
  if (win.builtinComponent === "admin") {
    return (
      <div className="shell-window__body shell-window__body--component">
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
      allow="geolocation; microphone; camera; encrypted-media; storage-access *"
      onLoad={onIframeLoad}
    />
  );
}

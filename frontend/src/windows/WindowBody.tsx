import { useEffect, useState } from "react";
import { AccountPanel } from "@/account/AccountPanel";
import { AdminConsole } from "@/admin/AdminConsole";
import { SettingsPanel } from "@/settings/SettingsPanel";
import type { ShellWindow } from "@/stores/windows";
import { checkIframeEmbeddable } from "@/api/prefs";

type WindowBodyProps = {
  win: ShellWindow;
  onIframeLoad: () => void;
};

export function WindowBody({ win, onIframeLoad }: WindowBodyProps) {
  const [embeddable, setEmbeddable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!win.url || win.builtinComponent) return;

    checkIframeEmbeddable(win.url)
      .then((res) => {
        if (res && res.embeddable === false) {
          setEmbeddable(false);
          window.open(win.url, "_blank");
        } else {
          setEmbeddable(true);
        }
      })
      .catch(() => {
        setEmbeddable(true);
      });
  }, [win.url, win.builtinComponent]);

  if (win.builtinComponent === "admin") {
    return (
      <div className="shell-window__body shell-window__body--component">
        <AdminConsole embedded />
      </div>
    );
  }

  if (win.builtinComponent === "account") {
    return (
      <div className="shell-window__body shell-window__body--component">
        <AccountPanel embedded />
      </div>
    );
  }

  if (win.builtinComponent === "settings") {
    return (
      <div className="shell-window__body shell-window__body--component">
        <SettingsPanel embedded />
      </div>
    );
  }

  if (!win.url) {
    return null;
  }

  if (embeddable === false) {
    return (
      <div className="shell-window__body iframe-fallback-container">
        <p className="iframe-fallback-text">
          This website does not allow embedding inside other pages for security reasons.
        </p>
        <button
          type="button"
          className="iframe-fallback-button"
          onClick={() => window.open(win.url, "_blank")}
        >
          Open in New Tab
        </button>
      </div>
    );
  }

  return (
    <iframe
      key={win.id}
      title={win.title}
      src={win.url}
      className="shell-window__body"
      allow="geolocation; microphone; camera; encrypted-media; storage-access *; notifications"
      onLoad={onIframeLoad}
    />
  );
}

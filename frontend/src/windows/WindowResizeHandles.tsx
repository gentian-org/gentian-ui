import type { PointerEvent as ReactPointerEvent } from "react";

import type { WindowResizeEdge } from "@/lib/windows";
import type { ShellWindow } from "@/stores/windows";

const HANDLES: Array<{ edge: WindowResizeEdge; className: string }> = [
  { edge: "n", className: "shell-window__resize-handle shell-window__resize-handle--n" },
  { edge: "s", className: "shell-window__resize-handle shell-window__resize-handle--s" },
  { edge: "e", className: "shell-window__resize-handle shell-window__resize-handle--e" },
  { edge: "w", className: "shell-window__resize-handle shell-window__resize-handle--w" },
  { edge: "ne", className: "shell-window__resize-handle shell-window__resize-handle--ne" },
  { edge: "nw", className: "shell-window__resize-handle shell-window__resize-handle--nw" },
  { edge: "se", className: "shell-window__resize-handle shell-window__resize-handle--se" },
  { edge: "sw", className: "shell-window__resize-handle shell-window__resize-handle--sw" },
];

type WindowResizeHandlesProps = {
  win: ShellWindow;
  onPointerDown: (
    event: ReactPointerEvent<HTMLElement>,
    win: ShellWindow,
    edge: WindowResizeEdge,
  ) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
};

export function WindowResizeHandles({
  win,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: WindowResizeHandlesProps) {
  if (win.state === "maximized") {
    return null;
  }

  return (
    <>
      {HANDLES.map(({ edge, className }) => (
        <div
          key={edge}
          className={className}
          aria-hidden="true"
          onPointerDown={(event) => onPointerDown(event, win, edge)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        />
      ))}
    </>
  );
}

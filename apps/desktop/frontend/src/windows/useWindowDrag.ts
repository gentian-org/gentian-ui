import { useCallback, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { clampWindowPosition } from "@/lib/windows";
import { useWindowsStore, type ShellWindow } from "@/stores/windows";

type DragSession = {
  windowId: string;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  width: number;
};

export function useWindowDrag() {
  const moveWindow = useWindowsStore((s) => s.moveWindow);
  const focusWindow = useWindowsStore((s) => s.focusWindow);
  const dragRef = useRef<DragSession | null>(null);

  const endDrag = useCallback((target: HTMLElement, pointerId: number) => {
    if (dragRef.current?.pointerId === pointerId) {
      dragRef.current = null;
    }
    if (target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
  }, []);

  const onHeaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, win: ShellWindow) => {
      if (win.state === "maximized") return;
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest("button")) return;

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      focusWindow(win.id);
      dragRef.current = {
        windowId: win.id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: win.geometry.x,
        originY: win.geometry.y,
        width: win.geometry.w,
      };
    },
    [focusWindow],
  );

  const onHeaderPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const { x, y } = clampWindowPosition(
        drag.originX + dx,
        drag.originY + dy,
        drag.width,
      );
      moveWindow(drag.windowId, x, y);
    },
    [moveWindow],
  );

  const onHeaderPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      endDrag(event.currentTarget, event.pointerId);
    },
    [endDrag],
  );

  const onHeaderPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      endDrag(event.currentTarget, event.pointerId);
    },
    [endDrag],
  );

  return {
    onHeaderPointerDown,
    onHeaderPointerMove,
    onHeaderPointerUp,
    onHeaderPointerCancel,
  };
}

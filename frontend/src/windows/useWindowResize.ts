import { useCallback, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { type WindowGeometry, type WindowResizeEdge, resizeWindowGeometry } from "@/lib/windows";
import { useWindowsStore, type ShellWindow } from "@/stores/windows";

type ResizeSession = {
  windowId: string;
  pointerId: number;
  edge: WindowResizeEdge;
  startX: number;
  startY: number;
  origin: WindowGeometry;
};

export function useWindowResize() {
  const resizeWindow = useWindowsStore((s) => s.resizeWindow);
  const focusWindow = useWindowsStore((s) => s.focusWindow);
  const resizeRef = useRef<ResizeSession | null>(null);

  const endResize = useCallback((target: HTMLElement, pointerId: number) => {
    if (resizeRef.current?.pointerId === pointerId) {
      resizeRef.current = null;
    }
    if (target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
  }, []);

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, win: ShellWindow, edge: WindowResizeEdge) => {
      if (win.state === "maximized") return;
      if (event.button !== 0) return;

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      focusWindow(win.id);
      resizeRef.current = {
        windowId: win.id,
        pointerId: event.pointerId,
        edge,
        startX: event.clientX,
        startY: event.clientY,
        origin: { ...win.geometry },
      };
    },
    [focusWindow],
  );

  const onHandlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const resize = resizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;

      const dx = event.clientX - resize.startX;
      const dy = event.clientY - resize.startY;
      const geometry = resizeWindowGeometry(resize.origin, resize.edge, dx, dy);
      resizeWindow(resize.windowId, geometry);
    },
    [resizeWindow],
  );

  const onHandlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      endResize(event.currentTarget, event.pointerId);
    },
    [endResize],
  );

  const onHandlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      endResize(event.currentTarget, event.pointerId);
    },
    [endResize],
  );

  return {
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp,
    onHandlePointerCancel,
  };
}

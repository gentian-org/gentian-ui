/** Pixels reserved for the bottom app menu dock. */
export const APP_MENU_HEIGHT = 56;

export const WINDOW_HEADER_HEIGHT = 40;

export type WindowGeometry = { x: number; y: number; w: number; h: number };

/** Cascade + jitter so new windows do not stack on the same spot. */
export function createWindowGeometry(
  openCount: number,
  viewport = { width: window.innerWidth, height: window.innerHeight },
): WindowGeometry {
  const w = Math.min(960, Math.max(480, viewport.width - 48));
  const h = Math.min(640, Math.max(360, viewport.height - APP_MENU_HEIGHT - 48));
  const maxX = Math.max(16, viewport.width - w - 16);
  const maxY = Math.max(16, viewport.height - h - APP_MENU_HEIGHT - 16);

  const cascade = openCount * 28;
  const jitterX = Math.floor(Math.random() * 48);
  const jitterY = Math.floor(Math.random() * 48);

  return {
    x: Math.min(24 + cascade + jitterX, maxX),
    y: Math.min(24 + cascade + jitterY, maxY),
    w,
    h,
  };
}

export function maximizedGeometry(
  viewport = { width: window.innerWidth, height: window.innerHeight },
): WindowGeometry {
  return {
    x: 0,
    y: 0,
    w: viewport.width,
    h: viewport.height - APP_MENU_HEIGHT,
  };
}

/** Keep at least part of the title bar on-screen while dragging. */
export function clampWindowPosition(
  x: number,
  y: number,
  w: number,
  viewport = { width: window.innerWidth, height: window.innerHeight },
): Pick<WindowGeometry, "x" | "y"> {
  const minVisible = 48;
  const minX = Math.min(0, minVisible - w);
  const maxX = Math.max(0, viewport.width - minVisible);
  const minY = 0;
  const maxY = Math.max(0, viewport.height - APP_MENU_HEIGHT - WINDOW_HEADER_HEIGHT);
  return {
    x: Math.min(Math.max(minX, x), maxX),
    y: Math.min(Math.max(minY, y), maxY),
  };
}

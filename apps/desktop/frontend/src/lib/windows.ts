/** Pixels reserved for the bottom app menu dock. */
export const APP_MENU_HEIGHT = 56;

export const WINDOW_HEADER_HEIGHT = 40;

export const WINDOW_MIN_WIDTH = 360;
export const WINDOW_MIN_HEIGHT = 240;

export type WindowGeometry = { x: number; y: number; w: number; h: number };

export type WindowResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Cascade + jitter so new windows do not stack on the same spot. */
export function createWindowGeometry(
  openCount: number,
  viewport = { width: window.innerWidth, height: window.innerHeight },
): WindowGeometry {
  const w = Math.min(1200, Math.max(800, viewport.width - 96));
  const h = Math.min(800, Math.max(500, viewport.height - APP_MENU_HEIGHT - 96));
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

/** Clamp size and position while resizing from any edge or corner. */
export function clampWindowGeometry(
  geometry: WindowGeometry,
  viewport = { width: window.innerWidth, height: window.innerHeight },
): WindowGeometry {
  let { x, y, w, h } = geometry;

  w = Math.max(WINDOW_MIN_WIDTH, w);
  h = Math.max(WINDOW_MIN_HEIGHT, h);

  const maxW = viewport.width - 16;
  const maxH = viewport.height - APP_MENU_HEIGHT - 16;
  w = Math.min(w, maxW);
  h = Math.min(h, maxH);

  const minVisible = 48;
  const maxX = Math.max(0, viewport.width - minVisible);
  const maxY = Math.max(0, viewport.height - APP_MENU_HEIGHT - WINDOW_HEADER_HEIGHT);

  if (x > maxX) {
    x = maxX;
  }
  if (y > maxY) {
    y = maxY;
  }
  if (x + w < minVisible) {
    x = minVisible - w;
  }
  if (y + h < WINDOW_HEADER_HEIGHT) {
    y = WINDOW_HEADER_HEIGHT - h;
  }

  return { x, y, w, h };
}

export function resizeWindowGeometry(
  origin: WindowGeometry,
  edge: WindowResizeEdge,
  dx: number,
  dy: number,
): WindowGeometry {
  let x = origin.x;
  let y = origin.y;
  let w = origin.w;
  let h = origin.h;

  if (edge.includes("e")) {
    w = origin.w + dx;
  }
  if (edge.includes("w")) {
    w = origin.w - dx;
    x = origin.x + dx;
  }
  if (edge.includes("s")) {
    h = origin.h + dy;
  }
  if (edge.includes("n")) {
    h = origin.h - dy;
    y = origin.y + dy;
  }

  if (w < WINDOW_MIN_WIDTH) {
    if (edge.includes("w")) {
      x = origin.x + origin.w - WINDOW_MIN_WIDTH;
    }
    w = WINDOW_MIN_WIDTH;
  }
  if (h < WINDOW_MIN_HEIGHT) {
    if (edge.includes("n")) {
      y = origin.y + origin.h - WINDOW_MIN_HEIGHT;
    }
    h = WINDOW_MIN_HEIGHT;
  }

  return clampWindowGeometry({ x, y, w, h });
}

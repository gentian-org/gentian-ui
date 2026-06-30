import { create } from "zustand";
import { createWindowGeometry, maximizedGeometry, type WindowGeometry } from "@/lib/windows";

export type WindowVisualState = "normal" | "minimized" | "maximized";

export type ShellWindow = {
  id: string;
  appId: string;
  title: string;
  url: string;
  /** When set, navigate the iframe to this URL after the current IdP bootstrap page loads. */
  pendingUrl?: string;
  geometry: WindowGeometry;
  /** Saved when maximizing so restore returns to the prior size. */
  restoreGeometry: WindowGeometry;
  state: WindowVisualState;
  zIndex: number;
  focused: boolean;
};

type OpenWindowInput = {
  id: string;
  appId: string;
  title: string;
  url: string;
  pendingUrl?: string;
  geometry?: WindowGeometry;
};

type WindowsState = {
  windows: ShellWindow[];
  nextZIndex: number;
  openWindow: (win: OpenWindowInput) => void;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, geometry: WindowGeometry) => void;
  advanceWindowNavigation: (id: string) => void;
};

const BASE_Z = 100;

export const useWindowsStore = create<WindowsState>((set, get) => ({
  windows: [],
  nextZIndex: BASE_Z,
  openWindow: (win) =>
    set((state) => {
      const nextZ = state.nextZIndex + 1;
      const visibleCount = state.windows.filter((w) => w.state !== "minimized").length;
      const geometry = win.geometry ?? createWindowGeometry(visibleCount);
      return {
        nextZIndex: nextZ,
        windows: [
          ...state.windows.map((w) => ({ ...w, focused: false })),
          {
            id: win.id,
            appId: win.appId,
            title: win.title,
            url: win.url,
            pendingUrl: win.pendingUrl,
            geometry,
            restoreGeometry: geometry,
            zIndex: nextZ,
            focused: true,
            state: "normal" as const,
          },
        ],
      };
    }),
  closeWindow: (id) =>
    set((state) => ({
      windows: state.windows.filter((w) => w.id !== id),
    })),
  focusWindow: (id) =>
    set((state) => {
      const target = state.windows.find((w) => w.id === id);
      if (!target) return state;
      const nextZ = state.nextZIndex + 1;
      return {
        nextZIndex: nextZ,
        windows: state.windows.map((w) => {
          if (w.id !== id) return { ...w, focused: false };
          if (w.state === "minimized") {
            return { ...w, state: "normal" as const, zIndex: nextZ, focused: true };
          }
          return { ...w, zIndex: nextZ, focused: true };
        }),
      };
    }),
  minimizeWindow: (id) =>
    set((state) => ({
      windows: state.windows.map((w) =>
        w.id === id ? { ...w, state: "minimized" as const, focused: false } : w,
      ),
    })),
  maximizeWindow: (id) =>
    set((state) => {
      const nextZ = state.nextZIndex + 1;
      return {
        nextZIndex: nextZ,
        windows: state.windows.map((w) => {
          if (w.id !== id) return { ...w, focused: false };
          if (w.state === "maximized") {
            return {
              ...w,
              state: "normal" as const,
              geometry: w.restoreGeometry,
              zIndex: nextZ,
              focused: true,
            };
          }
          return {
            ...w,
            state: "maximized" as const,
            restoreGeometry: w.state === "normal" ? w.geometry : w.restoreGeometry,
            geometry: maximizedGeometry(),
            zIndex: nextZ,
            focused: true,
          };
        }),
      };
    }),
  restoreWindow: (id) =>
    set((state) => {
      const win = state.windows.find((w) => w.id === id);
      if (!win) return state;
      if (win.state === "maximized") {
        get().maximizeWindow(id);
        return get();
      }
      return {
        windows: state.windows.map((w) =>
          w.id === id ? { ...w, state: "normal" as const, geometry: w.restoreGeometry } : w,
        ),
      };
    }),
  moveWindow: (id, x, y) =>
    set((state) => ({
      windows: state.windows.map((w) => {
        if (w.id !== id || w.state === "maximized") return w;
        const geometry = { ...w.geometry, x, y };
        return { ...w, geometry, restoreGeometry: geometry };
      }),
    })),
  resizeWindow: (id, geometry) =>
    set((state) => ({
      windows: state.windows.map((w) => {
        if (w.id !== id || w.state === "maximized") return w;
        return { ...w, geometry, restoreGeometry: geometry };
      }),
    })),
  advanceWindowNavigation: (id) =>
    set((state) => ({
      windows: state.windows.map((w) => {
        if (w.id !== id || !w.pendingUrl) {
          return w;
        }
        return { ...w, url: w.pendingUrl, pendingUrl: undefined };
      }),
    })),
}));

import { create } from "zustand";

export type WindowVisualState = "normal" | "minimized" | "maximized" | "fullscreen";

export type ShellWindow = {
  id: string;
  appId: string;
  title: string;
  url: string;
  geometry: { x: number; y: number; w: number; h: number };
  state: WindowVisualState;
  zIndex: number;
  focused: boolean;
};

type WindowsState = {
  windows: ShellWindow[];
  nextZIndex: number;
  openWindow: (win: Omit<ShellWindow, "zIndex" | "focused" | "state">) => void;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
};

const BASE_Z = 100;

export const useWindowsStore = create<WindowsState>((set) => ({
  windows: [],
  nextZIndex: BASE_Z,
  openWindow: (win) =>
    set((state) => {
      const nextZ = state.nextZIndex + 1;
      return {
        nextZIndex: nextZ,
        windows: [
          ...state.windows.map((w) => ({ ...w, focused: false })),
          { ...win, zIndex: nextZ, focused: true, state: "normal" as const },
        ],
      };
    }),
  closeWindow: (id) =>
    set((state) => ({
      windows: state.windows.filter((w) => w.id !== id),
    })),
  focusWindow: (id) =>
    set((state) => {
      const nextZ = state.nextZIndex + 1;
      return {
        nextZIndex: nextZ,
        windows: state.windows.map((w) =>
          w.id === id ? { ...w, zIndex: nextZ, focused: true } : { ...w, focused: false },
        ),
      };
    }),
}));

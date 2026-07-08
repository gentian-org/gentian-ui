import { create } from "zustand";
import { fetchPrefs, savePrefs } from "@/api/prefs";

export type DesktopTile = {
  id: string;
  appId?: string;
  type: "app" | "link";
  title: string;
  icon: string;
  url?: string;
  openMode?: "iframe" | "tab";
  position: { x: number; y: number };
};

export type TileCustomization = {
  title?: string;
  icon?: string;
};

type PrefsState = {
  customPrefs: {
    desktopTiles?: DesktopTile[];
    tileCustomizations?: Record<string, TileCustomization>;
  };
  isLoading: boolean;
  loadPrefs: () => Promise<void>;
  updateCustomPrefs: (updater: (prev: PrefsState["customPrefs"]) => PrefsState["customPrefs"]) => Promise<void>;
};

export const usePrefsStore = create<PrefsState>((set, get) => ({
  customPrefs: {},
  isLoading: false,
  loadPrefs: async () => {
    set({ isLoading: true });
    try {
      const prefs = await fetchPrefs();
      set({ customPrefs: prefs.customPrefs || {} });
    } catch (err) {
      console.error("Failed to load preferences:", err);
    } finally {
      set({ isLoading: false });
    }
  },
  updateCustomPrefs: async (updater) => {
    const nextPrefs = updater(get().customPrefs);
    set({ customPrefs: nextPrefs });
    try {
      await savePrefs(nextPrefs);
    } catch (err) {
      console.error("Failed to save preferences:", err);
    }
  },
}));

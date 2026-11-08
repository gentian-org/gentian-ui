import { create } from "zustand";
import type { ShellApp } from "@/api/client";

type AppsState = {
  apps: ShellApp[];
  activeAppId: string | null;
  setApps: (apps: ShellApp[]) => void;
  setActiveAppId: (id: string | null) => void;
};

export const useAppsStore = create<AppsState>((set) => ({
  apps: [],
  activeAppId: null,
  setApps: (apps) => set({ apps }),
  setActiveAppId: (id) => set({ activeAppId: id }),
}));

import { create } from "zustand";
import { fetchPrefs, savePrefs } from "@/api/prefs";
import { applyStoredLanguage } from "@/lib/i18n";

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
    menuAppIds?: string[];
    // Apps the user deliberately took off the quick bar. Without this we cannot
    // tell "removed on purpose" from "provisioned after menuAppIds was written",
    // and newly installed apps would either never appear or resurrect removed ones.
    menuRemovedAppIds?: string[];
    // The language this person reads the desktop in (AD-15). Here rather than
    // in the browser, because it belongs to the account: the same person on a
    // second machine should not have to say it again, and a tenant
    // administrator handing out a settings template hands out the language
    // with it. Absent means follow the browser.
    language?: string;
  };
  // The tenant's own language, as the server reported it. Not a preference:
  // it is what this person gets until they choose, so it lives beside
  // customPrefs rather than in it.
  tenantLanguage?: string;
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
      const custom = prefs.customPrefs || {};
      set({ customPrefs: custom, tenantLanguage: prefs.tenantLanguage ?? undefined });
      // The language, in the order that makes each source mean what it says:
      //
      //   1. this person's own choice, in their preferences — which is also
      //      what a settings template gives them, because a template is a
      //      copy of somebody's preferences and `language` is one of them;
      //   2. the tenant's language, so a German tenant's people get a German
      //      desktop on their first sign-in without anybody configuring them
      //      one at a time;
      //   3. the browser, for a tenant that declared none.
      //
      // Passing undefined at step 3 is what hands the decision back to the
      // browser, rather than freezing whatever it said today.
      applyStoredLanguage(custom.language || prefs.tenantLanguage || undefined);
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

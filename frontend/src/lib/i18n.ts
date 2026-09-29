import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

/**
 * The platform's own words, in the viewer's language (AD-15).
 *
 * **Adding a language is one file.** Drop `src/locales/<code>.json` in, copy
 * the keys from `en.json`, translate them. Nothing here is edited: the
 * catalogues are discovered at build time by the glob below, and the language
 * list, the chooser and the detector all derive from what was found. That is
 * the whole reason the catalogues are JSON rather than TypeScript — a
 * translator needs no toolchain, and the files go to a translation service
 * and come back without anybody touching code.
 *
 * i18next rather than something written here, because the parts that look
 * easy are not: plural categories differ per language (Polish has four, Arabic
 * six), and getting them from a hand-rolled lookup wrong is the kind of bug
 * nobody who speaks the language of the source ever sees.
 *
 * English is the fallback because it is the language the source strings are
 * written in. A key missing from a translation renders the English sentence
 * the author wrote, never a blank and never the key itself, so a language is
 * shippable while it is still half translated.
 */

// Every catalogue in src/locales. eager so they are in the bundle: this is a
// desktop shell behind a login, the strings are a few kilobytes, and a
// language that arrives one network round trip after the page does is a
// flash of English on every load.
const modules = import.meta.glob<{ default: Record<string, unknown> }>("../locales/*.json", {
  eager: true,
});

const resources: Record<string, { translation: Record<string, unknown> }> = {};
for (const [path, module] of Object.entries(modules)) {
  const code = path.split("/").pop()?.replace(/\.json$/, "");
  if (code) resources[code] = { translation: module.default };
}

/** The languages this build ships, in a stable order for a chooser. */
export const languages: readonly string[] = Object.keys(resources).sort();

/** The language the source strings are written in, and the last fallback. */
export const fallbackLanguage = "en";

/** The key a chooser stores an explicit choice under. */
export const languageStorageKey = "gentian.language";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: languages as string[],
    fallbackLng: fallbackLanguage,
    // de-CH and de-AT are served the German catalogue. The platform has no
    // strings that differ between them, and a regional catalogue would be
    // sixty identical entries maintained in parallel. Falling back ACROSS
    // languages is what never happens: an unmatched language gets English,
    // which is the author's own words rather than a guess.
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    detection: {
      // What to render before the account's preference has arrived. The
      // account is the source of truth (see applyStoredLanguage) and it comes
      // from the desktop's own settings, one HTTP round trip after the first
      // paint; localStorage holds the last known answer so that round trip is
      // not a flash of English on every load, and the browser's own languages
      // answer for a person who has never chosen.
      order: ["localStorage", "navigator"],
      lookupLocalStorage: languageStorageKey,
      caches: ["localStorage"],
    },
    interpolation: {
      // React escapes what it renders; doing it twice turns an apostrophe
      // into &#39; on the screen.
      escapeValue: false,
    },
    returnNull: false,
  });

export default i18n;

/**
 * Apply the language the account stores, and remember it for the next first
 * paint.
 *
 * `undefined` means the person has never chosen: the browser decides, and the
 * cached answer is cleared so a choice made on one machine and then removed
 * does not linger on another.
 *
 * The desktop's settings are the source of truth, not this browser. That is
 * what makes the choice follow a person to a second machine, and what lets a
 * tenant administrator hand out a language with a settings template.
 */
export function applyStoredLanguage(language: string | undefined): void {
  try {
    if (language) window.localStorage.setItem(languageStorageKey, language);
    else window.localStorage.removeItem(languageStorageKey);
  } catch {
    // Private windows and blocked site data both throw. The language still
    // applies to this page; only the first-paint cache is lost.
  }
  void i18n.changeLanguage(language || undefined);
}

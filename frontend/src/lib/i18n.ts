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
      // The viewer's own choice first, then what their browser asks for.
      // AD-15's "from their account, and from the browser until they have
      // said" — the account plugs in ahead of these once the desktop can read
      // a locale from it.
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

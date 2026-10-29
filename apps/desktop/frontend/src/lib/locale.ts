import i18n, { fallbackLanguage } from "@/lib/i18n";

/**
 * The language this desktop is showing, as chosen in its settings (AD-15).
 *
 * i18next's resolved language rather than the browser's: the desktop's
 * settings decide it (see applyStoredLanguage), and a label or a date in a
 * different language from the words around it is the bug this exists to
 * prevent. A browser listing en-US, de-CH must not turn a tile German on a
 * desktop set to English.
 */
export function activeLanguage(): string {
  return i18n.resolvedLanguage || i18n.language || fallbackLanguage;
}

/**
 * Which of a tile's labels this viewer should see.
 *
 * The platform's catalog carries a label and, for some tiles, translations
 * keyed by locale — "de_DE", "en_US". Thirty tiles are genuinely translated
 * ("Dateien", "Automatisierung", every Odoo module), so picking the right one
 * is not decoration.
 *
 * Matching is deliberately forgiving in one direction only. A desktop in de
 * is offered de_DE, because the language is what makes a label readable and
 * the region rarely changes a tile's name. But nothing falls back ACROSS
 * languages: a language with no translation gets `displayName`, which is the
 * label the profile author wrote and knows is correct.
 */
export function localisedLabel(
  fallback: string,
  translations?: Record<string, string>,
  language: string = activeLanguage(),
): string {
  if (!translations) return fallback;

  const normalize = (s: string) => s.replace("-", "_").toLowerCase();
  const byKey = new Map<string, string>();
  for (const [key, value] of Object.entries(translations)) {
    if (value) byKey.set(normalize(key), value);
  }

  const want = normalize(language);
  const exact = byKey.get(want);
  if (exact) return exact;

  // Same language, different region: de takes de_DE, de-CH takes de_DE.
  const base = want.split("_")[0];
  for (const [key, value] of byKey) {
    if (key.split("_")[0] === base) return value;
  }
  return fallback;
}

/** A moment, written the way the desktop's language writes one. */
export function formatDateTime(value: number | string | Date): string {
  return new Date(value).toLocaleString(activeLanguage());
}

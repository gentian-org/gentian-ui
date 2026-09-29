/**
 * Which of a tile's labels this viewer should see.
 *
 * The platform's catalogue carries a label and, for some tiles, translations
 * keyed by locale — "de_DE", "en_US". Thirty tiles are genuinely translated
 * ("Dateien", "Automatisierung", every Odoo module), so picking the right one
 * is not decoration.
 *
 * Matching is deliberately forgiving in one direction only. A viewer asking
 * for de-CH is offered de_DE, because a German label is better than an English
 * one; a viewer asking for de is offered de_DE for the same reason. But nothing
 * falls back ACROSS languages: an unmatched language gets `displayName`, which
 * is the label the profile author wrote and knows is correct.
 */
export function localisedLabel(
  fallback: string,
  translations?: Record<string, string>,
  locales: readonly string[] = navigator.languages ?? [navigator.language],
): string {
  if (!translations) return fallback;

  const normalise = (s: string) => s.replace("-", "_").toLowerCase();
  const byKey = new Map<string, string>();
  for (const [key, value] of Object.entries(translations)) {
    if (value) byKey.set(normalise(key), value);
  }
  if (byKey.size === 0) return fallback;

  for (const requested of locales) {
    const want = normalise(requested);
    const exact = byKey.get(want);
    if (exact) return exact;

    // Same language, different region: de-CH takes de_DE. The language is what
    // makes a label readable; the region rarely changes a tile's name.
    const language = want.split("_")[0];
    for (const [key, value] of byKey) {
      if (key.split("_")[0] === language) return value;
    }
  }
  return fallback;
}

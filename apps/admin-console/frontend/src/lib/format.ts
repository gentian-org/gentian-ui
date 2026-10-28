/* SPDX-License-Identifier: Apache-2.0 */
import i18n, { fallbackLanguage } from "@/lib/i18n";

/**
 * Dates and numbers in the console's language, not the browser's.
 *
 * A bare `toLocaleString()` formats in whatever the browser lists first, so a
 * console reading in English beside a browser set to de-CH wrote its words in
 * one language and its dates in another. Everything here passes the language
 * i18next resolved, so the two always agree.
 */
function language(): string {
  return i18n.resolvedLanguage || i18n.language || fallbackLanguage;
}

type Moment = number | string | Date;

/** A date and time of day. */
export function formatDateTime(value: Moment): string {
  return new Date(value).toLocaleString(language());
}

/** A calendar day. */
export function formatDate(value: Moment): string {
  return new Date(value).toLocaleDateString(language());
}

/** A count, with the language's grouping. */
export function formatNumber(value: number): string {
  return value.toLocaleString(language());
}

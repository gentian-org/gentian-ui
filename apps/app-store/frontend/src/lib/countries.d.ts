/** The types of `countries.js`; the reasons are written there. */

export const COUNTRIES: readonly string[];
export function countryOptions(language: string): { code: string; name: string }[];
export const CHOICE_KEY: string;
export function readCountryChoice(storage: Pick<Storage, "getItem"> | null | undefined): string | null;
export function keepCountryChoice(storage: Pick<Storage, "setItem"> | null | undefined, choice: string): void;

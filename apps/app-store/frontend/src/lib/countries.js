// @ts-check
/**
 * The countries a person may ask a store's support offers for, and the one
 * they chose for this browser session.
 *
 * ISO 3166-1 alpha-2, every officially assigned code: what a store's support
 * offers name and what its `country` query takes. Their names are the
 * browser's own (`Intl.DisplayNames`), in the reader's language; this module
 * holds no name of any country.
 *
 * Plain JavaScript with no imports, so it runs under `node --test`
 * (test/countries.test.js).
 */

export const COUNTRIES = Object.freeze(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ " +
    "BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ " +
    "DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY " +
    "HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY " +
    "MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
    "NA NC NE NF NG NI NL NO NP NR NU NZ OM " +
    "PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ " +
    "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ " +
    "VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

const CODE = /^[A-Z]{2}$/;

/**
 * Every country with its name in `language`, sorted by that name; the code
 * stands for the name where the browser has none.
 *
 * @param {string} language
 * @returns {{code: string, name: string}[]}
 */
export function countryOptions(language) {
  /** @type {Intl.DisplayNames | null} */
  let names = null;
  try {
    names = new Intl.DisplayNames([language], { type: "region" });
  } catch {
    names = null;
  }
  const collator = new Intl.Collator([language]);
  return COUNTRIES.map((code) => {
    let name = code;
    try {
      name = names?.of(code) ?? code;
    } catch {
      name = code;
    }
    return { code, name };
  }).sort((a, b) => collator.compare(a.name, b.name));
}

/** Where the choice is kept for the browser session. */
export const CHOICE_KEY = "app-store.support-country";

/**
 * The country chosen in this browser session: a code, "" for all countries,
 * or null when nothing was chosen (or what is kept is no code).
 *
 * @param {Pick<Storage, "getItem"> | null | undefined} storage
 * @returns {string | null}
 */
export function readCountryChoice(storage) {
  try {
    const kept = storage?.getItem(CHOICE_KEY) ?? null;
    return kept === "" || (kept !== null && CODE.test(kept)) ? kept : null;
  } catch {
    return null;
  }
}

/**
 * Keeps the choice for the browser session; a code, or "" for all countries.
 *
 * @param {Pick<Storage, "setItem"> | null | undefined} storage
 * @param {string} choice
 */
export function keepCountryChoice(storage, choice) {
  if (choice !== "" && !CODE.test(choice)) return;
  try {
    storage?.setItem(CHOICE_KEY, choice);
  } catch {
    // Without storage the choice holds until the page is left.
  }
}

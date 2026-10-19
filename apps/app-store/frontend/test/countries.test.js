// The countries a person may ask a store's support offers for, and the choice
// kept for the browser session.
//
//   node --test test/*.test.js

import assert from "node:assert/strict";
import { test } from "node:test";
import { CHOICE_KEY, COUNTRIES, countryOptions, keepCountryChoice, readCountryChoice } from "../src/lib/countries.js";

test("every officially assigned ISO 3166-1 alpha-2 code, once", () => {
  assert.equal(COUNTRIES.length, 249);
  assert.equal(new Set(COUNTRIES).size, COUNTRIES.length);
  for (const code of COUNTRIES) assert.match(code, /^[A-Z]{2}$/);
  for (const code of ["CH", "DE", "AT", "LI", "US", "NO"]) assert.ok(COUNTRIES.includes(code), code);
});

test("the names are the browser's, in the reader's language, sorted by them", () => {
  const de = countryOptions("de");
  assert.equal(de.length, COUNTRIES.length);
  assert.equal(de.find((o) => o.code === "CH")?.name, "Schweiz");
  assert.equal(countryOptions("en").find((o) => o.code === "CH")?.name, "Switzerland");
  const names = de.map((o) => o.name);
  assert.deepEqual(names, [...names].sort(new Intl.Collator(["de"]).compare));
});

function memory() {
  const kept = new Map();
  return {
    kept,
    getItem: (key) => (kept.has(key) ? kept.get(key) : null),
    setItem: (key, value) => kept.set(key, value),
  };
}

test("a choice is kept for the session: a code, or all countries", () => {
  const storage = memory();
  assert.equal(readCountryChoice(storage), null);
  keepCountryChoice(storage, "FR");
  assert.equal(readCountryChoice(storage), "FR");
  keepCountryChoice(storage, "");
  assert.equal(readCountryChoice(storage), "");
  keepCountryChoice(storage, "France");
  assert.equal(readCountryChoice(storage), "", "what is no code is not kept");
  storage.kept.set(CHOICE_KEY, "x&y");
  assert.equal(readCountryChoice(storage), null, "what is kept and no code is no choice");
});

test("without storage nothing is kept and nothing breaks", () => {
  const broken = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  assert.equal(readCountryChoice(broken), null);
  keepCountryChoice(broken, "DE");
  assert.equal(readCountryChoice(undefined), null);
});

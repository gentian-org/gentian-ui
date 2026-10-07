// Every key a component asks for is in both catalogues.
//
// scripts/i18n.mjs --check proves that no sentence is written inline in a
// component and that German has every key English has. It does not prove
// that a key a component NAMES exists, and a key that does not exist renders
// as itself. This does, for the keys written out in the source, and for the
// families of keys that are composed from a value.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SRC = new URL("../src/", import.meta.url).pathname;
const catalogue = (language) => JSON.parse(readFileSync(join(SRC, "locales", `${language}.json`), "utf8"));
const LANGUAGES = readdirSync(join(SRC, "locales")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** A key, or one of its plural forms. */
const has = (entries, key) => {
  const [namespace, name] = key.split(".");
  const found = entries[namespace] ?? {};
  return name in found || `${name}_one` in found || `${name}_other` in found;
};

const written = new Set();
const composed = new Set();
for (const file of sources(SRC)) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/["'`]([a-zA-Z]+\.[a-zA-Z0-9-]+)["'`]/g)) {
    if (/(?:\bt\(|i18nKey=\{?|\?\s*|:\s*|exists\()\s*$/.test(source.slice(0, match.index))) written.add(match[1]);
  }
  for (const match of source.matchAll(/`([a-zA-Z]+)\.\$\{/g)) composed.add(match[1]);
}

test("the catalogues are found, and keys are found in the source", () => {
  assert.ok(LANGUAGES.includes("en") && LANGUAGES.includes("de"));
  assert.ok(written.size > 100, `${written.size} keys found`);
  assert.ok(composed.has("stage") && composed.has("problem"));
});

for (const language of LANGUAGES) {
  test(`${language}: every key a component names is in the catalogue`, () => {
    const entries = catalogue(language);
    // A string that only looks like a key -- "react.dom" -- is not one unless
    // its first part is a namespace of the catalogue.
    const missing = [...written].filter((key) => key.split(".")[0] in entries && !has(entries, key));
    assert.deepEqual(missing, []);
  });

  test(`${language}: every family of composed keys has its members`, () => {
    const entries = catalogue(language);
    const families = {
      edition: ["ce", "pe", "me", "ee"],
      trustTier: ["platform", "certified", "experimental"],
      stage: ["not-installed", "checkout", "acquired", "installing", "ready", "failing", "installed"],
      acquisition: ["pending", "confirmed", "cancelled", "failed"],
      steps: ["acquire", "checkout", "declare", "credential", "install", "addons", "rollout"],
      signInReason: ["state", "other-session", "code", "exchange", "denied", "other"],
      credentialOutcome: ["set", "not-declared", "refused", "no-credential"],
      // The definition's open enumerations: the values it names. One it does
      // not name falls back, in the component.
      reportKind: ["security", "quality", "accessibility", "privacy", "licence", "other"],
      links: ["homepage", "documentation", "source", "support", "licence", "privacy", "terms", "subscription"],
      standing: ["no-reports-for-tenant", "tenant-not-claimed", "reports-stale", "tenant-blocked"],
      problemSource: ["store", "director", "custodian", "usher", "app"],
      // The codes the store API's definition gives, and this app's own.
      problem: [
        "invalid-request", "insufficient-scope", "tenant-refused", "not-found", "acquisition-not-confirmed",
        "idempotency-conflict", "not-acquirable", "rate-limited", "store-not-configured", "store-unreachable",
        "store-format", "store-unavailable", "store-sign-in-required", "checkout-refused", "acquisition-cancelled",
        "acquisition-failed", "host-not-configured", "no-operation", "unreachable", "not-configured", "failed",
      ],
    };
    for (const family of composed) {
      if (family === "refused") continue; // by step and status; absent means no extra words
      assert.ok(family in families, `the composed family ${family} is not listed in this test`);
    }
    for (const [family, members] of Object.entries(families)) {
      for (const member of members) assert.ok(has(entries, `${family}.${member}`), `${language}: ${family}.${member}`);
    }
  });
}

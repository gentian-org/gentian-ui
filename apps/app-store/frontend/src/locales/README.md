# The app's words

One file per language, discovered at build time by the glob in
`src/lib/i18n.ts`. **Adding a language is adding a file** — nothing in the
code changes.

```
cp en.json fr.json     # then translate the values, leave the keys alone
```

`en.json` is the source: it is written by hand, beside the components, and is
the fallback for every other language. A key missing from a translation renders
the English sentence its author wrote, never a blank and never the key, so a
language is shippable while it is still half translated.

## Rules the checks enforce

`node scripts/i18n.mjs --check` fails when any of these is broken, and CI runs
it:

- **No user-visible string is written inline in a component.** Not as JSX
  text, not as a label in a module-scope array, not in a ternary. The parser
  finds all three; a regular expression would not.
- **Every language has every key `en.json` has**, with the same `{{placeholders}}`
  and the same `<tags>`. A German sentence that dropped `{{count}}` would
  render a number nowhere.

## Writing entries

- **Whole sentences, one key.** Never split a sentence around a value: German
  puts the pieces in a different order, and half a sentence cannot be
  translated. A sentence with something inside it uses `{{interpolation}}`,
  or `<Trans>` where the inside is markup.
- **Counts use i18next plurals** — `thing_one` / `thing_other`, never
  `count === 1 ? … : …` in a component. Languages have between one and six
  plural categories and none of them is English's.
- **Code is not language.** A field path, a command or a key name stays in
  `<code>` or a `mono` span, which the extractor skips on purpose.

## Keys

Two levels, `namespace.key`, and no deeper: the check reads the catalogues
that way. A family of keys composed from a value -- `stage.ready`,
`problem.rate-limited` -- is a namespace of its own. `npm test` checks that
every key a component names, and every member of each such family, is in
every catalogue (`test/locales.test.js`).

`scripts/i18n.mjs --apply` is the Admin Console's extractor and is not used
here: it would rewrite `en.json` from inline strings, and this app has none.

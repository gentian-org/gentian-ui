# Languages

One file per language, named by its ISO 639-1 code: `en.json`, `de.json`.

**Adding a language is adding a file.** Copy `en.json`, translate the values,
save it as `<code>.json`. Nothing else changes — no import, no list, no code.
`src/lib/i18n.ts` globs this directory at build time, and the language chooser
in Settings is built from what it found.

`en.json` is the source. Every other file is a translation of it, and a key
missing from a translation renders the English sentence rather than a blank or
a raw key — so a language is shippable while it is still half done, and a new
string added to `en.json` does not break any other language.

Regional codes are not needed. `de-CH` and `de-AT` are both served `de.json`,
because nothing here differs between them; add `de-CH.json` only if something
genuinely does.

## Conventions

- Keys are dotted and named for **where** a string is used, not for what it
  says, so rewording a label is not a rename.
- Write in the language of the person using the desktop, not of the software.
- German uses the formal *Sie*, which is what a workplace tool is expected to
  use here.
- Interpolate with `{{name}}`; i18next handles plurals through suffixed keys
  (`key_one`, `key_other`) and the language's own plural categories, which is
  why this is a library rather than a lookup written here.

## Checking a translation is complete

```sh
python3 - <<'EOF'
import json, glob, io
def keys(d, p=""):
    out = set()
    for k, v in d.items():
        out |= keys(v, p + k + ".") if isinstance(v, dict) else {p + k}
    return out
src = keys(json.load(io.open("src/locales/en.json", encoding="utf-8")))
for f in sorted(glob.glob("src/locales/*.json")):
    if f.endswith("en.json"):
        continue
    missing = src - keys(json.load(io.open(f, encoding="utf-8")))
    print(f, "complete" if not missing else f"{len(missing)} missing: {sorted(missing)[:5]}")
EOF
```

#!/usr/bin/env node
// The desktop's own tile glyphs, as the PNGs a browser is given.
//
// The SVGs in assets/glyph-templates/ are templates and nothing else: no page
// ever draws one. This rasterizes each to public/tiles/<id>.png at SIZE x SIZE
// and writes public/tiles/catalogue.json, the list "customize tile" offers,
// from the template catalog beside them. Run it after changing a template
// and commit what it wrote:
//
//   npm run glyphs
//
// --check fails when a committed PNG or the catalog is missing or no longer
// what its template renders to.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const SIZE = 128;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const templates = join(root, "assets", "glyph-templates");
const out = join(root, "public", "tiles");
const check = process.argv.includes("--check");

const source = JSON.parse(readFileSync(join(templates, "catalogue.json"), "utf8"));
const ids = readdirSync(templates)
  .filter((name) => name.endsWith(".svg"))
  .map((name) => name.slice(0, -4))
  .sort();

const missing = Object.keys(source.tiles).filter((id) => !ids.includes(id));
if (missing.length) {
  console.error(`the catalog names glyphs that have no template: ${missing.join(", ")}`);
  process.exit(1);
}

function render(id) {
  const svg = readFileSync(join(templates, `${id}.svg`), "utf8");
  return new Resvg(svg, { fitTo: { mode: "width", value: SIZE }, font: { loadSystemFonts: false } })
    .render()
    .asPng();
}

const catalog = {
  version: 3,
  license: source.license,
  size: SIZE,
  tiles: Object.fromEntries(
    Object.entries(source.tiles).map(([id, tile]) => [id, { label: tile.label, glyph: `${id}.png` }]),
  ),
};
const catalogText = `${JSON.stringify(catalog, null, 2)}\n`;

const stale = [];
if (!check) mkdirSync(out, { recursive: true });
for (const id of ids) {
  const png = render(id);
  const target = join(out, `${id}.png`);
  if (check) {
    if (!existsSync(target) || !readFileSync(target).equals(png)) stale.push(`${id}.png`);
  } else {
    writeFileSync(target, png);
  }
}
const catalogTarget = join(out, "catalogue.json");
if (check) {
  if (!existsSync(catalogTarget) || readFileSync(catalogTarget, "utf8") !== catalogText) {
    stale.push("catalogue.json");
  }
  if (stale.length) {
    console.error(`public/tiles is not what the templates render to: ${stale.join(", ")}. Run npm run glyphs.`);
    process.exit(1);
  }
  console.log(`${ids.length} glyphs match their templates`);
} else {
  writeFileSync(catalogTarget, catalogText);
  console.log(`${ids.length} glyphs written to public/tiles at ${SIZE}x${SIZE}`);
}

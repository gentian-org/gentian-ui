// Which picture a tile is drawn with: raster images from inside the cluster,
// and nothing else.
//
//   node --test test/*.test.js

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_TILE_BYTES,
  personTileFileError,
  personTilePath,
  tileIconUrl,
  tileImageSrc,
} from "../src/lib/tiles.js";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const SVG = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";

test("a glyph is the desktop's own PNG", () => {
  assert.equal(tileIconUrl("files"), "/tiles/files.png");
  assert.equal(tileImageSrc("kube"), "/tiles/kube.png");
});

test("a name that is not a glyph's falls back to the generic one", () => {
  assert.equal(tileIconUrl("../config"), "/tiles/app.png");
  assert.equal(tileIconUrl(""), "/tiles/app.png");
  assert.equal(tileImageSrc(undefined), "/tiles/app.png");
});

test("a raster data URI is drawn as it is", () => {
  assert.equal(tileImageSrc(PNG), PNG);
  assert.equal(tileImageSrc("data:image/jpeg;base64,/9j/4A=="), "data:image/jpeg;base64,/9j/4A==");
});

test("an SVG is never drawn, whatever form it arrives in", () => {
  assert.equal(tileImageSrc(SVG), "/tiles/app.png");
  assert.equal(tileImageSrc("data:image/svg+xml;utf8,<svg/>"), "/tiles/app.png");
  assert.equal(tileImageSrc("data:image/png;base64,PHN2Zz4=<svg>"), "/tiles/app.png");
});

test("nothing is fetched from outside the cluster", () => {
  assert.equal(tileImageSrc("https://example.com/logo.png"), "/tiles/app.png");
  assert.equal(tileImageSrc("//example.com/logo.png"), "/tiles/app.png");
});

test("a picture the API serves is drawn from there", () => {
  const src = "/api/v1/tiles/kernel-acme/nextcloud/web?v=t1700000000";
  assert.equal(tileImageSrc(src), src);
  assert.equal(tileImageSrc("/api/v1/tiles/../prefs/background"), "/tiles/app.png");
});

test("a person uploads a PNG, JPEG or WebP of at most 1 MiB", () => {
  assert.equal(personTileFileError({ type: "image/png", size: 1000 }), null);
  assert.equal(personTileFileError({ type: "image/webp", size: MAX_TILE_BYTES }), null);
  assert.equal(personTileFileError({ type: "image/svg+xml", size: 100 }), "type");
  assert.equal(personTileFileError({ type: "image/png", size: MAX_TILE_BYTES + 1 }), "size");
});

test("a tile's id keeps its slashes in the path and nothing else", () => {
  assert.equal(personTilePath("kernel-acme/nextcloud/web"), "/person-tiles/kernel-acme/nextcloud/web");
  assert.equal(personTilePath("a b"), "/person-tiles/a%20b");
});

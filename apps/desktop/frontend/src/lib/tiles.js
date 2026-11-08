// Which picture a tile is drawn with, and from where.
//
// Every picture is a raster image from inside the cluster: one of the
// desktop's own glyphs (public/tiles/<id>.png), a picture this API serves
// (/api/v1/tiles/..., where the person's, the tenant's or the profile's is
// chosen), or a PNG, JPEG or WebP the tile carries as a data URI. Nothing else
// is drawn. An SVG -- a legacy profile picture, an old upload kept in a
// person's preferences -- is a document a browser would run, and is shown as
// the generic glyph instead. So is an address on another origin: drawing a
// tile never fetches anything from outside the cluster.

/** The picture any tile falls back to. */
export const FALLBACK_GLYPH = "app";

/** The most a person's own tile may weigh; the API refuses more. */
export const MAX_TILE_BYTES = 1024 * 1024;

/** What a person may upload as a tile. The API checks the bytes again. */
export const PERSON_TILE_TYPES = ["image/png", "image/jpeg", "image/webp"];

const GLYPH = /^[a-z0-9-]{1,63}$/;
const RASTER_DATA_URI = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const API_TILE = "/api/v1/tiles/";

/** One of the desktop's own glyphs, by name. */
export function tileIconUrl(iconId) {
  const id = typeof iconId === "string" ? iconId.trim() : "";
  return `/tiles/${GLYPH.test(id) ? id : FALLBACK_GLYPH}.png`;
}

/** Whether a picture is one this API serves, and so needs the person's session. */
export function isApiTile(src) {
  return typeof src === "string" && src.startsWith(API_TILE);
}

/** The address a tile's icon is drawn from. */
export function tileImageSrc(icon) {
  if (typeof icon !== "string" || !icon.trim()) return tileIconUrl(FALLBACK_GLYPH);
  const value = icon.trim();
  if (value.startsWith("data:")) {
    return RASTER_DATA_URI.test(value) ? value : tileIconUrl(FALLBACK_GLYPH);
  }
  if (isApiTile(value) && !value.includes("..")) return value;
  return tileIconUrl(value);
}

/** The API's path for a person's own picture of one tile. */
export function personTilePath(tileId) {
  return `/person-tiles/${tileId.split("/").map(encodeURIComponent).join("/")}`;
}

/** Why a file cannot be a person's tile, or null when it can. */
export function personTileFileError(file) {
  if (!PERSON_TILE_TYPES.includes(file.type)) return "type";
  if (file.size > MAX_TILE_BYTES) return "size";
  return null;
}

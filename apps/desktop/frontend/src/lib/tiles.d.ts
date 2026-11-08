/** The types of `tiles.js`; the reasons are written there. */

export const FALLBACK_GLYPH: string;
export const MAX_TILE_BYTES: number;
export const PERSON_TILE_TYPES: string[];
export function tileIconUrl(iconId: string): string;
export function isApiTile(src: unknown): boolean;
export function tileImageSrc(icon: unknown): string;
export function personTilePath(tileId: string): string;
export function personTileFileError(file: { type: string; size: number }): "type" | "size" | null;

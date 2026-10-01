/** Resolve app launcher tile SVG under frontend/public/tiles/. */
export function tileIconUrl(iconId: string): string {
  const id = iconId.trim() || "app";
  return `/tiles/${id}.svg`;
}

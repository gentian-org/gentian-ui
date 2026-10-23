// A page in one of the desktop's windows asks the desktop to open another of
// the person's apps in a window of its own:
//
//   window.parent.postMessage({type: "gentian:open-app", app: "admin-console",
//                              path: "/?tab=apps&app=nextcloud"}, "*")
//
// The App Store does, to open the Admin Console at an app. The desktop
// answers only a message that holds to all of these, and ignores any other in
// silence:
//
// * it comes from the origin of one of the person's own tiles;
// * it names an app the person has a tile for, by its component name (the
//   second part of a tile id, <tenant>/<component>/<exposure>);
// * its path is relative: it starts with one "/", with no scheme, no "//"
//   and no backslash, and opens on the target tile's own origin.

export const OPEN_APP = "gentian:open-app";
export const OPENED = "gentian:open-app:opened";

const COMPONENT = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
// Printable ASCII, a path and an optional query, nothing a browser reads as
// another origin.
const PATH = /^\/(?![/\\])[\x21-\x7e]{0,1000}$/;

function originOf(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

function componentOf(id) {
  const parts = String(id || "").replace(/^kernel-/, "").split("/");
  return parts.length >= 2 ? parts[1] : null;
}

/**
 * The window to open for a message, or null to ignore it.
 * @param {{origin: string, data: unknown}} event
 * @param {{id: string, title: string, launchUrl?: string | null}[]} apps the person's tiles
 */
export function openAppRequest(event, apps) {
  const data = event && event.data;
  if (!data || typeof data !== "object" || data.type !== OPEN_APP) return null;
  if (typeof data.app !== "string" || !COMPONENT.test(data.app)) return null;
  if (typeof data.path !== "string" || !PATH.test(data.path) || data.path.includes("\\")) return null;
  const list = Array.isArray(apps) ? apps : [];
  const fromOwnTile = list.some((app) => app.launchUrl && originOf(app.launchUrl) === event.origin);
  if (!fromOwnTile) return null;
  const target = list.find((app) => app.launchUrl && originOf(app.launchUrl) && componentOf(app.id) === data.app);
  if (!target) return null;
  const origin = originOf(target.launchUrl);
  let url;
  try {
    url = new URL(data.path, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  return { app: target, url: url.toString() };
}

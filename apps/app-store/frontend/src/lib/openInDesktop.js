// Opening the Admin Console at an app: in a window of the desktop when this
// app runs in one, and in a browser tab otherwise.
//
// The desktop opens another of the person's apps when a window asks with
// {type: "gentian:open-app", app, path} and answers "gentian:open-app:opened"
// (apps/desktop/frontend/src/lib/openApp.js). Without an answer in a moment
// -- no desktop around this page, or one that does not take it -- the
// address opens in a tab, as a link would.

export const OPEN_APP = "gentian:open-app";
export const OPENED = "gentian:open-app:opened";
const WAIT_MS = 400;

/** The path and query of an https address, or null. */
export function pathOf(href) {
  try {
    const url = new URL(href);
    return url.protocol === "https:" ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}

/**
 * Open `href`, an address of the component `app`, in a desktop window where
 * there is one. `win` is the window this page runs in.
 */
export function openInDesktop(app, href, win = window) {
  const path = pathOf(href);
  if (!path || win.parent === win) {
    win.open(href, "_blank", "noopener,noreferrer");
    return;
  }
  let answered = false;
  const onMessage = (event) => {
    if (event.source === win.parent && event.data && event.data.type === OPENED) answered = true;
  };
  win.addEventListener("message", onMessage);
  // The desktop's origin is not known here; the message names only an app
  // and a path of it, nothing that is not already on this page.
  win.parent.postMessage({ type: OPEN_APP, app, path }, "*");
  win.setTimeout(() => {
    win.removeEventListener("message", onMessage);
    if (!answered) win.open(href, "_blank", "noopener,noreferrer");
  }, WAIT_MS);
}

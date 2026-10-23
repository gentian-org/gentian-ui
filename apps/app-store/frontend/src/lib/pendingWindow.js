// A page shown in a frame -- on the desktop -- cannot take its window to a
// store's sign-in, and a checkout refuses to be framed. So such a page opens
// a window of its own, and it has to do that in the click itself: a browser
// lets a window be opened by a click, and blocks one opened later, once an
// answer from the API has come. The window is opened empty at once and sent
// to the address when it is known.

/** Open an empty window now, in the person's click. Null when it is blocked. */
export function openPending(win = window) {
  try {
    const opened = win.open("", "_blank");
    if (!opened) return null;
    // It is sent to another origin: it gets no hold on this page.
    try {
      opened.opener = null;
    } catch {
      // A browser that does not let it be set has already cut it.
    }
    return opened;
  } catch {
    return null;
  }
}

/** Send a window opened by openPending to `url`; false when it is gone. */
export function sendPending(pending, url) {
  if (!pending || pending.closed || typeof url !== "string" || !url.startsWith("https://")) return false;
  pending.location.href = url;
  return true;
}

/** Close a window that has nowhere to go: the request for its address failed. */
export function closePending(pending) {
  try {
    if (pending && !pending.closed) pending.close();
  } catch {
    // Nothing to close.
  }
}

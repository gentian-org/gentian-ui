// What raising a window does to its state, and what a window goes back to.
// Raising only brings a window out of minimized: every press on a window raises
// it, including the press on the restore button, so a raise that also ended
// "maximized" left a full-size window that the button then maximized again.

export function stateOnRaise(win) {
  return win.state === "minimized" ? (win.minimizedFrom ?? "normal") : win.state;
}

export function minimized(win) {
  return {
    state: "minimized",
    minimizedFrom: win.state === "minimized" ? win.minimizedFrom : win.state,
  };
}

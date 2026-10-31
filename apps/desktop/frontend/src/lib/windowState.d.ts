/** The types of `windowState.js`; the reasons are written there. */

type Visual = "normal" | "minimized" | "maximized";
type Shown = "normal" | "maximized";

export function stateOnRaise(win: { state: Visual; minimizedFrom?: Shown }): Visual;
export function minimized(win: { state: Visual; minimizedFrom?: Shown }): {
  state: "minimized";
  minimizedFrom?: Shown;
};

/** The types of `quickBar.js`; the reasons are written there. */

export function quickBarOrder(
  menuAppIds: string[] | undefined,
  menuRemovedAppIds: string[] | undefined,
  appIds: string[],
): string[];
export function moveToSlot(ids: string[], id: string, slotIds: string[], insertAt: number): string[];

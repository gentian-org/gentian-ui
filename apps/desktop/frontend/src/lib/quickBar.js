// The order of the quick bar.
//
// menuAppIds is a fixed list written the first time someone reorders or pins
// anything, so an app installed afterwards is not in it. Everything that reads
// or changes the order has to start from the order shown, not from that list.

/**
 * The ids the bar shows, in order: the saved list, then every app it does not
 * name and that was not taken off the bar on purpose.
 */
export function quickBarOrder(menuAppIds, menuRemovedAppIds, appIds) {
  const saved = menuAppIds || [];
  const listed = new Set(saved);
  const removed = new Set(menuRemovedAppIds || []);
  return [...saved, ...appIds.filter((id) => !listed.has(id) && !removed.has(id))];
}

/**
 * Move `id` so that it lands at slot `insertAt` of the slots shown. `ids` may
 * hold entries with no slot (uninstalled apps, revoked access, deleted link
 * tiles), so the slot is found by the id of the one that follows it rather than
 * by index. `id` itself is no anchor: a drop just before its own slot leaves it
 * in place.
 */
export function moveToSlot(ids, id, slotIds, insertAt) {
  const next = ids.filter((existing) => existing !== id);
  const anchor = slotIds.slice(insertAt).find((slot) => slot !== id);
  const at = anchor === undefined ? -1 : next.indexOf(anchor);
  next.splice(at === -1 ? next.length : at, 0, id);
  return next;
}

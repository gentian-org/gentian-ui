/* SPDX-License-Identifier: Apache-2.0 */

/**
 * Membership changes ticked and not saved yet: for each key (a group's path,
 * or a person's id), whether it is to be in (true) or out (false). A key that
 * is ticked back to what it is now leaves the draft, so an empty draft is
 * "nothing to save".
 */
export type MembershipDraft = Record<string, boolean>;

/** The draft after one box is ticked (true) or unticked (false). */
export function toggleDraft(draft: MembershipDraft, current: Set<string>, key: string, on: boolean): MembershipDraft {
  const next = { ...draft };
  if (current.has(key) === on) delete next[key];
  else next[key] = on;
  return next;
}

/** What the boxes show: what is now, with the draft applied. */
export function withDraft(current: Set<string>, draft: MembershipDraft): Set<string> {
  const shown = new Set(current);
  for (const [key, on] of Object.entries(draft)) {
    if (on) shown.add(key);
    else shown.delete(key);
  }
  return shown;
}

/** The draft without one key, once its change went through. */
export function withoutKey(draft: MembershipDraft, key: string): MembershipDraft {
  const next = { ...draft };
  delete next[key];
  return next;
}

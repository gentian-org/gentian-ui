import type { ObjectAccess, PersonAccess, PositionAccess } from "@/api/admin";
import type { CellKind } from "./RoleMatrix";

/** What a person holds on one thing: the tenant (app ""), or one app. */
export function accessOn(access: PersonAccess | undefined, app: string): ObjectAccess | undefined {
  if (!access) return undefined;
  return app ? access.apps.find((a) => a.app === app) : access.onTenant;
}

/**
 * How a person holds one role on one thing. `own` when it was given to them
 * themselves; `inherited` when it comes through a position, naming the
 * positions; `implied` when it is in effect without being given here (Admin
 * includes it, or a role on the base or an add-on brings it); `free` when not.
 */
export function personCell(
  access: PersonAccess | undefined,
  app: string,
  role: string,
): { kind: CellKind; positions: string[] } {
  const on = accessOn(access, app);
  if (!on) return { kind: "free", positions: [] };
  const held = on.held.filter((h) => h.role === role);
  if (held.some((h) => !h.position)) return { kind: "own", positions: [] };
  const positions = held.flatMap((h) => (h.position ? [h.position] : []));
  if (positions.length > 0) return { kind: "inherited", positions };
  if (on.roles.includes(role)) return { kind: "implied", positions: [] };
  return { kind: "free", positions: [] };
}

function key(app: string, role: string) {
  return `${app}/${role}`;
}

/**
 * The roles the positions ticked and not saved yet would bring, by app and
 * role, each naming the ticked positions that bring it: what each holds
 * itself and what it inherits through the positions it includes.
 */
export function draftGains(ticked: PositionAccess[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const position of ticked) {
    for (const hold of [...position.holds, ...(position.inherited ?? [])]) {
      const k = key(hold.app ?? "", hold.role);
      const names = out.get(k) ?? [];
      if (!names.includes(position.position)) out.set(k, [...names, position.position]);
    }
  }
  return out;
}

/**
 * The positions the person would no longer hold once the unticked ones are
 * taken away: each one held only as an unticked position itself or through
 * one that includes it. One still included by a kept position stays.
 */
export function draftLosses(access: PersonAccess | undefined, unticked: string[]): Set<string> {
  const gone = new Set(unticked);
  // For each position the person holds, whether each way they hold it goes.
  const ways = new Map<string, boolean[]>();
  for (const held of access?.positions ?? []) {
    const way = held.through ? gone.has(held.through) : gone.has(held.name);
    ways.set(held.name, [...(ways.get(held.name) ?? []), way]);
  }
  const lost = new Set<string>();
  for (const name of unticked) if (!ways.has(name)) lost.add(name);
  for (const [name, all] of ways) {
    if (all.every(Boolean)) lost.add(name);
  }
  return lost;
}

/**
 * How one cell would be once the draft is saved. `pendingGain` for a role not
 * in effect now that a ticked position would bring (Admin on a thing brings
 * every other role on it too); `pendingLoss` for a role that comes only
 * through positions that would be lost, or that follows only from an Admin
 * that would be. Anything else stays as it is saved.
 */
export function pendingCell(
  access: PersonAccess | undefined,
  gains: Map<string, string[]>,
  lost: Set<string>,
  app: string,
  role: string,
): { kind: CellKind; positions: string[] } {
  const saved = personCell(access, app, role);
  // Admin on a thing brings every other role on it.
  const throughAdmin = role !== "admin" ? (gains.get(key(app, "admin")) ?? []) : [];
  const gainedBy = [...new Set([...(gains.get(key(app, role)) ?? []), ...throughAdmin])];
  if (saved.kind === "free") return gainedBy.length > 0 ? { kind: "pendingGain", positions: gainedBy } : saved;
  // A ticked position brings it too: it stays, however it is held now.
  if (gainedBy.length > 0) return saved;
  const onlyThroughLost = (positions: string[]) => positions.length > 0 && positions.every((p) => lost.has(p));
  if (saved.kind === "inherited" && onlyThroughLost(saved.positions)) {
    return { kind: "pendingLoss", positions: saved.positions };
  }
  if (saved.kind === "implied" && role !== "admin") {
    const admin = personCell(access, app, "admin");
    if (admin.kind === "inherited" && onlyThroughLost(admin.positions)) {
      return { kind: "pendingLoss", positions: admin.positions };
    }
  }
  return saved;
}

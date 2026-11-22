import type { ObjectAccess, PersonAccess } from "@/api/admin";
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

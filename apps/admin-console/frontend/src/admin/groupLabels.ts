import type { PersonGroup } from "@/api/admin";

/** What a group is for, which decides where it is listed. */
export type GroupKind = "app" | "role" | "custom";

export type DescribedGroup = PersonGroup & { kind: GroupKind; label: string };

/**
 * A group as a person reads it, from the path the graph uses.
 *
 * The tenant's prefix is dropped -- every group on this screen is the tenant's,
 * so repeating "gentian:tenant:acme:" on each line says nothing. What is left is
 * "app:<profile>" for an app's entitlement, a label for a custom group, and the
 * platform's own roles (admin, app-admins) otherwise.
 */
export function describeGroup(group: PersonGroup, tenant: string): DescribedGroup {
  let rest = group.path;
  for (const prefix of [`gentian:tenant:${tenant}:`, "gentian:platform:"]) {
    if (rest.startsWith(prefix)) {
      rest = rest.slice(prefix.length);
      break;
    }
  }
  if (group.custom) return { ...group, kind: "custom", label: rest };
  if (rest.startsWith("app:")) return { ...group, kind: "app", label: rest.slice("app:".length) };
  return { ...group, kind: "role", label: rest };
}

/** The order the kinds are listed in: what most invitations are about first. */
export const GROUP_KINDS: GroupKind[] = ["app", "role", "custom"];

export function describeGroups(groups: PersonGroup[], tenant: string): DescribedGroup[] {
  return groups
    .map((g) => describeGroup(g, tenant))
    .sort((a, b) => a.label.localeCompare(b.label));
}

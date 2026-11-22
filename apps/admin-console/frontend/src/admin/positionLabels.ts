import type { TFunction } from "i18next";
import { SHIPPED_POSITIONS, type TenantPosition } from "@/api/admin";

/** Whether a position is one of the three every tenant has. */
export function isShipped(name: string) {
  return (SHIPPED_POSITIONS as readonly string[]).includes(name);
}

/**
 * A position as people read it: the platform's own words for the three every
 * tenant has, the title a tenant gave its own, and the name where it gave none.
 */
export function positionLabel(t: TFunction, name: string, own?: TenantPosition[]) {
  if (isShipped(name)) return t(`positions.shipped_${name}`, { defaultValue: name });
  return own?.find((p) => p.name === name)?.title || name;
}

/** The positions a tenant has, the three every tenant has first, each with its label. */
export function allPositions(t: TFunction, shipped: string[], own: TenantPosition[]) {
  const mine = [...own].sort((a, b) => (a.title || a.name).localeCompare(b.title || b.name));
  return [
    ...shipped.map((name) => ({ name, label: positionLabel(t, name), shipped: true })),
    ...mine.map((p) => ({ name: p.name, label: positionLabel(t, p.name, own), shipped: false })),
  ];
}

/** A role in words; one this console does not know, a declared one among them, stays as it is named. */
export function roleLabel(t: TFunction, type: string, role: string) {
  return t(`access.role_${type}_${role}`, { defaultValue: role });
}

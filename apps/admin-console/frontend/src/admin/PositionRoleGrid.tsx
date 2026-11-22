import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchPositionAccess, type PositionHold, type PositionRole, type TenantPosition } from "@/api/admin";
import { inheritedFrom } from "./AccessSection";
import { positionLabel, roleLabel } from "./positionLabels";
import { RoleMatrix, useMatrixRows, type GridRow } from "./RoleMatrix";

export { gridRows, type GridRow } from "./RoleMatrix";

function key(app: string, role: string) {
  return `${app}/${role}`;
}

/** Whether the position declares the role itself. */
export function holdsRole(roles: PositionRole[], app: string, role: string) {
  return roles.some((r) => (r.app ?? "") === app && r.role === role);
}

/** The position's roles with one role ticked or unticked. */
export function toggleRole(roles: PositionRole[], app: string, role: string, checked: boolean): PositionRole[] {
  const rest = roles.filter((r) => !((r.app ?? "") === app && r.role === role));
  if (!checked) return rest;
  return [...rest, app ? { app, role } : { role }];
}

/** The roles inherited through included positions, by app and role, each with its chain. */
export function inheritedByRole(inherited: PositionHold[] | undefined) {
  const out = new Map<string, string[]>();
  for (const hold of inherited ?? []) {
    out.set(key(hold.app ?? "", hold.role), hold.through ?? []);
  }
  return out;
}

/** The position's roles on something the grid has no row for: an app no longer installed, or one the platform places. */
export function strayRoles(roles: PositionRole[], rows: GridRow[]) {
  const shown = new Set(rows.map((row) => row.profile));
  return roles.filter((r) => !shown.has(r.app ?? ""));
}

/** How one cell is: ticked by the position, inherited, implied by Admin, or free. */
export type CellState =
  | { kind: "own" }
  | { kind: "inherited"; through: string[] }
  | { kind: "implied" }
  | { kind: "free" };

export function cellState(
  roles: PositionRole[],
  inherited: Map<string, string[]>,
  app: string,
  role: string,
): CellState {
  if (holdsRole(roles, app, role)) return { kind: "own" };
  const through = inherited.get(key(app, role));
  if (through) return { kind: "inherited", through };
  // Admin on a thing includes every other role on it.
  if (role !== "admin" && (holdsRole(roles, app, "admin") || inherited.has(key(app, "admin")))) {
    return { kind: "implied" };
  }
  return { kind: "free" };
}

/**
 * A position's roles as a grid: one row per thing (the tenant, every app,
 * its add-ons under it), one column per role every thing has, and the roles
 * an app declares in its own cell. Ticks edit the draft the position editor
 * saves whole. A role the position inherits through an included position is
 * shown ticked and grayed, naming where it comes from; one that Admin
 * includes is shown ticked and grayed too.
 */
export function PositionRoleGrid({
  name,
  own,
  roles,
  onChange,
}: {
  name: string;
  own: TenantPosition[];
  roles: PositionRole[];
  onChange: (roles: PositionRole[]) => void;
}) {
  const { t } = useTranslation();
  const { rows, declaredOf, loading, loaded } = useMatrixRows();
  const access = useQuery({
    queryKey: ["admin", "access", "position", name],
    queryFn: () => fetchPositionAccess(name),
    retry: false,
  });
  const inherited = inheritedByRole(access.data?.inherited);
  const strays = strayRoles(roles, rows);
  const label = (n: string) => positionLabel(t, n, own);
  const cell = (row: GridRow, role: string) => {
    const state = cellState(roles, inherited, row.profile, role);
    if (state.kind === "inherited") return { kind: state.kind, title: inheritedFrom(t, state.through, label) };
    if (state.kind === "implied") return { kind: state.kind, title: t("positions.gridImplied") };
    return { kind: state.kind };
  };

  if (loading) return <p className="admin-console__loading">{t("positions.loading")}</p>;
  return (
    <div className="admin-console__field">
      <span>{t("positions.roles")}</span>
      <RoleMatrix
        rows={rows}
        declaredOf={declaredOf}
        cell={cell}
        onToggle={(row, role, checked) => onChange(toggleRole(roles, row.profile, role, checked))}
        legend={{
          own: t("access.givenToThisPosition"),
          inherited: t("access.inheritedFromIncluded"),
          implied: t("positions.gridImplied"),
        }}
      />
      <p className="admin-console__hint">{t("positions.gridHint")}</p>
      {loaded && strays.length > 0 ? (
        <>
          <p className="admin-console__hint">{t("positions.gridStrays")}</p>
          <ul className="admin-console__access-list">
            {strays.map((r) => (
              <li key={key(r.app ?? "", r.role)}>
                {roleLabel(t, "app", r.role)} <code>{r.app}</code>{" "}
                <button
                  className="admin-console__btn admin-console__btn--quiet"
                  type="button"
                  onClick={() => onChange(toggleRole(roles, r.app ?? "", r.role, false))}
                >
                  {t("positions.removeRole")}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

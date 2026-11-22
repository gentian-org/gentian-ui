import { useQueries, useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  fetchAppAccess,
  fetchAppStates,
  fetchPositionAccess,
  type AppState,
  type PositionHold,
  type PositionRole,
  type TenantPosition,
} from "@/api/admin";
import { inheritedFrom } from "./AccessSection";
import { positionLabel, roleLabel } from "./positionLabels";

/** One row of the grid: the tenant (profile ""), an app, or an add-on under its app. */
export type GridRow = { profile: string; label: string; addon: boolean };

/** The rows: the tenant first, then every installed app by name, each followed by its add-ons. */
export function gridRows(t: TFunction, apps: AppState[]): GridRow[] {
  const rows: GridRow[] = [{ profile: "", label: t("positions.theTenant"), addon: false }];
  const installed = apps.filter((app) => app.origin !== "default");
  for (const app of [...installed].sort((a, b) => (a.name || a.profile).localeCompare(b.name || b.profile))) {
    rows.push({ profile: app.profile, label: app.name || app.profile, addon: false });
    for (const addon of [...(app.addons ?? [])].sort((a, b) => a.profile.localeCompare(b.profile))) {
      rows.push({ profile: addon.profile, label: addon.name || addon.profile, addon: true });
    }
  }
  return rows;
}

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
  const apps = useQuery({ queryKey: ["admin", "apps", "status"], queryFn: fetchAppStates });
  const access = useQuery({
    queryKey: ["admin", "access", "position", name],
    queryFn: () => fetchPositionAccess(name),
    retry: false,
  });
  const rows = gridRows(t, apps.data?.apps ?? []);
  const appRows = rows.filter((row) => row.profile !== "");
  const declared = useQueries({
    queries: appRows.map((row) => ({
      queryKey: ["admin", "access", "app", row.profile],
      queryFn: () => fetchAppAccess(row.profile),
      retry: false,
    })),
  });
  const declaredOf = new Map<string, string[]>();
  appRows.forEach((row, i) => {
    declaredOf.set(
      row.profile,
      (declared[i]?.data?.bindings ?? []).filter((b) => b.declared).map((b) => b.relation),
    );
  });
  const inherited = inheritedByRole(access.data?.inherited);
  const strays = strayRoles(roles, rows);
  const label = (n: string) => positionLabel(t, n, own);

  const cell = (row: GridRow, role: string, text?: string) => {
    const state = cellState(roles, inherited, row.profile, role);
    const locked = state.kind === "inherited" || state.kind === "implied";
    const title =
      state.kind === "inherited"
        ? inheritedFrom(t, state.through, label)
        : state.kind === "implied"
          ? t("positions.gridImplied")
          : roleLabel(t, row.profile ? "app" : "tenant", role);
    return (
      <label
        key={role}
        className={`admin-console__grid-cell admin-console__grid-cell--${state.kind}`}
        title={title}
      >
        <input
          type="checkbox"
          aria-label={`${row.label}: ${text ?? roleLabel(t, row.profile ? "app" : "tenant", role)}`}
          checked={state.kind !== "free"}
          disabled={locked}
          onChange={(e) => onChange(toggleRole(roles, row.profile, role, e.target.checked))}
        />
        {text ? <span>{text}</span> : null}
      </label>
    );
  };

  if (apps.isLoading) return <p className="admin-console__loading">{t("positions.loading")}</p>;
  return (
    <div className="admin-console__field">
      <span>{t("positions.roles")}</span>
      <p className="admin-console__access-legend">
        <span className="admin-console__access-swatch admin-console__access-swatch--own" />{" "}
        {t("access.givenToThisPosition")}{" "}
        <span className="admin-console__access-swatch admin-console__access-swatch--inherited" />{" "}
        {t("access.inheritedFromIncluded")}
      </p>
      <div className="admin-console__grid-scroll">
        <table className="admin-console__table admin-console__role-grid">
          <thead>
            <tr>
              <th>{t("positions.gridThing")}</th>
              <th>{t("positions.gridUser")}</th>
              <th>{t("positions.gridAdmin")}</th>
              <th>{t("positions.gridOther")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.profile || "tenant"}>
                <td className={row.addon ? "admin-console__grid-addon" : undefined}>
                  {row.addon ? "└ " : ""}
                  {row.label}
                </td>
                <td>{cell(row, "user")}</td>
                <td>{cell(row, "admin")}</td>
                <td>
                  {(declaredOf.get(row.profile) ?? []).map((role) => cell(row, role, role))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="admin-console__hint">{t("positions.gridHint")}</p>
      {apps.data && strays.length > 0 ? (
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

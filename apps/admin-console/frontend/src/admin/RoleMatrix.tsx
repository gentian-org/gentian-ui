import { useQueries, useQuery } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { fetchAppAccess, fetchAppStates, type AppState } from "@/api/admin";
import { roleLabel } from "./positionLabels";

/** One row of a matrix: the tenant (profile ""), an app, or an add-on under its app. */
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

/**
 * How one cell is. `own`: given here (to this position, or to this person
 * themselves). `inherited`: held through another position. `implied`: follows
 * from a role held on the same thing, such as Admin. `free`: not held.
 */
export type CellKind = "own" | "inherited" | "implied" | "free";
export type Cell = { kind: CellKind; title?: string };

/** The matrix's rows and the roles each app declares, read from the cluster. */
export function useMatrixRows() {
  const { t } = useTranslation();
  const apps = useQuery({ queryKey: ["admin", "apps", "status"], queryFn: fetchAppStates });
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
  return { rows, declaredOf, loading: apps.isLoading, loaded: Boolean(apps.data) };
}

/**
 * Roles as a matrix: one row per thing (the tenant, every installed app, its
 * add-ons under it), columns User and Admin, and the roles an app declares in
 * the last column. Each cell is colored by how it is held; its title says
 * why. Without `onToggle` it only shows.
 */
export function RoleMatrix({
  rows,
  declaredOf,
  cell,
  onToggle,
  busy,
  legend,
}: {
  rows: GridRow[];
  declaredOf: Map<string, string[]>;
  cell: (row: GridRow, role: string) => Cell;
  onToggle?: (row: GridRow, role: string, checked: boolean) => void;
  busy?: boolean;
  legend: { own: string; inherited: string; implied?: string };
}) {
  const { t } = useTranslation();
  const box = (row: GridRow, role: string, text?: string) => {
    const state = cell(row, role);
    const name = text ?? roleLabel(t, row.profile ? "app" : "tenant", role);
    const locked = !onToggle || busy || state.kind === "inherited" || state.kind === "implied";
    return (
      <label
        key={role}
        className={`admin-console__grid-cell admin-console__grid-cell--${state.kind}`}
        title={state.title ?? name}
      >
        <input
          type="checkbox"
          aria-label={`${row.label}: ${name}`}
          checked={state.kind !== "free"}
          disabled={locked}
          readOnly={!onToggle}
          onChange={(e) => onToggle?.(row, role, e.target.checked)}
        />
        {text ? <span>{text}</span> : null}
      </label>
    );
  };
  return (
    <>
      <p className="admin-console__access-legend">
        <span className="admin-console__access-swatch admin-console__access-swatch--own" /> {legend.own}
        <span className="admin-console__access-swatch admin-console__access-swatch--inherited" /> {legend.inherited}
        {legend.implied ? (
          <>
            <span className="admin-console__access-swatch admin-console__access-swatch--implied" /> {legend.implied}
          </>
        ) : null}
      </p>
      <div className="admin-console__grid-scroll">
        <table className="admin-console__table admin-console__role-grid">
          <colgroup>
            <col className="admin-console__role-grid-thing" />
            <col className="admin-console__role-grid-box" />
            <col className="admin-console__role-grid-box" />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>{t("positions.gridThing")}</th>
              <th className="admin-console__role-grid-center">{t("positions.gridUser")}</th>
              <th className="admin-console__role-grid-center">{t("positions.gridAdmin")}</th>
              <th>{t("positions.gridOther")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.profile || "tenant"}>
                <td className={row.addon ? "admin-console__grid-addon" : undefined} title={row.profile || undefined}>
                  {row.addon ? "└ " : ""}
                  {row.label}
                </td>
                <td className="admin-console__role-grid-center">{box(row, "user")}</td>
                <td className="admin-console__role-grid-center">{box(row, "admin")}</td>
                <td>{(declaredOf.get(row.profile) ?? []).map((role) => box(row, role, role))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

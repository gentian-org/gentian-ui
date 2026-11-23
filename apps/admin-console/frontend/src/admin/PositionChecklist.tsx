import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { SHIPPED_POSITIONS, type TenantPosition } from "@/api/admin";
import { allPositions } from "./positionLabels";

/**
 * The positions that have every app whatever is ticked, each with the hint
 * that says why: All apps uses every app, App administrator administers it.
 */
const ALWAYS: Record<string, string> = {
  "all-apps": "positionChecklist.allApps",
  "app-administrator": "positionChecklist.always",
};

/** The position no app is given to: it enters the tenant, its desktop, and nothing else. */
const NO_APP = "user";

/** The positions an app can be given to or kept from, by name: the tenant's, but none that has every app or none. */
export function choosablePositions(own: TenantPosition[]) {
  return [...SHIPPED_POSITIONS.filter((name) => !(name in ALWAYS) && name !== NO_APP), ...own.map((p) => p.name)];
}

/** What the box at the top shows for a selection: all, none, or some. */
export function headerState(choosable: string[], selected: ReadonlySet<string>) {
  const ticked = choosable.filter((name) => selected.has(name)).length;
  if (ticked === 0) return "none" as const;
  return ticked === choosable.length ? ("all" as const) : ("some" as const);
}

/** The selection after the box at the top is pressed: everything unless everything was ticked already. */
export function toggledAll(choosable: string[], selected: ReadonlySet<string>) {
  return headerState(choosable, selected) === "all" ? new Set<string>() : new Set(choosable);
}

/**
 * Who gets an app: the tenant's positions, each with a box, and one box at
 * the top that ticks all of them or none.
 *
 * A ticked position holds the app's role user, so everybody who holds the
 * position uses the app. User gives no app and is not listed. All apps and
 * App administrator have every app and are shown ticked, not to change.
 */
export function PositionChecklist({
  own,
  selected,
  disabled,
  onChange,
}: {
  own: TenantPosition[];
  selected: ReadonlySet<string>;
  disabled?: boolean;
  onChange: (next: Set<string>) => void;
}) {
  const { t } = useTranslation();
  const choosable = choosablePositions(own);
  const listed = allPositions(t, [...SHIPPED_POSITIONS], own).filter((position) => position.name !== NO_APP);
  const state = headerState(choosable, selected);
  const header = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (header.current) header.current.indeterminate = state === "some";
  }, [state]);

  function toggle(name: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(name);
    else next.delete(name);
    onChange(next);
  }

  return (
    <>
      <table className="admin-console__table">
        <thead>
          <tr>
            <th>
              <label className="admin-console__checkbox">
                <input
                  ref={header}
                  type="checkbox"
                  checked={state === "all"}
                  disabled={disabled}
                  aria-label={state === "all" ? t("positionChecklist.selectNone") : t("positionChecklist.selectAll")}
                  onChange={() => onChange(toggledAll(choosable, selected))}
                />
                <span>{t("positionChecklist.position")}</span>
              </label>
            </th>
          </tr>
        </thead>
        <tbody>
          {listed.map((position) => {
            const always = ALWAYS[position.name];
            return (
              <tr key={position.name}>
                <td>
                  <label className="admin-console__checkbox">
                    <input
                      type="checkbox"
                      checked={Boolean(always) || selected.has(position.name)}
                      disabled={disabled || Boolean(always)}
                      onChange={(e) => toggle(position.name, e.target.checked)}
                    />
                    <span>
                      {position.label}
                      {always ? <span className="admin-console__hint"> {t(always)}</span> : null}
                    </span>
                  </label>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

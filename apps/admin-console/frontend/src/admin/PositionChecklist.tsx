import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { SHIPPED_POSITIONS, type TenantPosition } from "@/api/admin";
import { allPositions } from "./positionLabels";

/** The position whose holders administer every app: it has each app whatever is ticked. */
const ALWAYS = "app-administrator";

/** The positions an app can be given to or kept from, by name: all of the tenant's but the one that has every app. */
export function choosablePositions(own: TenantPosition[]) {
  return [...SHIPPED_POSITIONS.filter((name) => name !== ALWAYS), ...own.map((p) => p.name)];
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
 * position uses the app. User is every person of the tenant. App
 * administrator administers every app and is shown ticked, not to change.
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
          {allPositions(t, [...SHIPPED_POSITIONS], own).map((position) => {
            const always = position.name === ALWAYS;
            return (
              <tr key={position.name}>
                <td>
                  <label className="admin-console__checkbox">
                    <input
                      type="checkbox"
                      checked={always || selected.has(position.name)}
                      disabled={disabled || always}
                      onChange={(e) => toggle(position.name, e.target.checked)}
                    />
                    <span>
                      {position.label}
                      {position.name === "user" ? (
                        <span className="admin-console__hint"> {t("positionChecklist.userIsEveryone")}</span>
                      ) : null}
                      {always ? <span className="admin-console__hint"> {t("positionChecklist.always")}</span> : null}
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

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GROUP_KINDS, type DescribedGroup } from "./groupLabels";

/** Above this many groups the list gets a filter field. */
const FILTER_FROM = 8;

/**
 * A dropdown of checkboxes for choosing groups.
 *
 * A dropdown rather than a row of buttons, because a tenant gains a group with
 * every app it installs and a row of buttons stops fitting on a screen long
 * before a tenant stops installing apps. Checkboxes inside it, so what is
 * chosen is visible without opening anything else; a scrolling list with a
 * filter once there are more than a handful.
 */
export function GroupPicker({
  id,
  groups,
  selected,
  onToggle,
  disabled,
}: {
  id: string;
  groups: DescribedGroup[];
  selected: string[];
  onToggle: (path: string, checked: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const root = useRef<HTMLDivElement>(null);

  // Closed by a click anywhere else, as a dropdown is.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const chosen = new Set(selected);
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? groups.filter((g) => g.label.toLowerCase().includes(f)) : groups;
  }, [groups, filter]);

  const summary =
    selected.length === 0
      ? t("groupPicker.none")
      : groups
          .filter((g) => chosen.has(g.path))
          .map((g) => g.label)
          .join(", ");

  return (
    <div className="admin-console__picker" ref={root}>
      <button
        id={id}
        type="button"
        className="admin-console__picker-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <span className="admin-console__picker-summary">{summary}</span>
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="admin-console__picker-panel" role="listbox" aria-multiselectable="true">
          {groups.length > FILTER_FROM && (
            <input
              type="search"
              className="admin-console__picker-filter"
              placeholder={t("groupPicker.filter")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
            />
          )}
          <div className="admin-console__picker-list">
            {GROUP_KINDS.map((kind) => {
              const inKind = visible.filter((g) => g.kind === kind);
              if (inKind.length === 0) return null;
              return (
                <div key={kind} className="admin-console__picker-section">
                  <div className="admin-console__picker-heading">{t(`groupPicker.kind_${kind}`)}</div>
                  {inKind.map((g) => (
                    <label key={g.path} className="admin-console__checkbox">
                      <input
                        type="checkbox"
                        checked={chosen.has(g.path)}
                        onChange={(e) => onToggle(g.path, e.target.checked)}
                      />
                      <span>{g.label}</span>
                    </label>
                  ))}
                </div>
              );
            })}
            {visible.length === 0 && <p className="admin-console__hint">{t("groupPicker.noMatch")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

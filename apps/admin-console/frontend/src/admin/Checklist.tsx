import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export type ChecklistItem = { key: string; label: string; detail?: string; section?: string };

/** Above this many rows the box gets a filter field. */
const FILTER_FROM = 10;

/**
 * A fixed-size box of rows, one per choice, each a checkbox followed by its
 * name, that scrolls once there are more rows than fit.
 *
 * Fixed rather than growing because a tenant gains a group with every app it
 * installs: a list that grew would push the rest of the form off the screen,
 * and a row of buttons stops fitting long before a tenant stops installing
 * apps. Rows rather than a pop-up, so what is chosen is in view while the rest
 * of the form is filled in.
 */
export function Checklist({
  id,
  items,
  selected,
  onToggle,
  disabled,
  sectionLabel,
}: {
  id: string;
  items: ChecklistItem[];
  selected: Set<string>;
  onToggle: (key: string, checked: boolean) => void;
  disabled?: boolean;
  /** Heading for each item's section, when items carry one. */
  sectionLabel?: (section: string) => string;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? items.filter((i) => `${i.label} ${i.detail ?? ""}`.toLowerCase().includes(f)) : items;
  }, [items, filter]);

  const sections: string[] = [];
  for (const i of visible) {
    const s = i.section ?? "";
    if (!sections.includes(s)) sections.push(s);
  }

  return (
    <div className="admin-console__checklist-wrap">
      {items.length > FILTER_FROM && (
        <input
          type="search"
          className="admin-console__checklist-filter"
          placeholder={t("checklist.filter")}
          aria-controls={id}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      <div id={id} className="admin-console__checklist" role="group">
        {sections.map((section) => (
          <div key={section || "-"}>
            {section && sectionLabel && (
              <div className="admin-console__checklist-heading">{sectionLabel(section)}</div>
            )}
            {visible
              .filter((i) => (i.section ?? "") === section)
              .map((i) => (
                <label key={i.key} className="admin-console__checklist-row">
                  <input
                    type="checkbox"
                    checked={selected.has(i.key)}
                    disabled={disabled}
                    onChange={(e) => onToggle(i.key, e.target.checked)}
                  />
                  <span className="admin-console__checklist-label">{i.label}</span>
                  {i.detail && <span className="admin-console__checklist-detail">{i.detail}</span>}
                </label>
              ))}
          </div>
        ))}
        {visible.length === 0 && <p className="admin-console__checklist-empty">{t("checklist.empty")}</p>}
      </div>
    </div>
  );
}

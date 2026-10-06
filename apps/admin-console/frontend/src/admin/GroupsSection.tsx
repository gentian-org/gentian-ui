import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createCustomGroup,
  deleteCustomGroup,
  fetchPersonGroups,
  renameCustomGroup,
} from "@/api/admin";
import { GroupMembers } from "./GroupMembers";
import { GROUP_KINDS, describeGroups, type DescribedGroup } from "./groupLabels";
import "./admin.css";

/**
 * The tenant's groups: the ones the platform composes -- an app's entitlement,
 * the tenant's administrators -- and the ones an administrator makes here.
 *
 * Every group can be opened to choose who is in it. A custom group can also be
 * renamed and deleted; the platform's own keep their names and go with the app
 * or tenant they belong to, because other things find them by name and
 * deleting one would only have it made again, empty.
 */
export function GroupsSection({ tenant }: { tenant: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const groupsQuery = useQuery({
    queryKey: ["admin", "people", "groups"],
    queryFn: () => fetchPersonGroups(),
  });
  const groups = useMemo(
    () => describeGroups(groupsQuery.data?.groups ?? [], tenant),
    [groupsQuery.data, tenant],
  );
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["admin", "people"] });

  const create = useMutation({
    mutationFn: () => createCustomGroup(name.trim()),
    onSuccess: () => {
      setName("");
      refresh();
    },
  });

  if (groupsQuery.isLoading) {
    return <p className="admin-console__loading">{t("groups.loading")}</p>;
  }
  if (groupsQuery.isError) {
    return (
      <p className="admin-console__error">
        {t("groups.cannotBeRead")} {String(groupsQuery.error)}
      </p>
    );
  }

  return (
    <section>
      <header className="admin-console__section-head">
        <div>
          <h2 className="admin-console__section-title">{t("groups.title")}</h2>
          <p className="admin-console__lead">{t("groups.lead")}</p>
        </div>
      </header>

      <div className="admin-console__cards">
        <div className="admin-console__card">
          <form
            className="admin-console__card-main admin-console__form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate();
            }}
          >
            <h3 className="admin-console__card-title">{t("groups.createTitle")}</h3>
            <p className="admin-console__card-desc">{t("groups.createLead")}</p>
            <div className="admin-console__field-row">
              <div className="admin-console__field">
                <label htmlFor="group-name">{t("groups.name")}</label>
                <input
                  id="group-name"
                  value={name}
                  placeholder={t("groups.namePlaceholder")}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                />
              </div>
            </div>
            {create.isError && <p className="admin-console__error">{String(create.error)}</p>}
            <div className="admin-console__form-footer">
              <button
                className="admin-console__btn admin-console__btn--primary"
                type="submit"
                disabled={!name.trim() || create.isPending}
              >
                {t("groups.create")}
              </button>
            </div>
          </form>
        </div>

        {GROUP_KINDS.map((kind) => {
          const inKind = groups.filter((g) => g.kind === kind);
          if (inKind.length === 0) return null;
          return (
            <div key={kind} className="admin-console__card">
              <div className="admin-console__card-main">
                <h3 className="admin-console__card-title">{t(`groupPicker.kind_${kind}`)}</h3>
                <table className="admin-console__table">
                  <thead>
                    <tr>
                      <th>{t("groups.name")}</th>
                      <th>{t("groups.path")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {inKind.map((g) => (
                      <GroupRow
                        key={g.path}
                        group={g}
                        open={open === g.path}
                        onToggle={() => setOpen(open === g.path ? null : g.path)}
                        onChanged={(renamedTo) => {
                          if (renamedTo !== undefined) setOpen(renamedTo);
                          refresh();
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
        {groups.length === 0 && <p className="admin-console__empty">{t("groups.none")}</p>}
      </div>
    </section>
  );
}

function GroupRow({
  group,
  open,
  onToggle,
  onChanged,
}: {
  group: DescribedGroup;
  open: boolean;
  onToggle: () => void;
  /** After a change; the new path when the group was renamed, null when deleted. */
  onChanged: (renamedTo?: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <tr className={open ? "admin-console__row--editing" : undefined}>
        <td>{group.label}</td>
        <td className="admin-console__mono">{group.path}</td>
        <td>
          <button className="admin-console__btn admin-console__btn--quiet" type="button" onClick={onToggle}>
            {open ? t("groups.close") : t("groups.edit")}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={3}>
            <GroupEditor group={group} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * One group, opened: who is in it, ticked from the tenant's members, and for a
 * custom group its name. Membership changes as each box is ticked, the same as
 * on a member's own page.
 */
function GroupEditor({
  group,
  onChanged,
}: {
  group: DescribedGroup;
  onChanged: (renamedTo?: string | null) => void;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(group.label);

  const rename = useMutation({
    mutationFn: () => renameCustomGroup(group.path, label.trim()),
    onSuccess: (renamed) => onChanged(renamed.path),
  });
  const remove = useMutation({
    mutationFn: () => deleteCustomGroup(group.path),
    onSuccess: () => onChanged(null),
  });
  const failure = [rename, remove].find((m) => m.isError)?.error;

  return (
    <div className="admin-console__editor">
      {group.custom && (
        <div className="admin-console__field-row">
          <div className="admin-console__field">
            <label htmlFor={`g-name-${group.id}`}>{t("groups.name")}</label>
            <input
              id={`g-name-${group.id}`}
              value={label}
              onChange={(e) => setLabel(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            />
          </div>
          <div className="admin-console__field" />
        </div>
      )}

      <div className="admin-console__field">
        <span>{t("groups.whoIsIn")}</span>
        <GroupMembers group={group} />
      </div>

      {failure && <p className="admin-console__error">{String(failure)}</p>}

      {group.custom && (
        <div className="admin-console__editor-footer">
          <button
            className="admin-console__btn admin-console__btn--danger"
            type="button"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(t("groups.deleteConfirm", { name: group.label }))) remove.mutate();
            }}
          >
            {t("groups.delete")}
          </button>
          <button
            className="admin-console__btn admin-console__btn--primary"
            type="button"
            disabled={!label.trim() || label.trim() === group.label || rename.isPending}
            onClick={() => rename.mutate()}
          >
            {t("groups.rename")}
          </button>
        </div>
      )}
    </div>
  );
}

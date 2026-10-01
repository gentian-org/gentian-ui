import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createCustomGroup,
  deleteCustomGroup,
  fetchGroupMembers,
  fetchPersonGroups,
} from "@/api/admin";
import { GROUP_KINDS, describeGroups, type DescribedGroup } from "./groupLabels";
import "./admin.css";

/**
 * The tenant's groups: the ones the platform composes -- an app's entitlement,
 * the tenant's administrators -- and the ones an administrator makes here.
 *
 * Membership is changed from a member's own page; this one says who is in a
 * group, and makes and removes custom groups. A group the platform composed is
 * not deleted from here: it goes with the app or the tenant it belongs to, and
 * deleting it would only have it made again, empty.
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
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["admin", "people", "groups"] });

  const create = useMutation({
    mutationFn: () => createCustomGroup(name.trim()),
    onSuccess: () => {
      setName("");
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (path: string) => deleteCustomGroup(path),
    onSuccess: refresh,
  });

  if (groupsQuery.isLoading) {
    return <p className="admin-console__loading">{t("groups.loading")}</p>;
  }
  if (groupsQuery.isError) {
    return <p className="admin-console__error">{t("groups.cannotBeRead")} {String(groupsQuery.error)}</p>;
  }

  return (
    <section>
      <header className="admin-console__section-head">
        <div>
          <h2 className="admin-console__section-title">{t("groups.title")}</h2>
          <p className="admin-console__lead">{t("groups.lead")}</p>
        </div>
      </header>

      <div className="admin-console__card">
        <form
          className="admin-console__card-main"
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

      {remove.isError && <p className="admin-console__error">{String(remove.error)}</p>}

      {GROUP_KINDS.map((kind) => {
        const inKind = groups.filter((g) => g.kind === kind);
        if (inKind.length === 0) return null;
        return (
          <div key={kind} className="admin-console__card">
            <div className="admin-console__card-main">
              <h3 className="admin-console__card-title">{t(`groupPicker.kind_${kind}`)}</h3>
              <table className="admin-console__table">
                <tbody>
                  {inKind.map((g) => (
                    <GroupRow
                      key={g.path}
                      group={g}
                      open={open === g.path}
                      onToggle={() => setOpen(open === g.path ? null : g.path)}
                      onDelete={() => {
                        if (window.confirm(t("groups.deleteConfirm", { name: g.label }))) remove.mutate(g.path);
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
    </section>
  );
}

function GroupRow({
  group,
  open,
  onToggle,
  onDelete,
}: {
  group: DescribedGroup;
  open: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const members = useQuery({
    queryKey: ["admin", "people", "group-members", group.path],
    queryFn: () => fetchGroupMembers(group.path),
    enabled: open,
  });
  const people = members.data?.people ?? [];
  return (
    <>
      <tr>
        <td>{group.label}</td>
        <td className="admin-console__mono">{group.path}</td>
        <td>
          <div className="admin-console__actions">
            <button className="admin-console__btn admin-console__btn--quiet" type="button" onClick={onToggle}>
              {open ? t("groups.hideMembers") : t("groups.showMembers")}
            </button>
            {group.custom && (
              <button className="admin-console__btn admin-console__btn--danger" type="button" onClick={onDelete}>
                {t("groups.delete")}
              </button>
            )}
          </div>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={3}>
            {members.isLoading ? (
              <p className="admin-console__hint">{t("groups.readingMembers")}</p>
            ) : people.length === 0 ? (
              <p className="admin-console__hint">{t("groups.noMembers")}</p>
            ) : (
              <ul className="admin-console__stack">
                {people.map((p) => (
                  <li key={p.id}>
                    <span className="admin-console__mono">{p.username}</span>
                    {p.name ? ` — ${p.name}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchAppAccess,
  fetchPeople,
  fetchPositions,
  setAssignment,
  type AuthorizationBinding,
  type Person,
} from "@/api/admin";
import { positionLabel, roleLabel } from "./positionLabels";

function personName(person: Person) {
  return person.name ? `${person.name} (${person.username})` : person.username;
}

/**
 * The roles of an app in the order they are offered: user, the ones its
 * profile declares, admin. From the app's own access, so a role nobody holds
 * is offered too.
 */
export function rolesOffered(bindings: AuthorizationBinding[]) {
  const declared = bindings.filter((b) => b.declared).map((b) => b.relation);
  return ["user", ...declared, "admin"];
}

/** The accounts that were given a role on the app directly, by role. */
export function directHolders(bindings: AuthorizationBinding[]) {
  return bindings.flatMap((binding) =>
    binding.holders.filter((h) => h.kind === "person").map((h) => ({ role: binding.relation, person: h.name })),
  );
}

/**
 * Who holds which role on one app, or one add-on, and giving a role to a
 * single person.
 *
 * An app is used by whoever holds a role on it. Mostly that is a position:
 * the people who hold it are changed on Positions, and it is shown here by
 * its name. A role given to one person beside their position is the
 * exception; it is given and taken here, and written at once.
 */
export function RoleHolders({ profile }: { profile: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [person, setPerson] = useState("");
  const [role, setRole] = useState("user");

  const access = useQuery({
    queryKey: ["admin", "access", "app", profile],
    queryFn: () => fetchAppAccess(profile),
    retry: false,
  });
  const people = useQuery({ queryKey: ["admin", "people", ""], queryFn: () => fetchPeople() });
  const positions = useQuery({ queryKey: ["admin", "positions"], queryFn: () => fetchPositions() });
  const change = useMutation({
    mutationFn: (input: { person: string; role: string; holds: boolean }) =>
      setAssignment({ person: input.person, assignment: { app: profile, role: input.role }, holds: input.holds }),
    onSuccess: () => {
      setPerson("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "access"] });
    },
  });

  if (access.isLoading) return <p className="admin-console__hint">{t("roleHolders.reading")}</p>;
  if (access.isError || !access.data) return <p className="admin-console__error">{t("roleHolders.cannotBeRead")}</p>;

  const bindings = access.data.bindings;
  const own = positions.data?.positions ?? [];
  const everyone = people.data?.people ?? [];
  const byId = new Map(everyone.map((p) => [p.id, p]));
  const nameOf = (id: string) => {
    const known = byId.get(id);
    return known ? personName(known) : id;
  };
  const sorted = [...everyone].sort((a, b) => personName(a).localeCompare(personName(b)));

  return (
    <>
      <table className="admin-console__table">
        <thead>
          <tr>
            <th>{t("roleHolders.role")}</th>
            <th>{t("roleHolders.heldBy")}</th>
          </tr>
        </thead>
        <tbody>
          {bindings.map((binding) => (
            <tr key={binding.relation}>
              <td>
                {roleLabel(t, "app", binding.relation)}{" "}
                {binding.declared ? <span className="admin-console__badge">{t("roleHolders.declared")}</span> : null}
              </td>
              <td>
                {binding.holders.length === 0 ? (
                  <span className="admin-console__empty">{t("roleHolders.nobody")}</span>
                ) : (
                  binding.holders.map((holder) =>
                    holder.kind === "person" ? (
                      <span key={`person/${holder.name}`} className="admin-console__badge admin-console__badge--warn">
                        {nameOf(holder.name)}{" "}
                        <button
                          className="admin-console__btn admin-console__btn--quiet"
                          type="button"
                          disabled={change.isPending}
                          onClick={() => {
                            const question = t("roleHolders.takeConfirm", {
                              person: nameOf(holder.name),
                              role: roleLabel(t, "app", binding.relation),
                              app: profile,
                            });
                            if (window.confirm(question)) {
                              change.mutate({ person: holder.name, role: binding.relation, holds: false });
                            }
                          }}
                        >
                          {t("roleHolders.take")}
                        </button>
                      </span>
                    ) : (
                      <span key={`${holder.kind}/${holder.name}`} className="admin-console__badge">
                        {holder.kind === "position" ? positionLabel(t, holder.name, own) : holder.name}
                      </span>
                    ),
                  )
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="admin-console__hint">{t("roleHolders.hint")}</p>

      <div className="admin-console__field-row">
        <label className="admin-console__field">
          <span className="admin-console__label-text">{t("roleHolders.giveTo")}</span>
          <select value={person} disabled={people.isLoading} onChange={(e) => setPerson(e.target.value)}>
            <option value="">{t("roleHolders.choosePerson")}</option>
            {sorted.map((p) => (
              <option key={p.id} value={p.id}>
                {personName(p)}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-console__field">
          <span className="admin-console__label-text">{t("roleHolders.theRole")}</span>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {rolesOffered(bindings).map((r) => (
              <option key={r} value={r}>
                {roleLabel(t, "app", r)}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-console__field">
          <button
            className="admin-console__btn admin-console__btn--primary"
            type="button"
            disabled={!person || change.isPending}
            onClick={() => change.mutate({ person, role, holds: true })}
          >
            {t("roleHolders.give")}
          </button>
        </div>
      </div>
      {change.isError && <p className="admin-console__error">{String(change.error)}</p>}
      {change.data?.warning ? <p className="admin-console__error">{change.data.warning}</p> : null}
    </>
  );
}

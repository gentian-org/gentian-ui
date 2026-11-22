import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchAppAccess,
  fetchAppStates,
  fetchPeople,
  fetchPositionAccess,
  fetchPositions,
  removePosition,
  setAssignment,
  setPosition,
  SHIPPED_POSITIONS,
  type Person,
  type PositionRole,
  type TenantPosition,
} from "@/api/admin";
import { PositionAccessView } from "./AccessSection";
import { allPositions, positionLabel, roleLabel } from "./positionLabels";
import "./admin.css";

/**
 * The tenant's positions: named sets of roles a kind of person holds.
 *
 * Three every tenant has -- a person of the tenant, the administrator of its
 * apps, the administrator of the tenant -- and the ones the tenant declares
 * here: "Sales intern", "Engineering manager". A person is given a position,
 * not a list of roles; a role given to one person beside their position is the
 * exception and is made on that person's own page.
 *
 * What a position is, is declared and takes a moment to arrive: the director
 * commits it and the cluster follows. Who holds one is written at once.
 */
export function PositionsSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const query = useQuery({ queryKey: ["admin", "positions"], queryFn: () => fetchPositions() });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "positions"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "access"] });
  };

  const create = useMutation({
    mutationFn: () => setPosition({ name: name.trim(), title: title.trim() }),
    onSuccess: () => {
      setOpen(name.trim());
      setName("");
      setTitle("");
      refresh();
    },
  });

  if (query.isLoading) return <p className="admin-console__loading">{t("positions.loading")}</p>;
  if (query.isError || !query.data) {
    return (
      <p className="admin-console__error">
        {t("positions.cannotBeRead")} {query.error ? String(query.error) : ""}
      </p>
    );
  }
  const own = query.data.positions;
  const positions = allPositions(t, query.data.shipped, own);
  const taken = positions.some((p) => p.name === name.trim());

  return (
    <section>
      <header className="admin-console__section-head">
        <div>
          <h2 className="admin-console__section-title">{t("positions.title")}</h2>
          <p className="admin-console__lead">{t("positions.lead")}</p>
        </div>
      </header>

      <div className="admin-console__cards">
        <div className="admin-console__card">
          <form
            className="admin-console__card-main admin-console__form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && !taken) create.mutate();
            }}
          >
            <h3 className="admin-console__card-title">{t("positions.createTitle")}</h3>
            <p className="admin-console__card-desc">{t("positions.createLead")}</p>
            <div className="admin-console__field-row">
              <div className="admin-console__field">
                <label htmlFor="position-title">{t("positions.titleField")}</label>
                <input
                  id="position-title"
                  value={title}
                  maxLength={80}
                  placeholder={t("positions.titlePlaceholder")}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="admin-console__field">
                <label htmlFor="position-name">{t("positions.name")}</label>
                <input
                  id="position-name"
                  value={name}
                  maxLength={63}
                  placeholder={t("positions.namePlaceholder")}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                />
              </div>
            </div>
            <p className="admin-console__hint">{t("positions.nameHint")}</p>
            {taken ? <p className="admin-console__error">{t("positions.nameTaken")}</p> : null}
            {create.isError && <p className="admin-console__error">{String(create.error)}</p>}
            <div className="admin-console__form-footer">
              <button
                className="admin-console__btn admin-console__btn--primary"
                type="submit"
                disabled={!name.trim() || taken || create.isPending}
              >
                {t("positions.create")}
              </button>
            </div>
          </form>
        </div>

        <div className="admin-console__card">
          <div className="admin-console__card-main">
            <table className="admin-console__table">
              <thead>
                <tr>
                  <th>{t("positions.position")}</th>
                  <th>{t("positions.name")}</th>
                  <th />
                  <th />
                </tr>
              </thead>
              <tbody>
                {positions.map((position) => (
                  <PositionRow
                    key={position.name}
                    name={position.name}
                    label={position.label}
                    shipped={position.shipped}
                    own={own}
                    open={open === position.name}
                    onToggle={() => setOpen(open === position.name ? null : position.name)}
                    onChanged={(removed) => {
                      if (removed) setOpen(null);
                      refresh();
                    }}
                  />
                ))}
              </tbody>
            </table>
            <p className="admin-console__hint">{t("positions.declaredHint")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function PositionRow({
  name,
  label,
  shipped,
  own,
  open,
  onToggle,
  onChanged,
}: {
  name: string;
  label: string;
  shipped: boolean;
  own: TenantPosition[];
  open: boolean;
  onToggle: () => void;
  /** After a change; true when the position was removed. */
  onChanged: (removed?: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <tr className={open ? "admin-console__row--editing" : undefined}>
        <td>{label}</td>
        <td className="admin-console__mono">{name}</td>
        <td>
          {shipped ? <span className="admin-console__badge">{t("positions.everyTenantHas")}</span> : null}
        </td>
        <td>
          <button className="admin-console__btn admin-console__btn--quiet" type="button" onClick={onToggle}>
            {open ? t("positions.close") : t("positions.open")}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4}>
            <div className="admin-console__editor">
              {shipped ? (
                <p className="admin-console__hint">{t(`positions.shippedHint_${name}`, { defaultValue: "" })}</p>
              ) : (
                <PositionDeclaration key={name} position={own.find((p) => p.name === name)} own={own} onChanged={onChanged} />
              )}
              <PositionAccessView name={name} withoutHolders />
              <PositionHolders name={name} own={own} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** The roles a position may hold on one thing: the two every thing has, and on an app the ones it declares. */
function useRolesOf(app: string) {
  const access = useQuery({
    queryKey: ["admin", "access", "app", app],
    queryFn: () => fetchAppAccess(app),
    enabled: app !== "",
    retry: false,
  });
  const declared = (access.data?.bindings ?? []).filter((b) => b.declared).map((b) => b.relation);
  return ["user", ...declared, "admin"];
}

/** Whether two roles are the same role on the same thing. */
export function sameRole(a: PositionRole, b: PositionRole) {
  return (a.app ?? "") === (b.app ?? "") && a.role === b.role;
}

/** A position's roles with one more, once. */
export function withRole(roles: PositionRole[], role: PositionRole) {
  return roles.some((have) => sameRole(have, role)) ? roles : [...roles, role];
}

/**
 * What one of the tenant's own positions is: its title, who it is for, the
 * positions it includes and the roles it holds. Saved whole, as one commit.
 */
function PositionDeclaration({
  position,
  own,
  onChanged,
}: {
  position?: TenantPosition;
  own: TenantPosition[];
  onChanged: (removed?: boolean) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(position?.title ?? "");
  const [description, setDescription] = useState(position?.description ?? "");
  const [includes, setIncludes] = useState<string[]>(position?.includes ?? []);
  const [roles, setRoles] = useState<PositionRole[]>(position?.roles ?? []);
  const [on, setOn] = useState("");
  const [role, setRole] = useState("user");

  const apps = useQuery({ queryKey: ["admin", "apps", "status"], queryFn: fetchAppStates });
  const profiles = (apps.data?.apps ?? [])
    .flatMap((app) => [app.profile, ...(app.addons ?? []).map((addon) => addon.profile)])
    .sort((a, b) => a.localeCompare(b));
  const offered = useRolesOf(on);
  const name = position?.name ?? "";

  const save = useMutation({
    mutationFn: () => setPosition({ name, title: title.trim(), description: description.trim(), includes, roles }),
    onSuccess: () => onChanged(),
  });
  const remove = useMutation({
    mutationFn: () => removePosition(name),
    onSuccess: () => onChanged(true),
  });
  const failure = [save, remove].find((m) => m.isError)?.error;
  if (!position) return null;

  // Any other position may be included; the director refuses a circle.
  const includable = allPositions(t, [...SHIPPED_POSITIONS], own).filter((p) => p.name !== name);

  return (
    <>
      <div className="admin-console__field-row">
        <div className="admin-console__field">
          <label htmlFor={`p-title-${name}`}>{t("positions.titleField")}</label>
          <input id={`p-title-${name}`} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="admin-console__field">
          <label htmlFor={`p-description-${name}`}>{t("positions.description")}</label>
          <input
            id={`p-description-${name}`}
            value={description}
            maxLength={400}
            placeholder={t("positions.descriptionPlaceholder")}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      <div className="admin-console__field">
        <span>{t("positions.includes")}</span>
        <p className="admin-console__hint">{t("positions.includesHint")}</p>
        {includable.map((other) => (
          <label key={other.name} className="admin-console__checklist-row">
            <input
              type="checkbox"
              checked={includes.includes(other.name)}
              onChange={(e) =>
                setIncludes(e.target.checked ? [...includes, other.name] : includes.filter((n) => n !== other.name))
              }
            />{" "}
            {other.label}
          </label>
        ))}
      </div>

      <div className="admin-console__field">
        <span>{t("positions.roles")}</span>
        {roles.length === 0 ? (
          <p className="admin-console__empty">{t("positions.noRoles")}</p>
        ) : (
          <table className="admin-console__table">
            <tbody>
              {roles.map((held) => (
                <tr key={`${held.app ?? ""}/${held.role}`}>
                  <td>{roleLabel(t, held.app ? "app" : "tenant", held.role)}</td>
                  <td>{held.app ? <code>{held.app}</code> : t("positions.onTheTenant")}</td>
                  <td>
                    <button
                      className="admin-console__btn admin-console__btn--quiet"
                      type="button"
                      onClick={() => setRoles(roles.filter((r) => !sameRole(r, held)))}
                    >
                      {t("positions.removeRole")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="admin-console__field-row">
          <label className="admin-console__field">
            <span className="admin-console__label-text">{t("positions.roleOn")}</span>
            <select
              value={on}
              onChange={(e) => {
                setOn(e.target.value);
                setRole("user");
              }}
            >
              <option value="">{t("positions.theTenant")}</option>
              {profiles.map((profile) => (
                <option key={profile} value={profile}>
                  {profile}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-console__field">
            <span className="admin-console__label-text">{t("positions.role")}</span>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {offered.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(t, on ? "app" : "tenant", r)}
                </option>
              ))}
            </select>
          </label>
          <div className="admin-console__field">
            <button
              className="admin-console__btn"
              type="button"
              onClick={() => setRoles(withRole(roles, on ? { app: on, role } : { role }))}
            >
              {t("positions.addRole")}
            </button>
          </div>
        </div>
      </div>

      {failure && <p className="admin-console__error">{String(failure)}</p>}
      {save.isSuccess ? <p className="admin-console__hint">{t("positions.saved")}</p> : null}

      <div className="admin-console__editor-footer">
        <button
          className="admin-console__btn admin-console__btn--danger"
          type="button"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(t("positions.removeConfirm", { name: positionLabel(t, name, own) }))) remove.mutate();
          }}
        >
          {t("positions.remove")}
        </button>
        <button
          className="admin-console__btn admin-console__btn--primary"
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {t("positions.save")}
        </button>
      </div>
    </>
  );
}

function personName(person: Person) {
  return person.name ? `${person.name} (${person.username})` : person.username;
}

/** The people who were not given a position yet, by name. */
export function notHolding(people: Person[], holders: string[]) {
  const held = new Set(holders);
  return people.filter((person) => !held.has(person.id)).sort((a, b) => personName(a).localeCompare(personName(b)));
}

/**
 * Who was given a position, and giving and taking it. Written at once: the
 * person holds it, or no longer does, as soon as the answer is back.
 */
function PositionHolders({ name, own }: { name: string; own: TenantPosition[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState("");
  const access = useQuery({
    queryKey: ["admin", "access", "position", name],
    queryFn: () => fetchPositionAccess(name),
    retry: false,
  });
  const people = useQuery({ queryKey: ["admin", "people", ""], queryFn: () => fetchPeople() });
  const change = useMutation({
    mutationFn: (input: { person: string; holds: boolean }) =>
      setAssignment({ person: input.person, assignment: { position: name }, holds: input.holds }),
    onSuccess: () => {
      setAdding("");
      void queryClient.invalidateQueries({ queryKey: ["admin", "access"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "people"] });
    },
  });

  const everyone = people.data?.people ?? [];
  const byId = new Map(everyone.map((person) => [person.id, person]));
  const holders = access.data?.holders ?? [];
  const candidates = notHolding(everyone, holders);

  return (
    <div className="admin-console__field">
      <h3 className="admin-console__subsection-title">{t("positions.whoHoldsIt")}</h3>
      {access.isLoading ? (
        <p className="admin-console__loading">{t("positions.loading")}</p>
      ) : access.isError ? (
        <p className="admin-console__error">{t("positions.holdersCannotBeRead")}</p>
      ) : holders.length === 0 ? (
        <p className="admin-console__empty">{t("positions.nobody")}</p>
      ) : (
        <table className="admin-console__table">
          <tbody>
            {holders.map((id) => {
              const person = byId.get(id);
              return (
                <tr key={id}>
                  <td>{person ? personName(person) : <code>{id}</code>}</td>
                  <td>
                    <button
                      className="admin-console__btn admin-console__btn--quiet"
                      type="button"
                      disabled={change.isPending}
                      onClick={() => {
                        const who = person ? personName(person) : id;
                        const position = positionLabel(t, name, own);
                        if (window.confirm(t("positions.takeConfirm", { person: who, position }))) {
                          change.mutate({ person: id, holds: false });
                        }
                      }}
                    >
                      {t("positions.take")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="admin-console__field-row">
        <label className="admin-console__field">
          <span className="admin-console__label-text">{t("positions.giveTo")}</span>
          <select value={adding} disabled={people.isLoading} onChange={(e) => setAdding(e.target.value)}>
            <option value="">{t("positions.choosePerson")}</option>
            {candidates.map((person) => (
              <option key={person.id} value={person.id}>
                {personName(person)}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-console__field">
          <button
            className="admin-console__btn admin-console__btn--primary"
            type="button"
            disabled={!adding || change.isPending}
            onClick={() => change.mutate({ person: adding, holds: true })}
          >
            {t("positions.give")}
          </button>
        </div>
      </div>
      {change.isError && <p className="admin-console__error">{String(change.error)}</p>}
      {change.data?.totpRequired ? <p className="admin-console__hint">{t("positions.secondFactorRequired")}</p> : null}
      {change.data?.warning ? <p className="admin-console__error">{change.data.warning}</p> : null}
    </div>
  );
}

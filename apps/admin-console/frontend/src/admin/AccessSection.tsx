import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  fetchAppAccess,
  fetchAppStates,
  fetchGroupAccess,
  fetchGroupMembers,
  fetchPeople,
  fetchPersonAccess,
  fetchPersonGroups,
  type AccessPermission,
  type AppHold,
  type HeldRole,
  type ObjectAccess,
  type Person,
} from "@/api/admin";
import { describeGroup } from "@/admin/groupLabels";

/**
 * Who may do what in the tenant, and why.
 *
 * Read-only, and answered by the rights store, not worked out here: the usher
 * says which roles a person holds through which group and which permissions
 * are in effect for them, and this screen puts that into sentences. Where the
 * two disagree it says so -- a permission a group carries that is not in
 * effect, and one in effect that no group of the tenant accounts for -- since
 * those are the cases nobody can guess from the group lists.
 *
 * Nothing is given or taken here. People are put in groups on Members and
 * Groups, and an app's access is set on Apps.
 */

export type AccessKind = "person" | "group" | "app";

const KINDS: AccessKind[] = ["person", "group", "app"];

/** A group's name without the tenant's prefix, as the other screens show it. */
function groupLabel(path: string, tenant: string) {
  const described = describeGroup({ id: path, path, name: path }, tenant);
  return described.kind === "app" ? `app:${described.label}` : described.label;
}

/** A role in words; one this console does not know stays as the model names it. */
function roleLabel(t: TFunction, object: string, role: string) {
  const type = object.split(":")[0];
  return t(`access.role_${type}_${role}`, { defaultValue: role });
}

/** A permission in words, the same way. */
function permissionLabel(t: TFunction, object: string, name: string) {
  const type = object.split(":")[0];
  return t(`access.permission_${type}_${name}`, { defaultValue: name });
}

/** The permissions of an object that are in effect and come from `from`. */
export function inEffectFrom(access: ObjectAccess, from: string): AccessPermission[] {
  return access.permissions.filter((p) => p.inEffect && p.from === from);
}

/** Whether a person holds or may do anything at all on an object. */
export function holdsAnything(access: ObjectAccess) {
  return access.held.length > 0 || access.permissions.some((p) => p.inEffect);
}

function Permissions({ object, names }: { object: string; names: string[] }) {
  const { t } = useTranslation();
  return (
    <ul className="admin-console__access-list">
      {names.map((name) => (
        <li key={name}>{permissionLabel(t, object, name)}</li>
      ))}
    </ul>
  );
}

/** One role a person holds, through what, and what of it is in effect. */
function HeldRoleRow({ access, held, tenant }: { access: ObjectAccess; held: HeldRole; tenant: string }) {
  const { t } = useTranslation();
  const answer = new Map(access.permissions.map((p) => [p.name, p.inEffect]));
  const inEffect = held.carries.filter((name) => answer.get(name));
  const withheld = held.carries.filter((name) => !answer.get(name));
  return (
    <div className="admin-console__access-role">
      <div>
        <strong>{roleLabel(t, access.object, held.role)}</strong>{" "}
        <span className="admin-console__hint">
          {held.group
            ? t("access.throughGroup", { group: groupLabel(held.group, tenant) })
            : t("access.byName")}
        </span>
      </div>
      {inEffect.length > 0 ? <Permissions object={access.object} names={inEffect} /> : null}
      {withheld.length > 0 ? (
        <>
          <p className="admin-console__hint">
            <span className="admin-console__badge admin-console__badge--warn">{t("access.notInEffect")}</span>{" "}
            {t(access.app ? "access.withheldOnApp" : "access.withheld")}
          </p>
          <Permissions object={access.object} names={withheld} />
        </>
      ) : null}
    </div>
  );
}

/** Everything a person holds on one object: the tenant, or one app. */
function ObjectRights({ access, tenant }: { access: ObjectAccess; tenant: string }) {
  const { t } = useTranslation();
  const fromTenant = inEffectFrom(access, "tenant");
  const elsewhere = inEffectFrom(access, "elsewhere");
  return (
    <>
      {access.held.map((held) => (
        <HeldRoleRow key={`${held.role}/${held.group ?? ""}`} access={access} held={held} tenant={tenant} />
      ))}
      {fromTenant.length > 0 ? (
        <div className="admin-console__access-role">
          <div>
            <span className="admin-console__hint">{t("access.fromTenant")}</span>
          </div>
          <Permissions object={access.object} names={fromTenant.map((p) => p.name)} />
        </div>
      ) : null}
      {elsewhere.length > 0 ? (
        <div className="admin-console__access-role">
          <div>
            <span className="admin-console__badge">{t("access.fromElsewhere")}</span>{" "}
            <span className="admin-console__hint">{t("access.fromElsewhereHint")}</span>
          </div>
          <Permissions object={access.object} names={elsewhere.map((p) => p.name)} />
        </div>
      ) : null}
    </>
  );
}

export function PersonAccessView({ id, tenant }: { id: string; tenant: string }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["admin", "access", "person", id],
    queryFn: () => fetchPersonAccess(id),
    retry: false,
  });
  if (query.isLoading) return <p className="admin-console__loading">{t("access.reading")}</p>;
  if (query.isError || !query.data) return <p className="admin-console__error">{t("access.cannotBeRead")}</p>;
  const access = query.data;
  const withAccess = access.apps.filter(holdsAnything);
  const without = access.apps.filter((app) => !holdsAnything(app));
  return (
    <>
      <h3 className="admin-console__subsection-title">{t("access.inTheTenant")}</h3>
      {holdsAnything(access.onTenant) ? (
        <ObjectRights access={access.onTenant} tenant={tenant} />
      ) : (
        <p className="admin-console__empty">{t("access.nothingInTheTenant")}</p>
      )}

      <h3 className="admin-console__subsection-title">{t("access.inTheApps")}</h3>
      {withAccess.length === 0 ? (
        <p className="admin-console__empty">{t("access.noApps")}</p>
      ) : (
        <div className="admin-console__table-wrap">
          <table className="admin-console__table">
            <thead>
              <tr>
                <th>{t("access.app")}</th>
                <th>{t("access.holds")}</th>
              </tr>
            </thead>
            <tbody>
              {withAccess.map((app) => (
                <tr key={app.object}>
                  <td>
                    <code>{app.app}</code>
                  </td>
                  <td>
                    <ObjectRights access={app} tenant={tenant} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {without.length > 0 ? (
        <p className="admin-console__hint">
          {t("access.noAccessTo")}{" "}
          {without.map((app, i) => (
            <span key={app.object}>
              {i > 0 ? ", " : ""}
              <code>{app.app}</code>
            </span>
          ))}
        </p>
      ) : null}

      <h3 className="admin-console__subsection-title">{t("access.groupsOfPerson")}</h3>
      {access.groups.length === 0 ? (
        <p className="admin-console__empty">{t("access.noGroups")}</p>
      ) : (
        <p>
          {access.groups.map((group) => (
            <span key={group} className="admin-console__badge">
              {groupLabel(group, tenant)}
            </span>
          ))}
        </p>
      )}
      <p className="admin-console__hint">{t("access.groupsOfPersonHint")}</p>
    </>
  );
}

function personName(person: Person) {
  return person.name ? `${person.name} (${person.username})` : person.username;
}

export function GroupAccessView({ group }: { group: string }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["admin", "access", "group", group],
    queryFn: () => fetchGroupAccess(group),
    retry: false,
  });
  const members = useQuery({
    queryKey: ["admin", "people", "group-members", group],
    queryFn: () => fetchGroupMembers(group),
  });
  if (query.isLoading) return <p className="admin-console__loading">{t("access.reading")}</p>;
  if (query.isError || !query.data) return <p className="admin-console__error">{t("access.cannotBeRead")}</p>;
  const holds = query.data.holds;
  return (
    <>
      <h3 className="admin-console__subsection-title">{t("access.whatTheGroupGives")}</h3>
      {holds.length === 0 ? (
        <p className="admin-console__empty">{t("access.groupGivesNothing")}</p>
      ) : (
        holds.map((hold) => (
          <div key={`${hold.object}/${hold.role}`} className="admin-console__access-role">
            <div>
              <strong>{roleLabel(t, hold.object, hold.role)}</strong>{" "}
              {hold.app ? (
                <span className="admin-console__hint">
                  {t("access.onApp")} <code>{hold.app}</code>
                </span>
              ) : null}
            </div>
            <Permissions object={hold.object} names={hold.carries} />
          </div>
        ))
      )}
      {holds.some((hold) => hold.app && hold.carries.length > 0) ? (
        <p className="admin-console__hint">{t("access.groupWithheldHint")}</p>
      ) : null}

      <h3 className="admin-console__subsection-title">{t("access.whoIsInTheGroup")}</h3>
      {members.isLoading ? (
        <p className="admin-console__loading">{t("access.reading")}</p>
      ) : members.isError || !members.data ? (
        <p className="admin-console__error">{t("access.membersCannotBeRead")}</p>
      ) : members.data.people.length === 0 ? (
        <p className="admin-console__empty">{t("access.nobody")}</p>
      ) : (
        <ul className="admin-console__access-list">
          {members.data.people.map((person) => (
            <li key={person.id}>{personName(person)}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/** What one hold says, as a sentence. One this console does not know is named as it came. */
export function holdSentence(t: TFunction, hold: AppHold) {
  const names = (hold.names ?? []).join(", ");
  const presence = hold.presence === "away" ? "away" : "present";
  const keys = [
    hold.names?.length ? `access.hold_${hold.kind}_${presence}_named` : "",
    `access.hold_${hold.kind}_${presence}`,
    hold.names?.length ? `access.hold_${hold.kind}_named` : "",
    `access.hold_${hold.kind}`,
  ].filter(Boolean);
  return t(keys, { names, defaultValue: names ? `${hold.kind}: ${names}` : hold.kind });
}

function Holds({ holds, trustTier }: { holds?: AppHold[]; trustTier?: string }) {
  const { t } = useTranslation();
  return (
    <>
      {trustTier ? (
        <p className="admin-console__hint">
          {t("access.trustTier")} <code>{trustTier}</code>
        </p>
      ) : null}
      {!holds || holds.length === 0 ? (
        <p className="admin-console__empty">{t("access.holdsNothing")}</p>
      ) : (
        <ul className="admin-console__access-list">
          {holds.map((hold) => (
            <li key={`${hold.kind}/${hold.presence ?? ""}`}>{holdSentence(t, hold)}</li>
          ))}
        </ul>
      )}
    </>
  );
}

export function AppAccessView({ profile, tenant }: { profile: string; tenant: string }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["admin", "access", "app", profile],
    queryFn: () => fetchAppAccess(profile),
    retry: false,
  });
  const states = useQuery({ queryKey: ["admin", "apps", "status"], queryFn: fetchAppStates });
  if (query.isLoading) return <p className="admin-console__loading">{t("access.reading")}</p>;
  if (query.isError || !query.data) return <p className="admin-console__error">{t("access.cannotBeRead")}</p>;
  const view = query.data;
  const state = states.data?.apps.find((app) => app.profile === profile);
  return (
    <>
      <h3 className="admin-console__subsection-title">{t("access.whoOnTheApp")}</h3>
      <div className="admin-console__table-wrap">
        <table className="admin-console__table">
          <thead>
            <tr>
              <th>{t("access.role")}</th>
              <th>{t("access.heldThrough")}</th>
              <th>{t("access.gives")}</th>
            </tr>
          </thead>
          <tbody>
            {view.bindings.map((binding) => (
              <tr key={binding.relation}>
                <td>{roleLabel(t, view.object, binding.relation)}</td>
                <td>
                  {binding.groups.length === 0 ? (
                    <span className="admin-console__empty">{t("access.nobody")}</span>
                  ) : (
                    binding.groups.map((group) => (
                      <span key={group} className="admin-console__badge">
                        {groupLabel(group, tenant)}
                      </span>
                    ))
                  )}
                </td>
                <td>
                  <Permissions object={view.object} names={binding.grants} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="admin-console__hint">{t("access.whoOnTheAppHint")}</p>

      <h3 className="admin-console__subsection-title">{t("access.whatTheAppHolds")}</h3>
      <p className="admin-console__hint">{t("access.whatTheAppHoldsHint")}</p>
      {states.isLoading ? (
        <p className="admin-console__loading">{t("access.reading")}</p>
      ) : !state ? (
        <p className="admin-console__empty">{t("access.appStateUnknown")}</p>
      ) : (
        <>
          <Holds holds={state.holds} trustTier={state.trustTier} />
          {(state.addons ?? []).map((addon) => (
            <div key={addon.profile}>
              <h4 className="admin-console__subsection-title">
                {t("access.addon")} <code>{addon.profile}</code>
              </h4>
              <Holds holds={addon.holds} trustTier={addon.trustTier} />
            </div>
          ))}
        </>
      )}
    </>
  );
}

export function AccessSection({ tenant }: { tenant: string }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<AccessKind>("person");
  const [chosen, setChosen] = useState<Record<AccessKind, string>>({ person: "", group: "", app: "" });

  const people = useQuery({ queryKey: ["admin", "people", ""], queryFn: () => fetchPeople() });
  const groups = useQuery({ queryKey: ["admin", "people", "groups"], queryFn: () => fetchPersonGroups() });
  const apps = useQuery({ queryKey: ["admin", "apps", "status"], queryFn: fetchAppStates });

  const options: Record<AccessKind, { value: string; label: string }[]> = {
    person: (people.data?.people ?? [])
      .map((person) => ({ value: person.id, label: personName(person) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    group: (groups.data?.groups ?? [])
      .map((group) => ({ value: group.path, label: groupLabel(group.path, tenant) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    app: (apps.data?.apps ?? [])
      .map((app) => ({ value: app.profile, label: app.profile }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
  const source = { person: people, group: groups, app: apps }[kind];
  const selected = chosen[kind];

  return (
    <section>
      <header className="admin-console__section-head">
        <div>
          <h2 className="admin-console__section-title">{t("access.title")}</h2>
          <p className="admin-console__lead">{t("access.lead")}</p>
        </div>
      </header>

      <div className="admin-console__field-row">
        <label className="admin-console__field">
          <span className="admin-console__label-text">{t("access.show")}</span>
          <select id="access-kind" value={kind} onChange={(e) => setKind(e.target.value as AccessKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`access.kind_${k}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-console__field">
          <span className="admin-console__label-text">{t(`access.which_${kind}`)}</span>
          <select
            id="access-which"
            value={selected}
            disabled={source.isLoading}
            onChange={(e) => setChosen({ ...chosen, [kind]: e.target.value })}
          >
            <option value="">{t("access.choose")}</option>
            {options[kind].map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {source.isError ? (
        <p className="admin-console__error">{t("access.listCannotBeRead")}</p>
      ) : !selected ? (
        <p className="admin-console__empty">{t(`access.pick_${kind}`)}</p>
      ) : kind === "person" ? (
        <PersonAccessView key={selected} id={selected} tenant={tenant} />
      ) : kind === "group" ? (
        <GroupAccessView key={selected} group={selected} />
      ) : (
        <AppAccessView key={selected} profile={selected} tenant={tenant} />
      )}
    </section>
  );
}

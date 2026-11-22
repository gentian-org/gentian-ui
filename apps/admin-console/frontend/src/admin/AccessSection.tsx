import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  fetchAppAccess,
  fetchAppStates,
  fetchPeople,
  fetchPersonAccess,
  fetchPositionAccess,
  fetchPositions,
  type AccessPermission,
  type AppHold,
  type HeldRole,
  type Holder,
  type ObjectAccess,
  type Person,
  type PositionHold,
  type TenantPosition,
} from "@/api/admin";
import { allPositions, positionLabel, roleLabel } from "@/admin/positionLabels";

/**
 * Who may do what in the tenant, and why.
 *
 * Read-only, and answered by the rights store, not worked out here: the usher
 * says which roles a person was given, through which position, and what is in
 * effect for them, and this screen puts that into sentences. More is in
 * effect than is held -- an app's administrator holds every role the app
 * declares, a role on an add-on lets a person into its base, and some things
 * follow from the tenant or the cluster -- and the screen says where each
 * comes from, since those are the cases nobody can guess from a list.
 *
 * Nothing is given or taken here. People are given positions on People and
 * Positions.
 */

export type AccessKind = "person" | "position" | "app";

const KINDS: AccessKind[] = ["person", "position", "app"];

/** The kind of thing an object of the rights store is: tenant, app. */
function typeOf(object: string) {
  return object.split(":")[0];
}

/** A permission in words; one this console does not know stays as the model names it. */
function permissionLabel(t: TFunction, object: string, name: string) {
  return t(`access.permission_${typeOf(object)}_${name}`, { defaultValue: name });
}

/** The permissions of an object that are in effect and come from `from`. */
export function inEffectFrom(access: ObjectAccess, from: string): AccessPermission[] {
  return access.permissions.filter((p) => p.inEffect && p.from === from);
}

/** Whether a person holds or may do anything at all on an object. */
export function holdsAnything(access: ObjectAccess) {
  return access.held.length > 0 || access.permissions.some((p) => p.inEffect);
}

/** The roles in effect on an object that the person was not given there: they follow from something else. */
export function rolesThatFollow(access: ObjectAccess) {
  const given = new Set(access.held.map((held) => held.role));
  return access.roles.filter((role) => !given.has(role));
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

/** One role a person was given, how, and what it lets them do. */
function HeldRoleRow({ access, held, own }: { access: ObjectAccess; held: HeldRole; own: TenantPosition[] }) {
  const { t } = useTranslation();
  const answer = new Map(access.permissions.map((p) => [p.name, p.inEffect]));
  const inEffect = held.carries.filter((name) => answer.get(name));
  return (
    <div className="admin-console__access-role">
      <div>
        <strong>{roleLabel(t, typeOf(access.object), held.role)}</strong>{" "}
        {held.declared ? <span className="admin-console__badge">{t("access.declaredRole")}</span> : null}{" "}
        <span className="admin-console__hint">
          {held.position
            ? t("access.throughPosition", { position: positionLabel(t, held.position, own) })
            : t("access.givenDirectly")}
        </span>
        {held.direct ? (
          <>
            {" "}
            <span className="admin-console__badge admin-console__badge--warn">{t("access.exception")}</span>
          </>
        ) : null}
      </div>
      {inEffect.length > 0 ? <Permissions object={access.object} names={inEffect} /> : null}
    </div>
  );
}

/** Everything a person holds on one object: the tenant, or one app. */
function ObjectRights({ access, own }: { access: ObjectAccess; own: TenantPosition[] }) {
  const { t } = useTranslation();
  const follows = rolesThatFollow(access);
  const groups: { from: string; hint: string }[] = [
    { from: "tenant", hint: t("access.fromTenant") },
    { from: "app", hint: t("access.fromApp") },
  ];
  const elsewhere = inEffectFrom(access, "elsewhere");
  return (
    <>
      {access.held.map((held) => (
        <HeldRoleRow key={`${held.role}/${held.position ?? ""}`} access={access} held={held} own={own} />
      ))}
      {follows.length > 0 ? (
        <div className="admin-console__access-role">
          <div>
            <span className="admin-console__hint">{t("access.rolesThatFollow")}</span>{" "}
            {follows.map((role) => (
              <span key={role} className="admin-console__badge">
                {roleLabel(t, typeOf(access.object), role)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {groups.map(({ from, hint }) => {
        const names = inEffectFrom(access, from).map((p) => p.name);
        return names.length > 0 ? (
          <div key={from} className="admin-console__access-role">
            <div>
              <span className="admin-console__hint">{hint}</span>
            </div>
            <Permissions object={access.object} names={names} />
          </div>
        ) : null;
      })}
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

/** The tenant's own positions, for their titles; none while they are being read. */
function useOwnPositions() {
  const query = useQuery({ queryKey: ["admin", "positions"], queryFn: () => fetchPositions() });
  return query.data?.positions ?? [];
}

export function PersonAccessView({ id }: { id: string }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["admin", "access", "person", id],
    queryFn: () => fetchPersonAccess(id),
    retry: false,
  });
  const own = useOwnPositions();
  if (query.isLoading) return <p className="admin-console__loading">{t("access.reading")}</p>;
  if (query.isError || !query.data) return <p className="admin-console__error">{t("access.cannotBeRead")}</p>;
  const access = query.data;
  const withAccess = access.apps.filter(holdsAnything);
  const without = access.apps.filter((app) => !holdsAnything(app));
  return (
    <>
      <h3 className="admin-console__subsection-title">{t("access.positionsOfPerson")}</h3>
      {access.positions.length === 0 ? (
        <p className="admin-console__empty">{t("access.noPositions")}</p>
      ) : (
        <ul className="admin-console__access-list">
          {access.positions.map((position) => (
            <li key={position.name}>
              <strong>{positionLabel(t, position.name, own)}</strong>
              {position.through ? (
                <>
                  {" "}
                  <span className="admin-console__hint">
                    {t("access.includedBy", { position: positionLabel(t, position.through, own) })}
                  </span>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <h3 className="admin-console__subsection-title">{t("access.inTheTenant")}</h3>
      {holdsAnything(access.onTenant) ? (
        <ObjectRights access={access.onTenant} own={own} />
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
                    <ObjectRights access={app} own={own} />
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
    </>
  );
}

function personName(person: Person) {
  return person.name ? `${person.name} (${person.username})` : person.username;
}

/** The people of the tenant by account id, for naming who holds something. */
function usePeopleById() {
  const people = useQuery({ queryKey: ["admin", "people", ""], queryFn: () => fetchPeople() });
  return new Map((people.data?.people ?? []).map((person) => [person.id, person]));
}

/** A holder as a person reading the screen knows them. */
function HolderBadge({ holder, own, people }: { holder: Holder; own: TenantPosition[]; people: Map<string, Person> }) {
  const { t } = useTranslation();
  if (holder.kind === "position") {
    return <span className="admin-console__badge">{positionLabel(t, holder.name, own)}</span>;
  }
  if (holder.kind === "person") {
    const person = people.get(holder.name);
    return (
      <span className="admin-console__badge admin-console__badge--warn">{person ? personName(person) : holder.name}</span>
    );
  }
  return (
    <span className="admin-console__badge">
      <code>{holder.name}</code>
    </span>
  );
}

/**
 * Where an inherited role comes from, as a sentence: the position holding it,
 * and the ones it comes through on the way. Empty for a role given to the
 * position itself.
 */
export function inheritedFrom(t: TFunction, through: string[] | undefined, label: (name: string) => string) {
  if (!through || through.length === 0) return "";
  const from = label(through[through.length - 1]);
  if (through.length === 1) return t("access.inheritedFromPosition", { position: from });
  const via = through.slice(0, -1).map(label).join(" → ");
  return t("access.inheritedFromPositionVia", { position: from, via });
}

/** One role a position holds, colored by whether it was given to it or inherited. */
function PositionHoldRow({ hold, own }: { hold: PositionHold; own: ReturnType<typeof useOwnPositions> }) {
  const { t } = useTranslation();
  const from = inheritedFrom(t, hold.through, (name) => positionLabel(t, name, own));
  const inherited = from !== "";
  return (
    <div
      className={`admin-console__access-role admin-console__access-role--${inherited ? "inherited" : "own"}`}
      title={inherited ? from : t("access.givenToThisPosition")}
    >
      <div>
        <strong>{roleLabel(t, typeOf(hold.object), hold.role)}</strong>{" "}
        {hold.declared ? <span className="admin-console__badge">{t("access.declaredRole")}</span> : null}{" "}
        {hold.app ? (
          <span className="admin-console__hint">
            {t("access.onApp")} <code>{hold.app}</code>
          </span>
        ) : (
          <span className="admin-console__hint">{t("access.onTheTenant")}</span>
        )}
        {inherited ? <span className="admin-console__hint admin-console__access-from"> · {from}</span> : null}
      </div>
      <Permissions object={hold.object} names={hold.carries} />
    </div>
  );
}

/**
 * What one position is. `withoutHolders` leaves out who holds it, for a screen
 * that lists them itself.
 */
export function PositionAccessView({ name, withoutHolders }: { name: string; withoutHolders?: boolean }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["admin", "access", "position", name],
    queryFn: () => fetchPositionAccess(name),
    retry: false,
  });
  const own = useOwnPositions();
  const people = usePeopleById();
  if (query.isLoading) return <p className="admin-console__loading">{t("access.reading")}</p>;
  if (query.isError || !query.data) return <p className="admin-console__error">{t("access.cannotBeRead")}</p>;
  const position = query.data;
  const inherited = position.inherited ?? [];
  const description = own.find((p) => p.name === name)?.description;
  return (
    <>
      {description ? <p className="admin-console__lead">{description}</p> : null}
      <h3 className="admin-console__subsection-title">{t("access.whatThePositionHolds")}</h3>
      {position.holds.length === 0 && inherited.length === 0 ? (
        <p className="admin-console__empty">{t("access.positionHoldsNothing")}</p>
      ) : (
        <>
          {inherited.length > 0 ? (
            <p className="admin-console__access-legend">
              <span className="admin-console__access-swatch admin-console__access-swatch--own" />{" "}
              {t("access.givenToThisPosition")}{" "}
              <span className="admin-console__access-swatch admin-console__access-swatch--inherited" />{" "}
              {t("access.inheritedFromIncluded")}
            </p>
          ) : null}
          {[...position.holds, ...inherited].map((hold) => (
            <PositionHoldRow key={`${hold.object}/${hold.role}`} hold={hold} own={own} />
          ))}
        </>
      )}
      {position.includes.length > 0 ? (
        <p>
          <span className="admin-console__hint">{t("access.includes")}</span>{" "}
          {position.includes.map((included) => (
            <span key={included} className="admin-console__badge">
              {positionLabel(t, included, own)}
            </span>
          ))}
        </p>
      ) : null}
      {position.includedIn.length > 0 ? (
        <p>
          <span className="admin-console__hint">{t("access.includedIn")}</span>{" "}
          {position.includedIn.map((including) => (
            <span key={including} className="admin-console__badge">
              {positionLabel(t, including, own)}
            </span>
          ))}
        </p>
      ) : null}

      {withoutHolders ? null : (
        <>
          <h3 className="admin-console__subsection-title">{t("access.whoHoldsThePosition")}</h3>
          {position.holders.length === 0 ? (
            <p className="admin-console__empty">{t("access.nobody")}</p>
          ) : (
            <ul className="admin-console__access-list">
              {position.holders.map((id) => {
                const person = people.get(id);
                return <li key={id}>{person ? personName(person) : <code>{id}</code>}</li>;
              })}
            </ul>
          )}
        </>
      )}
      {position.includedIn.length > 0 ? (
        <p className="admin-console__hint">{t("access.holdersThroughInclusionHint")}</p>
      ) : null}
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

export function AppAccessView({ profile }: { profile: string }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["admin", "access", "app", profile],
    queryFn: () => fetchAppAccess(profile),
    retry: false,
  });
  const states = useQuery({ queryKey: ["admin", "apps", "status"], queryFn: fetchAppStates });
  const own = useOwnPositions();
  const people = usePeopleById();
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
              <th>{t("access.heldBy")}</th>
              <th>{t("access.gives")}</th>
            </tr>
          </thead>
          <tbody>
            {view.bindings.map((binding) => (
              <tr key={binding.relation}>
                <td>
                  {roleLabel(t, typeOf(view.object), binding.relation)}{" "}
                  {binding.declared ? <span className="admin-console__badge">{t("access.declaredRole")}</span> : null}
                </td>
                <td>
                  {binding.holders.length === 0 ? (
                    <span className="admin-console__empty">{t("access.nobody")}</span>
                  ) : (
                    binding.holders.map((holder) => (
                      <HolderBadge key={`${holder.kind}/${holder.name}`} holder={holder} own={own} people={people} />
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

export function AccessSection() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<AccessKind>("person");
  const [chosen, setChosen] = useState<Record<AccessKind, string>>({ person: "", position: "", app: "" });

  const people = useQuery({ queryKey: ["admin", "people", ""], queryFn: () => fetchPeople() });
  const positions = useQuery({ queryKey: ["admin", "positions"], queryFn: () => fetchPositions() });
  const apps = useQuery({ queryKey: ["admin", "apps", "status"], queryFn: fetchAppStates });

  const options: Record<AccessKind, { value: string; label: string }[]> = {
    person: (people.data?.people ?? [])
      .map((person) => ({ value: person.id, label: personName(person) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    position: allPositions(t, positions.data?.shipped ?? [], positions.data?.positions ?? []).map((position) => ({
      value: position.name,
      label: position.label,
    })),
    app: (apps.data?.apps ?? [])
      .flatMap((app) => [app.profile, ...(app.addons ?? []).map((addon) => addon.profile)])
      .map((profile) => ({ value: profile, label: profile }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
  const source = { person: people, position: positions, app: apps }[kind];
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
        <PersonAccessView key={selected} id={selected} />
      ) : kind === "position" ? (
        <PositionAccessView key={selected} name={selected} />
      ) : (
        <AppAccessView key={selected} profile={selected} />
      )}
    </section>
  );
}

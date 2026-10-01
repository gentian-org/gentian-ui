import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  fetchIdentitySettings,
  fetchPeople,
  fetchPerson,
  fetchPersonGroups,
  fetchSettingsTemplates,
  invitePerson,
  removePerson,
  removeTotp,
  requireTotp,
  sendPasswordReset,
  setMembership,
  updatePerson,
  type Person,
} from "@/api/admin";
import { GroupPicker } from "./GroupPicker";
import { describeGroups, type DescribedGroup } from "./groupLabels";
import "./admin.css";

/**
 * The tenant's members, managed through the director.
 *
 * Every call carries the caller's own token and the director decides; every
 * write is an action rather than a commit, because people do not belong in an
 * append-only history.
 */
export function MembersSection({ tenant }: { tenant: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const peopleQuery = useQuery({
    queryKey: ["admin", "people", search],
    queryFn: () => fetchPeople({ search: search || undefined }),
  });
  const groupsQuery = useQuery({
    queryKey: ["admin", "people", "groups"],
    queryFn: () => fetchPersonGroups(),
  });
  const settingsQuery = useQuery({
    queryKey: ["admin", "people", "identity"],
    queryFn: () => fetchIdentitySettings(),
    retry: false,
  });
  const groups = useMemo(
    () => describeGroups(groupsQuery.data?.groups ?? [], tenant),
    [groupsQuery.data, tenant],
  );
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["admin", "people"] });

  if (peopleQuery.isLoading) {
    return <p className="admin-console__loading">{t("members.loading")}</p>;
  }
  if (peopleQuery.isError) {
    return (
      <section>
        <p className="admin-console__error">
          {t("members.cannotBeRead")} {String(peopleQuery.error)}
        </p>
      </section>
    );
  }

  const people = peopleQuery.data?.people ?? [];
  const pending = people.filter((p) => p.pending).length;

  return (
    <section>
      <header className="admin-console__section-head">
        <div>
          <h2 className="admin-console__section-title">{t("members.title")}</h2>
          <p className="admin-console__lead">{t("members.lead")}</p>
        </div>
        <div className="admin-console__field">
          <label htmlFor="members-search">{t("members.search")}</label>
          <input
            id="members-search"
            type="search"
            placeholder={t("members.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </header>

      <InviteCard
        groups={groups}
        loginDomain={settingsQuery.data?.loginDomain ?? ""}
        templatesOffered={settingsQuery.data?.templates ?? false}
        onInvited={refresh}
      />

      <div className="admin-console__card">
        <div className="admin-console__card-main">
          <h3 className="admin-console__card-title">
            {t("members.count", { count: people.length })}
            {pending > 0 && (
              <span className="admin-console__badge">{t("members.pendingCount", { count: pending })}</span>
            )}
          </h3>
          <table className="admin-console__table">
            <thead>
              <tr>
                <th>{t("members.colLogin")}</th>
                <th>{t("members.colName")}</th>
                <th>{t("members.colState")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <MemberRow
                  key={person.id}
                  person={person}
                  groups={groups}
                  editing={editing === person.id}
                  onToggle={() => setEditing(editing === person.id ? null : person.id)}
                  onChanged={refresh}
                />
              ))}
              {people.length === 0 && (
                <tr>
                  <td colSpan={4} className="admin-console__empty">
                    {t(search ? "members.nobodyMatches" : "members.nobodyYet")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/** The part before the @ a person types: letters, digits, dots, dashes, underscores. */
function sanitizeLocalPart(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

/** Suggested from the name until somebody edits it themselves. */
function suggestLocalPart(first: string, last: string): string {
  const clean = (s: string) =>
    s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  const f = clean(first);
  const l = clean(last);
  return f && l ? `${f}-${l}` : f || l;
}

function InviteCard({
  groups,
  loginDomain,
  templatesOffered,
  onInvited,
}: {
  groups: DescribedGroup[];
  loginDomain: string;
  templatesOffered: boolean;
  onInvited: () => void;
}) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [localPart, setLocalPart] = useState("");
  const [localEdited, setLocalEdited] = useState(false);
  const [email, setEmail] = useState("");
  const [template, setTemplate] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [requireTotpOnAccept, setRequireTotpOnAccept] = useState(false);

  const templatesQuery = useQuery({
    queryKey: ["admin", "templates"],
    queryFn: () => fetchSettingsTemplates(),
    enabled: templatesOffered,
    retry: false,
  });
  const templates = templatesQuery.data?.templates ?? [];

  const setName = (first: string, last: string) => {
    setFirstName(first);
    setLastName(last);
    if (!localEdited) setLocalPart(suggestLocalPart(first, last));
  };

  const reset = () => {
    setFirstName("");
    setLastName("");
    setLocalPart("");
    setLocalEdited(false);
    setEmail("");
    setTemplate("");
    setChosen([]);
    setRequireTotpOnAccept(false);
  };

  const invite = useMutation({
    mutationFn: () =>
      invitePerson({
        email: email.trim(),
        username: loginDomain ? localPart : undefined,
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        requireTotp: requireTotpOnAccept,
        settingsTemplate: template || undefined,
        groups: chosen,
      }),
    onSuccess: (result) => {
      if (result.mailed) reset();
      onInvited();
    },
  });

  const ready = email.includes("@") && (!loginDomain || localPart.length > 0);

  return (
    <div className="admin-console__card">
      <form
        className="admin-console__card-main admin-console__form--invite"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) invite.mutate();
        }}
      >
        <h3 className="admin-console__card-title">{t("members.inviteTitle")}</h3>
        <p className="admin-console__card-desc">{t("members.inviteLead")}</p>

        <div className="admin-console__field-row">
          <div className="admin-console__field">
            <label htmlFor="inv-first">{t("members.firstName")}</label>
            <input
              id="inv-first"
              name="invitee-given"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              value={firstName}
              onChange={(e) => setName(e.target.value, lastName)}
            />
          </div>
          <div className="admin-console__field">
            <label htmlFor="inv-last">{t("members.lastName")}</label>
            <input
              id="inv-last"
              name="invitee-family"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              value={lastName}
              onChange={(e) => setName(firstName, e.target.value)}
            />
          </div>
        </div>

        {loginDomain && (
          <div className="admin-console__field">
            <label htmlFor="inv-login">{t("members.username")}</label>
            <div className="admin-console__email-input-wrapper">
              <input
                id="inv-login"
                name="invitee-login-local"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                value={localPart}
                onChange={(e) => {
                  setLocalPart(sanitizeLocalPart(e.target.value));
                  setLocalEdited(true);
                }}
              />
              <span className="admin-console__email-domain">@{loginDomain}</span>
            </div>
          </div>
        )}

        <div className="admin-console__field">
          <label htmlFor="inv-email">{t("members.inviteEmail")}</label>
          <input
            id="inv-email"
            name="invitee-delivery"
            type="email"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            placeholder={t("members.inviteEmailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className="admin-console__hint">{t("members.inviteEmailHint")}</p>
        </div>

        <div className="admin-console__field-row">
          <div className="admin-console__field">
            <label htmlFor="inv-groups">{t("members.groups")}</label>
            <GroupPicker
              id="inv-groups"
              groups={groups}
              selected={chosen}
              onToggle={(path, on) =>
                setChosen(on ? [...chosen, path] : chosen.filter((p) => p !== path))
              }
            />
          </div>
          {templatesOffered && (
            <div className="admin-console__field">
              <label htmlFor="inv-template">{t("members.template")}</label>
              <select id="inv-template" value={template} onChange={(e) => setTemplate(e.target.value)}>
                <option value="">{t("members.templateNone")}</option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <label className="admin-console__checkbox">
          <input
            type="checkbox"
            checked={requireTotpOnAccept}
            onChange={(e) => setRequireTotpOnAccept(e.target.checked)}
          />
          <span>{t("members.requireTotpOnAccept")}</span>
        </label>

        {invite.isError && <p className="admin-console__error">{String(invite.error)}</p>}
        {invite.data && !invite.data.mailed && (
          <p className="admin-console__error">
            {t("members.createdNotMailed", { login: invite.data.person.username })} {invite.data.warning}
          </p>
        )}
        {invite.data?.mailed && (
          <p className="admin-console__success">
            {t("members.invitationSent", { email: invite.data.person.email })}
          </p>
        )}
        {invite.data?.templateApplied === false && (
          <p className="admin-console__warning">{invite.data.warning}</p>
        )}

        <div className="admin-console__form-footer">
          <button
            className="admin-console__btn admin-console__btn--primary"
            type="submit"
            disabled={!ready || invite.isPending}
          >
            {invite.isPending ? t("members.inviting") : t("members.invite")}
          </button>
        </div>
      </form>
    </div>
  );
}

function MemberRow({
  person,
  groups,
  editing,
  onToggle,
  onChanged,
}: {
  person: Person;
  groups: DescribedGroup[];
  editing: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <tr className={editing ? "admin-console__row--editing" : undefined}>
        <td className="admin-console__mono">{person.username}</td>
        <td>{person.name || "—"}</td>
        <td>
          {!person.enabled ? (
            <span className="admin-console__badge admin-console__badge--danger">{t("members.disabled")}</span>
          ) : person.pending ? (
            <span className="admin-console__badge admin-console__badge--warn">{t("members.pending")}</span>
          ) : (
            <span className="admin-console__badge admin-console__badge--ok">{t("members.active")}</span>
          )}{" "}
          {person.totpRequired && <span className="admin-console__badge">{t("members.totpRequired")}</span>}
        </td>
        <td>
          <button className="admin-console__btn admin-console__btn--quiet" type="button" onClick={onToggle}>
            {editing ? t("members.close") : t("members.edit")}
          </button>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={4}>
            <MemberEditor person={person} groups={groups} onChanged={onChanged} onRemoved={onToggle} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * One member, opened: who they are, which groups they are in, how they sign
 * in. Read again when opened, because the list does not carry anybody's groups
 * or second factor -- a call per person, made only for the one being looked at.
 */
function MemberEditor({
  person,
  groups,
  onChanged,
  onRemoved,
}: {
  person: Person;
  groups: DescribedGroup[];
  onChanged: () => void;
  onRemoved: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["admin", "people", "detail", person.id],
    queryFn: () => fetchPerson(person.id),
  });
  const p = detail.data ?? person;
  const [draft, setDraft] = useState<{ firstName?: string; lastName?: string; email?: string; enabled?: boolean }>(
    {},
  );
  const [notice, setNotice] = useState<string | null>(null);
  const changed = Object.keys(draft).length > 0;

  const after = (message?: string) => {
    setNotice(message ?? null);
    void queryClient.invalidateQueries({ queryKey: ["admin", "people", "detail", person.id] });
    onChanged();
  };

  const save = useMutation({
    mutationFn: () => updatePerson({ person: person.id, ...draft }),
    onSuccess: () => {
      setDraft({});
      after(t("members.saved"));
    },
  });
  const membership = useMutation({
    mutationFn: (v: { group: string; member: boolean }) => setMembership({ person: person.id, ...v }),
    onSuccess: () => after(),
  });
  const reset = useMutation({
    mutationFn: () => sendPasswordReset(person.id),
    onSuccess: () => after(t("members.resetSent", { email: p.email })),
  });
  const totpOn = useMutation({
    mutationFn: () => requireTotp(person.id, true),
    onSuccess: () => after(t("members.totpMailed", { email: p.email })),
  });
  const totpOff = useMutation({
    mutationFn: () => removeTotp(person.id),
    onSuccess: () => after(t("members.totpRemoved")),
  });
  const remove = useMutation({
    mutationFn: () => removePerson(person.id),
    onSuccess: () => {
      onRemoved();
      onChanged();
    },
  });
  const failure = [save, membership, reset, totpOn, totpOff, remove].find((m) => m.isError)?.error;

  if (detail.isLoading) {
    return <p className="admin-console__hint">{t("members.reading")}</p>;
  }

  return (
    <div className="admin-console__edit-panel">
      <div className="admin-console__edit-panel-body">
        <div className="admin-console__field-row">
          <div className="admin-console__field">
            <label htmlFor={`m-first-${person.id}`}>{t("members.firstName")}</label>
            <input
              id={`m-first-${person.id}`}
              value={draft.firstName ?? p.firstName ?? ""}
              onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
            />
          </div>
          <div className="admin-console__field">
            <label htmlFor={`m-last-${person.id}`}>{t("members.lastName")}</label>
            <input
              id={`m-last-${person.id}`}
              value={draft.lastName ?? p.lastName ?? ""}
              onChange={(e) => setDraft({ ...draft, lastName: e.target.value })}
            />
          </div>
        </div>
        <div className="admin-console__field-row">
          <div className="admin-console__field">
            <label htmlFor={`m-email-${person.id}`}>{t("members.inviteEmail")}</label>
            <input
              id={`m-email-${person.id}`}
              type="email"
              value={draft.email ?? p.email ?? ""}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            />
          </div>
          <div className="admin-console__field">
            <label htmlFor={`m-groups-${person.id}`}>{t("members.groups")}</label>
            <GroupPicker
              id={`m-groups-${person.id}`}
              groups={groups}
              selected={p.groups ?? []}
              disabled={membership.isPending}
              onToggle={(group, member) => membership.mutate({ group, member })}
            />
          </div>
        </div>
        <label className="admin-console__checkbox">
          <input
            type="checkbox"
            checked={draft.enabled ?? p.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          <span>{t("members.maySignIn")}</span>
        </label>

        <div className="admin-console__subsection">
          <h4 className="admin-console__subsection-title">{t("members.signIn")}</h4>
          <p className="admin-console__hint">
            {p.totpConfigured
              ? t("members.totpConfigured")
              : p.totpRequired
                ? t("members.totpPending")
                : t("members.totpNone")}
          </p>
          <div className="admin-console__actions">
            <button
              className="admin-console__btn"
              type="button"
              disabled={reset.isPending}
              onClick={() => reset.mutate()}
            >
              {t("members.sendReset")}
            </button>
            {!p.totpConfigured && !p.totpRequired && (
              <button
                className="admin-console__btn"
                type="button"
                disabled={totpOn.isPending}
                onClick={() => totpOn.mutate()}
              >
                {t("members.requireTotp")}
              </button>
            )}
            {(p.totpConfigured || p.totpRequired) && (
              <button
                className="admin-console__btn"
                type="button"
                disabled={totpOff.isPending}
                onClick={() => {
                  if (window.confirm(t("members.removeTotpConfirm", { login: p.username }))) totpOff.mutate();
                }}
              >
                {p.totpConfigured ? t("members.removeTotp") : t("members.cancelTotp")}
              </button>
            )}
          </div>
        </div>

        {notice && <p className="admin-console__success">{notice}</p>}
        {failure && <p className="admin-console__error">{String(failure)}</p>}

        <div className="admin-console__edit-actions">
          <button
            className="admin-console__btn admin-console__btn--danger"
            type="button"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(t("members.removeConfirm", { login: p.username }))) remove.mutate();
            }}
          >
            {t("members.remove")}
          </button>
          <button
            className="admin-console__btn admin-console__btn--primary"
            type="button"
            disabled={!changed || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? t("members.saving") : t("members.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

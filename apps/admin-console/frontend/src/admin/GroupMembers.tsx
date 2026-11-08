/* SPDX-License-Identifier: Apache-2.0 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchGroupMembers, fetchPeople, setMembership } from "@/api/admin";
import { Checklist } from "./Checklist";
import { toggleDraft, withDraft, withoutKey, type MembershipDraft } from "./membershipDraft";
import "./admin.css";

/**
 * Who is in one group, ticked from the tenant's members.
 *
 * Ticks are collected and applied together when Save is pressed, through the
 * registrar and with the person's own token; a change that is refused stays
 * ticked and is named with what the registrar said. Used wherever a group is
 * opened: on Groups, and on an app's own page, where the group is the app's
 * and being in it is having access.
 */
export function GroupMembers({ group }: { group: { id: string; path: string } }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const people = useQuery({ queryKey: ["admin", "people", ""], queryFn: () => fetchPeople() });
  const members = useQuery({
    queryKey: ["admin", "people", "group-members", group.path],
    queryFn: () => fetchGroupMembers(group.path),
  });
  const memberIds = new Set((members.data?.people ?? []).map((p) => p.id));
  // Who is to be in (true) or out (false), not saved yet.
  const [draft, setDraft] = useState<MembershipDraft>({});
  const [notice, setNotice] = useState<string | null>(null);
  const selected = withDraft(memberIds, draft);
  const toggle = (person: string, member: boolean) => {
    setNotice(null);
    setDraft((now) => toggleDraft(now, memberIds, person, member));
  };

  const save = useMutation({
    mutationFn: async () => {
      const names = new Map((people.data?.people ?? []).map((p) => [p.id, p.name || p.username]));
      const failed: string[] = [];
      for (const [person, member] of Object.entries(draft)) {
        try {
          await setMembership({ person, group: group.path, member });
          setDraft((now) => withoutKey(now, person));
        } catch (error) {
          failed.push(
            t(member ? "groups.saveFailedAdd" : "groups.saveFailedRemove", {
              person: names.get(person) ?? person,
              error: String(error),
            }),
          );
        }
      }
      if (failed.length > 0) throw new Error(failed.join(" "));
    },
    onSuccess: () => setNotice(t("groups.membersSaved")),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "people", "group-members", group.path] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "people", "detail"] });
    },
  });

  if (people.isLoading || members.isLoading) {
    return <p className="admin-console__hint">{t("groups.readingMembers")}</p>;
  }
  const failure = people.error ?? members.error ?? save.error;
  const changed = Object.keys(draft).length > 0;
  return (
    <>
      {people.isError || members.isError ? null : (
        <>
          <Checklist
            id={`g-members-${group.id}`}
            items={(people.data?.people ?? []).map((p) => ({
              key: p.id,
              label: p.name || p.username,
              detail: p.name ? p.username : undefined,
            }))}
            selected={selected}
            disabled={save.isPending}
            onToggle={toggle}
          />
          <div className="admin-console__actions">
            <button
              type="button"
              className="admin-console__btn admin-console__btn--primary"
              disabled={!changed || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? t("members.saving") : t("members.save")}
            </button>
          </div>
        </>
      )}
      {notice && !changed ? <p className="admin-console__success">{notice}</p> : null}
      {failure ? (
        <p className="admin-console__error">{failure instanceof Error ? failure.message : String(failure)}</p>
      ) : null}
    </>
  );
}

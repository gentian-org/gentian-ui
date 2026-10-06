/* SPDX-License-Identifier: Apache-2.0 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchGroupMembers, fetchPeople, setMembership } from "@/api/admin";
import { Checklist } from "./Checklist";
import "./admin.css";

/**
 * Who is in one group, ticked from the tenant's members.
 *
 * Membership changes as each box is ticked, through the registrar and with
 * the person's own token; what it refuses is shown as it said it. Used
 * wherever a group is opened: on Groups, and on an app's own page, where the
 * group is the app's and being in it is having access.
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

  const membership = useMutation({
    mutationFn: (v: { person: string; member: boolean }) =>
      setMembership({ person: v.person, group: group.path, member: v.member }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "people", "group-members", group.path] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "people", "detail"] });
    },
  });

  if (people.isLoading || members.isLoading) {
    return <p className="admin-console__hint">{t("groups.readingMembers")}</p>;
  }
  const failure = people.error ?? members.error ?? membership.error;
  return (
    <>
      {people.isError || members.isError ? null : (
        <Checklist
          id={`g-members-${group.id}`}
          items={(people.data?.people ?? []).map((p) => ({
            key: p.id,
            label: p.name || p.username,
            detail: p.name ? p.username : undefined,
          }))}
          selected={memberIds}
          disabled={membership.isPending}
          onToggle={(person, member) => membership.mutate({ person, member })}
        />
      )}
      {failure ? <p className="admin-console__error">{String(failure)}</p> : null}
    </>
  );
}

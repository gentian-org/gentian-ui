import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createGroup, deleteGroup, fetchGroups, updateGroup } from "@/api/admin";
import "./admin.css";

type GroupsSectionProps = {
  tenant: string;
};

export function GroupsSection({ tenant }: GroupsSectionProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(`gentian:tenant:${tenant}:app:`);
  const [error, setError] = useState<string | null>(null);

  const groupsQuery = useQuery({
    queryKey: ["admin", "groups", tenant],
    queryFn: () => fetchGroups(tenant),
  });

  const createMutation = useMutation({
    mutationFn: () => createGroup(name, tenant),
    onSuccess: async () => {
      setName(`gentian:tenant:${tenant}:app:`);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["admin", "groups", tenant] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteGroup(id, tenant),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "groups", tenant] });
      await queryClient.invalidateQueries({ queryKey: ["admin", "members", tenant] });
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, nextName }: { id: string; nextName: string }) =>
      updateGroup(id, nextName, tenant),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin", "groups", tenant] });
    },
  });

  const groups = groupsQuery.data ?? [];

  return (
    <section>
      <div className="admin-console__toolbar">
        <h2 className="admin-console__title" style={{ fontSize: "1.125rem" }}>
          Groups
        </h2>
      </div>

      <form
        className="admin-console__form"
        onSubmit={(event) => {
          event.preventDefault();
          createMutation.mutate();
        }}
      >
        <div className="admin-console__field">
          <label htmlFor="group-name">Group name</label>
          <input
            id="group-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="admin-console__mono"
          />
        </div>
        {error && <p className="admin-console__error">{error}</p>}
        <button className="admin-console__btn admin-console__btn--primary" type="submit">
          Create group
        </button>
      </form>

      <table className="admin-console__table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Path</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.id}>
              <td className="admin-console__mono">{group.name}</td>
              <td className="admin-console__mono">{group.path}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <button
                  type="button"
                  className="admin-console__btn"
                  onClick={() => {
                    const nextName = window.prompt("Rename group", group.name);
                    if (nextName && nextName !== group.name) {
                      renameMutation.mutate({ id: group.id, nextName });
                    }
                  }}
                >
                  Rename
                </button>{" "}
                <button
                  type="button"
                  className="admin-console__btn admin-console__btn--danger"
                  onClick={() => deleteMutation.mutate(group.id)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

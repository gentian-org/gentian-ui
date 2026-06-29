import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  fetchSessions,
  revokeAllMemberSessions,
  revokeMemberSession,
  type AdminMemberSession,
} from "@/api/admin";
import "./admin.css";

type SessionsSectionProps = {
  tenant: string;
};

function formatSessionTime(epochSeconds: number) {
  if (!epochSeconds) {
    return "—";
  }
  return new Date(epochSeconds * 1000).toLocaleString();
}

function memberLabel(session: AdminMemberSession) {
  return session.memberEmail ?? session.memberUsername;
}

export function SessionsSection({ tenant }: SessionsSectionProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const sessionsQuery = useQuery({
    queryKey: ["admin", "sessions", tenant],
    queryFn: () => fetchSessions(tenant),
  });

  const revokeMutation = useMutation({
    mutationFn: ({ memberId, sessionId }: { memberId: string; sessionId: string }) =>
      revokeMemberSession(memberId, sessionId, tenant),
    onSuccess: async () => {
      setError(null);
      setSuccess("Session revoked.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "sessions", tenant] });
    },
    onError: (err: Error) => {
      setSuccess(null);
      setError(err.message);
    },
  });

  const revokeAllMutation = useMutation({
    mutationFn: (memberId: string) => revokeAllMemberSessions(memberId, tenant),
    onSuccess: async () => {
      setError(null);
      setSuccess("All sessions signed out for that member.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "sessions", tenant] });
    },
    onError: (err: Error) => {
      setSuccess(null);
      setError(err.message);
    },
  });

  const sessions = sessionsQuery.data ?? [];

  const membersWithSessions = useMemo(() => {
    const grouped = new Map<string, { label: string; sessions: AdminMemberSession[] }>();
    for (const session of sessions) {
      const existing = grouped.get(session.memberId);
      if (existing) {
        existing.sessions.push(session);
      } else {
        grouped.set(session.memberId, {
          label: memberLabel(session),
          sessions: [session],
        });
      }
    }
    return Array.from(grouped.entries()).sort((a, b) =>
      a[1].label.localeCompare(b[1].label),
    );
  }, [sessions]);

  if (sessionsQuery.isLoading) {
    return <p>Loading active sessions…</p>;
  }

  if (sessionsQuery.isError) {
    return <p className="admin-console__error">Sessions are not available.</p>;
  }

  return (
    <section>
      <div className="admin-console__toolbar">
        <h2 className="admin-console__title" style={{ fontSize: "1.125rem" }}>
          Active sessions
        </h2>
        <button
          type="button"
          className="admin-console__btn"
          onClick={() => sessionsQuery.refetch()}
        >
          Refresh
        </button>
      </div>

      <p style={{ fontSize: "0.875rem", color: "var(--gtn-ink-4)", marginBottom: "1rem" }}>
        Signed-in portal and app sessions for this workspace. Revoke individual sessions or sign a
        member out everywhere. Disabling a member also ends all sessions automatically.
      </p>

      {error && <p className="admin-console__error">{error}</p>}
      {success && <p className="admin-console__success">{success}</p>}

      {sessions.length === 0 ? (
        <p style={{ fontSize: "0.875rem" }}>No active sessions.</p>
      ) : (
        membersWithSessions.map(([memberId, group]) => (
          <div key={memberId} style={{ marginBottom: "1.5rem" }}>
            <div
              className="admin-console__toolbar"
              style={{ marginBottom: "0.5rem", alignItems: "baseline" }}
            >
              <h3 className="admin-console__mono" style={{ margin: 0, fontSize: "0.9375rem" }}>
                {group.label}
              </h3>
              <button
                type="button"
                className="admin-console__btn admin-console__btn--danger"
                disabled={revokeAllMutation.isPending}
                onClick={() => {
                  setSuccess(null);
                  revokeAllMutation.mutate(memberId);
                }}
              >
                Sign out everywhere
              </button>
            </div>
            <table className="admin-console__table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>IP address</th>
                  <th>Started</th>
                  <th>Last access</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {group.sessions.map((session) => (
                  <tr key={session.id}>
                    <td>{session.clientName}</td>
                    <td className="admin-console__mono">{session.ipAddress ?? "—"}</td>
                    <td>{formatSessionTime(session.startedAt)}</td>
                    <td>{formatSessionTime(session.lastAccessAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="admin-console__btn"
                        disabled={revokeMutation.isPending}
                        onClick={() => {
                          setSuccess(null);
                          revokeMutation.mutate({
                            memberId: session.memberId,
                            sessionId: session.id,
                          });
                        }}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </section>
  );
}

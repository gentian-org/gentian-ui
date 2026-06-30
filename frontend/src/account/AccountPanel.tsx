import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  changeAccountPassword,
  fetchAccountProfile,
  fetchAccountSessions,
  requestAccountTotp,
  revokeAccountSession,
  revokeAllAccountSessions,
  updateAccountProfile,
} from "@/api/account";
import "@/styles/shell-panel.css";

type AccountTab = "profile" | "password" | "security" | "sessions";

type AccountPanelProps = {
  embedded?: boolean;
};

function formatTime(epochMs: number | null | undefined) {
  if (!epochMs) {
    return "—";
  }
  return new Date(epochMs).toLocaleString();
}

export function AccountPanel({ embedded = false }: AccountPanelProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<AccountTab>("profile");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ["account", "profile"],
    queryFn: fetchAccountProfile,
  });

  const sessionsQuery = useQuery({
    queryKey: ["account", "sessions"],
    queryFn: fetchAccountSessions,
    enabled: tab === "sessions",
  });

  const profileMutation = useMutation({
    mutationFn: () => updateAccountProfile({ firstName, lastName }),
    onSuccess: async (profile) => {
      setError(null);
      setMessage("Profile updated.");
      setFirstName(profile.firstName);
      setLastName(profile.lastName);
      await queryClient.invalidateQueries({ queryKey: ["account", "profile"] });
    },
    onError: (err: Error) => {
      setMessage(null);
      setError(err.message);
    },
  });

  const passwordMutation = useMutation({
    mutationFn: () => changeAccountPassword(currentPassword, newPassword),
    onSuccess: () => {
      setError(null);
      setMessage("Password changed.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err: Error) => {
      setMessage(null);
      setError(err.message);
    },
  });

  const totpMutation = useMutation({
    mutationFn: requestAccountTotp,
    onSuccess: async () => {
      setError(null);
      setMessage("TOTP setup will be required on your next sign-in.");
      await queryClient.invalidateQueries({ queryKey: ["account", "profile"] });
    },
    onError: (err: Error) => {
      setMessage(null);
      setError(err.message);
    },
  });

  const revokeAllMutation = useMutation({
    mutationFn: revokeAllAccountSessions,
    onSuccess: async () => {
      setError(null);
      setMessage("Signed out of all other sessions.");
      await queryClient.invalidateQueries({ queryKey: ["account", "sessions"] });
    },
    onError: (err: Error) => {
      setMessage(null);
      setError(err.message);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) => revokeAccountSession(sessionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["account", "sessions"] });
    },
  });

  const profile = profileQuery.data;

  useEffect(() => {
    if (!profile) {
      return;
    }
    setFirstName(profile.firstName ?? "");
    setLastName(profile.lastName ?? "");
  }, [profile?.firstName, profile?.lastName, profile?.email]);

  const rootClass = `shell-panel${embedded ? " shell-panel--embedded" : ""}`;

  return (
    <div className={rootClass}>
      <div className="shell-panel__frame">
        <header className="shell-panel__header">
          <div className="shell-panel__eyebrow">Your workspace</div>
          <h1 className="shell-panel__title">Account</h1>
        </header>

        <nav className="shell-panel__tabs" aria-label="Account sections">
          {(
            [
              ["profile", "Profile"],
              ["password", "Password"],
              ["security", "Security"],
              ["sessions", "Sessions"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`shell-panel__tab${tab === id ? " shell-panel__tab--active" : ""}`}
              onClick={() => {
                setTab(id);
                setMessage(null);
                setError(null);
              }}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="shell-panel__body">
          {profileQuery.isLoading && <p>Loading account…</p>}
          {profileQuery.isError && (
            <p className="shell-panel__error">Account settings are unavailable.</p>
          )}

          {message && <p className="shell-panel__success">{message}</p>}
          {error && <p className="shell-panel__error">{error}</p>}

          {tab === "profile" && profile && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setMessage(null);
                profileMutation.mutate();
              }}
            >
              <div className="shell-panel__field">
                <label htmlFor="account-email">Email</label>
                <input id="account-email" type="email" value={profile.email ?? ""} disabled />
                <p className="shell-panel__hint">Contact your administrator to change your login email.</p>
              </div>
              <div className="shell-panel__field">
                <label htmlFor="account-first">First name</label>
                <input
                  id="account-first"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="shell-panel__field">
                <label htmlFor="account-last">Last name</label>
                <input
                  id="account-last"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className="shell-panel__btn shell-panel__btn--primary"
                disabled={profileMutation.isPending}
              >
                Save profile
              </button>
            </form>
          )}

          {tab === "password" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                setMessage(null);
                setError(null);
                if (newPassword !== confirmPassword) {
                  setError("New passwords do not match.");
                  return;
                }
                if (newPassword.length < 8) {
                  setError("Password must be at least 8 characters.");
                  return;
                }
                passwordMutation.mutate();
              }}
            >
              <div className="shell-panel__field">
                <label htmlFor="account-current-pw">Current password</label>
                <input
                  id="account-current-pw"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>
              <div className="shell-panel__field">
                <label htmlFor="account-new-pw">New password</label>
                <input
                  id="account-new-pw"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>
              <div className="shell-panel__field">
                <label htmlFor="account-confirm-pw">Confirm new password</label>
                <input
                  id="account-confirm-pw"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <button
                type="submit"
                className="shell-panel__btn shell-panel__btn--primary"
                disabled={passwordMutation.isPending}
              >
                Change password
              </button>
            </form>
          )}

          {tab === "security" && profile && (
            <section>
              <p className="shell-panel__hint" style={{ marginBottom: "1rem" }}>
                Protect your account with a time-based one-time password (TOTP) authenticator app.
              </p>
              <p style={{ marginBottom: "1rem" }}>
                Status:{" "}
                {profile.totpConfigured
                  ? "TOTP is active"
                  : profile.totpPending
                    ? "TOTP setup pending on next sign-in"
                    : "TOTP not configured"}
              </p>
              {!profile.totpConfigured && (
                <button
                  type="button"
                  className="shell-panel__btn shell-panel__btn--primary"
                  disabled={totpMutation.isPending}
                  onClick={() => {
                    setMessage(null);
                    totpMutation.mutate();
                  }}
                >
                  Set up authenticator app
                </button>
              )}
            </section>
          )}

          {tab === "sessions" && (
            <section>
              <div style={{ marginBottom: "1rem" }}>
                <button
                  type="button"
                  className="shell-panel__btn shell-panel__btn--primary"
                  disabled={revokeAllMutation.isPending}
                  onClick={() => {
                    setMessage(null);
                    revokeAllMutation.mutate();
                  }}
                >
                  Sign out everywhere
                </button>
                <p className="shell-panel__hint">Ends all sessions except this browser.</p>
              </div>
              {sessionsQuery.isLoading && <p>Loading sessions…</p>}
              <table className="shell-panel__table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>IP</th>
                    <th>Last active</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(sessionsQuery.data ?? []).map((session) => {
                    const clientName =
                      session.clients[0]?.clientName ?? (session.current ? "This device" : "App");
                    return (
                      <tr key={session.id ?? clientName}>
                        <td>
                          {clientName}
                          {session.current ? " (current)" : ""}
                        </td>
                        <td>{session.ipAddress ?? "—"}</td>
                        <td>{formatTime(session.lastAccess ?? session.started)}</td>
                        <td>
                          {!session.current && session.id && (
                            <button
                              type="button"
                              className="shell-panel__btn"
                              disabled={revokeMutation.isPending}
                              onClick={() => revokeMutation.mutate(session.id!)}
                            >
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

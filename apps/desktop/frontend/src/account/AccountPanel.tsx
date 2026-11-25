import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  fetchAccountProfile,
  fetchAccountSessions,
  revokeAccountSession,
  revokeAllAccountSessions,
  updateAccountProfile,
} from "@/api/account";
import { accountConsoleUrl } from "@/auth/oidc";
import { DevicesTab } from "@/account/DevicesTab";
import { ConnectionsTab } from "@/account/ConnectionsTab";
import { arrivalShown, pendingArrival } from "@/account/arrival";
import { fetchConnections } from "@/api/connections";
import "@/styles/shell-panel.css";

import { useTranslation } from "react-i18next";
import { formatDateTime } from "@/lib/locale";
type AccountTab = "profile" | "security" | "sessions" | "devices" | "connections";

type AccountPanelProps = {
  embedded?: boolean;
};

function formatTime(epochMs: number | null | undefined) {
  if (!epochMs) {
    return "—";
  }
  return formatDateTime(epochMs);
}

export function AccountPanel({ embedded = false }: AccountPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // A person back from an outside service's sign-in lands on Connections.
  const [arrival] = useState(pendingArrival);
  const [tab, setTab] = useState<AccountTab>(arrival?.tab ?? "profile");
  useEffect(() => {
    arrivalShown();
  }, []);
  // The tab is there only where the workspace has a liaison.
  const connectionsQuery = useQuery({
    queryKey: ["account", "connections"],
    queryFn: fetchConnections,
  });
  const hasConnections = connectionsQuery.data?.available === true || tab === "connections";
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
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
      setMessage(t("account.updated"));
      setFirstName(profile.firstName);
      setLastName(profile.lastName);
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
      setMessage(t("account.sessionsSignedOutOthers"));
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
          <div className="shell-panel__eyebrow">{t("account.workspace")}</div>
          <h1 className="shell-panel__title">{t("account.title")}</h1>
        </header>

        <nav className="shell-panel__tabs" aria-label={t("account.sections")}>
          {(
            [
              ["profile", "Profile"],
              ["security", "Security"],
              ["sessions", "Sessions"],
              ["devices", "Devices"],
              ["connections", "Connections"],
            ] as const
          )
            .filter(([id]) => id !== "connections" || hasConnections)
            .map(([id, label]) => (
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
          {profileQuery.isLoading && <p>{t("account.loading")}</p>}
          {profileQuery.isError && (
            <p className="shell-panel__error">
              {profileQuery.error instanceof Error
                ? profileQuery.error.message
                : t("account.unavailable")}
            </p>
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
                <label htmlFor="account-email">{t("account.email")}</label>
                <input id="account-email" type="email" value={profile.email ?? ""} disabled />
                <p className="shell-panel__hint">{t("account.emailHint")}</p>
              </div>
              <div className="shell-panel__field">
                <label htmlFor="account-first">{t("account.firstName")}</label>
                <input
                  id="account-first"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="shell-panel__field">
                <label htmlFor="account-last">{t("account.lastName")}</label>
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
                // Set up where credentials live, with the session you already
                // hold. This used to be a button here, and behind it this
                // service set a required action on your account through
                // Keycloak's ADMIN API -- an administrator credential, held by
                // the desktop, to do something you were asking for about
                // yourself (gentian-os S7A.6).
                <a
                  className="shell-panel__btn shell-panel__btn--primary"
                  href={accountConsoleUrl()}
                  target="_blank"
                  rel="noreferrer"
                >
                  Set up authenticator app
                </a>
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
                <p className="shell-panel__hint">{t("account.sessionsSignOutOthers")}</p>
              </div>
              {sessionsQuery.isLoading && <p>{t("account.sessionsLoading")}</p>}
              <table className="shell-panel__table">
                <thead>
                  <tr>
                    <th>{t("account.sessionsClient")}</th>
                    <th>IP</th>
                    <th>{t("account.sessionsLastActive")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(sessionsQuery.data ?? []).map((session) => {
                    const clientName =
                      session.clients[0]?.clientName ?? (session.current ? t("account.sessionsThisDevice") : "App");
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
          {tab === "devices" && <DevicesTab />}
          {tab === "connections" && <ConnectionsTab arrival={arrival} />}
        </div>
      </div>
    </div>
  );
}

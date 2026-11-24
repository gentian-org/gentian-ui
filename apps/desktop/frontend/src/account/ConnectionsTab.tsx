import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { endConnection, fetchConnections, startConnection } from "@/api/connections";
import type { AccountArrival } from "@/account/arrival";

type ConnectionsTabProps = {
  arrival?: AccountArrival | null;
};

/**
 * A person's own sign-ins at services outside the workspace, which the
 * agents they run call on their behalf. Connect takes them to the service's
 * own sign-in and back here; what the service hands back stays with the
 * platform, never with an agent.
 */
export function ConnectionsTab({ arrival }: ConnectionsTabProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice] = useState<string | null>(() =>
    arrival?.connected ? t("account.connectionsConnected", { name: arrival.connected }) : null,
  );
  const [failed] = useState<string | null>(() =>
    arrival?.failed === "declined"
      ? t("account.connectionsDeclined")
      : arrival?.failed
        ? t("account.connectionsFailed")
        : null,
  );

  const listQuery = useQuery({ queryKey: ["account", "connections"], queryFn: fetchConnections });

  const connect = useMutation({
    mutationFn: (name: string) => startConnection(name),
    onSuccess: ({ url }) => {
      window.location.assign(url);
    },
    onError: (err: Error) => setError(err.message),
  });

  const disconnect = useMutation({
    mutationFn: (name: string) => endConnection(name),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["account", "connections"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const rows = listQuery.data?.connections ?? [];
  const busy = connect.isPending || disconnect.isPending;

  return (
    <section>
      <p className="shell-panel__hint" style={{ marginBottom: "1rem" }}>
        {t("account.connectionsIntro")}
      </p>
      {notice && (
        <p className="shell-panel__success" role="status">
          {notice}
        </p>
      )}
      {failed && (
        <p className="shell-panel__error" role="alert">
          {failed}
        </p>
      )}
      {error && (
        <p className="shell-panel__error" role="alert">
          {error}
        </p>
      )}
      {listQuery.isLoading && <p>{t("account.loading")}</p>}
      {listQuery.isError && <p className="shell-panel__error">{t("account.connectionsUnavailable")}</p>}
      {listQuery.data && rows.length === 0 && <p>{t("account.connectionsNone")}</p>}
      {rows.length > 0 && (
        <table className="shell-panel__table">
          <thead>
            <tr>
              <th>{t("account.connectionsService")}</th>
              <th>{t("account.connectionsState")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td>
                  <strong>{row.service}</strong>
                  <div className="shell-panel__hint">{row.name}</div>
                </td>
                <td>{row.connected ? t("account.connectionsYes") : t("account.connectionsNo")}</td>
                <td>
                  {row.connected ? (
                    <button
                      type="button"
                      className="shell-panel__btn"
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        disconnect.mutate(row.name);
                      }}
                    >
                      {t("account.connectionsDisconnect")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="shell-panel__btn shell-panel__btn--primary"
                      disabled={busy}
                      onClick={() => {
                        setError(null);
                        connect.mutate(row.name);
                      }}
                    >
                      {t("account.connectionsConnect")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

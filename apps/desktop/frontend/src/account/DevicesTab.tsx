import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createDevicePassword,
  DevicesError,
  fetchDevicePasswords,
  fetchDoor,
  revokeDevicePassword,
  type NewDevicePassword,
} from "@/api/devices";
import { signInAgain } from "@/auth/oidc";
import { formatDateTime } from "@/lib/locale";

/**
 * A person's own device passwords: for a calendar, contact or file program
 * that knows only a username and a password. The ways offered are the ones
 * the tenant's door serves to apps this person may use; the password is
 * shown once, with what the program needs to be set up.
 */
export function DevicesTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [made, setMade] = useState<NewDevicePassword | null>(null);
  const [error, setError] = useState<DevicesError | null>(null);
  const [copied, setCopied] = useState(false);

  const doorQuery = useQuery({ queryKey: ["account", "devices", "door"], queryFn: fetchDoor });
  const listQuery = useQuery({ queryKey: ["account", "devices"], queryFn: fetchDevicePasswords });

  const createMutation = useMutation({
    mutationFn: () => createDevicePassword(name.trim(), chosen),
    onSuccess: async (result) => {
      setError(null);
      setMade(result);
      setName("");
      setChosen([]);
      await queryClient.invalidateQueries({ queryKey: ["account", "devices"] });
    },
    onError: (err: Error) => {
      setError(err instanceof DevicesError ? err : new DevicesError(err.message, 0, false));
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeDevicePassword(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["account", "devices"] });
    },
    onError: (err: Error) => setError(new DevicesError(err.message, 0, false)),
  });

  const door = doorQuery.data;
  const ways = door?.ways ?? [];
  // A way's name is what a password names; two bridges may share one.
  const wayNames = Array.from(new Set(ways.map((w) => w.name)));
  const describe = (wayName: string) => {
    const of = ways.filter((w) => w.name === wayName);
    const protocols = Array.from(new Set(of.map((w) => w.protocol.toUpperCase()))).join(", ");
    return protocols ? `${wayName} (${protocols})` : wayName;
  };

  return (
    <section>
      <p className="shell-panel__hint" style={{ marginBottom: "1rem" }}>
        {t("account.devicesIntro")}
      </p>

      {error && (
        <div className="shell-panel__error" role="alert">
          <p>{error.signInAgain ? t("account.devicesSignInAgain") : error.message}</p>
          {error.signInAgain && (
            <button type="button" className="shell-panel__btn" onClick={() => void signInAgain()}>
              {t("account.devicesSignInAgainButton")}
            </button>
          )}
        </div>
      )}

      {made && door && (
        <div className="shell-panel__success" role="status" style={{ marginBottom: "1rem" }}>
          <p>
            <strong>{t("account.devicesMadeTitle", { name: made.name })}</strong>
          </p>
          <p>{t("account.devicesMadeOnce")}</p>
          <table className="shell-panel__table">
            <tbody>
              <tr>
                <th>{t("account.devicesServer")}</th>
                <td>
                  <code>{`https://${door.host}`}</code>
                </td>
              </tr>
              <tr>
                <th>{t("account.devicesUsername")}</th>
                <td>
                  <code>{made.username}</code>
                </td>
              </tr>
              <tr>
                <th>{t("account.devicesPassword")}</th>
                <td>
                  <code style={{ fontSize: "1.1em", letterSpacing: "0.05em" }}>{made.password}</code>{" "}
                  <button
                    type="button"
                    className="shell-panel__btn"
                    onClick={() => {
                      void navigator.clipboard?.writeText(made.password).then(() => setCopied(true));
                    }}
                  >
                    {copied ? t("account.devicesCopied") : t("account.devicesCopy")}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <button
            type="button"
            className="shell-panel__btn"
            onClick={() => {
              setMade(null);
              setCopied(false);
            }}
          >
            {t("account.devicesDone")}
          </button>
        </div>
      )}

      {doorQuery.isLoading && <p>{t("account.loading")}</p>}
      {doorQuery.isError && <p className="shell-panel__error">{t("account.devicesUnavailable")}</p>}
      {door && wayNames.length === 0 && <p>{t("account.devicesNoWays")}</p>}

      {door && wayNames.length > 0 && !made && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            createMutation.mutate();
          }}
          style={{ marginBottom: "1.5rem" }}
        >
          <div className="shell-panel__field">
            <label htmlFor="device-name">{t("account.devicesName")}</label>
            <input
              id="device-name"
              type="text"
              maxLength={64}
              placeholder={t("account.devicesNamePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <fieldset className="shell-panel__field">
            <legend>{t("account.devicesWays")}</legend>
            {wayNames.map((way) => (
              <label key={way} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  checked={chosen.includes(way)}
                  onChange={(e) =>
                    setChosen(e.target.checked ? [...chosen, way] : chosen.filter((w) => w !== way))
                  }
                />{" "}
                {describe(way)}
              </label>
            ))}
            <p className="shell-panel__hint">{t("account.devicesWaysHint")}</p>
          </fieldset>
          <button
            type="submit"
            className="shell-panel__btn shell-panel__btn--primary"
            disabled={createMutation.isPending || !name.trim() || chosen.length === 0}
          >
            {t("account.devicesCreate")}
          </button>
        </form>
      )}

      {listQuery.isError && <p className="shell-panel__error">{t("account.devicesUnavailable")}</p>}
      {(listQuery.data ?? []).length > 0 && (
        <table className="shell-panel__table">
          <thead>
            <tr>
              <th>{t("account.devicesName")}</th>
              <th>{t("account.devicesWays")}</th>
              <th>{t("account.devicesCreated")}</th>
              <th>{t("account.devicesLastUsed")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(listQuery.data ?? []).map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>{d.ways.join(", ")}</td>
                <td>{formatDateTime(Date.parse(d.createdAt))}</td>
                <td>{d.lastUsedAt ? formatDateTime(Date.parse(d.lastUsedAt)) : t("account.devicesNeverUsed")}</td>
                <td>
                  <button
                    type="button"
                    className="shell-panel__btn"
                    disabled={revokeMutation.isPending}
                    onClick={() => {
                      if (window.confirm(t("account.devicesRevokeConfirm", { name: d.name }))) {
                        revokeMutation.mutate(d.id);
                      }
                    }}
                  >
                    {t("account.devicesRevoke")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {listQuery.data && listQuery.data.length === 0 && <p>{t("account.devicesNone")}</p>}
    </section>
  );
}

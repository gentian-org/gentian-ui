/* SPDX-License-Identifier: Apache-2.0 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  fetchClusterModels,
  providerKeyProperty,
  updateClusterModels,
  type GatewayModel,
  type ModelInstance,
  type ModelProvider,
  type ModelSettings,
  type ProviderModel,
} from "@/api/cluster";
import { fetchCredentials, type CredentialStatus } from "@/api/credentials";
import "./admin.css";
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";

/**
 * The models this cluster's gateway offers, which are the Cluster claim's and
 * nobody else's: the gateway reads them from the claim when it starts and
 * takes none from its own console or API.
 *
 * The screen follows the cluster settings screen. It holds no credential and
 * decides nothing: the director says whether this person may read or change
 * the cluster, holds a change to the claim's schema, and commits it. A save is
 * a commit Argo CD has not applied yet, and the screen says so.
 *
 * Two things it is careful to be honest about.
 *
 * Whether a model works. Nothing here asks the gateway. A model the cluster
 * would serve itself is flagged as not served because the director says the
 * platform starts no server for it. A provider's model is checked against the
 * credentials list this console already reads: the token missing, or no
 * credential to enter it under, is flagged. A token that is there is reported
 * as supplied, not as working -- nobody probes it.
 *
 * Tokens. A provider's API token is never typed here. It is entered on the
 * Credentials screen, under a credential the cluster declares for every
 * provider on the claim. Which property of it the gateway reads follows from
 * the provider's name and is not a choice: a provider reads its own token and
 * no other provider's, so the screen shows the property and sends it as it is
 * computed.
 */

type Verdict = { tone: "ok" | "danger" | "warn" | "info"; label: string; note?: string };

/** What to say about one model, from the director's state and the credentials list. */
function verdictOf(model: GatewayModel, credentials: CredentialStatus[] | undefined, t: TFunction): Verdict {
  if (model.state === "not-served") {
    return { tone: "danger", label: t("models.notServed"), note: model.reason };
  }
  if (model.state === "not-offered") {
    return { tone: "warn", label: t("models.notOffered"), note: model.reason };
  }
  if (!credentials) {
    return { tone: "info", label: t("models.declared"), note: t("models.credentialsUnreadable") };
  }
  const credential = credentials.find((c) => c.name === model.credential);
  if (!credential) {
    return {
      tone: "danger",
      label: t("models.noCredential"),
      note: t("models.noCredentialNote", { credential: model.credential }),
    };
  }
  if (!credential.fields.some((f) => f.key === model.apiKeyProperty)) {
    return {
      tone: "danger",
      label: t("models.wrongProperty"),
      note: t("models.wrongPropertyNote", { credential: model.credential, property: model.apiKeyProperty }),
    };
  }
  if (!credential.satisfied) {
    return {
      tone: "danger",
      label: t("models.tokenMissing"),
      note: t("models.tokenMissingNote", { credential: model.credential }),
    };
  }
  return { tone: "ok", label: t("models.tokenSupplied"), note: t("models.tokenSuppliedNote") };
}

const emptyInstance = (): ModelInstance => ({ name: "", modelId: "" });
const emptyModel = (): ProviderModel => ({ name: "", model: "" });
const emptyProvider = (): ModelProvider => ({ name: "", apiBase: "", apiKeyProperty: "", models: [] });

/** The settings as the director takes them: no empty optional left in as an empty string. */
function cleaned(settings: ModelSettings): ModelSettings {
  const text = (v: string | undefined) => (v === undefined || v.trim() === "" ? undefined : v.trim());
  return {
    enabled: settings.enabled,
    gpuAcceleration: settings.gpuAcceleration,
    console: settings.console,
    instances: settings.instances.map((i) => ({
      ...i,
      name: i.name.trim(),
      modelId: i.modelId.trim(),
      gpuMemoryUtilization: text(i.gpuMemoryUtilization),
      maxModelLen: text(i.maxModelLen),
      modelCacheSize: text(i.modelCacheSize),
      imageTag: text(i.imageTag),
      toolCallParser: text(i.toolCallParser),
    })),
    providers: settings.providers.map((p) => ({
      name: p.name.trim(),
      displayName: text(p.displayName),
      apiBase: p.apiBase.trim(),
      apiKeyProperty: providerKeyProperty(p.name.trim()),
      models: p.models.map((m) => ({
        name: m.name.trim(),
        model: m.model.trim(),
        maxTokens: m.maxTokens,
        mode: text(m.mode),
      })),
    })),
  };
}

const MODES = ["chat", "completion", "embedding"];

export function ModelsSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const modelsQuery = useQuery({
    queryKey: ["cluster", "models"],
    queryFn: () => fetchClusterModels(),
  });
  // The credentials list is another service's and another permission's. When
  // it cannot be read the models are still shown, with the token's state
  // reported as unknown rather than guessed.
  const credentialsQuery = useQuery({
    queryKey: ["credentials"],
    queryFn: () => fetchCredentials(),
    retry: false,
  });

  const [draft, setDraft] = useState<ModelSettings | null>(null);
  const [lastCommit, setLastCommit] = useState<string | null>(null);
  const [unchanged, setUnchanged] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (settings: ModelSettings) => updateClusterModels(cleaned(settings)),
    onSuccess: (result) => {
      setDraft(null);
      setLastCommit(result.commit ?? null);
      setUnchanged(!result.changed);
      void queryClient.invalidateQueries({ queryKey: ["cluster", "models"] });
    },
  });

  if (modelsQuery.isLoading) {
    return <p className="admin-console__loading">{t("models.loading")}</p>;
  }
  if (modelsQuery.isError || !modelsQuery.data) {
    return <p className="admin-console__error">{t("models.unavailable")}</p>;
  }

  const { cluster, models } = modelsQuery.data;
  const saved = modelsQuery.data.settings;
  const settings = draft ?? saved;
  const credentials = credentialsQuery.data;

  const change = (next: ModelSettings) => {
    setLastCommit(null);
    setUnchanged(false);
    saveMutation.reset();
    setDraft(next);
  };
  const setInstance = (at: number, patch: Partial<ModelInstance>) =>
    change({ ...settings, instances: settings.instances.map((i, n) => (n === at ? { ...i, ...patch } : i)) });
  const setProvider = (at: number, patch: Partial<ModelProvider>) =>
    change({ ...settings, providers: settings.providers.map((p, n) => (n === at ? { ...p, ...patch } : p)) });
  const setProviderModel = (at: number, m: number, patch: Partial<ProviderModel>) =>
    setProvider(at, {
      models: settings.providers[at].models.map((model, n) => (n === m ? { ...model, ...patch } : model)),
    });

  return (
    <section>
      <header className="admin-console__section-head">
        <div>
          <h2 className="admin-console__section-title">{t("models.title")}</h2>
          <p className="admin-console__lead">
            <Trans
              i18nKey="models.lead"
              values={{ cluster }}
              components={{ mono: <span className="admin-console__mono" /> }}
            />
          </p>
        </div>
        {draft ? (
          <span className="admin-console__badge admin-console__badge--warn">{t("models.unsaved")}</span>
        ) : null}
      </header>

      {lastCommit ? (
        <p className="admin-console__success">
          <Trans
            i18nKey="models.committedAs"
            values={{ commit: lastCommit.slice(0, 8) }}
            components={{ mono: <span className="admin-console__mono" /> }}
          />
        </p>
      ) : null}
      {unchanged ? <p className="admin-console__hint">{t("models.nothingToCommit")}</p> : null}
      {saveMutation.isError ? (
        <p className="admin-console__error">{(saveMutation.error as Error).message || t("models.changeRefused")}</p>
      ) : null}

      <div className="admin-console__subsection">
        <h3 className="admin-console__subsection-title">{t("models.offered")}</h3>
        <p className="admin-console__hint">{t("models.offeredHint")}</p>
        {models.length === 0 ? (
          <p className="admin-console__empty">{t("models.none")}</p>
        ) : (
          <div className="admin-console__table-wrap">
            <table className="admin-console__table">
              <thead>
                <tr>
                  <th>{t("models.model")}</th>
                  <th>{t("models.servedBy")}</th>
                  <th>{t("models.status")}</th>
                </tr>
              </thead>
              <tbody>
                {models.map((model) => {
                  const verdict = verdictOf(model, credentials, t);
                  return (
                    <tr key={`${model.kind}/${model.name}`}>
                      <td>
                        <code>{model.name}</code>
                      </td>
                      <td>
                        {model.kind === "instance" ? t("models.thisCluster") : t("models.provider")}{" "}
                        <code>{model.source}</code>
                      </td>
                      <td>
                        <span className={`admin-console__badge admin-console__badge--${verdict.tone}`}>
                          {verdict.label}
                        </span>
                        {verdict.note ? <p className="admin-console__hint">{verdict.note}</p> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="admin-console__subsection">
        <h3 className="admin-console__subsection-title">{t("models.switches")}</h3>
        <label className="admin-console__checkbox">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => change({ ...settings, enabled: e.target.checked })}
          />
          <span>{t("models.enabled")}</span>
        </label>
        <p className="admin-console__hint">{t("models.enabledHint")}</p>
        <label className="admin-console__checkbox">
          <input
            type="checkbox"
            checked={settings.gpuAcceleration}
            onChange={(e) => change({ ...settings, gpuAcceleration: e.target.checked })}
          />
          <span>{t("models.gpuAcceleration")}</span>
        </label>
        <p className="admin-console__hint">{t("models.gpuAccelerationHint")}</p>
        <label className="admin-console__checkbox">
          <input
            type="checkbox"
            checked={settings.console?.enabled ?? false}
            onChange={(e) => change({ ...settings, console: { enabled: e.target.checked } })}
          />
          <span>{t("models.gatewayConsole")}</span>
        </label>
        <p className="admin-console__warning">{t("models.gatewayConsoleWarning")}</p>
      </div>

      <div className="admin-console__subsection">
        <h3 className="admin-console__subsection-title">{t("models.instances")}</h3>
        <p className="admin-console__hint">{t("models.instancesHint")}</p>
        {settings.instances.map((instance, at) => (
          <div className="admin-console__field admin-console__field-row" key={at}>
            <label>
              {t("models.instanceName")}
              <input
                type="text"
                value={instance.name}
                onChange={(e) => setInstance(at, { name: e.target.value })}
              />
            </label>
            <label>
              {t("models.modelId")}
              <input
                type="text"
                value={instance.modelId}
                placeholder={"Qwen/Qwen2.5-7B-Instruct"}
                onChange={(e) => setInstance(at, { modelId: e.target.value })}
              />
            </label>
            <div>
              <button
                type="button"
                className="admin-console__btn admin-console__btn--quiet"
                onClick={() => change({ ...settings, instances: settings.instances.filter((_, n) => n !== at) })}
              >
                {t("models.remove")}
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="admin-console__btn"
          onClick={() => change({ ...settings, instances: [...settings.instances, emptyInstance()] })}
        >
          {t("models.addInstance")}
        </button>
      </div>

      <div className="admin-console__subsection">
        <h3 className="admin-console__subsection-title">{t("models.providers")}</h3>
        <p className="admin-console__hint">{t("models.providersHint")}</p>
        <p className="admin-console__hint">{t("models.newProviderHint")}</p>
        <div className="admin-console__cards">
        {settings.providers.map((provider, at) => (
          <div className="admin-console__card" key={at}>
            <div className="admin-console__card-main">
              <div className="admin-console__field admin-console__field-row">
                <label>
                  {t("models.providerName")}
                  <input
                    type="text"
                    value={provider.name}
                    maxLength={40}
                    onChange={(e) => setProvider(at, { name: e.target.value })}
                  />
                </label>
                <label>
                  {t("models.displayName")}
                  <input
                    type="text"
                    value={provider.displayName ?? ""}
                    onChange={(e) => setProvider(at, { displayName: e.target.value })}
                  />
                </label>
              </div>
              <div className="admin-console__field admin-console__field-row">
                <label>
                  {t("models.apiBase")}
                  <input
                    type="text"
                    value={provider.apiBase}
                    placeholder={"https://"}
                    onChange={(e) => setProvider(at, { apiBase: e.target.value })}
                  />
                </label>
                <label>
                  {t("models.apiKeyProperty")}
                  <input type="text" value={provider.name ? providerKeyProperty(provider.name) : ""} readOnly />
                </label>
              </div>
              <p className="admin-console__hint">
                <Trans
                  i18nKey="models.tokenHint"
                  values={{ credential: `llm-provider-${provider.name || "…"}` }}
                  components={{ mono: <span className="admin-console__mono" /> }}
                />
              </p>

              {provider.models.map((model, m) => (
                <div className="admin-console__field admin-console__field-row" key={m}>
                  <label>
                    {t("models.offeredAs")}
                    <input
                      type="text"
                      value={model.name}
                      onChange={(e) => setProviderModel(at, m, { name: e.target.value })}
                    />
                  </label>
                  <label>
                    {t("models.upstreamModel")}
                    <input
                      type="text"
                      value={model.model}
                      onChange={(e) => setProviderModel(at, m, { model: e.target.value })}
                    />
                  </label>
                  <label>
                    {t("models.maxTokens")}
                    <input
                      type="number"
                      min={1}
                      value={model.maxTokens ?? ""}
                      onChange={(e) =>
                        setProviderModel(at, m, {
                          maxTokens: e.target.value === "" ? undefined : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    {t("models.mode")}
                    <select
                      value={model.mode ?? "chat"}
                      onChange={(e) => setProviderModel(at, m, { mode: e.target.value })}
                    >
                      {MODES.map((mode) => (
                        <option value={mode} key={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div>
                    <button
                      type="button"
                      className="admin-console__btn admin-console__btn--quiet"
                      onClick={() => setProvider(at, { models: provider.models.filter((_, n) => n !== m) })}
                    >
                      {t("models.remove")}
                    </button>
                  </div>
                </div>
              ))}
              <div className="admin-console__form-footer">
                <button
                  type="button"
                  className="admin-console__btn"
                  onClick={() => setProvider(at, { models: [...provider.models, emptyModel()] })}
                >
                  {t("models.addModel")}
                </button>
                <button
                  type="button"
                  className="admin-console__btn admin-console__btn--danger"
                  onClick={() => change({ ...settings, providers: settings.providers.filter((_, n) => n !== at) })}
                >
                  {t("models.removeProvider")}
                </button>
              </div>
            </div>
          </div>
        ))}
        </div>
        <button
          type="button"
          className="admin-console__btn"
          onClick={() => change({ ...settings, providers: [...settings.providers, emptyProvider()] })}
        >
          {t("models.addProvider")}
        </button>
      </div>

      <div className="admin-console__form-footer">
        <button
          type="button"
          className="admin-console__btn admin-console__btn--primary"
          disabled={!draft || saveMutation.isPending}
          onClick={() => draft && saveMutation.mutate(draft)}
        >
          {saveMutation.isPending ? t("models.committing") : t("models.commit")}
        </button>
        <button
          type="button"
          className="admin-console__btn admin-console__btn--quiet"
          disabled={!draft || saveMutation.isPending}
          onClick={() => {
            saveMutation.reset();
            setDraft(null);
          }}
        >
          {t("models.discard")}
        </button>
      </div>
    </section>
  );
}

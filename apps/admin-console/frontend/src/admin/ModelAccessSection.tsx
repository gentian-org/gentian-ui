/* SPDX-License-Identifier: Apache-2.0 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ApiError } from "@/api/client";
import {
  fetchClusterTenants,
  fetchTenantModelAccess,
  modelAccessQueryKey,
  updateTenantModelAccess,
  type ClusterSettingsWriteResult,
  type ModelAccessBudget,
  type TenantModelAccess,
  type TenantModelAccessBody,
} from "@/api/cluster";
import "./admin.css";

/**
 * What one tenant's apps may use at the model gateway: Tenant.spec.llm, read
 * and committed by the director.
 *
 * Every tenant may use the models the cluster serves itself. A provider's
 * models send the tenant's prompts out of the cluster and spend the
 * provider's account, so a tenant uses them only once its manifest names the
 * provider. Beside that sit a budget for all the tenant's apps together and
 * the delegation, which lets the tenant's own administrators choose the
 * providers.
 *
 * Who may change what is the director's answer; the screen only offers what
 * that answer would allow. The cluster's administrator (can_configure on the
 * cluster, `isPlatformAdmin` in the console's context) changes everything,
 * for any tenant. The tenant's administrator changes the providers while
 * delegated, and sends the budget and the delegation back exactly as read,
 * because the PUT replaces the whole of spec.llm and the director refuses a
 * body that changes either. Without the delegation the screen is read-only.
 */

/** Who is looking, as far as this screen is concerned. */
export type ModelAccessMode = "cluster" | "delegated" | "readOnly";

export function modeOf(isClusterAdmin: boolean, access: TenantModelAccess): ModelAccessMode {
  if (isClusterAdmin) return "cluster";
  return access.delegated ? "delegated" : "readOnly";
}

/** The form: the budget as typed, so an empty field is "not set". */
export type ModelAccessDraft = {
  providers: string[];
  maxBudget: string;
  budgetDuration: string;
  rpmLimit: string;
  tpmLimit: string;
  delegated: boolean;
};

const asText = (n: number | undefined) => (n === undefined || n === null ? "" : String(n));

export function draftOf(access: TenantModelAccess): ModelAccessDraft {
  const budget = access.budget ?? {};
  return {
    providers: [...access.providers],
    maxBudget: asText(budget.maxBudget),
    budgetDuration: budget.budgetDuration ?? "",
    rpmLimit: asText(budget.rpmLimit),
    tpmLimit: asText(budget.tpmLimit),
    delegated: access.delegated,
  };
}

/**
 * One provider toggle per provider the cluster offers models of, in the
 * director's order, and after them any provider the tenant names that the
 * cluster no longer lists, so it can be seen and turned off. The director's
 * model-access answer carries the cluster's models; the cluster's own model
 * settings are a can_audit read a tenant's administrator does not hold, and
 * a provider without a model gives a tenant nothing to use.
 */
export function providersOf(access: TenantModelAccess): { name: string; models: string[]; onCluster: boolean }[] {
  const out: { name: string; models: string[]; onCluster: boolean }[] = [];
  for (const model of access.models) {
    if (model.kind !== "provider") continue;
    const entry = out.find((p) => p.name === model.source);
    if (entry) entry.models.push(model.name);
    else out.push({ name: model.source, models: [model.name], onCluster: true });
  }
  for (const name of access.providers) {
    if (!out.some((p) => p.name === name)) out.push({ name, models: [], onCluster: false });
  }
  return out;
}

type BudgetField = "maxBudget" | "budgetDuration" | "rpmLimit" | "tpmLimit";
type BudgetProblem = "wholeNumber" | "atLeastOne" | "period";

const PROBLEM_KEYS: Record<BudgetProblem, string> = {
  wholeNumber: "modelAccess.problemWholeNumber",
  atLeastOne: "modelAccess.problemAtLeastOne",
  period: "modelAccess.problemPeriod",
};

/** What is wrong with the budget as typed, by field; the director checks again. */
export function budgetProblems(draft: ModelAccessDraft): Partial<Record<BudgetField, BudgetProblem>> {
  const problems: Partial<Record<BudgetField, BudgetProblem>> = {};
  const max = draft.maxBudget.trim();
  if (max !== "" && !/^\d+$/.test(max)) problems.maxBudget = "wholeNumber";
  for (const field of ["rpmLimit", "tpmLimit"] as const) {
    const value = draft[field].trim();
    if (value !== "" && (!/^\d+$/.test(value) || Number(value) < 1)) problems[field] = "atLeastOne";
  }
  const period = draft.budgetDuration.trim();
  if (period !== "" && !/^[0-9]+(s|m|h|d|w|mo)$/.test(period)) problems.budgetDuration = "period";
  return problems;
}

function budgetOf(draft: ModelAccessDraft): ModelAccessBudget | undefined {
  const number = (v: string) => (v.trim() === "" ? undefined : Number(v.trim()));
  const budget: ModelAccessBudget = {};
  const max = number(draft.maxBudget);
  if (max !== undefined) budget.maxBudget = max;
  if (draft.budgetDuration.trim()) budget.budgetDuration = draft.budgetDuration.trim();
  const rpm = number(draft.rpmLimit);
  if (rpm !== undefined) budget.rpmLimit = rpm;
  const tpm = number(draft.tpmLimit);
  if (tpm !== undefined) budget.tpmLimit = tpm;
  return Object.keys(budget).length ? budget : undefined;
}

/**
 * The PUT's body. The cluster's administrator sends the form; a budget left
 * empty is left out, which removes it. Anyone else sends the providers and
 * the budget and the delegation exactly as the director answered them.
 */
export function bodyOf(access: TenantModelAccess, draft: ModelAccessDraft, mode: ModelAccessMode): TenantModelAccessBody {
  if (mode === "cluster") {
    const budget = budgetOf(draft);
    return { providers: draft.providers, ...(budget ? { budget } : {}), delegated: draft.delegated };
  }
  return { providers: draft.providers, budget: access.budget, delegated: access.delegated };
}

function refusalOf(err: unknown, t: (key: string, values?: Record<string, unknown>) => string): string {
  if (err instanceof ApiError && err.status === 403) {
    return err.detail ? t("modelAccess.refused", { reason: err.detail }) : t("modelAccess.refusedNoReason");
  }
  return (err as Error)?.message || t("modelAccess.changeFailed");
}

type ModelAccessSectionProps = {
  /** The tenant this console administers, shown first. */
  tenant: string;
  /** can_configure on the cluster: everything, for any tenant. */
  isClusterAdmin: boolean;
};

export function ModelAccessSection({ tenant, isClusterAdmin }: ModelAccessSectionProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(tenant);
  const [draft, setDraft] = useState<ModelAccessDraft | null>(null);
  const [outcome, setOutcome] = useState<ClusterSettingsWriteResult | null>(null);

  // Only the cluster's administrator picks another tenant; the director
  // refuses anyone else whatever this list holds.
  const tenantsQuery = useQuery({
    queryKey: ["cluster", "tenants"],
    queryFn: () => fetchClusterTenants(),
    enabled: isClusterAdmin,
  });

  const accessQuery = useQuery({
    queryKey: modelAccessQueryKey(selected),
    queryFn: () => fetchTenantModelAccess(selected),
  });

  const saveMutation = useMutation({
    mutationFn: (body: TenantModelAccessBody) => updateTenantModelAccess(selected, body),
    onSuccess: async (result) => {
      setOutcome(result);
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: modelAccessQueryKey(selected) });
    },
    onError: () => setOutcome(null),
  });

  const pick = (name: string) => {
    setSelected(name);
    setDraft(null);
    setOutcome(null);
    saveMutation.reset();
  };

  const tenantPicker = isClusterAdmin ? (
    <div className="admin-console__field">
      <label className="admin-console__label" htmlFor="ma-tenant">
        <span className="admin-console__label-text">{t("modelAccess.tenant")}</span>
        <select id="ma-tenant" value={selected} onChange={(e) => pick(e.target.value)}>
          {[tenant, ...(tenantsQuery.data?.tenants ?? []).map((x) => x.name).filter((n) => n !== tenant)].map(
            (name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ),
          )}
        </select>
      </label>
    </div>
  ) : null;

  const head = (
    <header className="admin-console__section-head">
      <div>
        <h2 className="admin-console__section-title">{t("modelAccess.title")}</h2>
        <p className="admin-console__lead">{t("modelAccess.lead")}</p>
      </div>
    </header>
  );

  if (accessQuery.isLoading) {
    return (
      <section>
        {head}
        {tenantPicker}
        <p className="admin-console__loading">{t("modelAccess.loading")}</p>
      </section>
    );
  }
  if (accessQuery.isError || !accessQuery.data) {
    return (
      <section>
        {head}
        {tenantPicker}
        <p className="admin-console__error">{refusalOf(accessQuery.error, t)}</p>
      </section>
    );
  }

  const access = accessQuery.data;
  const mode = modeOf(isClusterAdmin, access);
  const form = draft ?? draftOf(access);
  const edit = (patch: Partial<ModelAccessDraft>) => {
    setOutcome(null);
    setDraft({ ...form, ...patch });
  };
  const toggle = (name: string, on: boolean) =>
    edit({ providers: on ? [...form.providers.filter((p) => p !== name), name] : form.providers.filter((p) => p !== name) });
  const providers = providersOf(access);
  const problems = mode === "cluster" ? budgetProblems(form) : {};
  const problemText = (field: BudgetField) => {
    const problem = problems[field];
    return problem ? <p className="admin-console__field-error">{t(PROBLEM_KEYS[problem])}</p> : null;
  };
  const budget = access.budget;
  const budgetValue = (value: number | string | undefined) =>
    value === undefined || value === "" ? t("modelAccess.notSet") : String(value);

  const budgetInput = (field: BudgetField, label: string, hint: string, placeholder?: string) => (
    <div className="admin-console__field">
      <label className="admin-console__label" htmlFor={`ma-${field}`}>
        <span className="admin-console__label-text">{label}</span>
        <input
          id={`ma-${field}`}
          type="text"
          inputMode={field === "budgetDuration" ? undefined : "numeric"}
          value={form[field]}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e) => edit({ [field]: e.target.value })}
        />
      </label>
      {problemText(field) ?? <p className="admin-console__hint">{hint}</p>}
    </div>
  );

  return (
    <section>
      {head}
      {tenantPicker}

      <p className="admin-console__hint">{t("modelAccess.localAlways")}</p>
      {mode === "delegated" ? <p className="admin-console__meta">{t("modelAccess.delegatedNote")}</p> : null}
      {mode === "readOnly" ? <p className="admin-console__meta">{t("modelAccess.readOnlyNote")}</p> : null}

      <form
        className="admin-console__form admin-console__form--wide"
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === "readOnly") return;
          setOutcome(null);
          saveMutation.mutate(bodyOf(access, form, mode));
        }}
      >
        <fieldset className="admin-console__fieldset">
          <legend>{t("modelAccess.providers")}</legend>
          <p className="admin-console__hint">{t("modelAccess.providersHint")}</p>
          {providers.length === 0 ? (
            <p className="admin-console__empty">{t("modelAccess.noProviders")}</p>
          ) : (
            providers.map((provider) => (
              <div className="admin-console__field" key={provider.name}>
                <label className="admin-console__checkbox">
                  <input
                    type="checkbox"
                    checked={form.providers.includes(provider.name)}
                    disabled={mode === "readOnly"}
                    onChange={(e) => toggle(provider.name, e.target.checked)}
                  />
                  <span className="admin-console__mono">{provider.name}</span>
                </label>
                <p className={provider.onCluster ? "admin-console__hint" : "admin-console__field-error"}>
                  {provider.onCluster
                    ? t("modelAccess.providerModels", { models: provider.models.join(", ") })
                    : t("modelAccess.providerNotOnCluster")}
                </p>
              </div>
            ))
          )}
        </fieldset>

        <fieldset className="admin-console__fieldset">
          <legend>{t("modelAccess.budget")}</legend>
          {mode === "cluster" ? (
            <>
              <p className="admin-console__hint">{t("modelAccess.budgetHint")}</p>
              {budgetInput("maxBudget", t("modelAccess.maxBudget"), t("modelAccess.maxBudgetHint"))}
              {budgetInput("budgetDuration", t("modelAccess.budgetDuration"), t("modelAccess.budgetDurationHint"), "30d")}
              {budgetInput("rpmLimit", t("modelAccess.rpmLimit"), t("modelAccess.limitHint"))}
              {budgetInput("tpmLimit", t("modelAccess.tpmLimit"), t("modelAccess.limitHint"))}
              <button
                type="button"
                className="admin-console__btn admin-console__btn--quiet"
                onClick={() => edit({ maxBudget: "", budgetDuration: "", rpmLimit: "", tpmLimit: "" })}
              >
                {t("modelAccess.clearBudget")}
              </button>
            </>
          ) : budget ? (
            <dl className="admin-console__facts">
              <dt>{t("modelAccess.maxBudget")}</dt>
              <dd>{budgetValue(budget.maxBudget)}</dd>
              <dt>{t("modelAccess.budgetDuration")}</dt>
              <dd>{budgetValue(budget.budgetDuration)}</dd>
              <dt>{t("modelAccess.rpmLimit")}</dt>
              <dd>{budgetValue(budget.rpmLimit)}</dd>
              <dt>{t("modelAccess.tpmLimit")}</dt>
              <dd>{budgetValue(budget.tpmLimit)}</dd>
            </dl>
          ) : (
            <p className="admin-console__hint">{t("modelAccess.noBudget")}</p>
          )}
        </fieldset>

        <fieldset className="admin-console__fieldset">
          <legend>{t("modelAccess.delegation")}</legend>
          {mode === "cluster" ? (
            <>
              <label className="admin-console__checkbox">
                <input type="checkbox" checked={form.delegated} onChange={(e) => edit({ delegated: e.target.checked })} />
                {t("modelAccess.delegatedLabel")}
              </label>
              <p className="admin-console__hint">{t("modelAccess.delegatedHint")}</p>
            </>
          ) : (
            <p className="admin-console__hint">
              {access.delegated ? t("modelAccess.isDelegated") : t("modelAccess.isNotDelegated")}
            </p>
          )}
        </fieldset>

        {saveMutation.isError ? (
          <p className="admin-console__error" role="alert">
            {refusalOf(saveMutation.error, t)}
          </p>
        ) : null}
        {outcome ? (
          <p className="admin-console__success" role="status">
            {outcome.commit ? (
              <Trans
                i18nKey="modelAccess.committedAs"
                values={{ commit: outcome.commit.slice(0, 8) }}
                components={{ mono: <span className="admin-console__mono" /> }}
              />
            ) : (
              t("modelAccess.unchanged")
            )}
          </p>
        ) : null}
        {mode !== "readOnly" ? (
          <button
            className="admin-console__btn admin-console__btn--primary"
            type="submit"
            disabled={saveMutation.isPending || Object.keys(problems).length > 0}
          >
            {saveMutation.isPending ? t("modelAccess.saving") : t("modelAccess.save")}
          </button>
        ) : null}
      </form>
    </section>
  );
}

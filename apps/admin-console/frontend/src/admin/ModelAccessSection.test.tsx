import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { modelAccessQueryKey, type TenantModelAccess } from "@/api/cluster";
import { bodyOf, budgetProblems, draftOf, modeOf, ModelAccessSection, providersOf } from "./ModelAccessSection";

const access: TenantModelAccess = {
  tenant: "acme",
  providers: ["infomaniak"],
  budget: { maxBudget: 50, budgetDuration: "30d", rpmLimit: 120 },
  delegated: true,
  models: [
    { name: "qwen-qwen2.5-7b-instruct", kind: "instance", source: "qwen", state: "declared", allowed: true },
    {
      name: "infomaniak/gemma-4-31b",
      kind: "provider",
      source: "infomaniak",
      credential: "llm-provider-infomaniak",
      apiKeyProperty: "infomaniak_api_key",
      state: "declared",
      allowed: true,
    },
    {
      name: "openai/gpt-small",
      kind: "provider",
      source: "openai",
      credential: "llm-provider-openai",
      apiKeyProperty: "openai_api_key",
      state: "declared",
      allowed: false,
    },
  ],
};

function render(data: TenantModelAccess, isClusterAdmin: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(modelAccessQueryKey("acme"), data);
  client.setQueryData(["cluster", "tenants"], { cluster: "demo", tenants: [{ name: "acme", apps: [], protected: false }] });
  return renderToString(
    <QueryClientProvider client={client}>
      <ModelAccessSection tenant="acme" isClusterAdmin={isClusterAdmin} />
    </QueryClientProvider>,
  );
}

describe("ModelAccessSection", () => {
  it("offers the cluster's administrator the providers, the budget form and the delegation", () => {
    const html = render(access, true);
    expect(html).toContain("infomaniak/gemma-4-31b");
    expect(html).toContain("openai/gpt-small");
    expect(html).toContain('id="ma-maxBudget"');
    expect(html).toContain('value="50"');
    expect(html).toContain("The tenant&#x27;s administrators may choose the providers");
    expect(html).toContain("always available");
    expect(html).toContain("Save model access");
    expect(html).toContain('id="ma-tenant"');
  });

  it("offers a delegated tenant administrator the providers only, the rest read-only", () => {
    const html = render(access, false);
    expect(html).not.toContain('id="ma-maxBudget"');
    expect(html).not.toContain('id="ma-tenant"');
    expect(html).toContain("120");
    expect(html).toContain("Save model access");
    expect(html).not.toMatch(/type="checkbox"[^>]*disabled/);
  });

  it("shows a tenant administrator without the delegation everything read-only", () => {
    const html = render({ ...access, delegated: false }, false);
    expect(html).not.toContain("Save model access");
    expect(html).toMatch(/type="checkbox"[^>]*disabled/);
    expect(html).toContain("Only the cluster&#x27;s administrator");
  });
});

describe("the body the screen sends", () => {
  it("sends the budget and the delegation back as read for a delegated tenant administrator", () => {
    const draft = { ...draftOf(access), providers: [], maxBudget: "9999", delegated: false };
    expect(bodyOf(access, draft, "delegated")).toEqual({
      providers: [],
      budget: { maxBudget: 50, budgetDuration: "30d", rpmLimit: 120 },
      delegated: true,
    });
    expect(bodyOf({ ...access, budget: null }, draft, "delegated").budget).toBeNull();
  });

  it("sends the cluster administrator's form, and no budget when it is cleared", () => {
    const draft = { ...draftOf(access), tpmLimit: "200000", delegated: false };
    expect(bodyOf(access, draft, "cluster")).toEqual({
      providers: ["infomaniak"],
      budget: { maxBudget: 50, budgetDuration: "30d", rpmLimit: 120, tpmLimit: 200000 },
      delegated: false,
    });
    const cleared = { ...draft, maxBudget: "", budgetDuration: "", rpmLimit: "", tpmLimit: "" };
    expect(bodyOf(access, cleared, "cluster")).toEqual({ providers: ["infomaniak"], delegated: false });
  });

  it("decides the mode from the cluster relation and the delegation", () => {
    expect(modeOf(true, { ...access, delegated: false })).toBe("cluster");
    expect(modeOf(false, access)).toBe("delegated");
    expect(modeOf(false, { ...access, delegated: false })).toBe("readOnly");
  });

  it("lists a provider per provider of the cluster's models, and one the cluster no longer lists", () => {
    expect(providersOf({ ...access, providers: ["gone"] })).toEqual([
      { name: "infomaniak", models: ["infomaniak/gemma-4-31b"], onCluster: true },
      { name: "openai", models: ["openai/gpt-small"], onCluster: true },
      { name: "gone", models: [], onCluster: false },
    ]);
  });

  it("flags a budget the director would refuse", () => {
    const draft = { ...draftOf(access), maxBudget: "12.5", budgetDuration: "a month", rpmLimit: "0", tpmLimit: "" };
    expect(budgetProblems(draft)).toEqual({ maxBudget: "wholeNumber", budgetDuration: "period", rpmLimit: "atLeastOne" });
    expect(budgetProblems(draftOf(access))).toEqual({});
  });
});

import { apiFetch, type Problem } from "@/api/client";

/**
 * What this app's own API answers.
 *
 * The catalogue types are the store API's, as the API hands them on: checked
 * against the definition there, with every image named by the API's own
 * address or `null`. Everything a store wrote is text -- shown as text, and
 * two fields as store-markdown-1 -- and nothing here is ever HTML.
 */

export type Context = {
  tenant: string;
  name: string | null;
  mayInstall: boolean;
  storeConfigured: boolean;
  /** Whether the cluster offers an App Store at all; null when it could not be asked. */
  appStore: { available: boolean; reason: string | null } | null;
  adminConsoleUrl: string | null;
  /** The tenant's country, ISO 3166-1 alpha-2; null when it names none. */
  tenantCountry: string | null;
};

export type CompanySize = "1-9" | "10-49" | "50-249" | "250-999" | "1000+";
export type Industry = string;

export type StoreMeta = {
  name: string;
  apiVersion: string;
  /** Open. `review-writing`: a person may write a review; `company`: an account has a company; `support`: apps carry support offers. */
  features: string[];
  languages: string[];
  links: { terms?: string | null; privacy?: string | null; support?: string | null; account?: string | null };
  /** The store's own names for them, in the language asked for; empty from a 1.0 store. */
  companySizes: { id: CompanySize; name: string }[];
  industries: { id: Industry; name: string; nace: string }[];
  reviewing: { requireAcquisition: boolean } | null;
};

export type Link = { rel?: string | null; label?: string | null; url: string };

export type Notice = {
  type: string;
  severity: "info" | "warning";
  title?: string | null;
  text: string;
  link?: Link | null;
};

export type Standing = {
  tenantUrl: string;
  known: boolean;
  lastReportAt?: string | null;
  served: boolean;
  refusal: { reason: string; detail: string; link?: Link | null } | null;
  notices: Notice[];
};

export type StoreSession = {
  signedIn: boolean;
  expiresInSeconds: number | null;
  standing: Standing | null;
};

export type Category = { id: string; name: string };
export type Edition = "ce" | "pe" | "me" | "ee";

export type Price = {
  model: "free" | "one-time" | "subscription" | "quote";
  amount?: string | null;
  currency?: string | null;
  per?: "tenant" | "user" | null;
  period?: "month" | "year" | null;
  note?: string | null;
};

export type ScoreName = "features" | "easeOfUse" | "easeOfSetup" | "support" | "value";
export type ScoreSummary = { average: number | null; count: number };

export type ReviewSummary = {
  count: number;
  average: number | null;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  /** Absent from a 1.0 store. */
  recommend?: { yes: number; no: number } | null;
  scores?: Record<ScoreName, ScoreSummary> | null;
};

export type AppSummary = {
  coordinate: string;
  family: string;
  name: string;
  summary: string;
  /** This API's own address for the icon, or null when there is none to show. */
  iconUrl: string | null;
  categories: string[];
  publisher: { name: string; url?: string | null };
  edition: Edition;
  editions: { edition: Edition; coordinate: string }[];
  trustTier: "platform" | "certified" | "experimental";
  latestVersion: string;
  price: Price;
  rating?: ReviewSummary | null;
};

export type Version = {
  version: string;
  digest: string;
  releasedAt: string;
  /** store-markdown-1. */
  releaseNotes: string;
  requirements: {
    platform?: string | null;
    resources?: { cpu?: string | null; memory?: string | null; storage?: string | null } | null;
    notes?: string[] | null;
  };
};

export type AppDetail = AppSummary & {
  /** store-markdown-1. */
  description: string;
  screenshots: { url: string | null; contentType: string; width?: number | null; height?: number | null; caption?: string | null }[];
  versions: Version[];
  addons: { coordinate: string; name: string; summary: string }[];
  addonOf: string | null;
  links: Link[];
  license: { spdx?: string | null; name: string; url?: string | null } | null;
  /** The partners that offer support (store API 1.3); empty from a store without them. */
  support: SupportOffer[];
};

/** A partner's offer of support for an app, in the store's words. */
export type SupportOffer = {
  id: string;
  partner: {
    slug: string;
    name: string;
    url: string | null;
    /** This API's own address for the logo, or null when there is none to show. */
    logoUrl: string | null;
    verified: boolean;
  };
  /** ISO 3166-1 alpha-2; empty means worldwide. */
  countries: string[];
  /** BCP 47. */
  languages: string[];
  tiers: { name: string; description: string | null }[];
  priceHint: string | null;
  contactUrl: string | null;
  /** Whether a request may be sent through the store. */
  requestable: boolean;
};

export type SupportRequest = { offer: string; message: string | null };
export type SupportReceipt = { id: string; status: string };

/** Stars, 1 to 5. `support` and `value` are for an entry of edition `ee`, and null on any other. */
export type ReviewScores = {
  features: number;
  easeOfUse: number;
  easeOfSetup: number;
  support: number | null;
  value: number | null;
};

export type Review = {
  id: string;
  rating: number;
  title?: string | null;
  text: string;
  author: string;
  date: string;
  language?: string | null;
  version?: string | null;
  recommend?: boolean | null;
  scores?: ReviewScores | null;
  /** The size and industry of the author's company; never its name. */
  reviewer?: { size: CompanySize; industry: Industry } | null;
  mine?: boolean;
};

export type ReviewRequest = {
  recommend: boolean;
  scores: ReviewScores;
  title: string | null;
  text: string;
  version: string | null;
};

export type Company = { name: string; size: CompanySize; industry: Industry };

export type Report = {
  id: string;
  kind: string;
  title: string;
  issuer?: string | null;
  date: string;
  summary: string;
  version?: string | null;
  documentUrl: string;
  documentType?: string | null;
};

export type AppsPage = { items: AppSummary[]; nextCursor: string | null; omitted: number };
export type ReviewsPage = { summary: ReviewSummary; items: Review[]; nextCursor: string | null };

/** What git says of an installed app. */
export type Installed = {
  profile: string;
  digest: string | null;
  forEveryone: boolean;
  addons: string[];
  /** How the app moves to newer builds: "latest" (the platform), "manual" (the cluster's administrator) or "tenant" (this store may). Null when the director could not say. */
  updateMode?: string | null;
};

/** What the cluster has made of it, in its own words. */
export type AppState = {
  phase: string | null;
  ready: boolean;
  message: string | null;
  failure: string | null;
  pendingPrivileges: string[];
};

export type AcquisitionView = {
  id: string;
  coordinate: string;
  status: "pending" | "confirmed" | "cancelled" | "failed";
  createdAt: string;
  updatedAt: string;
  version: string | null;
  digest: string | null;
  addons: { coordinate: string; version: string }[];
  repositories: { name: string; url: string }[];
  failure: { reason: string; detail: string } | null;
};

export type Stage =
  | "acquire"
  | "checkout"
  | "confirm-build"
  | "declare"
  | "confirm-repository"
  | "credential"
  | "credential-timeout"
  | "install"
  | "addons"
  | "metering"
  | "metering-timeout"
  | "rollout"
  | "failing"
  | "done"
  | "failed";

/** Where an install sequence stands. It never carries a credential. */
export type Operation = {
  coordinate: string;
  mode: "install" | "update";
  forEveryone: boolean;
  stage: Stage;
  failedStage: Stage | null;
  waitsForPerson: boolean;
  waitSeconds: number;
  expectedDigest: string;
  /** `waitingFor` (store API 1.2): what a pending acquisition waits for. */
  acquisition: { id: string; status: string | null; waitingFor?: "confirmation" | "approval" | "checkout" | null } | null;
  checkout: { url: string; expiresAt: string | null } | null;
  build: {
    coordinate: string;
    version: string;
    digest: string;
    addons: { coordinate: string; version: string; digest: string }[];
  } | null;
  repositories: { name: string; url: string; declared: string | null; credential: string }[];
  confirmRepository: { name: string; url: string; text: string | null; confirmWith: string | null } | null;
  install: { status: string | null; commit: string | null } | null;
  addons: { status: string | null; commit: string | null } | null;
  rollout: AppState | null;
  /**
   * What came of putting the store's picture of the app on its desktop tile,
   * once the app was ready. `failed` never fails the install: the tile keeps
   * the app's own picture, and `problem` says why.
   */
  tile: { outcome: "copied" | "no-picture" | "failed"; problem: Problem | null } | null;
  error: Problem | null;
};

export type AppStanding =
  | "not-installed"
  | "checkout"
  | "acquired"
  | "installing"
  | "ready"
  | "failing"
  | "installed";

export type AppStateAnswer = {
  coordinate: string;
  profile: string;
  stage: AppStanding;
  installed: Installed | null;
  /** Whether a newer build may be taken from here: only under the tenant mode. */
  mayUpdate: boolean;
  state: AppState | null;
  clusterProblems: Record<string, Problem>;
  storeSignedIn: boolean;
  storeProblem: Problem | null;
  acquisition: AcquisitionView | null;
  operation: Operation | null;
};

export type OverviewRow = {
  profile: string;
  coordinate: string | null;
  name?: string;
  edition?: Edition;
  stage: AppStanding;
  installed: Installed | null;
  state: AppState | null;
  acquisition: AcquisitionView | null;
  latest: { version: string; digest: string } | null;
  updateAvailable: boolean;
  /** Whether this store may take the newer build: the tenant mode. */
  mayUpdate: boolean;
  operation: Operation | null;
};

export type Overview = {
  rows: OverviewRow[];
  clusterProblems: Record<string, Problem>;
  storeSignedIn: boolean;
  storeProblem: Problem | null;
};

export type CredentialOutcome = {
  acquisition: string;
  rotated: boolean;
  repositories: { name: string; url: string; outcome: "set" | "not-declared" | "refused" | "no-credential"; problem?: Problem }[];
};

const appPath = (coordinate: string) => coordinate.split("/").map(encodeURIComponent).join("/");

export const fetchContext = () => apiFetch<Context>("/context");
export const fetchMeta = () => apiFetch<StoreMeta>("/store/meta");
export const fetchCategories = () => apiFetch<{ items: Category[] }>("/store/categories");

export function fetchApps(filters: { category?: string; edition?: string; q?: string }, cursor?: string) {
  const params = new URLSearchParams();
  if (filters.category) params.set("category", filters.category);
  if (filters.edition) params.set("edition", filters.edition);
  if (filters.q) params.set("q", filters.q);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return apiFetch<AppsPage>(`/store/apps${query ? `?${query}` : ""}`);
}

export const fetchApp = (coordinate: string) => apiFetch<AppDetail>(`/store/apps/${appPath(coordinate)}`);

/** An app's support offers for a country, or for none ("") -- what the store has. */
export const fetchSupport = (coordinate: string, country: string) =>
  apiFetch<{ country: string | null; items: SupportOffer[] }>(
    `/store/apps/${appPath(coordinate)}/support?${new URLSearchParams({ country })}`,
  );

export type ReviewFilters = { companySize?: string; industry?: string };

export function fetchReviews(coordinate: string, filters: ReviewFilters = {}, cursor?: string) {
  const params = new URLSearchParams();
  if (filters.companySize) params.set("companySize", filters.companySize);
  if (filters.industry) params.set("industry", filters.industry);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return apiFetch<ReviewsPage>(`/store/apps/${appPath(coordinate)}/reviews${query ? `?${query}` : ""}`);
}

// What the person says at the store in their own name. Signed-in calls; the
// API holds the token.
export const fetchMyReview = (coordinate: string) =>
  apiFetch<{ review: Review | null }>(`/store/apps/${appPath(coordinate)}/reviews/mine`);
export const putMyReview = (coordinate: string, body: ReviewRequest) =>
  apiFetch<{ review: Review }>(`/store/apps/${appPath(coordinate)}/reviews/mine`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
export const deleteMyReview = (coordinate: string) =>
  apiFetch<{ review: null }>(`/store/apps/${appPath(coordinate)}/reviews/mine`, { method: "DELETE" });

/** Ask a partner, through the store, for support with an app (1.3, `support`). */
export const requestSupport = (coordinate: string, body: SupportRequest) =>
  apiFetch<{ request: SupportReceipt }>(`/store/apps/${appPath(coordinate)}/support-requests`, {
    method: "POST",
    body: JSON.stringify(body),
  });

/** Who manages the tenant at the store (1.2, `tenant-access`). */
export type TenantRole = "holder" | "manager" | "requested" | "declined" | "none";
export type TenantAccount = { subject: string; name: string | null; email: string | null; role: TenantRole; since: string };
export type TenantAccess = { role: TenantRole; accounts: TenantAccount[] };

export const fetchAccess = () => apiFetch<TenantAccess>("/store/tenant/access");
export const decideAccess = (subject: string, approve: boolean) =>
  apiFetch<{ account: TenantAccount }>(
    `/store/tenant/access/${encodeURIComponent(subject)}/${approve ? "approve" : "decline"}`,
    { method: "POST" },
  );

export const fetchCompany = () => apiFetch<{ company: Company | null }>("/store/account/company");
export const putCompany = (body: Company) =>
  apiFetch<{ company: Company }>("/store/account/company", { method: "PUT", body: JSON.stringify(body) });

export const fetchReports = (coordinate: string) =>
  apiFetch<{ items: Report[] }>(`/store/apps/${appPath(coordinate)}/reports`);

export const fetchStoreSession = () => apiFetch<StoreSession>("/store/session");
export const beginStoreSignIn = () =>
  apiFetch<{ authorizationUrl: string }>("/store/sign-in", { method: "POST" });
export const signOutOfStore = () => apiFetch<StoreSession>("/store/session", { method: "DELETE" });

export const fetchAppState = (coordinate: string) =>
  apiFetch<AppStateAnswer>(`/apps/${appPath(coordinate)}/state`);
export const fetchOverview = () => apiFetch<Overview>("/overview");

export type StartRequest = {
  mode: "install" | "update";
  forEveryone: boolean;
  expectedDigest: string;
  version?: string;
  acquisitionId?: string;
};

export const startOperation = (coordinate: string, body: StartRequest) =>
  apiFetch<Operation>(`/apps/${appPath(coordinate)}/operation`, { method: "POST", body: JSON.stringify(body) });

export type AdvanceRequest = {
  retry?: boolean;
  continue?: boolean;
  confirmDigest?: string;
  confirmRepository?: string;
};

export const advanceOperation = (coordinate: string, body: AdvanceRequest = {}) =>
  apiFetch<Operation>(`/apps/${appPath(coordinate)}/operation/advance`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const stopOperation = (coordinate: string) =>
  apiFetch<AppStateAnswer>(`/apps/${appPath(coordinate)}/operation`, { method: "DELETE" });

export const setCredential = (acquisitionId: string, rotate: boolean) =>
  apiFetch<CredentialOutcome>(`/acquisitions/${encodeURIComponent(acquisitionId)}/credential`, {
    method: "POST",
    body: JSON.stringify({ rotate }),
  });

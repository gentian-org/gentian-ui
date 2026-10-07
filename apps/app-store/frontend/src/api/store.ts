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
};

export type StoreMeta = {
  name: string;
  apiVersion: string;
  features: string[];
  languages: string[];
  links: { terms?: string | null; privacy?: string | null; support?: string | null; account?: string | null };
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

export type ReviewSummary = {
  count: number;
  average: number | null;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
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
  licence: { spdx?: string | null; name: string; url?: string | null } | null;
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
};

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
export type Installed = { profile: string; digest: string | null; forEveryone: boolean; addons: string[] };

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
  acquisition: { id: string; status: string | null } | null;
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
  stage: AppStanding;
  installed: Installed | null;
  state: AppState | null;
  acquisition: AcquisitionView | null;
  latest: { version: string; digest: string } | null;
  updateAvailable: boolean;
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

export function fetchReviews(coordinate: string, cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<ReviewsPage>(`/store/apps/${appPath(coordinate)}/reviews${query}`);
}

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

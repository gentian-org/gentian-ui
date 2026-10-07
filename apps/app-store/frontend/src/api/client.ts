/* SPDX-License-Identifier: Apache-2.0 */
import { getAccessToken, isEdgeSession, redirectToLoginForExpiredSession } from "@/auth/oidc";
import i18n from "@/lib/i18n";

const API_BASE = "/api/v1";

/**
 * A refusal, in the refusing party's own words.
 *
 * `source` says who refused: the store, one of the cluster's services, or
 * this app. `title` and `detail` are theirs and are shown as they are;
 * `code` is what a screen branches on.
 */
export type Problem = {
  source: "store" | "director" | "custodian" | "usher" | "app" | string;
  code: string;
  status?: number;
  title?: string;
  detail?: string;
  reason?: string;
  retryAfter?: number;
};

/** Thrown by apiFetch on any answer that is not a success. */
export class ApiError extends Error {
  /** The HTTP status of the answer, when there was an answer. */
  readonly status?: number;
  /** What was refused and by whom, when the answer said. */
  readonly problem?: Problem;
  constructor(message: string, status?: number, problem?: Problem) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }
}

/** The problem an error carries, or one that says only that it failed. */
export function problemOf(error: unknown): Problem {
  if (error instanceof ApiError && error.problem) return error.problem;
  if (error instanceof ApiError) {
    return { source: "app", code: "failed", status: error.status, detail: error.message };
  }
  return { source: "app", code: "failed" };
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    // The language the app is shown in. The API passes it on to the store,
    // which answers its translatable fields in the best match.
    "Accept-Language": i18n.resolvedLanguage ?? i18n.language ?? "en",
    ...(init?.body ? { "Content-Type": "application/json" } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    let problem: Problem | undefined;
    let detail = "";
    try {
      const body = (await response.json()) as { detail?: unknown; problem?: Problem };
      if (body.problem && typeof body.problem.code === "string") problem = body.problem;
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // The answer is not JSON.
    }
    // A 401 here is always the cluster session: the API answers a store
    // sign-in that has ended as 403 with its own code, never as this.
    if (response.status === 401 && (token || isEdgeSession())) {
      redirectToLoginForExpiredSession();
    }
    throw new ApiError(
      `API ${path} failed: ${response.status}${detail ? `: ${detail}` : ""}`,
      response.status,
      problem ?? (detail ? { source: "app", code: "failed", status: response.status, detail } : undefined),
    );
  }
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  if (isEdgeSession() && (response.headers.get("content-type") ?? "").includes("text/html")) {
    // The edge session ended between two requests: what came back is the
    // sign-in page, not an answer. Reload, and the edge signs in silently.
    redirectToLoginForExpiredSession();
    throw new ApiError(`API ${path}: the edge session has ended`);
  }
  return JSON.parse(text) as T;
}

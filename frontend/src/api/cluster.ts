import { apiFetch } from "@/api/client";

/**
 * One setting of the cluster, as the director describes it.
 *
 * The catalogue arrives with the values, so the console renders the screen
 * from one answer and holds no list of its own. A setting with no `value` is
 * unset in the claim, which is a different thing from set to nothing: the
 * schema's default applies, and the screen says so rather than showing a blank
 * box that looks like someone cleared it.
 */
export type ClusterSetting = {
  /** Dotted path within the claim's spec, e.g. "mail.serviceMode". */
  path: string;
  /** What this setting is for, written for the person changing it. */
  doc: string;
  /** The values it accepts, when it is a closed set. */
  oneOf?: string[];
  /** What the claim carries now. Absent when the claim does not set it. */
  value?: string;
};

export type ClusterSettingsResponse = {
  cluster: string;
  settings: ClusterSetting[];
};

/**
 * The outcome of a write, which is a commit rather than a save.
 *
 * 202 means git has the change and the cluster does not yet, and `commit` is
 * the handle to follow it. 200 means the state asked for already held and
 * nothing was committed.
 */
export type ClusterSettingsWriteResult = {
  status: string;
  commit?: string;
  /** False when the request changed nothing. */
  changed: boolean;
};

export function fetchClusterSettings() {
  return apiFetch<ClusterSettingsResponse>("/cluster/settings");
}

export async function updateClusterSettings(
  settings: Record<string, string>,
): Promise<ClusterSettingsWriteResult> {
  const body = await apiFetch<{ status: string; commit?: string }>("/cluster/settings", {
    method: "PATCH",
    body: JSON.stringify({ settings }),
  });
  return { ...body, changed: Boolean(body.commit) };
}

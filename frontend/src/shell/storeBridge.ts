/**
 * The store bridge: what the App Store may ask of this cluster, and how.
 *
 * The store runs outside the cluster and holds no credential for it (AD-3).
 * It is shown in a window on this desktop, on its own origin, and the person's
 * token is forwarded to the desktop and to nothing else (AD-13). So the store
 * asks the desktop, the desktop asks the director as the person sitting at it,
 * and the answer goes back the way the question came.
 *
 * The wire is window.postMessage, and everything that makes it safe is here:
 *
 *   - One origin. A message is read only if it comes from the origin of the
 *     store the Cluster claim names (catalogue.storeUrl). Which store may ask
 *     anything of this cluster is recorded in git, not decided by whatever
 *     page happens to be in a frame.
 *   - A closed list. The operations below are all there are. The store
 *     cannot phrase a request that reaches another route.
 *   - Names are names. A profile or a catalogue lands in a URL path, so it
 *     is matched against what a name may be before anything is sent.
 *   - Writes are confirmed here. Installing, removing, changing add-ons and
 *     recording a grant each wait for the person to say yes in a dialog the
 *     DESKTOP draws, on the cluster's own origin -- a page in a frame can ask
 *     for an install but cannot press the button.
 */

import { getAccessToken } from "@/auth/oidc";

export const BRIDGE = "store-bridge";
export const BRIDGE_VERSION = 1;

/** The status a reply carries when the person said no. Not an HTTP status. */
export const DECLINED = 499;

export type StoreContext = {
  cluster: string | null;
  tenant: string;
  relations: Record<string, boolean>;
  storeUrl: string | null;
  storeOrigin: string | null;
};

export type BridgeRequest = {
  gentian: typeof BRIDGE;
  v: number;
  id: string;
  op: string;
  args: Record<string, unknown>;
};

export type BridgeReply =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: string };

/** What a write is, in the words the confirmation uses. */
export type WriteKind = "install" | "uninstall" | "purge" | "provision" | "addons" | "grant";

type Call = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
};

export type Planned =
  | { kind: "context" }
  | { kind: "read"; call: Call }
  | { kind: "write"; write: WriteKind; subject: string; call: Call };

const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
// <catalogue>/<app>, both names.
const COORDINATE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\/[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function name(value: unknown): string | null {
  return typeof value === "string" && NAME.test(value) ? value : null;
}

/** A message that is a bridge request, or nothing. */
export function parseRequest(data: unknown): BridgeRequest | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.gentian !== BRIDGE || m.v !== BRIDGE_VERSION) return null;
  if (typeof m.id !== "string" || m.id.length === 0 || m.id.length > 64) return null;
  if (typeof m.op !== "string") return null;
  const args = typeof m.args === "object" && m.args !== null ? m.args : {};
  return {
    gentian: BRIDGE,
    v: BRIDGE_VERSION,
    id: m.id,
    op: m.op,
    args: args as Record<string, unknown>,
  };
}

/**
 * What a request asks for, or why it asks for nothing this bridge does.
 *
 * Pure: no network, no window. The list of operations IS this function, which
 * is what lets a test say what the store can reach by reading one switch.
 */
export function plan(req: BridgeRequest): Planned | { kind: "refused"; error: string } {
  const a = req.args;
  switch (req.op) {
    case "context":
      return { kind: "context" };
    case "apps.list":
      return { kind: "read", call: { method: "GET", path: "/apps" } };
    case "apps.status":
      return { kind: "read", call: { method: "GET", path: "/apps/status" } };
    case "resources.get":
      return { kind: "read", call: { method: "GET", path: "/resources" } };
    case "entitlements.list":
      return { kind: "read", call: { method: "GET", path: "/entitlements" } };
    case "catalogues.list":
      return { kind: "read", call: { method: "GET", path: "/catalogues" } };
    case "catalogues.entries": {
      const source = name(a.source);
      if (!source) return { kind: "refused", error: "source is not a catalogue name" };
      return { kind: "read", call: { method: "GET", path: `/catalogues/${source}/entries` } };
    }
    case "addons.get": {
      const profile = name(a.profile);
      if (!profile) return { kind: "refused", error: "profile is not a profile name" };
      return { kind: "read", call: { method: "GET", path: `/apps/${profile}/addons` } };
    }
    case "apps.install": {
      const profile = name(a.profile);
      if (!profile) return { kind: "refused", error: "profile is not a profile name" };
      const coordinate = typeof a.coordinate === "string" ? a.coordinate : "";
      if (coordinate && !COORDINATE.test(coordinate)) {
        return { kind: "refused", error: "coordinate is <catalogue>/<app>" };
      }
      return {
        kind: "write",
        write: "install",
        subject: profile,
        call: { method: "POST", path: `/apps/${profile}`, body: { coordinate } },
      };
    }
    case "apps.uninstall": {
      const profile = name(a.profile);
      if (!profile) return { kind: "refused", error: "profile is not a profile name" };
      return {
        kind: "write",
        write: "uninstall",
        subject: profile,
        call: { method: "DELETE", path: `/apps/${profile}` },
      };
    }
    case "apps.purge": {
      const profile = name(a.profile);
      if (!profile) return { kind: "refused", error: "profile is not a profile name" };
      return {
        kind: "write",
        write: "purge",
        subject: profile,
        call: { method: "POST", path: `/apps/${profile}/purge` },
      };
    }
    case "apps.provision": {
      const profile = name(a.profile);
      if (!profile) return { kind: "refused", error: "profile is not a profile name" };
      return {
        kind: "write",
        write: "provision",
        subject: profile,
        call: { method: "POST", path: `/apps/${profile}/provision` },
      };
    }
    case "addons.set": {
      const profile = name(a.profile);
      if (!profile) return { kind: "refused", error: "profile is not a profile name" };
      if (!Array.isArray(a.addons)) return { kind: "refused", error: "addons is a list" };
      const addons = a.addons.map(name);
      if (addons.some((x) => x === null)) {
        return { kind: "refused", error: "an add-on is not a profile name" };
      }
      return {
        kind: "write",
        write: "addons",
        subject: profile,
        call: { method: "PUT", path: `/apps/${profile}/addons`, body: { addons } },
      };
    }
    case "entitlements.deliver": {
      if (typeof a.grant !== "string" || a.grant.length === 0 || a.grant.length > 16384) {
        return { kind: "refused", error: "grant is the signed statement" };
      }
      // What the person is asked about is the entry, which the statement
      // names and the store repeats beside it. It is a label for the dialog
      // and nothing more: the director reads the statement, not this.
      const subject = typeof a.coordinate === "string" && COORDINATE.test(a.coordinate)
        ? a.coordinate
        : "";
      return {
        kind: "write",
        write: "grant",
        subject,
        call: { method: "POST", path: "/entitlements", body: { grant: a.grant } },
      };
    }
    default:
      return { kind: "refused", error: `unknown operation: ${req.op.slice(0, 40)}` };
  }
}

/** One planned call, made as the person at this desktop. */
export async function perform(call: Call): Promise<BridgeReply> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (call.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`/api/v1/store${call.path}`, {
      method: call.method,
      headers,
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
    });
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "network error" };
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // The edge's sign-in page, or a proxy's error page. Not an answer, and
      // handing HTML to the store would be handing it something to render.
      return { ok: false, status: response.status || 502, error: "the cluster did not answer in JSON" };
    }
  }
  if (!response.ok) {
    const body = (data ?? {}) as { error?: unknown; detail?: unknown };
    const said = typeof body.error === "string" ? body.error
      : typeof body.detail === "string" ? body.detail
      : `the cluster answered ${response.status}`;
    return { ok: false, status: response.status, error: said };
  }
  return { ok: true, status: response.status, data };
}

/** Whether a window is one this desktop put in a frame. */
export function isFramedHere(source: MessageEventSource | null): boolean {
  if (!source) return false;
  return Array.from(document.querySelectorAll("iframe")).some(
    (frame) => frame.contentWindow === source,
  );
}

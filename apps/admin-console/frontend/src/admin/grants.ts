import type { AllowConsumer, AppGrant, ConsumeGrant } from "@/api/admin";

/**
 * What one app's grant becomes when one contract of it is set or withdrawn.
 *
 * The director's PUT replaces the app's whole grant, so a change to one
 * contract is written with everything else the grant already says, unchanged:
 * approving the second integration of an app must not withdraw its first, and
 * the contracts it lets others consume stay as they were.
 */
export type GrantBody = { consume: ConsumeGrant[]; allowConsumers: AllowConsumer[] };

/**
 * What this screen wrote for an app, by app; null for a grant it removed.
 * The cluster shows a commit only once it has applied it, so a second change
 * to the same app made before then starts from what was written, not from
 * the grant the cluster still shows.
 */
export type Written = Record<string, GrantBody | null>;

function current(grants: AppGrant[], app: string, written: Written): GrantBody {
  if (app in written) {
    return written[app] ?? { consume: [], allowConsumers: [] };
  }
  const grant = grants.find((g) => g.app === app);
  return {
    consume: grant?.consume ?? [],
    allowConsumers: grant?.allowConsumers ?? [],
  };
}

/** The app's grant with `contract` granted `granted`, in place of whatever it had of it. */
export function withContract(
  grants: AppGrant[],
  written: Written,
  app: string,
  contract: string,
  granted: string[],
): GrantBody {
  const body = current(grants, app, written);
  return {
    consume: [...body.consume.filter((c) => c.contract !== contract), { contract, granted }],
    allowConsumers: body.allowConsumers,
  };
}

/**
 * The app's grant without `contract`, or null when nothing would be left: a
 * grant that permits nothing is withdrawn as a whole rather than kept empty.
 */
export function withoutContract(grants: AppGrant[], written: Written, app: string, contract: string): GrantBody | null {
  const body = current(grants, app, written);
  const consume = body.consume.filter((c) => c.contract !== contract);
  if (consume.length === 0 && body.allowConsumers.length === 0) {
    return null;
  }
  return { consume, allowConsumers: body.allowConsumers };
}

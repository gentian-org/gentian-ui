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

function current(grants: AppGrant[], app: string): GrantBody {
  const grant = grants.find((g) => g.app === app);
  return {
    consume: grant?.consume ?? [],
    allowConsumers: grant?.allowConsumers ?? [],
  };
}

/** The app's grant with `contract` granted `granted`, in place of whatever it had of it. */
export function withContract(grants: AppGrant[], app: string, contract: string, granted: string[]): GrantBody {
  const body = current(grants, app);
  return {
    consume: [...body.consume.filter((c) => c.contract !== contract), { contract, granted }],
    allowConsumers: body.allowConsumers,
  };
}

/**
 * The app's grant without `contract`, or null when nothing would be left: a
 * grant that permits nothing is withdrawn as a whole rather than kept empty.
 */
export function withoutContract(grants: AppGrant[], app: string, contract: string): GrantBody | null {
  const body = current(grants, app);
  const consume = body.consume.filter((c) => c.contract !== contract);
  if (consume.length === 0 && body.allowConsumers.length === 0) {
    return null;
  }
  return { consume, allowConsumers: body.allowConsumers };
}

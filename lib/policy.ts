import { usd as micro } from "./money";

/**
 * The rules the cashier applies before the agent is allowed to spend. Every
 * refusal carries a sentence, because "denied" with no reason is what makes
 * people turn these controls off.
 */

export type Policy = {
  /** Ceiling for a single call, in micro-dollars. */
  perCallMicroUsd: number;
  /** Ceiling for the whole session, in micro-dollars. */
  sessionMicroUsd: number;
  /** Hosts the agent may reach. Anything else is refused. */
  allowedHosts: string[];
  /** Actions the agent may take. Anything else is refused. */
  allowedActions: string[];
};

export const DEFAULT_POLICY: Policy = {
  perCallMicroUsd: 20_000,
  sessionMicroUsd: 50_000,
  allowedHosts: ["arsenal.sumplus.xyz", "router.sumplus.xyz", "app.keeperhub.com"],
  // portfolio.rebalance is deliberately permitted here so that the call is
  // stopped by the per-call ceiling instead. A ceiling that never fires in the
  // demo is a ceiling nobody has seen work.
  allowedActions: [
    "catalog.read",
    "skill.search",
    "quote.read",
    "attestation.read",
    "anchor.read",
    "portfolio.rebalance",
    // The settlement runs under the same gate as everything else: if this
    // action or app.keeperhub.com were not listed, the money would not move.
    "settlement.transfer",
  ],
};

export type Decision =
  | { decision: "allowed" }
  | { decision: "refused"; reason: string };

export function decide(
  policy: Policy,
  spentMicroUsd: number,
  call: { action: string; host: string; costMicroUsd: number },
): Decision {
  if (!policy.allowedActions.includes(call.action)) {
    return {
      decision: "refused",
      reason: `The session may run ${policy.allowedActions.join(", ")}. It may not run ${call.action}.`,
    };
  }
  if (!policy.allowedHosts.includes(call.host)) {
    return {
      decision: "refused",
      reason: `The session may reach ${policy.allowedHosts.join(" and ")}. It may not reach ${call.host}.`,
    };
  }
  if (call.costMicroUsd > policy.perCallMicroUsd) {
    return {
      decision: "refused",
      reason: `This call costs more than the per-call ceiling of ${micro(policy.perCallMicroUsd)}.`,
    };
  }
  if (spentMicroUsd + call.costMicroUsd > policy.sessionMicroUsd) {
    const left = Math.max(0, policy.sessionMicroUsd - spentMicroUsd);
    return {
      decision: "refused",
      reason: `The session cap of ${micro(policy.sessionMicroUsd)} has ${micro(left)} left, and this call needs ${micro(call.costMicroUsd)}.`,
    };
  }
  return { decision: "allowed" };
}

/**
 * A ceiling of zero is a stop, never "no ceiling". Treating a zero limit as
 * unlimited turns an emergency brake into an accelerator.
 */
export function isStopped(policy: Policy): boolean {
  return policy.perCallMicroUsd === 0 || policy.sessionMicroUsd === 0;
}

/**
 * One agent session: the policy it runs under, the receipts it produced, and
 * the head those receipts hash to. Held in memory, because the point of the
 * demo is that the chain is checkable from the receipts alone.
 */
import { DEFAULT_POLICY, decide, type Policy } from "./policy";
import { keeperHubConfig, settle, type Settlement } from "./keeperhub";
import { appendReceipt, hashPayload, tamperedCopy, verifyChain, type Receipt } from "./receipts";
import {
  RATE_CARD,
  arsenalCategories,
  arsenalSkills,
  routerAttestation,
  routerRekor,
  type RekorAnchor,
} from "./upstream";

export type Step = {
  action: string;
  host: string;
  label: string;
  /** What the judge sees came back, in one line. */
  evidence?: string;
  receipt: Receipt;
};

export type SessionRun = {
  id: string;
  startedAt: string;
  policy: Policy;
  steps: Step[];
  receipts: Receipt[];
  spentMicroUsd: number;
  head: string;
  anchor: RekorAnchor | null;
  /** The onchain settlement, when KeeperHub is configured for this deployment. */
  settlement: Settlement | null;
};

let current: SessionRun | null = null;

export function getSession(): SessionRun | null {
  return current;
}

export function requireSession(): SessionRun {
  if (!current) throw new Error("No session has been run yet.");
  return current;
}

/**
 * A copy of this session's chain with one receipt edited, for showing the
 * verifier failing. The session's own receipts are never modified: the demo
 * control has to leave the record it is demonstrating intact, or the next
 * visitor reads a broken chain and concludes our receipts can be edited.
 */
export function tamperedView(
  seq: number,
  field: "costMicroUsd" | "target" | "chainTxHash",
): { receipts: Receipt[]; edited: Receipt; note: string } {
  const run = requireSession();
  return tamperedCopy(run.receipts, seq, field);
}

export async function runSession(policy: Policy = DEFAULT_POLICY): Promise<SessionRun> {
  const receipts: Receipt[] = [];
  const steps: Step[] = [];
  const sessionId = `run_${Date.now().toString(36)}`;
  let spent = 0;

  async function step(
    action: string,
    host: string,
    label: string,
    work: () => Promise<{
      payload: unknown;
      evidence: string;
      chain?: { txHash?: string; receiptStatus?: string; verified?: boolean };
    }>,
  ) {
    const costMicroUsd = RATE_CARD[action] ?? 0;
    const verdict = decide(policy, spent, { action, host, costMicroUsd });

    if (verdict.decision === "refused") {
      // The call is not made. The refusal is still recorded, because a spending
      // record with the refusals removed is not a record of the session.
      const receipt = appendReceipt(receipts, {
        action,
        target: host,
        costMicroUsd: 0,
        decision: "refused",
        reason: verdict.reason,
        payloadHash: hashPayload({ refused: action }),
      });
      steps.push({ action, host, label, receipt });
      return;
    }

    let payload: unknown;
    let evidence: string;
    let chain: { txHash?: string; receiptStatus?: string; verified?: boolean } | undefined;
    try {
      const out = await work();
      payload = out.payload;
      evidence = out.evidence;
      chain = out.chain;
    } catch (err) {
      payload = { error: err instanceof Error ? err.message : String(err) };
      evidence = `upstream did not answer: ${err instanceof Error ? err.message : String(err)}`;
    }

    spent += costMicroUsd;
    const receipt = appendReceipt(receipts, {
      action,
      target: host,
      costMicroUsd,
      decision: "allowed",
      payloadHash: hashPayload(payload),
      chainTxHash: chain?.txHash,
      chainReceiptStatus: chain?.receiptStatus,
      chainVerified: chain?.verified,
    });
    steps.push({ action, host, label, evidence, receipt });
  }

  await step("catalog.read", "arsenal.sumplus.xyz", "Read what the execution layer can do", async () => {
    const cats = await arsenalCategories();
    return {
      payload: cats,
      evidence: `${cats.count} capability categories, including ${cats.categories.slice(0, 4).join(", ")}`,
    };
  });

  await step("skill.search", "arsenal.sumplus.xyz", "Search for a way to move stablecoins", async () => {
    const hits = await arsenalSkills("swap usdc");
    const first = hits[0];
    return {
      payload: hits,
      evidence: hits.length
        ? `${hits.length} matching skills, first is ${first?.name ?? first?.id ?? "unnamed"}`
        : "the search returned nothing for this query",
    };
  });

  await step("attestation.read", "router.sumplus.xyz", "Ask the gateway to prove what it is running", async () => {
    const att = await routerAttestation();
    return {
      payload: att,
      evidence: `mode ${att.mode}, measurement ${att.measurement.slice(0, 16)}…, ${att.providers.length} providers`,
    };
  });

  await step("portfolio.rebalance", "arsenal.sumplus.xyz", "Try to spend past the per-call ceiling", async () => {
    throw new Error("unreachable: policy refuses this before it runs");
  });

  await step("quote.read", "example.invalid", "Try to reach a host outside the allowlist", async () => {
    throw new Error("unreachable: policy refuses this before it runs");
  });

  // The settlement. Everything above decides; this is where the money actually
  // moves, and it moves through KeeperHub. The policy gates it like any other
  // call: app.keeperhub.com and settlement.transfer both have to be allowed.
  let settlement: Settlement | null = null;
  const kh = keeperHubConfig();
  if (kh) {
    await step(
      "settlement.transfer",
      "app.keeperhub.com",
      "Settle the allowed spend on chain through KeeperHub",
      async () => {
        // The task id names the work rather than the attempt, so a retry of the
        // same session derives the same idempotency key and replays instead of
        // broadcasting a second transaction.
        const result = await settle(kh, `cashier-session-${sessionId}`);
        settlement = result;
        const verified = result.receipt?.verified === true;
        return {
          payload: {
            executionId: result.executionId,
            status: result.status,
            chainId: result.chainId,
            receipt: result.receipt,
          },
          evidence: verified
            ? `chain ${result.chainId}, transaction ${result.transactionHash} confirmed in block ${result.receipt?.blockNumber}`
            : `execution ${result.executionId} finished as ${result.status} with no confirmed receipt`,
          chain: {
            txHash: result.transactionHash ?? undefined,
            receiptStatus: result.receipt?.receiptStatus,
            verified,
          },
        };
      },
    );
  }

  // The public anchor, read as a step so it takes its own place in the chain.
  // It also means the settlement is not the last receipt, so editing the
  // settlement has a successor to break: a tampering demonstration on the final
  // receipt can only ever show half the property.
  let anchor: RekorAnchor | null = null;
  await step(
    "anchor.read",
    "router.sumplus.xyz",
    "Read the gateway's public transparency-log anchor",
    async () => {
      anchor = await routerRekor();
      return {
        payload: anchor,
        evidence: `Rekor entry ${anchor.rekor.log_index}, a log Sumplus does not operate`,
      };
    },
  );

  current = {
    id: sessionId,
    startedAt: new Date().toISOString(),
    policy,
    steps,
    receipts,
    spentMicroUsd: spent,
    head: verifyChain(receipts).head,
    anchor,
    settlement,
  };
  return current;
}

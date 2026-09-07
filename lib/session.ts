/**
 * One agent session: the policy it runs under, the receipts it produced, and
 * the head those receipts hash to. Held in memory, because the point of the
 * demo is that the chain is checkable from the receipts alone.
 */
import { DEFAULT_POLICY, decide, type Policy } from "./policy";
import { appendReceipt, hashPayload, verifyChain, type Receipt } from "./receipts";
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
};

let current: SessionRun | null = null;

export function getSession(): SessionRun | null {
  return current;
}

export function requireSession(): SessionRun {
  if (!current) throw new Error("No session has been run yet.");
  return current;
}

/** Replaces one receipt's field, so the verifier can be shown failing. */
export function tamper(seq: number, field: "costMicroUsd" | "target"): Receipt {
  const run = requireSession();
  const target = run.receipts.find((r) => r.seq === seq);
  if (!target) throw new Error(`No receipt numbered ${seq}.`);
  if (field === "costMicroUsd") target.costMicroUsd += 1_000_000;
  else target.target = `${target.target}.evil`;
  return target;
}

export async function runSession(policy: Policy = DEFAULT_POLICY): Promise<SessionRun> {
  const receipts: Receipt[] = [];
  const steps: Step[] = [];
  let spent = 0;

  async function step(
    action: string,
    host: string,
    label: string,
    work: () => Promise<{ payload: unknown; evidence: string }>,
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
    try {
      const out = await work();
      payload = out.payload;
      evidence = out.evidence;
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

  let anchor: RekorAnchor | null = null;
  try {
    anchor = await routerRekor();
  } catch {
    anchor = null;
  }

  current = {
    id: `run_${Date.now().toString(36)}`,
    startedAt: new Date().toISOString(),
    policy,
    steps,
    receipts,
    spentMicroUsd: spent,
    head: verifyChain(receipts).head,
    anchor,
  };
  return current;
}

#!/usr/bin/env tsx
/**
 * A verifier that always says yes is worth nothing. This runs a real session,
 * asserts the chain verifies, then edits one field of one receipt and requires
 * the verifier to reject it. Exit 0 only if both halves hold.
 *
 *   npm run negative-control
 *   npm run negative-control -- https://<deployed-url>   # against production
 */
import { verifyChain, type Receipt } from "../lib/receipts";
import { runSession } from "../lib/session";

async function fromDeployment(base: string): Promise<Receipt[]> {
  const run = await fetch(`${base.replace(/\/$/, "")}/api/run`, { method: "POST" });
  if (!run.ok) throw new Error(`POST /api/run returned HTTP ${run.status}`);
  const body = (await run.json()) as { receipts: Receipt[] };
  return body.receipts;
}

async function main() {
  const base = process.argv[2];
  const receipts = base ? await fromDeployment(base) : (await runSession()).receipts;

  console.log(`Session produced ${receipts.length} receipts.`);
  if (receipts.length < 3) throw new Error("The session is too short to be worth checking.");

  const genuine = verifyChain(receipts);
  console.log(`1. Genuine chain -> ${genuine.ok ? "accepted" : "REJECTED"}`);
  if (!genuine.ok) {
    console.error(genuine.problems);
    throw new Error("The untouched chain did not verify. The verifier is broken, not the chain.");
  }

  // Edit the earliest allowed receipt. Both halves of the break are asserted
  // below: its own hash, and the link held by the receipt after it.
  const victim = receipts.find((r) => r.decision === "allowed");
  if (!victim) throw new Error("No allowed receipt to edit.");
  victim.costMicroUsd += 1_000_000;

  const forged = verifyChain(receipts);
  console.log(
    `2. Chain with receipt ${victim.seq} edited -> ${forged.ok ? "ACCEPTED" : "rejected"}`,
  );
  for (const p of forged.problems) console.log(`   receipt ${p.seq}: ${p.detail}`);

  if (forged.ok) {
    throw new Error("The verifier accepted an edited receipt. It proves nothing.");
  }

  // An edit has to surface twice: the receipt no longer hashes to what it
  // claims, and the next receipt now points at a hash that no longer exists.
  // Asserting only the first would pass even if links were never checked.
  const kinds = new Set(forged.problems.map((p) => p.kind));
  const flagged = new Set(forged.problems.map((p) => p.seq));
  console.log(`   flagged receipts: ${[...flagged].join(", ")}`);

  if (!kinds.has("hash-mismatch")) {
    throw new Error("The edited receipt's own hash was not recomputed.");
  }
  const hasSuccessor = victim.seq + 1 < receipts.length;
  if (hasSuccessor && !kinds.has("broken-link")) {
    throw new Error(
      "The receipt after the edited one still linked cleanly, so links are not really checked.",
    );
  }
  if (hasSuccessor && !flagged.has(victim.seq + 1)) {
    throw new Error(`Receipt ${victim.seq + 1} should have been implicated and was not.`);
  }

  console.log("\nAccepted the genuine record and refused the edited one.");
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});

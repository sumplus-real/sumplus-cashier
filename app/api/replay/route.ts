import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import {
  executeTransfer,
  keeperHubConfig,
  waitForExecution,
  idempotencyKey,
  simulateTransfer,
} from "@/lib/keeperhub";
import { readTransactionCount } from "@/lib/chain";

export const dynamic = "force-dynamic";

/**
 * Asks KeeperHub to settle the same work a second time, under the key the work
 * already derived, and reports what the chain says about it.
 *
 * The property this demonstrates is the one that actually matters when an agent
 * is spending: a retry must not become a second payment. Until now that
 * property only existed in the tests, where it is asserted against a stub. A
 * judge cannot press a stub.
 *
 * The transaction count is read from a public node rather than from KeeperHub,
 * because "I did not broadcast anything" is exactly the claim that should not
 * be taken from the party making it.
 */
export async function POST() {
  try {
    const session = requireSession();
    const config = keeperHubConfig();
    if (!config) {
      return NextResponse.json(
        { error: "This deployment has no KeeperHub credentials, so there is nothing to replay." },
        { status: 400 },
      );
    }
    const original = session.settlement;
    if (!original) {
      return NextResponse.json(
        { error: "This session has no settlement to replay." },
        { status: 400 },
      );
    }

    // The same task id the session settled under, so the key derives the same.
    const taskId = `cashier-session-${session.id}`;
    const key = idempotencyKey({
      taskId,
      chainId: config.chainId,
      recipient: config.recipient,
      amount: config.amount,
    });

    // Count transactions for the account that BROADCASTS, which is the only
    // account whose count can move. Reading the recipient's count instead
    // happens to give the right answer here, because the demo settles to the
    // organisation wallet itself, but only by coincidence: point the recipient
    // at any third party and "the count did not move" becomes trivially true
    // while proving nothing. The dry run's `from` is the broadcaster by
    // definition, and it signs and broadcasts nothing to tell us.
    const simulation = await simulateTransfer(config);
    if (!simulation.ok) {
      return NextResponse.json(
        { error: `KeeperHub refused the dry run, so there is nothing to replay: ${simulation.reason}` },
        { status: 502 },
      );
    }
    const broadcaster = simulation.from;

    const before = await readTransactionCount(config.chainId, broadcaster);
    const again = await executeTransfer(config, taskId);
    const final = await waitForExecution(config, again.executionId);
    const after = await readTransactionCount(config.chainId, broadcaster);

    const replayedHash = final.transactionHash ?? final.receipts?.[0]?.hash ?? null;

    return NextResponse.json({
      idempotencyKey: key,
      original: {
        executionId: original.executionId,
        transactionHash: original.transactionHash,
      },
      replayed: {
        executionId: again.executionId,
        status: final.status,
        transactionHash: replayedHash,
      },
      sameExecution: again.executionId === original.executionId,
      sameTransaction: replayedHash !== null && replayedHash === original.transactionHash,
      chain: {
        /** The account that broadcasts. Its count is the only one that can move. */
        address: broadcaster,
        broadcasterIsRecipient: broadcaster.toLowerCase() === config.recipient.toLowerCase(),
        chainId: config.chainId,
        transactionCountBefore: before.transactionCount,
        transactionCountAfter: after.transactionCount,
        // The whole point: unchanged means the chain gained nothing.
        broadcastAnything: after.transactionCount !== before.transactionCount,
        nodeBefore: before.node,
        nodeAfter: after.node,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "the replay did not complete" },
      { status: 500 },
    );
  }
}

import { createHash } from "node:crypto";
import { short } from "./money";

/**
 * A receipt records one thing the agent did that cost something, and what the
 * policy decided before it happened. Receipts are chained: editing one breaks
 * its own hash and the link held by the receipt after it.
 */
export type Receipt = {
  seq: number;
  at: string;
  action: string;
  target: string;
  /** Micro-dollars. Integers only, so no float drift between chain and display. */
  costMicroUsd: number;
  decision: "allowed" | "refused";
  /** Present when refused. A sentence, not a code. */
  reason?: string;
  /** Hash of the request and response metadata. Bodies are never stored. */
  payloadHash: string;
  /**
   * Present when the spend was settled on chain through KeeperHub. The hash is
   * what the write path reported; `chainVerified` and `chainReceiptStatus` come
   * from the receipt KeeperHub re-fetched from the chain, which is the part
   * that is evidence rather than self-report.
   */
  chainTxHash?: string;
  chainReceiptStatus?: string;
  chainVerified?: boolean;
  prevHash: string;
  hash: string;
};

export const GENESIS = "0".repeat(64);

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** The bytes a receipt's hash commits to. Field order is part of the format. */
export function receiptPreimage(r: Omit<Receipt, "hash">): string {
  return [
    r.seq,
    r.at,
    r.action,
    r.target,
    r.costMicroUsd,
    r.decision,
    r.reason ?? "",
    r.payloadHash,
    // The settlement fields are inside the commitment, so editing a transaction
    // hash breaks the receipt's own hash and the link held by the next one.
    r.chainTxHash ?? "",
    r.chainReceiptStatus ?? "",
    r.chainVerified === true ? "verified" : "",
    r.prevHash,
  ].join("\n");
}

export function hashReceipt(r: Omit<Receipt, "hash">): string {
  return sha256Hex(receiptPreimage(r));
}

export function hashPayload(payload: unknown): string {
  return sha256Hex(JSON.stringify(payload));
}

export function appendReceipt(
  chain: Receipt[],
  fields: Omit<Receipt, "seq" | "prevHash" | "hash" | "at"> & { at?: string },
): Receipt {
  const prev = chain[chain.length - 1];
  const body = {
    seq: chain.length,
    at: fields.at ?? new Date().toISOString(),
    action: fields.action,
    target: fields.target,
    costMicroUsd: fields.costMicroUsd,
    decision: fields.decision,
    reason: fields.reason,
    payloadHash: fields.payloadHash,
    chainTxHash: fields.chainTxHash,
    chainReceiptStatus: fields.chainReceiptStatus,
    chainVerified: fields.chainVerified,
    prevHash: prev ? prev.hash : GENESIS,
  };
  const receipt: Receipt = { ...body, hash: hashReceipt(body) };
  chain.push(receipt);
  return receipt;
}

/**
 * How a receipt's onchain settlement should read. "Still settling" and "failed"
 * are deliberately separate: an execution that has broadcast but whose receipt
 * could not be read yet may still land, and showing it as a failure invites
 * exactly the double-send the idempotency key exists to prevent.
 */
export type SettlementState = {
  state: "none" | "settled" | "settling" | "failed";
  label: string;
  tone: "ok" | "wait" | "bad" | "none";
  detail: string;
};

export function settlementState(r: Pick<Receipt, "chainTxHash" | "chainReceiptStatus" | "chainVerified">): SettlementState {
  if (!r.chainTxHash && !r.chainReceiptStatus) {
    return { state: "none", label: "", tone: "none", detail: "" };
  }
  if (r.chainVerified === true && r.chainReceiptStatus === "success") {
    return {
      state: "settled",
      label: "settled on chain",
      tone: "ok",
      detail: "The receipt for this transaction was re-fetched from the chain and confirmed.",
    };
  }
  if (r.chainReceiptStatus === "reverted" || r.chainReceiptStatus === "safe_inner_failure") {
    return {
      state: "failed",
      label: "reverted on chain",
      tone: "bad",
      detail:
        r.chainReceiptStatus === "reverted"
          ? "The transaction was included and the chain rejected it."
          : "The outer transaction succeeded and an inner call failed.",
    };
  }
  return {
    state: "settling",
    label: "still settling",
    tone: "wait",
    detail:
      "The transaction was broadcast and its receipt has not been read conclusively yet. This is not a failure, and it must not be re-sent: a second send can put a second transaction on the chain.",
  };
}

/** A copy of the chain with one field edited. The stored receipts are untouched. */
export function tamperedCopy(
  chain: Receipt[],
  seq: number,
  field: "costMicroUsd" | "target" | "chainTxHash",
): { receipts: Receipt[]; edited: Receipt; note: string } {
  const receipts = chain.map((r) => ({ ...r }));
  const edited = receipts.find((r) => r.seq === seq);
  if (!edited) throw new Error(`No receipt numbered ${seq}.`);

  let note: string;
  if (field === "costMicroUsd") {
    edited.costMicroUsd += 1_000_000;
    note = `one dollar was added to receipt ${seq}'s cost`;
  } else if (field === "chainTxHash") {
    if (!edited.chainTxHash) throw new Error(`Receipt ${seq} carries no transaction hash.`);
    edited.chainTxHash = `0x${"f".repeat(64)}`;
    note = `receipt ${seq}'s transaction hash was swapped for a different one`;
  } else {
    edited.target = `${edited.target}.evil`;
    note = `receipt ${seq}'s target was changed`;
  }
  return { receipts, edited, note };
}

export type VerifyProblem = {
  seq: number;
  kind: "hash-mismatch" | "broken-link" | "bad-sequence";
  detail: string;
};

export type VerifyResult = {
  ok: boolean;
  length: number;
  head: string;
  problems: VerifyProblem[];
};

/**
 * Recompute the whole chain from the receipts alone. This is what a stranger
 * runs: it trusts none of the stored hashes, it derives them.
 */
export function verifyChain(chain: Receipt[]): VerifyResult {
  const problems: VerifyProblem[] = [];
  let expectedPrev = GENESIS;

  chain.forEach((r, index) => {
    if (r.seq !== index) {
      problems.push({
        seq: r.seq,
        kind: "bad-sequence",
        detail: `receipt is numbered ${r.seq} but sits at position ${index}`,
      });
    }
    if (r.prevHash !== expectedPrev) {
      problems.push({
        seq: r.seq,
        kind: "broken-link",
        detail: `points at ${short(r.prevHash)} but the receipt before it hashes to ${short(expectedPrev)}`,
      });
    }
    const recomputed = hashReceipt({ ...r });
    if (recomputed !== r.hash) {
      problems.push({
        seq: r.seq,
        kind: "hash-mismatch",
        detail: `contents hash to ${short(recomputed)}, receipt claims ${short(r.hash)}`,
      });
    }
    // Carry the recomputed hash, never the stored one. Trusting the stored hash
    // here would stop an edit from propagating, and a chain where tampering does
    // not propagate is just a list.
    expectedPrev = recomputed;
  });

  return {
    ok: problems.length === 0,
    length: chain.length,
    head: chain.length ? chain[chain.length - 1].hash : GENESIS,
    problems,
  };
}

export { short, usd } from "./money";

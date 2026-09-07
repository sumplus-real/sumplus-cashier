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
    prevHash: prev ? prev.hash : GENESIS,
  };
  const receipt: Receipt = { ...body, hash: hashReceipt(body) };
  chain.push(receipt);
  return receipt;
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

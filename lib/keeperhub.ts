import { createHash } from "node:crypto";

/**
 * KeeperHub is the execution layer: once the policy has allowed a spend, the
 * money actually moves through here, and the transaction it produces is what
 * the receipt commits to.
 *
 * Everything in this file follows the Direct Execution API as documented at
 * https://docs.keeperhub.com/api/direct-execution. Where the documentation is
 * silent, the assumption is marked ASSUMPTION with what it rests on.
 */

/**
 * Read at call time, never captured at module load. A base URL frozen into a
 * module constant cannot be pointed anywhere else in the same process, which
 * makes the settlement path untestable without a real key and a real chain.
 */
export function keeperHubBase(): string {
  return (process.env.KEEPERHUB_BASE ?? "https://app.keeperhub.com").replace(/\/$/, "");
}

/**
 * BNB Chain testnet. Chosen because this is the chain Sumplus already has
 * deployment and faucet experience on, and because `GET /api/chains` lists it
 * with `isTestnet: true`, which is what the documented first-write sequence
 * tells you to select.
 */
export const DEFAULT_CHAIN_ID = "97";

export type KeeperHubConfig = {
  apiKey: string;
  chainId: string;
  /** Where the settlement transfer goes. Our own address, never a third party. */
  recipient: string;
  /** Human-readable units, as the API wants them. */
  amount: string;
};

/**
 * Configuration comes from the environment so no key is ever committed. When
 * the key is absent the cashier runs exactly as before and says so, rather
 * than pretending a settlement happened.
 */
export function keeperHubConfig(): KeeperHubConfig | null {
  const apiKey = process.env.KEEPERHUB_API_KEY;
  const recipient = process.env.KEEPERHUB_RECIPIENT;
  if (!apiKey || !recipient) return null;
  return {
    apiKey,
    recipient,
    chainId: process.env.KEEPERHUB_CHAIN_ID ?? DEFAULT_CHAIN_ID,
    amount: process.env.KEEPERHUB_AMOUNT ?? "0.0001",
  };
}

/** One transaction, as re-fetched from the chain by KeeperHub before settling. */
export type ChainReceipt = {
  hash: string;
  chainId: number;
  verified: boolean;
  receiptStatus: "success" | "reverted" | "safe_inner_failure" | "not_found" | "timeout" | string;
  blockNumber?: number;
  gasUsed?: string;
  verifiedAt?: string;
};

export type ExecutionStatus = {
  executionId: string;
  status: string;
  network?: string;
  transactionHash?: string | null;
  transactionLink?: string | null;
  sponsored?: boolean;
  receipts?: ChainReceipt[];
  error?: string | null;
  /** Seconds to wait before polling again. 0 means terminal. */
  pollHintSeconds: number;
};

export type SimulationResult =
  | { ok: true; from: string; to: string; value: string; gasEstimate: string }
  | { ok: false; failureKind?: string; code?: string; wouldRevert?: boolean; reason: string };

export type Settlement = {
  executionId: string;
  status: string;
  /** Self-reported by the write path. Proof is the verified receipt below. */
  transactionHash: string | null;
  transactionLink: string | null;
  /** The chain-verified receipt for that hash, when one confirmed. */
  receipt: ChainReceipt | null;
  sponsored: boolean;
  chainId: string;
};

class KeeperHubError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type RequestOptions = {
  method: "GET" | "POST";
  path: string;
  apiKey: string;
  body?: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
};

type RawResponse = { status: number; headers: Headers; body: unknown };

/**
 * A network failure says nothing about whether the request was received, so it
 * is retried under the same idempotency key, which is what makes the retry
 * safe. An HTTP status is an answer and is never retried: retrying a 400 just
 * repeats a mistake, and retrying a 202 would risk a second transaction.
 */
async function call(opts: RequestOptions, tries = 3): Promise<RawResponse> {
  const url = `${keeperHubBase()}${opts.path}`;
  let last: unknown;

  for (let attempt = 0; attempt < tries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
    try {
      const headers: Record<string, string> = {
        authorization: `Bearer ${opts.apiKey}`,
        accept: "application/json",
      };
      if (opts.body !== undefined) headers["content-type"] = "application/json";
      if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;

      const res = await fetch(url, {
        method: opts.method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timer);

      const text = await res.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      return { status: res.status, headers: res.headers, body: parsed };
    } catch (err) {
      clearTimeout(timer);
      last = err;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/**
 * The documented canonical form for an idempotency key:
 *
 *   taskId|chainId|recipientAddress|amount|tokenAddress
 *
 * sha256 of the UTF-8 bytes, lowercase hex. The key has to identify the work
 * rather than the attempt, so a retry derives the same key and replays instead
 * of broadcasting a second transaction.
 */
export function idempotencyKey(parts: {
  taskId: string;
  chainId: string;
  recipient: string;
  amount: string;
  tokenAddress?: string;
}): string {
  const taskId = parts.taskId.trim().replace(/%/g, "%25").replace(/\|/g, "%7C");
  const chainId = String(Number(parts.chainId));
  const joined = [
    taskId,
    chainId,
    parts.recipient.trim().toLowerCase(),
    canonicalAmount(parts.amount),
    parts.tokenAddress ? parts.tokenAddress.trim().toLowerCase() : "",
  ].join("|");
  return createHash("sha256").update(joined, "utf8").digest("hex");
}

/**
 * Decimal string, no exponent, no leading or trailing zero noise, so that two
 * spellings of the same amount cannot derive different keys. Kept as a string
 * throughout: parsing "0.1" as a float gives 0.100000000000000006.
 */
export function canonicalAmount(input: string): string {
  const trimmed = input.trim();
  if (/[eE+-]/.test(trimmed)) throw new Error(`amount must be plain decimal: ${input}`);
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === "" || trimmed === ".") {
    throw new Error(`amount is not a decimal number: ${input}`);
  }

  let [whole = "", fraction = ""] = trimmed.split(".");
  whole = whole.replace(/^0+/, "");
  fraction = fraction.replace(/0+$/, "");
  if (whole === "") whole = "0";
  const out = fraction ? `${whole}.${fraction}` : whole;
  return out === "" ? "0" : out;
}

/**
 * Dry run. Signs nothing and broadcasts nothing, so it is the step that
 * belongs next to a spending control: the question "would this go through"
 * gets answered before the money moves.
 *
 * A deterministic failed simulation answers 400, and the documented way to
 * read it is `code` first, then `failureKind`, then `wouldRevert`. Treating
 * every non-2xx as a malformed request would throw away the diagnosis.
 */
export async function simulateTransfer(config: KeeperHubConfig): Promise<SimulationResult> {
  const res = await call({
    method: "POST",
    path: "/api/execute/transfer",
    apiKey: config.apiKey,
    body: {
      chainId: config.chainId,
      recipientAddress: config.recipient,
      amount: config.amount,
      simulate: true,
    },
  });

  const body = (res.body ?? {}) as Record<string, unknown>;

  if (res.status >= 200 && res.status < 300 && body.success === true) {
    return {
      ok: true,
      from: String(body.from ?? ""),
      to: String(body.to ?? ""),
      value: String(body.value ?? ""),
      gasEstimate: String(body.gasEstimate ?? ""),
    };
  }

  const code = typeof body.code === "string" ? body.code : undefined;
  const failureKind = typeof body.failureKind === "string" ? body.failureKind : undefined;
  const reason =
    (typeof body.revertReason === "string" && body.revertReason) ||
    (typeof body.error === "string" && body.error) ||
    `simulation failed with HTTP ${res.status}`;

  return {
    ok: false,
    code,
    failureKind,
    wouldRevert: body.wouldRevert === true,
    reason,
  };
}

/**
 * Broadcast. Returns as soon as the execution row exists; the hash may not be
 * on the response at all, because a failed or unconfirmed broadcast carries
 * neither hash nor link. The status endpoint is where those are read from.
 */
export async function executeTransfer(
  config: KeeperHubConfig,
  taskId: string,
): Promise<{ executionId: string; status: string }> {
  const key = idempotencyKey({
    taskId,
    chainId: config.chainId,
    recipient: config.recipient,
    amount: config.amount,
  });

  const res = await call({
    method: "POST",
    path: "/api/execute/transfer",
    apiKey: config.apiKey,
    idempotencyKey: key,
    body: {
      chainId: config.chainId,
      recipientAddress: config.recipient,
      amount: config.amount,
    },
  });

  const body = (res.body ?? {}) as Record<string, unknown>;
  if (res.status < 200 || res.status >= 300 || typeof body.executionId !== "string") {
    const message =
      (typeof body.error === "string" && body.error) || `execute returned HTTP ${res.status}`;
    throw new KeeperHubError(message, res.status, res.body);
  }

  return { executionId: body.executionId, status: String(body.status ?? "pending") };
}

/**
 * ASSUMPTION(documented header, no documented default): the polling interval
 * comes from `X-Poll-Interval-Hint`, and 0 means terminal. The docs say to
 * decide terminality from that header rather than from the status string, so
 * an unfamiliar status is not mistaken for a failure. They do not say what to
 * do when the header is missing; this treats a missing header as "keep
 * polling, wait two seconds", which is the conservative reading because the
 * alternative is stopping on an execution that is still settling. If polling
 * never terminates, look here first.
 */
function pollHint(headers: Headers): number {
  const raw = headers.get("x-poll-interval-hint");
  if (raw === null) return 2;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2;
}

export async function getExecution(
  config: KeeperHubConfig,
  executionId: string,
): Promise<ExecutionStatus> {
  const res = await call({
    method: "GET",
    path: `/api/execute/${encodeURIComponent(executionId)}/status`,
    apiKey: config.apiKey,
  });

  const body = (res.body ?? {}) as Record<string, unknown>;
  if (res.status < 200 || res.status >= 300) {
    const message =
      (typeof body.error === "string" && body.error) || `status returned HTTP ${res.status}`;
    throw new KeeperHubError(message, res.status, res.body);
  }

  return {
    executionId: String(body.executionId ?? executionId),
    status: String(body.status ?? "pending"),
    network: typeof body.network === "string" ? body.network : undefined,
    transactionHash: typeof body.transactionHash === "string" ? body.transactionHash : null,
    transactionLink: typeof body.transactionLink === "string" ? body.transactionLink : null,
    sponsored: body.sponsored === true,
    receipts: parseChainReceipts(body.receipts),
    error: typeof body.error === "string" ? body.error : null,
    pollHintSeconds: pollHint(res.headers),
  };
}

/**
 * Receipts are objects, not hash strings. Reading them as strings would turn
 * the one piece of chain-verified evidence into "[object Object]", so the
 * shape is parsed explicitly and anything that is not an object is dropped.
 */
export function parseChainReceipts(input: unknown): ChainReceipt[] {
  if (!Array.isArray(input)) return [];
  const out: ChainReceipt[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    if (typeof r.hash !== "string") continue;
    out.push({
      hash: r.hash,
      chainId: typeof r.chainId === "number" ? r.chainId : Number(r.chainId ?? 0),
      verified: r.verified === true,
      receiptStatus: typeof r.receiptStatus === "string" ? r.receiptStatus : "unknown",
      blockNumber: typeof r.blockNumber === "number" ? r.blockNumber : undefined,
      gasUsed: typeof r.gasUsed === "string" ? r.gasUsed : undefined,
      verifiedAt: typeof r.verifiedAt === "string" ? r.verifiedAt : undefined,
    });
  }
  return out;
}

/**
 * Poll until the server says the execution is terminal. `unconfirmed` is not a
 * failure and must not trigger a re-send: a second send under a fresh key can
 * put a second transaction on the chain for work the first one is completing.
 */
export async function waitForExecution(
  config: KeeperHubConfig,
  executionId: string,
  budgetMs = 120_000,
): Promise<ExecutionStatus> {
  const deadline = Date.now() + budgetMs;
  let latest = await getExecution(config, executionId);

  while (latest.pollHintSeconds > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, latest.pollHintSeconds * 1000));
    latest = await getExecution(config, executionId);
  }
  return latest;
}

/** Decimal string to the chain's base unit, without going through a float. */
export function toBaseUnits(amount: string, decimals = 18): bigint {
  const canonical = canonicalAmount(amount);
  const [whole, fraction = ""] = canonical.split(".");
  if (fraction.length > decimals) {
    throw new Error(`amount has more than ${decimals} decimal places: ${amount}`);
  }
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

export type SpendCap =
  | { known: true; remainingWei: bigint; usingDefault: boolean }
  | { known: false; why: string };

/**
 * Every organization is capped, including one that has never configured
 * anything: an unset cap means the platform default, not unlimited. Reading
 * the remaining allowance before broadcasting turns "the cap stopped us" from
 * a surprise at the worst moment into a refusal we can explain.
 *
 * ASSUMPTION(endpoint may be unreadable with this credential): the docs say
 * this endpoint accepts a `kh_` key with `mcp:read`, but a key whose scope is
 * narrower, or an org-level restriction, can still refuse it. When the figure
 * cannot be read this returns `known: false` and the settlement proceeds,
 * because the cap is enforced server-side regardless and refusing to spend on
 * the basis of a reading we could not take would be its own failure mode. If a
 * broadcast is ever rejected for the daily cap without a warning here, this is
 * the place to look.
 */
export async function readSpendCap(config: KeeperHubConfig): Promise<SpendCap> {
  try {
    const res = await call({
      method: "GET",
      path: "/api/analytics/spend-cap",
      apiKey: config.apiKey,
      timeoutMs: 15_000,
    });
    if (res.status < 200 || res.status >= 300) {
      return { known: false, why: `spend-cap returned HTTP ${res.status}` };
    }
    const body = (res.body ?? {}) as Record<string, unknown>;
    const effective = body.effectiveDailyCapWei;
    const used = body.dailyUsedWei;
    if (typeof effective !== "string" || typeof used !== "string") {
      return { known: false, why: "spend-cap did not carry the effective figures" };
    }
    const remaining = BigInt(effective) - BigInt(used);
    return {
      known: true,
      remainingWei: remaining > BigInt(0) ? remaining : BigInt(0),
      usingDefault: body.usingDefaultDailyCap === true,
    };
  } catch (err) {
    return { known: false, why: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The whole settlement: dry run, broadcast, then wait for the chain-verified
 * receipt. The caller hands this a task id that names the work, so a retry of
 * the same work derives the same idempotency key.
 */
export async function settle(config: KeeperHubConfig, taskId: string): Promise<Settlement> {
  const simulation = await simulateTransfer(config);
  if (!simulation.ok) {
    throw new Error(`KeeperHub refused the dry run: ${simulation.reason}`);
  }

  const cap = await readSpendCap(config);
  if (cap.known) {
    const needed = toBaseUnits(config.amount);
    if (cap.remainingWei < needed) {
      throw new Error(
        `The daily spending cap has ${cap.remainingWei} wei left and this transfer needs ${needed}. ` +
          (cap.usingDefault
            ? "The organization has set no cap of its own, so the platform default applies."
            : "Raise the organization's configured cap or wait for the day to roll over."),
      );
    }
  }

  const started = await executeTransfer(config, taskId);
  const final = await waitForExecution(config, started.executionId);

  const receipts = final.receipts ?? [];
  // Prefer a receipt that confirmed, but keep an unconfirmed or reverted one
  // rather than dropping it: "reverted" and "could not be read yet" are
  // different outcomes, and discarding the entry collapses them into the same
  // silence, which is the reading the caller must not be given.
  const chosen =
    receipts.find((r) => r.verified && r.receiptStatus === "success") ?? receipts[0] ?? null;

  return {
    executionId: final.executionId,
    status: final.status,
    transactionHash: final.transactionHash ?? chosen?.hash ?? null,
    transactionLink: final.transactionLink ?? null,
    receipt: chosen,
    sponsored: final.sponsored === true,
    chainId: config.chainId,
  };
}

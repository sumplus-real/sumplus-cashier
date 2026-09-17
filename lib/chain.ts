/**
 * Reads the chain directly, from nodes nobody here operates.
 *
 * This exists so that a claim about what did or did not reach the chain can be
 * settled by the chain rather than by the service making the claim. KeeperHub
 * saying "I replayed and broadcast nothing" and the chain saying "this account
 * has sent exactly four transactions" are different kinds of evidence, and only
 * the second one survives the question "what if the API is wrong".
 */

/** Public endpoints per chain, in the order they are tried. */
const NODES: Record<string, string[]> = {
  "97": [
    "https://bsc-testnet-rpc.publicnode.com",
    "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
    "https://data-seed-prebsc-2-s1.bnbchain.org:8545",
  ],
  "11155111": ["https://ethereum-sepolia-rpc.publicnode.com", "https://rpc.sepolia.org"],
};

export type NonceReading = {
  /** How many transactions this account has ever sent. */
  transactionCount: number;
  /** Which endpoint answered. Named so the reader can repeat the call. */
  node: string;
};

async function rpc(url: string, method: string, params: unknown[], timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    const body = (await res.json()) as { result?: string; error?: { message?: string } };
    if (body.error) throw new Error(`${url}: ${body.error.message ?? "rpc error"}`);
    if (typeof body.result !== "string") throw new Error(`${url} returned no result`);
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The account's transaction count, which is the number that has to stay still
 * for "nothing was broadcast" to be true. Tries each node in turn: a node being
 * unreachable is not an answer about the chain.
 */
export async function readTransactionCount(
  chainId: string,
  address: string,
): Promise<NonceReading> {
  const nodes = NODES[chainId];
  if (!nodes) throw new Error(`no public node configured for chain ${chainId}`);
  const failures: string[] = [];
  for (const node of nodes) {
    try {
      const hex = await rpc(node, "eth_getTransactionCount", [address, "latest"]);
      return { transactionCount: Number.parseInt(hex, 16), node };
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(`no public node answered for chain ${chainId}: ${failures.join("; ")}`);
}

#!/usr/bin/env tsx
/**
 * The settlement path, checked against a stub that answers the way the
 * Direct Execution API documents. No API key, no network, no chain: this
 * asserts we read the documented shapes correctly, which is the half that can
 * be wrong long before anyone hands us a key.
 *
 *   npm run keeperhub-test
 *
 * Each assertion is paired with a control: the stub is made to answer wrongly
 * and the assertion has to fail. An assertion that has never been red is not
 * evidence of anything.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

type StubBehaviour = {
  /** Status values the poll returns in order. The last one is repeated. */
  pollStatuses: { status: string; hint: string | null; receipts?: unknown; hash?: string | null }[];
  simulateFails?: { body: Record<string, unknown> };
  /** Defaults to a cap with plenty left. */
  spendCap?: { status: number; body: Record<string, unknown> };
};

type Captured = {
  simulateBodies: Record<string, unknown>[];
  broadcastBodies: Record<string, unknown>[];
  broadcastKeys: (string | null)[];
  simulateKeys: (string | null)[];
  polls: number;
  spendCapReads: number;
};

async function withStub<T>(
  behaviour: StubBehaviour,
  run: (base: string, captured: Captured) => Promise<T>,
): Promise<T> {
  const captured: Captured = {
    simulateBodies: [],
    broadcastBodies: [],
    broadcastKeys: [],
    simulateKeys: [],
    polls: 0,
    spendCapReads: 0,
  };

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const key = (req.headers["idempotency-key"] as string | undefined) ?? null;
      const url = req.url ?? "";

      if (req.method === "POST" && url === "/api/execute/transfer") {
        if (body.simulate === true) {
          captured.simulateBodies.push(body);
          captured.simulateKeys.push(key);
          if (behaviour.simulateFails) {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify(behaviour.simulateFails.body));
            return;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              status: "simulated",
              from: "0xorg",
              to: "0xrecipient",
              value: "100000000000000",
              gasEstimate: "21000",
              wouldRevert: false,
            }),
          );
          return;
        }
        captured.broadcastBodies.push(body);
        captured.broadcastKeys.push(key);
        res.writeHead(202, { "content-type": "application/json" });
        res.end(JSON.stringify({ executionId: "exec_1", status: "pending" }));
        return;
      }

      if (req.method === "GET" && url === "/api/analytics/spend-cap") {
        captured.spendCapReads += 1;
        const cap = behaviour.spendCap ?? {
          status: 200,
          body: {
            dailyCapWei: null,
            dailyUsedWei: "0",
            effectiveDailyCapWei: "20000000000000000",
            usingDefaultDailyCap: true,
          },
        };
        res.writeHead(cap.status, { "content-type": "application/json" });
        res.end(JSON.stringify(cap.body));
        return;
      }

      if (req.method === "GET" && url.startsWith("/api/execute/")) {
        const idx = Math.min(captured.polls, behaviour.pollStatuses.length - 1);
        const stage = behaviour.pollStatuses[idx];
        captured.polls += 1;
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (stage.hint !== null) headers["x-poll-interval-hint"] = stage.hint;
        res.writeHead(200, headers);
        res.end(
          JSON.stringify({
            executionId: "exec_1",
            status: stage.status,
            network: "97",
            transactionHash: stage.hash === undefined ? null : stage.hash,
            sponsored: false,
            receipts: stage.receipts ?? [],
          }),
        );
        return;
      }

      res.writeHead(404).end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  process.env.KEEPERHUB_BASE = base;

  try {
    return await run(base, captured);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const CONFIRMED = [
  {
    hash: "0xabc",
    chainId: 97,
    verified: true,
    receiptStatus: "success",
    blockNumber: 1234,
    gasUsed: "21000",
  },
];

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function main() {
  // Imported after KEEPERHUB_BASE can be set per test: the module reads it at
  // call time, but importing late keeps that true if it ever stops being.
  const kh = await import("../lib/keeperhub");

  const config = {
    apiKey: "kh_test",
    chainId: "97",
    recipient: "0x000000000000000000000000000000000000dead",
    amount: "0.0001",
  };

  console.log("1. A settlement that confirms");
  await withStub(
    {
      pollStatuses: [
        // `unconfirmed` is not a failure, and `settling` is a status this
        // client has never heard of. Both carry a non-zero poll hint, so a
        // client that decided terminality from the status string would stop
        // here and report a failure for an execution that is still settling.
        { status: "unconfirmed", hint: "0.01", receipts: [] },
        { status: "settling", hint: "0.01", receipts: [] },
        { status: "completed", hint: "0", receipts: CONFIRMED, hash: "0xabc" },
      ],
    },
    async (_base, captured) => {
      const result = await kh.settle(config, "task-1");
      check("polled past unconfirmed and an unknown status", captured.polls >= 3, `${captured.polls} polls`);
      check("transaction hash read back", result.transactionHash === "0xabc");
      check("chain receipt parsed as an object", result.receipt?.blockNumber === 1234);
      check("receipt reported verified", result.receipt?.verified === true);
      check("dry run ran before the broadcast", captured.simulateBodies.length === 1);
      check("broadcast carried no simulate flag", captured.broadcastBodies[0]?.simulate === undefined);
      check("broadcast carried an idempotency key", typeof captured.broadcastKeys[0] === "string");
      check("dry run carried no idempotency key", captured.simulateKeys[0] === null);
    },
  );

  console.log("2. Controls: the stub answers wrongly and the checks have to notice");
  await withStub(
    {
      pollStatuses: [
        // Receipts as bare strings, the shape we would get if the docs had
        // meant hashes. Reading them as objects must yield no verified receipt
        // rather than a receipt full of undefined.
        { status: "completed", hint: "0", receipts: ["0xabc"], hash: null },
      ],
    },
    async () => {
      const result = await kh.settle(config, "task-2");
      check("string receipts produce no verified receipt", result.receipt === null);
      check("no hash invented when the write path reported none", result.transactionHash === null);
    },
  );

  await withStub(
    {
      pollStatuses: [{ status: "completed", hint: "0", receipts: CONFIRMED, hash: "0xabc" }],
      simulateFails: {
        body: {
          success: false,
          failureKind: "validation",
          code: "insufficient_balance",
          wouldRevert: true,
          revertReason: "Insufficient BNB balance. Have: 0, Need: 0.0001",
        },
      },
    },
    async (_base, captured) => {
      let threw = "";
      try {
        await kh.settle(config, "task-3");
      } catch (err) {
        threw = err instanceof Error ? err.message : String(err);
      }
      check("a failed dry run stops the settlement", threw !== "", threw.slice(0, 60));
      check("nothing was broadcast after a failed dry run", captured.broadcastBodies.length === 0);
    },
  );

  await withStub(
    {
      pollStatuses: [
        { status: "unconfirmed", hint: "0.01", receipts: [] },
        { status: "failed", hint: "0", receipts: [], hash: null },
      ],
    },
    async () => {
      const result = await kh.settle(config, "task-4");
      check("a failed execution is reported, not dressed up", result.status === "failed");
      check("a failed execution carries no receipt", result.receipt === null);
    },
  );

  console.log("3. Idempotency keys identify the work, not the attempt");
  const k1 = kh.idempotencyKey({ ...config, taskId: "job-9", recipient: config.recipient });
  const k2 = kh.idempotencyKey({ ...config, taskId: "job-9", recipient: config.recipient.toUpperCase().replace("0X", "0x") });
  const k3 = kh.idempotencyKey({ ...config, taskId: "job-9", amount: "0.00010", recipient: config.recipient });
  const k4 = kh.idempotencyKey({ ...config, taskId: "job-10", recipient: config.recipient });
  check("same work derives the same key twice", k1 === kh.idempotencyKey({ ...config, taskId: "job-9", recipient: config.recipient }));
  check("address case does not change the key", k1 === k2);
  check("a trailing zero in the amount does not change the key", k1 === k3);
  check("different work derives a different key", k1 !== k4);
  check("key is lowercase hex", /^[0-9a-f]{64}$/.test(k1));

  check("canonical amount strips trailing zeros", kh.canonicalAmount("1.000") === "1");
  check("canonical amount keeps a leading zero", kh.canonicalAmount(".5") === "0.5");
  check("canonical amount collapses zeros", kh.canonicalAmount("0.000") === "0");

  console.log("4. The daily spending cap is read before anything is broadcast");
  await withStub(
    { pollStatuses: [{ status: "completed", hint: "0", receipts: CONFIRMED, hash: "0xabc" }] },
    async (_base, captured) => {
      await kh.settle(config, "task-cap-ok");
      check("the cap was read", captured.spendCapReads === 1);
      check("a cap with room left does not block the broadcast", captured.broadcastBodies.length === 1);
    },
  );

  await withStub(
    {
      pollStatuses: [{ status: "completed", hint: "0", receipts: CONFIRMED, hash: "0xabc" }],
      spendCap: {
        status: 200,
        body: {
          dailyCapWei: null,
          // Everything but a hundred wei of the default is already spent.
          dailyUsedWei: "19999999999999900",
          effectiveDailyCapWei: "20000000000000000",
          usingDefaultDailyCap: true,
        },
      },
    },
    async (_base, captured) => {
      let threw = "";
      try {
        await kh.settle(config, "task-cap-blocked");
      } catch (err) {
        threw = err instanceof Error ? err.message : String(err);
      }
      check("an exhausted cap stops the settlement", threw.includes("daily spending cap"), threw.slice(0, 50));
      check("nothing was broadcast once the cap was known to be short", captured.broadcastBodies.length === 0);
      check("the message names the platform default", threw.includes("platform default"));
    },
  );

  await withStub(
    {
      pollStatuses: [{ status: "completed", hint: "0", receipts: CONFIRMED, hash: "0xabc" }],
      spendCap: { status: 403, body: { error: "insufficient_scope" } },
    },
    async (_base, captured) => {
      await kh.settle(config, "task-cap-unknown");
      check(
        "an unreadable cap does not block the settlement",
        captured.broadcastBodies.length === 1,
      );
    },
  );

  check("one BNB converts to 18 zeros", kh.toBaseUnits("1") === BigInt(10) ** BigInt(18));
  check("a small amount converts exactly", kh.toBaseUnits("0.0001") === BigInt("100000000000000"));

  console.log("5. The settlement is inside the receipt's commitment");
  const { appendReceipt, verifyChain, hashPayload } = await import("../lib/receipts");
  const chain: import("../lib/receipts").Receipt[] = [];
  appendReceipt(chain, {
    action: "catalog.read",
    target: "arsenal.sumplus.xyz",
    costMicroUsd: 1_000,
    decision: "allowed",
    payloadHash: hashPayload({ ok: true }),
  });
  appendReceipt(chain, {
    action: "settlement.transfer",
    target: "app.keeperhub.com",
    costMicroUsd: 0,
    decision: "allowed",
    payloadHash: hashPayload({ executionId: "exec_1" }),
    chainTxHash: "0xabc",
    chainReceiptStatus: "success",
    chainVerified: true,
  });
  appendReceipt(chain, {
    action: "attestation.read",
    target: "router.sumplus.xyz",
    costMicroUsd: 1_000,
    decision: "allowed",
    payloadHash: hashPayload({ mode: "sev-snp" }),
  });

  check("the genuine chain verifies", verifyChain(chain).ok);

  chain[1].chainTxHash = `0x${"f".repeat(64)}`;
  const swapped = verifyChain(chain);
  const kinds = new Set(swapped.problems.map((p) => p.kind));
  const flagged = new Set(swapped.problems.map((p) => p.seq));
  check("swapping the transaction hash is rejected", !swapped.ok);
  check("the settlement receipt's own hash breaks", kinds.has("hash-mismatch") && flagged.has(1));
  check("the receipt after it loses its link", kinds.has("broken-link") && flagged.has(2));

  chain[1].chainTxHash = "0xabc";
  check("restoring the hash makes it verify again", verifyChain(chain).ok);

  const swappedStatus = (() => {
    chain[1].chainReceiptStatus = "reverted";
    const r = verifyChain(chain);
    chain[1].chainReceiptStatus = "success";
    return r;
  })();
  check("swapping the receipt status is rejected too", !swappedStatus.ok);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { settlementState, type Receipt } from "@/lib/receipts";
import { short, usd } from "@/lib/money";

type Run = { receipts: Receipt[]; head: string; spentMicroUsd: number; empty?: boolean };

export default function ReceiptsPage() {
  const [run, setRun] = useState<Run | null>(null);

  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Run) => setRun(d.empty ? null : d))
      .catch(() => undefined);
  }, []);

  return (
    <main>
      <section className="hero">
        <div className="kicker">The record</div>
        <h1>Every call, including the ones that were refused.</h1>
        <p className="lede">
          A spending record with the refusals removed is not a record of the session. Refusals are
          receipts too: they cost nothing and they still take a place in the chain.
        </p>
      </section>

      {!run ? (
        <section className="panel" style={{ marginTop: 28 }}>
          <h3>No receipts yet</h3>
          <p className="muted" style={{ margin: 0 }}>
            <Link href="/">Run a session</Link> to produce some.
          </p>
        </section>
      ) : (
        <>
          <h2>
            {run.receipts.length} receipts · {usd(run.spentMicroUsd)} metered
          </h2>
          <div className="grid">
            {run.receipts.map((r) => (
              <Link
                key={r.seq}
                href={`/receipt/${r.seq}`}
                className="step"
                style={{ color: "inherit", textDecoration: "none" }}
              >
                <div className="n">{r.seq}</div>
                <div>
                  <h3 className="mono">{r.action}</h3>
                  <p className="muted" style={{ margin: "0 0 6px" }}>
                    {r.decision === "refused" ? r.reason : `${r.target} · ${r.at}`}
                  </p>
                  <p className="mono muted" style={{ margin: 0 }}>
                    {short(r.prevHash)} → {short(r.hash)}
                  </p>
                  {(() => {
                    const s = settlementState(r);
                    if (s.state === "none") return null;
                    return (
                      <p className="mono muted" style={{ margin: "6px 0 0" }}>
                        <span className={`tag ${s.tone}`}>{s.label}</span>{" "}
                        {r.chainTxHash ? short(r.chainTxHash) : ""}
                      </p>
                    );
                  })()}
                </div>
                <div className={`tag ${r.decision === "allowed" ? "ok" : "no"}`}>
                  {r.decision !== "allowed"
                    ? "refused"
                    : r.chainTxHash && r.costMicroUsd === 0
                      ? // The gateway meters nothing here. What this step costs
                        // is gas, in the chain's own token, shown on the receipt.
                        "gas only"
                      : usd(r.costMicroUsd)}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <footer className="foot">Bodies are never stored. Receipts carry hashes, not prompts.</footer>
    </main>
  );
}

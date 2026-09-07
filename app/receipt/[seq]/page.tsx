"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import type { Receipt } from "@/lib/receipts";
import { usd } from "@/lib/money";

type Run = { receipts: Receipt[]; empty?: boolean };

export default function ReceiptPage({ params }: { params: Promise<{ seq: string }> }) {
  const { seq } = use(params);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Run) => {
        if (d.empty) return setMissing(true);
        const found = d.receipts.find((r) => String(r.seq) === seq);
        if (found) setReceipt(found);
        else setMissing(true);
      })
      .catch(() => setMissing(true));
  }, [seq]);

  if (missing) {
    return (
      <main>
        <section className="hero">
          <h1>That receipt is not in this session.</h1>
          <p className="lede">
            Sessions are held in memory, so a restart clears them.{" "}
            <Link href="/">Run a new one</Link>.
          </p>
        </section>
      </main>
    );
  }

  if (!receipt) return <main><section className="hero"><h1>Loading the receipt.</h1></section></main>;

  const rows: [string, string][] = [
    ["Sequence", String(receipt.seq)],
    ["Recorded at", receipt.at],
    ["Action", receipt.action],
    ["Target", receipt.target],
    ["Decision", receipt.decision],
    ["Metered", receipt.decision === "allowed" ? usd(receipt.costMicroUsd) : "nothing, the call did not run"],
  ];

  return (
    <main>
      <section className="hero">
        <div className="kicker">Receipt {receipt.seq}</div>
        <h1 className="mono" style={{ fontSize: 26 }}>
          {receipt.action}
        </h1>
        <p className="lede">
          {receipt.decision === "refused"
            ? receipt.reason
            : "This call ran, and these are the bytes its hash commits to."}
        </p>
      </section>

      <h2>Fields</h2>
      <div className="panel scroll-x">
        <table>
          <tbody>
            {rows.map(([k, val]) => (
              <tr key={k}>
                <th style={{ width: 160 }}>{k}</th>
                <td>{val}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Hashes</h2>
      <div className="panel">
        <p style={{ margin: "0 0 4px" }} className="muted">
          Payload
        </p>
        <p className="mono" style={{ margin: "0 0 14px" }}>
          {receipt.payloadHash}
        </p>
        <p style={{ margin: "0 0 4px" }} className="muted">
          Previous receipt
        </p>
        <p className="mono" style={{ margin: "0 0 14px" }}>
          {receipt.prevHash}
        </p>
        <p style={{ margin: "0 0 4px" }} className="muted">
          This receipt
        </p>
        <p className="mono" style={{ margin: 0 }}>
          {receipt.hash}
        </p>
      </div>

      <div className="callout">
        The hash covers every field above in a fixed order. Change one of them and this value
        changes, which is what the <Link href="/verify">verifier</Link> looks for.
      </div>

      <footer className="foot">
        <Link href="/receipts">Back to the record</Link>
      </footer>
    </main>
  );
}

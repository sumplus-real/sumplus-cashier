"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Receipt, VerifyProblem } from "@/lib/receipts";
import { short } from "@/lib/money";

type Verification = {
  ok: boolean;
  length: number;
  head: string;
  problems: VerifyProblem[];
  receipts: Receipt[];
  empty?: boolean;
};

export default function VerifyPage() {
  const [v, setV] = useState<Verification | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/verify", { cache: "no-store" });
    const data = (await res.json()) as Verification;
    setV(data.empty ? null : data);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  async function edit(seq: number) {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/tamper", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seq, field: "costMicroUsd" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "edit failed");
      setNote(`Receipt ${seq} was edited: one dollar was added to its cost. Nothing else changed.`);
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <section className="hero">
        <div className="kicker">Negative control</div>
        <h1>A check that always passes proves nothing.</h1>
        <p className="lede">
          This page recomputes every receipt hash from the receipt contents and re-links the chain.
          It trusts none of the stored hashes. Edit any receipt below and the check has to fail, or
          the check was never worth running.
        </p>
      </section>

      {!v && (
        <section className="panel" style={{ marginTop: 28 }}>
          <h3>No session to verify</h3>
          <p className="muted" style={{ margin: 0 }}>
            <Link href="/">Run a session</Link> first, then come back.
          </p>
        </section>
      )}

      {v && (
        <>
          <h2>Result</h2>
          <div className="panel">
            <p style={{ margin: "0 0 8px" }}>
              <span className={`tag ${v.ok ? "ok" : "bad"}`}>
                {v.ok ? "chain intact" : "chain broken"}
              </span>{" "}
              <span className="muted">
                {v.length} receipts, head <span className="mono">{short(v.head)}</span>
              </span>
            </p>
            {v.ok ? (
              <p className="muted" style={{ margin: 0 }}>
                Every receipt hashes to the value it claims, and every receipt points at the one
                before it.
              </p>
            ) : (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {v.problems.map((p, i) => (
                  <li key={i} style={{ color: "var(--bad)", marginBottom: 4 }}>
                    Receipt {p.seq}: {p.detail}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {note && <div className="callout bad">{note}</div>}

          <h2>Receipts</h2>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Action</th>
                  <th>Decision</th>
                  <th>Hash</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {v.receipts.map((r) => (
                  <tr key={r.seq}>
                    <td>{r.seq}</td>
                    <td className="mono">{r.action}</td>
                    <td>
                      <span className={`tag ${r.decision === "allowed" ? "ok" : "no"}`}>
                        {r.decision}
                      </span>
                    </td>
                    <td className="mono">{short(r.hash)}</td>
                    <td>
                      <button className="btn danger" disabled={busy} onClick={() => edit(r.seq)}>
                        Edit this receipt
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="callout">
            An edit surfaces twice. The receipt no longer hashes to the value it carries, and the
            receipt after it now points at a hash that nothing produces. You cannot fix the first
            without moving the second, which is the property that makes the record worth keeping.
          </div>
        </>
      )}

      <footer className="foot">
        Command line equivalent: <span className="mono">npm run negative-control</span>
      </footer>
    </main>
  );
}

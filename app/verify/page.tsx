"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { settlementState, type Receipt, type VerifyProblem } from "@/lib/receipts";
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
  const [clean, setClean] = useState<Verification | null>(null);
  /** The edited copy, when the demonstration control has been used. */
  const [edited, setEdited] = useState<Verification | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/verify", { cache: "no-store" });
    const data = (await res.json()) as Verification;
    setClean(data.empty ? null : data);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  // What the page is showing: the session's own record, or the edited copy.
  const v = edited ?? clean;

  async function edit(seq: number, field: "costMicroUsd" | "chainTxHash") {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/tamper", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seq, field }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "edit failed");
      setEdited({ ...data.verification, receipts: data.receipts });
      setNote(
        `Showing a copy in which ${data.note}. The session's own receipts are unchanged, and this copy is discarded when you restore it.`,
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function restore() {
    setEdited(null);
    setNote("");
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
              </span>{" "}
              <span className={`tag ${edited ? "no" : "ok"}`}>
                {edited ? "edited copy" : "the session as it ran"}
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
          <p className="muted" style={{ margin: "-6px 0 12px" }}>
            The buttons below are a demonstration control. They edit a copy of this session&apos;s
            record so you can watch the check fail. Nothing stored is modified, and{" "}
            <strong>Restore the real record</strong> brings the page back to the session as it ran.
          </p>
          {edited && (
            <p style={{ margin: "0 0 12px" }}>
              <button className="btn" onClick={restore}>
                Restore the real record
              </button>
            </p>
          )}
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Action</th>
                  <th>Decision</th>
                  <th>On chain</th>
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
                    <td>
                      {(() => {
                        const s = settlementState(r);
                        return s.state === "none" ? (
                          <span className="muted">off chain</span>
                        ) : (
                          <span className={`tag ${s.tone}`}>{s.label}</span>
                        );
                      })()}
                    </td>
                    <td className="mono">{short(r.hash)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button
                        className="btn danger"
                        disabled={busy}
                        onClick={() => edit(r.seq, "costMicroUsd")}
                      >
                        Edit the cost
                      </button>
                      {r.chainTxHash && (
                        <button
                          className="btn danger"
                          style={{ marginLeft: 8 }}
                          disabled={busy}
                          onClick={() => edit(r.seq, "chainTxHash")}
                        >
                          Swap the transaction hash
                        </button>
                      )}
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

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Receipt } from "@/lib/receipts";
import { short, usd } from "@/lib/money";

type Step = {
  action: string;
  host: string;
  label: string;
  evidence?: string;
  receipt: Receipt;
};

type Run = {
  id: string;
  startedAt: string;
  policy: {
    perCallMicroUsd: number;
    sessionMicroUsd: number;
    allowedHosts: string[];
    allowedActions: string[];
  };
  steps: Step[];
  spentMicroUsd: number;
  head: string;
  anchor: {
    rekor: { log_index: number; rekor_url: string; uuid: string };
  } | null;
  empty?: boolean;
};

export default function Home() {
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/session", { cache: "no-store" });
    const data = (await res.json()) as Run;
    if (!data.empty) setRun(data);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "The session did not run.");
      setRun(data as Run);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const refused = run?.steps.filter((s) => s.receipt.decision === "refused").length ?? 0;

  return (
    <main>
      <section className="hero">
        <div className="kicker">Sumplus</div>
        <h1>An agent that spends money, and a record you can check yourself.</h1>
        <p className="lede">
          Give an agent a budget and it will spend it. The cashier sits in front of every call it
          makes: the policy decides before the money moves, and each call leaves a receipt. The
          receipts are chained, so a stranger can recompute the whole record from the receipts alone
          and catch a single edited digit.
        </p>
        <div className="actions">
          <button className="btn" onClick={start} disabled={busy}>
            {busy ? "Running the session…" : run ? "Run it again" : "Run a session"}
          </button>
          <Link className="btn ghost" href="/verify">
            Verify the record
          </Link>
        </div>
        {error && (
          <div className="callout bad" style={{ marginTop: 18 }}>
            {error}
          </div>
        )}
      </section>

      {!run && (
        <section className="panel" style={{ marginTop: 28 }}>
          <h3>Nothing has been spent yet</h3>
          <p className="muted" style={{ margin: 0 }}>
            Press <b>Run a session</b>. The agent reads the Sumplus execution catalogue, searches it,
            asks the gateway to prove what hardware it is running on, and then tries two calls the
            policy has to refuse. Every call above is a live request to production, not a recording.
          </p>
        </section>
      )}

      {run && busy && (
        <div className="callout">
          Running a new session against production. Everything below is still the previous run until
          it finishes.
        </div>
      )}

      {run && (
        <div style={busy ? { opacity: 0.45, transition: "opacity .15s" } : undefined}>
          <h2>What the policy allowed</h2>
          <div className="grid three">
            <div className="stat">
              <b>{usd(run.spentMicroUsd)}</b>
              <span>metered this session, cap {usd(run.policy.sessionMicroUsd)}</span>
            </div>
            <div className="stat">
              <b>{refused}</b>
              <span>calls refused before they ran</span>
            </div>
            <div className="stat">
              <b>{run.steps.length}</b>
              <span>receipts, head {short(run.head, 6)}</span>
            </div>
          </div>

          <h2>The session, call by call</h2>
          <div className="grid">
            {run.steps.map((s) => {
              const no = s.receipt.decision === "refused";
              return (
                <div className={`step${no ? " refused" : ""}`} key={s.receipt.seq}>
                  <div className="n">{s.receipt.seq}</div>
                  <div>
                    <h3>{s.label}</h3>
                    <p className="muted" style={{ margin: "0 0 6px" }}>
                      <span className="mono">{s.action}</span> to{" "}
                      <span className="mono">{s.host}</span>
                    </p>
                    {no ? (
                      <p style={{ margin: 0, color: "var(--warn)" }}>{s.receipt.reason}</p>
                    ) : (
                      <p className="muted" style={{ margin: 0 }}>
                        {s.evidence}
                      </p>
                    )}
                    <p className="mono muted" style={{ margin: "8px 0 0" }}>
                      receipt {short(s.receipt.hash)}
                    </p>
                  </div>
                  <div className={`tag ${no ? "no" : "ok"}`}>
                    {no ? "refused" : usd(s.receipt.costMicroUsd)}
                  </div>
                </div>
              );
            })}
          </div>

          <h2>Where the record is anchored</h2>
          <div className="panel">
            {run.anchor ? (
              <>
                <p style={{ margin: "0 0 10px" }}>
                  The Sumplus gateway publishes the head of its own call chain to Sigstore Rekor, a
                  public transparency log that Sumplus does not operate. Entry{" "}
                  <b>{run.anchor.rekor.log_index}</b> is there right now.
                </p>
                <p className="mono muted" style={{ margin: "0 0 10px" }}>
                  {run.anchor.rekor.uuid}
                </p>
                <a
                  href={`https://search.sigstore.dev/?logIndex=${run.anchor.rekor.log_index}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Look the entry up on sigstore.dev
                </a>
              </>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                The anchor endpoint did not answer on this pass. The receipts above still verify on
                their own, because the chain is checked from the receipts, not from the anchor.
              </p>
            )}
          </div>

          <div className="callout">
            The interesting question is not whether this page says the record is intact. It is
            whether you can catch it lying. <Link href="/verify">Open the verifier</Link>, edit a
            receipt, and watch the check fail.
          </div>
        </div>
      )}

      <footer className="foot">
        Sumplus · Cashier · calls go to arsenal.sumplus.xyz and router.sumplus.xyz
      </footer>
    </main>
  );
}

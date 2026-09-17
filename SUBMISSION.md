# Submission — KeeperHub, The Agent Economy

**Project:** Sumplus Cashier
**Live:** https://sumplus-cashier-production.up.railway.app
**Event:** 2026-09-06 to 2026-09-18

## Elevator

An agent economy runs on agents spending money without a person watching each
call. That only works if two things hold: something decides before the money
moves, and something leaves a record afterwards that a stranger can check.
Cashier is both, running against live production services.

## The five-minute path

1. Open the live URL and press **Run a session**. Every call is a live request,
   not a recording.
2. Three calls run: the execution catalogue, a skill search, and the gateway's
   own hardware report.
3. Two are refused before they run, on two different rules: one exceeds the
   per-call ceiling, one reaches a host outside the allowlist. Each refusal
   carries a sentence.
4. Open **Verify**, press **Edit this receipt**, and the check fails.
5. Open **Attestation** and follow the link to Sigstore, where the anchor sits
   on a log the operator does not run.

## What is verifiable without trusting us

```bash
curl -s https://router.sumplus.xyz/attestation   # AMD SEV-SNP, mode "sev-snp"
curl -s https://router.sumplus.xyz/v1/rekor      # Sigstore Rekor entry 2688459202
npm run negative-control -- https://sumplus-cashier-production.up.railway.app
```

The negative control proves the verifier can fail. It accepts the genuine chain,
then edits one receipt and requires rejection, asserting both halves of the
break: the receipt's own hash and the next receipt's link.

## Why this belongs in an agent economy

Payment rails for agents are being built. The part that is thin is what happens
either side of the payment: the mandate that decides whether a call may happen
at all, and the receipt that makes the spend auditable afterwards by someone
who was not there. Cashier is that pair, and refusals are receipts too, because
a spending record with the refusals removed is not a record of the session.

## Notes

- Money moves. An allowed spend settles through KeeperHub on BNB Chain testnet
  and the chain-verified receipt is written into the receipt chain. Every other
  call is a read against production.
- Prompt and response bodies are never stored. Receipts carry hashes, costs and
  metadata.
- A ceiling of zero is a stop, never "no ceiling".

import { NextResponse } from "next/server";
import { tamperedView } from "@/lib/session";
import { verifyChain } from "@/lib/receipts";

export const dynamic = "force-dynamic";

/**
 * Returns a copy of the session's chain with one receipt edited, so the verify
 * page can show the check failing. The stored receipts are not modified: this
 * is a demonstration control, and a demonstration that damages the record it is
 * demonstrating would leave every later visitor looking at a broken chain.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      seq?: number;
      field?: "costMicroUsd" | "target" | "chainTxHash";
    };
    const { receipts, edited, note } = tamperedView(body.seq ?? 0, body.field ?? "costMicroUsd");
    return NextResponse.json({
      edited,
      note,
      receipts,
      verification: verifyChain(receipts),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "edit failed" },
      { status: 400 },
    );
  }
}

import { NextResponse } from "next/server";
import { getSession, tamper } from "@/lib/session";
import { verifyChain } from "@/lib/receipts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      seq?: number;
      field?: "costMicroUsd" | "target";
    };
    const edited = tamper(body.seq ?? 0, body.field ?? "costMicroUsd");
    const run = getSession();
    return NextResponse.json({
      edited,
      verification: run ? verifyChain(run.receipts) : null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "edit failed" },
      { status: 400 },
    );
  }
}

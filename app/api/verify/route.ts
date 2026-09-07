import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { verifyChain } from "@/lib/receipts";

export const dynamic = "force-dynamic";

export async function GET() {
  const run = getSession();
  if (!run) return NextResponse.json({ empty: true });
  return NextResponse.json({ ...verifyChain(run.receipts), receipts: run.receipts });
}

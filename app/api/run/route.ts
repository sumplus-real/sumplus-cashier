import { NextResponse } from "next/server";
import { runSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const run = await runSession();
    return NextResponse.json(run);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "run failed" },
      { status: 500 },
    );
  }
}

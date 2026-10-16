// app/api/yield/grade/route.ts — A–F risk grade for one way to earn on XRP or RLUSD, from the XRP Yield Desk
// (xrplhub.io/yield, same owner). $0.02 via x402 (middleware.ts), or with an XRPLHub Pro key. Unknown ids are
// answered by the middleware before the paywall, so nobody pays for a 404.
import { NextResponse } from "next/server";
import { fetchYieldGrade, YIELD_ID } from "@/lib/yield-desk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!YIELD_ID.test(id)) return NextResponse.json({ error: "bad_request", message: "id must be an option id from https://www.xrplhub.io/api/yield/options." }, { status: 400 });
  try {
    const g = await fetchYieldGrade(id);
    if (!g) return NextResponse.json({ error: "not_found", message: "No Yield Desk option with that id." }, { status: 404 });
    return NextResponse.json(g, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[yield/grade]", (e as Error).message);
    return NextResponse.json({ error: "source_unavailable", message: "The Yield Desk data can't be reached right now. Try again in a minute." }, { status: 503, headers: { "Retry-After": "60" } });
  }
}

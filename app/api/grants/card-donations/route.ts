// app/api/grants/card-donations/route.ts — every card donation to the XRPLHub grants pool: amount, card fee, net,
// date. Public (xrplhub.io/grants/ledger shows it). No names, emails or payment details.
import { NextResponse } from "next/server";
import { listCardDonations } from "@/lib/grants-donations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const donations = await listCardDonations();
    return NextResponse.json({ donations }, { headers: { "Cache-Control": "public, s-maxage=120", "Access-Control-Allow-Origin": "*" } });
  } catch (e) {
    console.error("[grants/card-donations]", (e as Error).message);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

// app/api/billing/entitlement/route.ts — read-only "what does this key pay for?" for xrplhub.io's Lending Pro
// routes (history, grade-change webhooks). The key is the secret: send it as `Authorization: Bearer uxus_...`.
// Never counts toward quota and never returns the key itself.
import { NextResponse } from "next/server";
import { entitlementForKey, KEY_FORMAT } from "@/lib/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const m = (req.headers.get("authorization") || "").match(/^Bearer\s+(\S+)$/);
  if (!m || !KEY_FORMAT.test(m[1])) {
    return NextResponse.json({ error: "missing_key", message: "Send your uxus API key as Authorization: Bearer uxus_..." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const e = await entitlementForKey(m[1]);
  if (!e) return NextResponse.json({ error: "invalid_key", message: "API key not recognized." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(e, { headers: { "Cache-Control": "no-store" } });
}

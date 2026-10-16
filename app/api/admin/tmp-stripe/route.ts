// app/api/admin/tmp-stripe/route.ts — TEMPORARY. Creates the XRPL Lending Pro product and its $49/month price
// in the live Stripe account (idempotent via the price lookup_key). Gated on a one-time token (only its
// SHA-256 is here). Deleted in the next commit.
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_SHA256 = "c6314813d55f8ed9979ff24a96db350ff22634791362e0a39e962599fb54c566";
const LOOKUP_KEY = "uxus_lending_pro_monthly";

function authorized(req: Request): boolean {
  const given = createHash("sha256").update(req.headers.get("x-admin-token") ?? "").digest();
  return timingSafeEqual(given, Buffer.from(TOKEN_SHA256, "hex"));
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const existing = await stripe().prices.list({ lookup_keys: [LOOKUP_KEY], expand: ["data.product"], limit: 1 });
    let price = existing.data[0];
    let created = false;
    if (!price) {
      const product = await stripe().products.create({
        name: "UXUS Lending Pro",
        description: "A–F risk grades for XRP Ledger lending vaults and loan brokers: 20,000 grade API calls a month, full grade history and grade-change webhook alerts. Risk grades from on-ledger data only — not credit ratings.",
        metadata: { plan: "lending_pro" },
      });
      price = await stripe().prices.create({
        product: product.id,
        currency: "usd",
        unit_amount: 4900,
        recurring: { interval: "month" },
        lookup_key: LOOKUP_KEY,
        metadata: { plan: "lending_pro" },
      });
      created = true;
    }
    return NextResponse.json({
      created,
      price: { id: price.id, unit_amount: price.unit_amount, currency: price.currency, interval: price.recurring?.interval, livemode: price.livemode, active: price.active },
      product: typeof price.product === "string" ? price.product : price.product.id,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

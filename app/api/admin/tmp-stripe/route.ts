// app/api/admin/tmp-stripe/route.ts — TEMPORARY. Creates the XRPLHub Pro product and its $49/month price in the
// live Stripe account (idempotent via the price lookup_key), and archives the old "UXUS Lending Pro" price and
// product (existing subscriptions on an archived price keep working; it just can't be bought again).
// Gated on a one-time token (only its SHA-256 is here). Deleted in the next commit.
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_SHA256 = "9debafa8d15e7b1e3e460262a2e9c018f884ca9adf335f6061335353a064755a";
const LOOKUP_KEY = "uxus_xrplhub_pro_monthly";
const OLD_PRICE = "price_1URAofRoquiH1GTZCgWWeul3";

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
        name: "XRPLHub Pro",
        description: "Risk-grade alerts for the XRP Yield Desk and XRPL lending on xrplhub.io: webhook alerts when a grade changes and 20,000 yield_grade / lending_grade API calls a month. Risk grades from public data — general information, not advice, not credit ratings.",
        metadata: { plan: "xrplhub_pro" },
      });
      price = await stripe().prices.create({
        product: product.id,
        currency: "usd",
        unit_amount: 4900,
        recurring: { interval: "month" },
        lookup_key: LOOKUP_KEY,
        metadata: { plan: "xrplhub_pro" },
      });
      created = true;
    }
    // Archive the old Lending Pro price and its product.
    const old = await stripe().prices.retrieve(OLD_PRICE);
    const archived: Record<string, string> = {};
    if (old.active) {
      await stripe().prices.update(OLD_PRICE, { active: false });
      archived.price = OLD_PRICE;
    }
    const oldProductId = typeof old.product === "string" ? old.product : old.product.id;
    const oldProduct = await stripe().products.retrieve(oldProductId);
    if (oldProduct.active) {
      await stripe().products.update(oldProductId, { active: false });
      archived.product = oldProductId;
    }
    const oldSubs = await stripe().subscriptions.list({ price: OLD_PRICE, status: "all", limit: 10 });
    return NextResponse.json({
      created,
      price: { id: price.id, unit_amount: price.unit_amount, currency: price.currency, interval: price.recurring?.interval, livemode: price.livemode, active: price.active },
      product: typeof price.product === "string" ? price.product : price.product.id,
      archived,
      oldPrice: { active: (await stripe().prices.retrieve(OLD_PRICE)).active, subscriptions: oldSubs.data.length },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

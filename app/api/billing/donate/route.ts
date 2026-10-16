// app/api/billing/donate/route.ts — "Donate by card" for the XRPLHub grants pool. POST { amountUsd } → a one-off
// Stripe Checkout session URL. The donor picks the amount ($5–$10,000). Recorded by the verified webhook
// (lib/grants-donations.ts). xrplhub.io calls this from its own server (/api/grants/donate-card), never the browser.
import { NextResponse } from "next/server";
import { stripe, STRIPE_ENABLED } from "@/lib/stripe";
import { DONATION_KIND, DONATION_MIN_USD, DONATION_MAX_USD, DONATION_DISCLOSURE } from "@/lib/grants-donations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GRANTS = "https://www.xrplhub.io/grants";

export async function POST(req: Request) {
  if (!STRIPE_ENABLED) return NextResponse.json({ error: "billing_disabled", message: "Card payments aren't set up." }, { status: 501 });
  const b = (await req.json().catch(() => ({}))) as { amountUsd?: unknown };
  const usd = Math.round(Number(b.amountUsd) * 100) / 100;
  if (!Number.isFinite(usd) || usd < DONATION_MIN_USD || usd > DONATION_MAX_USD) {
    return NextResponse.json({ error: "bad_amount", message: `Choose an amount from $${DONATION_MIN_USD} to $${DONATION_MAX_USD.toLocaleString("en-US")}.` }, { status: 400 });
  }
  try {
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      submit_type: "donate",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(usd * 100),
          product_data: { name: "Donation to the XRPLHub grants pool", description: DONATION_DISCLOSURE },
        },
      }],
      success_url: `${GRANTS}?donated=card`,
      cancel_url: GRANTS,
      metadata: { kind: DONATION_KIND },
      payment_intent_data: { metadata: { kind: DONATION_KIND }, description: "Donation to the XRPLHub grants pool (not tax-deductible)" },
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("[billing/donate]", (e as Error).message);
    return NextResponse.json({ error: "checkout_failed", message: "Couldn't start the card payment. Try again in a minute." }, { status: 502 });
  }
}

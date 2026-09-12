// app/api/billing/checkout/route.ts — creates a Stripe Checkout session for
// a subscription plan. Gated on STRIPE_ENABLED: 501 until both
// STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set (see lib/stripe.ts for
// why it's both, not just the secret key).
import { NextResponse } from "next/server";
import { stripe, STRIPE_ENABLED, priceIdFor, isPlanId } from "@/lib/stripe";
import { SITE_URL } from "@/lib/legal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!STRIPE_ENABLED) {
    return NextResponse.json({ error: "billing_disabled", message: "Billing is not yet configured." }, { status: 501 });
  }

  let body: { plan?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const plan = body.plan;
  if (!isPlanId(plan)) {
    return NextResponse.json({ error: "bad_request", message: "plan must be 'starter' or 'pro'." }, { status: 400 });
  }

  const priceId = priceIdFor(plan);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${SITE_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE_URL}/pricing`,
    metadata: { plan },
    subscription_data: { metadata: { plan } },
  });

  return NextResponse.json({ url: session.url });
}

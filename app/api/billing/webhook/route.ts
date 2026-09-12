// app/api/billing/webhook/route.ts — Stripe webhook receiver.
//
// Signature verification is non-negotiable: an unverified endpoint here mints
// free API keys for anyone who finds the URL and POSTs a fake
// checkout.session.completed body. stripe().webhooks.constructEvent is the
// ONLY way an event reaches handleStripeEvent — there is no code path that
// calls it with an unverified body.
import { NextResponse } from "next/server";
import { stripe, STRIPE_ENABLED } from "@/lib/stripe";
import { handleStripeEvent } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // STRIPE_ENABLED requires both STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET
  // (lib/stripe.ts) — so `secret` below is guaranteed set whenever this
  // passes, but keep the explicit check as the one place that guarantee is
  // asserted rather than assumed.
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!STRIPE_ENABLED || !secret) {
    return NextResponse.json({ error: "billing_disabled", message: "Billing is not yet configured." }, { status: 501 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  // Raw body, byte-for-byte — Stripe's HMAC is computed over the exact bytes
  // sent. Next.js App Router route handlers don't auto-parse the body, so
  // .text() is safe here.
  const body = await req.text();

  let event;
  try {
    event = stripe().webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    return NextResponse.json({ error: "invalid_signature", message: (err as Error).message }, { status: 400 });
  }

  try {
    await handleStripeEvent(event);
  } catch (err) {
    // 500 so Stripe retries with backoff — don't swallow a real failure by
    // returning 200 for an event we didn't actually apply.
    console.error("stripe webhook handler failed:", event.type, err);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

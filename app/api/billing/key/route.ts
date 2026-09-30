// app/api/billing/key/route.ts — lets the post-checkout success page fetch
// the key the webhook minted. Looked up by Stripe Checkout session_id (a
// short-lived, Stripe-generated identifier), not by anything guessable.
import { NextResponse } from "next/server";
import { stripe, STRIPE_ENABLED } from "@/lib/stripe";
import { keyForCustomer } from "@/lib/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!STRIPE_ENABLED) {
    return NextResponse.json({ error: "billing_disabled", message: "Billing is not yet configured." }, { status: 501 });
  }

  const sessionId = new URL(req.url).searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "bad_request", message: "session_id is required." }, { status: 400 });
  }

  let session;
  try {
    session = await stripe().checkout.sessions.retrieve(sessionId);
  } catch (e) {
    // Only a Stripe "no such resource" means the session id is wrong. Anything
    // else (Stripe outage, timeout) is transient — this customer may have just
    // paid, so tell the success page to keep trying instead of "not found".
    const err = e as { type?: string; code?: string };
    if (err?.type === "StripeInvalidRequestError" && err?.code === "resource_missing") {
      return NextResponse.json({ error: "not_found", message: "Unrecognized session_id." }, { status: 404 });
    }
    console.error("[billing/key] Stripe error", (e as Error)?.message ?? e);
    return NextResponse.json(
      { pending: true, error: "stripe_unavailable", message: "Payment provider is slow to respond — retrying." },
      { status: 503, headers: { "Retry-After": "10" } },
    );
  }

  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!customerId) {
    return NextResponse.json({ error: "not_found", message: "Session has no customer yet." }, { status: 404 });
  }

  const key = await keyForCustomer(customerId);
  if (!key) {
    // Webhook usually lands within a second or two of the redirect — the
    // success page polls this a few times before giving up.
    return NextResponse.json({ pending: true, message: "Provisioning — try again in a few seconds." }, { status: 202 });
  }

  return NextResponse.json(key);
}

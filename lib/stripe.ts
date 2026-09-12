// lib/stripe.ts — Stripe client + plan config.
//
// STRIPE_ENABLED requires BOTH STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET —
// deliberately, not just the secret key. If only the secret key were required,
// deploying this code with STRIPE_SECRET_KEY already in prod (as it is) would
// immediately expose a real, chargeable Checkout flow before the webhook that
// actually mints the key is wired up: a real card charge could succeed with
// no key ever minted. Requiring both means checkout stays "coming soon" /
// disabled until the webhook secret is also in place, so the two can never
// come live out of order.
import Stripe from "stripe";

export const STRIPE_ENABLED = !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET;

let _stripe: Stripe | null = null;
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!_stripe) _stripe = new Stripe(key);
  return _stripe;
}

export type PlanId = "starter" | "pro";

// quota = "screens"/month, matches the /pricing page copy exactly.
// Price IDs are real Stripe price identifiers, not secrets — hardcoding them
// is fine (this is how Stripe's own docs embed them in client code) and
// means going live needs no extra env vars beyond the two above.
export const PLANS: Record<PlanId, { name: string; quota: number; priceId: string }> = {
  starter: { name: "Starter", quota: 5_000, priceId: "price_1UEgZXRoquiH1GTZH8j0yJfE" },
  pro: { name: "Pro", quota: 25_000, priceId: "price_1UEgbQRoquiH1GTZlAlmQkG0" },
};

export function isPlanId(v: unknown): v is PlanId {
  return v === "starter" || v === "pro";
}

export function priceIdFor(plan: PlanId): string {
  return PLANS[plan].priceId;
}

// Reverse lookup: which of our plans does this Stripe price ID belong to.
export function planFromPriceId(priceId: string | undefined | null): PlanId | null {
  if (!priceId) return null;
  for (const p of Object.keys(PLANS) as PlanId[]) {
    if (PLANS[p].priceId === priceId) return p;
  }
  return null;
}

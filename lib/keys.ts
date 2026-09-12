// lib/keys.ts — Stripe-subscription-backed API keys. Stripe drives plan
// state (mint/sync/deactivate below only ever run from a verified Stripe
// webhook event); guard() is the one place quota is enforced. There is no
// second quota system — every quota-gated route calls guard() and nothing
// else.
//
// Keys are stored RAW, matching this repo's existing shield_sessions.token
// convention (lib/shield.ts) rather than introducing a new hashed-token
// pattern. guard() is a direct equality lookup.
import { randomBytes } from "node:crypto";
import { sql } from "@/lib/db";
import { PLANS, type PlanId } from "@/lib/stripe";

function generateKey(): string {
  return `uxus_${randomBytes(24).toString("hex")}`;
}

export const KEY_FORMAT = /^uxus_[0-9a-f]{48}$/;

export interface MintedKey {
  api_key: string;
  plan: PlanId;
  quota_limit: number;
  period_end: string;
}

// Mint (or re-mint, if this subscription already had a key — e.g. a replayed
// webhook) the key for a subscription. One row per stripe_subscription_id.
export async function mintKey(opts: {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  plan: PlanId;
  periodStart: Date;
  periodEnd: Date;
}): Promise<MintedKey> {
  const quota = PLANS[opts.plan].quota;
  const existing = (await sql`
    SELECT key FROM api_keys WHERE stripe_subscription_id = ${opts.stripeSubscriptionId}
  `) as { key: string }[];
  const key = existing[0]?.key ?? generateKey();

  await sql`
    INSERT INTO api_keys (key, stripe_customer_id, stripe_subscription_id, plan, status, quota_limit, usage_count, period_start, period_end)
    VALUES (${key}, ${opts.stripeCustomerId}, ${opts.stripeSubscriptionId}, ${opts.plan}, 'active', ${quota}, 0, ${opts.periodStart.toISOString()}, ${opts.periodEnd.toISOString()})
    ON CONFLICT (stripe_subscription_id) DO UPDATE SET
      stripe_customer_id = EXCLUDED.stripe_customer_id,
      plan = EXCLUDED.plan,
      status = 'active',
      quota_limit = EXCLUDED.quota_limit,
      period_start = EXCLUDED.period_start,
      period_end = EXCLUDED.period_end,
      updated_at = now()
  `;
  return { api_key: key, plan: opts.plan, quota_limit: quota, period_end: opts.periodEnd.toISOString() };
}

// Called from customer.subscription.updated. Syncs status/plan/period from
// Stripe's own subscription object — Stripe's dunning/retry configuration is
// the single source of truth for "past grace": a first failed payment moves
// Stripe's status to 'past_due', which is still the grace period (Stripe is
// retrying per its configured schedule) — the key stays active through that.
// Only once Stripe exhausts retries and moves the subscription to its
// terminal state ('canceled' or 'unpaid', per the dashboard's "failed
// payments" setting) does this deactivate the key. No separate grace-period
// timer of our own — whatever Stripe's dunning settings say "past grace"
// means is what drives this.
export async function syncSubscriptionStatus(opts: {
  stripeSubscriptionId: string;
  status: string;
  plan: PlanId;
  periodStart: Date;
  periodEnd: Date;
}): Promise<void> {
  const active = opts.status === "active" || opts.status === "trialing" || opts.status === "past_due";
  const rows = (await sql`
    SELECT period_start FROM api_keys WHERE stripe_subscription_id = ${opts.stripeSubscriptionId}
  `) as { period_start: string }[];
  if (!rows.length) return; // no key minted yet for this subscription (e.g. still incomplete) — nothing to sync
  const isNewPeriod = new Date(rows[0].period_start).getTime() !== opts.periodStart.getTime();

  await sql`
    UPDATE api_keys SET
      status = ${active ? "active" : "canceled"},
      plan = ${opts.plan},
      quota_limit = ${PLANS[opts.plan].quota},
      period_start = ${opts.periodStart.toISOString()},
      period_end = ${opts.periodEnd.toISOString()},
      usage_count = CASE WHEN ${isNewPeriod} THEN 0 ELSE usage_count END,
      updated_at = now()
    WHERE stripe_subscription_id = ${opts.stripeSubscriptionId}
  `;
}

// Called from customer.subscription.deleted.
export async function deactivateBySubscription(stripeSubscriptionId: string): Promise<void> {
  await sql`
    UPDATE api_keys SET status = 'canceled', updated_at = now()
    WHERE stripe_subscription_id = ${stripeSubscriptionId}
  `;
}

export async function keyForCustomer(customerId: string): Promise<MintedKey | null> {
  const rows = (await sql`
    SELECT key, plan, quota_limit, period_end FROM api_keys
    WHERE stripe_customer_id = ${customerId}
    ORDER BY created_at DESC LIMIT 1
  `) as { key: string; plan: PlanId; quota_limit: number; period_end: string }[];
  if (!rows.length) return null;
  const r = rows[0];
  return { api_key: r.key, plan: r.plan, quota_limit: r.quota_limit, period_end: r.period_end };
}

export type GuardResult =
  | { ok: true; plan: PlanId; remaining: number }
  | { ok: false; reason: "invalid_key" | "inactive" | "quota_exceeded"; message: string };

// The one place quota is enforced. Atomic UPDATE...RETURNING so concurrent
// requests can't both slip through on the last unit of quota (no separate
// check-then-increment — that would race).
export async function guard(rawKey: string): Promise<GuardResult> {
  const rows = (await sql`
    UPDATE api_keys
    SET usage_count = usage_count + 1, updated_at = now()
    WHERE key = ${rawKey} AND status = 'active' AND period_end > now() AND usage_count < quota_limit
    RETURNING plan, quota_limit, usage_count
  `) as { plan: PlanId; quota_limit: number; usage_count: number }[];

  if (rows.length) {
    const r = rows[0];
    return { ok: true, plan: r.plan, remaining: r.quota_limit - r.usage_count };
  }

  // Didn't qualify — look up why, for a clear (non-consuming) error message.
  const existing = (await sql`
    SELECT status, period_end, usage_count, quota_limit FROM api_keys WHERE key = ${rawKey}
  `) as { status: string; period_end: string; usage_count: number; quota_limit: number }[];

  if (!existing.length) {
    return { ok: false, reason: "invalid_key", message: "API key not recognized." };
  }
  const e = existing[0];
  if (e.status !== "active") {
    return { ok: false, reason: "inactive", message: `Subscription is ${e.status} — this key is deactivated.` };
  }
  if (new Date(e.period_end) <= new Date()) {
    return { ok: false, reason: "inactive", message: "Billing period has ended and has not renewed yet." };
  }
  return {
    ok: false,
    reason: "quota_exceeded",
    message: `Monthly quota of ${e.quota_limit} screens used for this billing period. Resets ${e.period_end}.`,
  };
}

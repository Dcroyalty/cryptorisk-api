// lib/grants-donations.ts — card donations to the XRPLHub grants pool (Morrbiz LLC's Stripe account).
//
// The donor picks the amount on xrplhub.io/grants; POST /api/billing/donate opens a one-off Stripe Checkout
// (metadata.kind = "grants_donation"). The verified Stripe webhook records each paid session here, with the card
// fee, so xrplhub.io can publish every donation and total them for the yearly $20,000 alert. The owner moves the
// net amount into the grants pool on the XRP Ledger; that payment is published there like every other one.
// Nothing here is a charitable receipt: Morrbiz LLC is a for-profit company and donations are not tax-deductible.
import type Stripe from "stripe";
import { sql } from "@/lib/db";
import { stripe } from "@/lib/stripe";

export const DONATION_KIND = "grants_donation";
export const DONATION_MIN_USD = 5;
export const DONATION_MAX_USD = 10_000;
export const DONATION_DISCLOSURE =
  "XRPLHub is run by Morrbiz LLC, a for-profit company. Donations are not tax-deductible. 100% of donations, after card fees, go to the grants pool. Every grant paid is published on the XRP Ledger.";

/** Card fee for a paid session (from the charge's balance transaction), or null if Stripe can't tell us yet. */
async function feeCents(session: Stripe.Checkout.Session): Promise<number | null> {
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!pi) return null;
  try {
    const intent = await stripe().paymentIntents.retrieve(pi, { expand: ["latest_charge.balance_transaction"] });
    const charge = intent.latest_charge as Stripe.Charge | null;
    const bt = charge?.balance_transaction as Stripe.BalanceTransaction | null;
    return typeof bt?.fee === "number" ? bt.fee : null;
  } catch {
    return null;
  }
}

/** Called from the verified webhook for checkout.session.completed with metadata.kind = grants_donation. */
export async function recordCardDonation(session: Stripe.Checkout.Session, fee: (s: Stripe.Checkout.Session) => Promise<number | null> = feeCents): Promise<void> {
  if (session.payment_status !== "paid" || typeof session.amount_total !== "number") return;
  const f = await fee(session);
  await sql`
    INSERT INTO card_donations (stripe_session_id, amount_cents, fee_cents, currency, created_at)
    VALUES (${session.id}, ${session.amount_total}, ${f}, ${session.currency ?? "usd"}, to_timestamp(${session.created}))
    ON CONFLICT (stripe_session_id) DO UPDATE SET fee_cents = COALESCE(card_donations.fee_cents, EXCLUDED.fee_cents)
  `;
}

export interface CardDonationRow { id: string; amount_usd: number; fee_usd: number | null; net_usd: number | null; received_at: string }

/** Public list: amounts and dates only (no names, emails or Stripe ids beyond a short reference). */
export async function listCardDonations(): Promise<CardDonationRow[]> {
  const rows = (await sql`SELECT stripe_session_id, amount_cents, fee_cents, created_at FROM card_donations ORDER BY created_at DESC LIMIT 1000`) as {
    stripe_session_id: string; amount_cents: number; fee_cents: number | null; created_at: string;
  }[];
  return rows.map((r) => ({
    id: r.stripe_session_id.slice(-8),
    amount_usd: r.amount_cents / 100,
    fee_usd: r.fee_cents == null ? null : r.fee_cents / 100,
    net_usd: r.fee_cents == null ? null : (r.amount_cents - r.fee_cents) / 100,
    received_at: new Date(r.created_at).toISOString(),
  }));
}

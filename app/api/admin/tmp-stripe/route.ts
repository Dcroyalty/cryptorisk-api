// app/api/admin/tmp-stripe/route.ts — TEMPORARY. One-off Stripe setup that has
// to run where the live key lives: report prices / webhook / portal state
// (GET) and create the hosted customer-portal configuration (POST). Gated on a
// one-time token (only its SHA-256 is here). Delete this file once it has run.
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { stripe, PLANS, type PlanId } from "@/lib/stripe";
import { SITE_URL } from "@/lib/legal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_SHA256 = "34df16346365e13f763ccd56686efea83de68e1af7192b3a292b03374aefe46f";

function authorized(req: Request): boolean {
  const given = createHash("sha256").update(req.headers.get("x-admin-token") ?? "").digest();
  return timingSafeEqual(given, Buffer.from(TOKEN_SHA256, "hex"));
}

const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

async function portalConfigs() {
  const list = await stripe().billingPortal.configurations.list({ limit: 20 });
  return list.data.map((c) => ({
    id: c.id,
    active: c.active,
    is_default: c.is_default,
    livemode: c.livemode,
    login_page: c.login_page,
    cancel: c.features.subscription_cancel,
    payment_method_update: c.features.payment_method_update.enabled,
    invoice_history: c.features.invoice_history.enabled,
  }));
}

export async function GET(req: Request) {
  if (!authorized(req)) return notFound();
  const out: Record<string, unknown> = { key_kind: (process.env.STRIPE_SECRET_KEY ?? "").slice(0, 7) };
  const attempt = async (name: string, fn: () => Promise<unknown>) => {
    try {
      out[name] = await fn();
    } catch (e) {
      out[name] = { error: (e as Error).message };
    }
  };
  await attempt("prices", async () => {
    const res: Record<string, unknown> = {};
    for (const plan of Object.keys(PLANS) as PlanId[]) {
      const p = await stripe().prices.retrieve(PLANS[plan].priceId, { expand: ["product"] });
      const product = typeof p.product === "string" ? null : p.product;
      res[plan] = {
        id: p.id,
        unit_amount: p.unit_amount,
        currency: p.currency,
        recurring: p.recurring && { interval: p.recurring.interval, interval_count: p.recurring.interval_count },
        active: p.active,
        livemode: p.livemode,
        product: product && !product.deleted ? { name: product.name, active: product.active } : null,
      };
    }
    return res;
  });
  await attempt("webhooks", async () => {
    const hooks = await stripe().webhookEndpoints.list({ limit: 50 });
    return hooks.data.map((h) => ({ url: h.url, status: h.status, livemode: h.livemode, enabled_events: h.enabled_events }));
  });
  await attempt("portal_configurations", portalConfigs);
  return NextResponse.json(out);
}

export async function POST(req: Request) {
  if (!authorized(req)) return notFound();
  try {
    const cfg = await stripe().billingPortal.configurations.create({
      name: "UXUS self-serve",
      business_profile: {
        headline: "UXUS — manage or cancel your subscription",
        terms_of_service_url: `${SITE_URL}/terms`,
      },
      default_return_url: `${SITE_URL}/pricing`,
      features: {
        subscription_cancel: {
          enabled: true,
          mode: "at_period_end",
          cancellation_reason: {
            enabled: true,
            options: ["too_expensive", "missing_features", "switched_service", "unused", "other"],
          },
        },
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        customer_update: { enabled: true, allowed_updates: ["email"] },
      },
      login_page: { enabled: true },
    });
    return NextResponse.json({ id: cfg.id, active: cfg.active, is_default: cfg.is_default, livemode: cfg.livemode, login_page: cfg.login_page });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

import type { Metadata } from "next";
import { BASE_SITE_CSS } from "../site-style";
import SiteFooter from "../components/SiteFooter";
import SubscribeButton from "./SubscribeButton";
import { STRIPE_ENABLED, PLANS, type PlanId } from "@/lib/stripe";
import { lendingLive } from "@/lib/xrpl-lending/live";
import { BILLING_PORTAL_URL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Pricing — UXUS",
  description: "Wallet and token risk screening pricing: free tier, and Starter/Pro subscriptions.",
};

const TIERS: {
  name: string; price: string; per: string; blurb: string; features: string[];
  free?: true; plan?: PlanId;
}[] = [
  {
    name: "Free",
    price: "$0",
    per: "/mo",
    blurb: "No key, no account, no card.",
    features: [
      "GET /api/risk — wallet & token score, level, verdict",
      "OFAC sanctions + scam-list matching",
      "Unlimited requests",
    ],
    free: true,
  },
  {
    name: "Starter",
    price: "$19",
    per: "/mo",
    blurb: "5,000 screens/month",
    features: [
      "Everything in Free",
      "Full breakdown: reasons, signals, sources",
      "5,000 screening calls/month",
      "Email support",
    ],
    plan: "starter",
  },
  {
    name: "Pro",
    price: "$49",
    per: "/mo",
    blurb: "25,000 screens/month",
    features: [
      "Everything in Starter",
      "25,000 screening calls/month",
      "Priority email support",
    ],
    plan: "pro",
  },
];

// Re-rendered every 10 minutes so the Lending Pro card opens by itself when XRPL lending is enabled on mainnet.
export const revalidate = 600;

export default async function Pricing() {
  const lendingOpen = STRIPE_ENABLED && !!PLANS.lending_pro.priceId && (await lendingLive());
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html:
            BASE_SITE_CSS +
            `
        .tiers{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin:32px 0 40px}
        .tier{background:var(--card);border:1px solid var(--rule);border-radius:3px;padding:22px;
          display:flex;flex-direction:column}
        .tier h3{font-size:15px;font-weight:600;margin:0 0 4px}
        .tier .amt{font-family:'IBM Plex Mono',monospace;font-size:30px;font-weight:600;margin:8px 0 2px}
        .tier .amt span{font-size:13px;font-weight:500;color:var(--muted)}
        .tier .blurb{color:var(--muted);font-size:13px;margin-bottom:16px}
        .tier ul{list-style:none;padding:0;margin:0 0 20px;flex:1}
        .tier li{font-size:13.5px;line-height:1.6;padding:7px 0;border-top:1px solid var(--rule)}
        .tier li:first-child{border-top:0}
        .tier .btn{display:block;text-align:center;padding:11px 0;border-radius:2px;font-size:14px;
          font-weight:600;text-decoration:none}
        .tier .btn.on{background:var(--petrol);color:#fff}
        .tier .btn.soon{background:#F0F3F4;color:var(--muted);cursor:default;border:1px dashed var(--rule)}
        .x402note{background:var(--card);border:1px solid var(--rule);border-radius:3px;padding:18px 20px;
          font-size:13.5px;color:var(--muted)}
        .x402note b{color:var(--ink)}
        .manage{font-size:13.5px;color:var(--muted);margin:-20px 0 28px}
        .lending{background:var(--card);border:1px solid var(--rule);border-radius:3px;padding:22px;margin:0 0 28px}
        .lending h3{font-size:15px;font-weight:600;margin:0 0 4px}
        .lending .amt{font-family:'IBM Plex Mono',monospace;font-size:26px;font-weight:600;margin:6px 0 10px}
        .lending .amt span{font-size:13px;font-weight:500;color:var(--muted)}
        .lending ul{margin:0 0 16px;padding-left:18px;font-size:13.5px;line-height:1.7}
        .lending .btn{display:inline-block;padding:11px 18px;border-radius:2px;font-size:14px;font-weight:600;text-decoration:none}
        .lending .btn.on{background:var(--petrol);color:#fff}
        .lending .btn.soon{background:#F0F3F4;color:var(--muted);border:1px dashed var(--rule)}
      `,
        }}
      />
      <div className="wrap">
        <div className="top">
          <a href="/"><b>UXUS Agent Services</b></a>
          <nav>
            <a href="/pricing">Pricing</a>
            <a href="/terms">Terms</a>
          </nav>
        </div>

        <h1>Pricing</h1>
        <p className="lede">
          A free tier for casual checks, and flat monthly subscriptions for teams that want
          predictable billing instead of pay-per-call.{" "}
          {STRIPE_ENABLED
            ? "Subscribe by card through Stripe Checkout — your API key is issued as soon as payment clears, and you can cancel any time."
            : "Card subscriptions are temporarily unavailable — pay-per-call below works now."}
        </p>

        <div className="tiers">
          {TIERS.map((t) => (
            <div className="tier" key={t.name}>
              <h3>{t.name}</h3>
              <div className="amt">
                {t.price}
                <span>{t.per}</span>
              </div>
              <div className="blurb">{t.blurb}</div>
              <ul>
                {t.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              {t.free ? (
                <a className="btn on" href="/">
                  Use it now
                </a>
              ) : STRIPE_ENABLED ? (
                <SubscribeButton plan={t.plan as PlanId} />
              ) : (
                <span className="btn soon">Coming soon</span>
              )}
            </div>
          ))}
        </div>

        {STRIPE_ENABLED && (
          <p className="manage">
            Already subscribed? <a href={BILLING_PORTAL_URL}>Manage or cancel your subscription</a> — enter
            your billing email and Stripe sends you a sign-in link.
          </p>
        )}

        <div className="lending" id="lending-pro">
          <h3>XRPL Lending Pro</h3>
          <div className="amt">$49<span>/mo</span></div>
          <ul>
            <li>A–F risk grades for XRP Ledger lending vaults and loan brokers through the API: 20,000 grade calls/month with your key</li>
            <li>Full grade history for every vault and broker</li>
            <li>Webhook alerts the moment a watched vault&apos;s or broker&apos;s grade changes</li>
            <li>Grades use on-ledger data only and are not credit ratings. Method: <a href="https://www.xrplhub.io/lending/method">xrplhub.io/lending/method</a></li>
          </ul>
          {lendingOpen ? (
            <SubscribeButton plan="lending_pro" />
          ) : (
            <span className="btn soon">Opens when XRPL lending goes live — <a href="https://www.xrplhub.io/lending">track the vote</a></span>
          )}
        </div>

        <div className="x402note">
          <b>Prefer pay-per-call?</b> That is not going away. <code>/api/risk/pro</code> is $0.02/call via the
          x402 protocol, settled in USDC on Base — no account, no subscription, no card. Subscriptions above
          are a second option for buyers who want a card invoice instead of a crypto wallet.
        </div>

        <SiteFooter />
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { BASE_SITE_CSS } from "../site-style";
import SiteFooter from "../components/SiteFooter";

export const metadata: Metadata = {
  title: "Pricing — UXUS",
  description: "Wallet and token risk screening pricing: free tier, and Starter/Pro subscriptions.",
};

const TIERS = [
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
    cta: "Use it now",
    href: "/",
    available: true,
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
    cta: "Coming soon",
    available: false,
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
    cta: "Coming soon",
    available: false,
  },
];

export default function Pricing() {
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
          predictable billing instead of pay-per-call. Card payments via Stripe are pending
          approval — subscriptions below go live the moment that clears.
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
              {t.available ? (
                <a className="btn on" href={t.href}>
                  {t.cta}
                </a>
              ) : (
                <span className="btn soon">{t.cta}</span>
              )}
            </div>
          ))}
        </div>

        <div className="x402note">
          <b>Prefer pay-per-call?</b> That is not going away. <code>/api/risk/pro</code> is $0.01/call via the
          x402 protocol, settled in USDC on Base — no account, no subscription, no card. Subscriptions above
          are a second option for buyers who want a card invoice instead of a crypto wallet.
        </div>

        <SiteFooter />
      </div>
    </>
  );
}

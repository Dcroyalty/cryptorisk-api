import type { Metadata } from "next";
import { BASE_SITE_CSS } from "../site-style";
import SiteFooter from "../components/SiteFooter";
import { CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Refund Policy — UXUS",
  description: "Refund and cancellation policy for UXUS subscriptions.",
};

export default function Refunds() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: BASE_SITE_CSS }} />
      <div className="wrap">
        <div className="top">
          <a href="/"><b>UXUS Agent Services</b></a>
          <nav>
            <a href="/pricing">Pricing</a>
            <a href="/terms">Terms</a>
          </nav>
        </div>

        <h1>Refund Policy</h1>
        <p className="updated">Last updated: September 12, 2026</p>

        <h2>Subscriptions</h2>
        <p>
          Starter and Pro are monthly subscriptions billed in advance by card. You can cancel at any time
          from your account. Cancelling stops the next renewal — <strong>your subscription remains active
          through the end of the billing period you already paid for</strong>, and access continues until
          then.
        </p>
        <p>
          We do not provide partial or prorated refunds for unused time within a billing period, whether you
          cancel, downgrade, or stop using the Service partway through.
        </p>

        <h2>Pay-per-call (x402)</h2>
        <p>
          Requests paid per-call via the x402 protocol settle on-chain at the time of the request and are
          final. Because these are individual, immediately-settled payments rather than a subscription,
          there is no recurring charge to cancel.
        </p>

        <h2>Billing errors and disputes</h2>
        <p>
          If you believe you were charged in error — a duplicate charge, a charge after you cancelled, or
          similar — contact us before filing a chargeback with your card issuer. We investigate and correct
          genuine billing errors. Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> with your
          account details and the charge in question.
        </p>

        <h2>Contact</h2>
        <p>
          For anything else related to billing: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>

        <SiteFooter />
      </div>
    </>
  );
}

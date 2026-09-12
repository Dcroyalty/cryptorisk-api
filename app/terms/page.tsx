import type { Metadata } from "next";
import { BASE_SITE_CSS } from "../site-style";
import SiteFooter from "../components/SiteFooter";
import { ENTITY_NAME, CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service — UXUS",
  description: "Terms of service for the UXUS wallet and token risk data API.",
};

export default function Terms() {
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

        <h1>Terms of Service</h1>
        <p className="updated">Last updated: September 12, 2026</p>

        <p>
          These Terms of Service ("Terms") govern your access to and use of the UXUS wallet and token risk
          API and related services (the "Service"), operated by {ENTITY_NAME} ("UXUS", "we", "us"). By
          calling the API, using the website, or subscribing to a paid tier, you agree to these Terms. If
          you do not agree, do not use the Service.
        </p>

        <h2>1. What the Service is</h2>
        <p>
          UXUS is a data API. It returns automated risk signals — sanctions-list matches, scam/phishing-list
          matches, and on-chain contract reads — for wallet addresses and token contracts you submit. That is
          the entire scope of the Service.
        </p>

        <h2>2. What the Service is not</h2>
        <p>
          UXUS does not hold, custody, transmit, or have access to any customer funds, cryptocurrency, or
          private keys. We are not a money transmitter, exchange, broker-dealer, custodian, or bank, and we
          do not facilitate the movement of funds between parties. Payment for the Service itself (via card
          subscription or the x402 protocol) is separate from, and unrelated to, the wallets and addresses
          the Service analyzes.
        </p>

        <h2>3. Not financial, legal, or compliance advice</h2>
        <p>
          Output from the Service is automated screening derived from public data — the OFAC SDN list,
          community scam and phishing registries, and on-chain reads. It is developer-grade signal, not
          legal, financial, or compliance advice, and not a substitute for a compliance program. Sanctions
          and scam lists refresh periodically and can lag a real-world designation. Verify any result against
          the official source before you rely on it to take action.
        </p>

        <h2>4. No warranty on accuracy or completeness</h2>
        <p>
          The Service is provided "as is" and "as available," without warranties of any kind, whether
          express, implied, or statutory, including any implied warranties of merchantability, fitness for a
          particular purpose, non-infringement, or that results are accurate, complete, or up to date. You
          are solely responsible for any decision made using output from the Service.
        </p>

        <h2>5. Acceptable use</h2>
        <ul>
          <li>Don't use the Service for any unlawful purpose, or to violate sanctions law yourself.</li>
          <li>Don't represent Service output as a complete or certified compliance determination without independent verification.</li>
          <li>Don't attempt to circumvent rate limits, resell raw API access as your own competing API, or reverse-engineer the Service.</li>
          <li>Don't submit data you don't have the right to submit.</li>
        </ul>

        <h2>6. Subscriptions and billing</h2>
        <p>
          Paid subscription tiers bill monthly in advance by card. See our{" "}
          <a href="/refunds">Refund Policy</a> for cancellation and refund terms. Pay-per-call access via the
          x402 protocol is billed per request in USDC and is governed by these Terms as well.
        </p>

        <h2>7. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, {ENTITY_NAME} will not be liable for any indirect,
          incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or
          funds, arising from your use of or inability to use the Service, even if advised of the
          possibility. Our total liability for any claim relating to the Service is limited to the amount
          you paid us in the three months preceding the claim.
        </p>

        <h2>8. Termination</h2>
        <p>
          You may stop using the Service at any time. We may suspend or terminate access for abuse, non-
          payment, or violation of these Terms, with notice where practicable.
        </p>

        <h2>9. Changes to these Terms</h2>
        <p>
          We may update these Terms from time to time. Continued use of the Service after a change is posted
          means you accept the updated Terms.
        </p>

        <h2>10. Governing law</h2>
        <p>
          These Terms are governed by United States law, without regard to conflict-of-laws principles,
          except as otherwise required by applicable mandatory law.
        </p>

        <h2>11. Contact</h2>
        <p>
          Questions about these Terms: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>

        <SiteFooter />
      </div>
    </>
  );
}

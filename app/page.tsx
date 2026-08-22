export default function Home() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px", fontFamily: "system-ui, -apple-system, sans-serif", lineHeight: 1.6, color: "#111" }}>
      <h1 style={{ fontSize: 40, marginBottom: 8 }}>CryptoRisk API</h1>
      <p style={{ fontSize: 20, color: "#555", marginTop: 0 }}>
        Wallet &amp; token risk scoring for Ethereum and Base. Sanctions, scam, and rug-pull detection in one call.
      </p>

      <div style={{ background: "#f5f7fa", borderRadius: 12, padding: 24, margin: "32px 0" }}>
        <h2 style={{ marginTop: 0 }}>Try it free</h2>
        <p>Score any address instantly — no signup:</p>
        <code style={{ display: "block", background: "#fff", padding: 12, borderRadius: 8, fontSize: 13, overflowX: "auto", border: "1px solid #e2e8f0" }}>
          GET /api/risk?address=0xADDRESS&amp;chain=base
        </code>
        <p style={{ marginBottom: 0 }}>
          <a href="/api/risk?address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045&chain=ethereum" style={{ color: "#1652F0", fontWeight: 600 }}>
            → See a live example (Vitalik&apos;s wallet)
          </a>
        </p>
      </div>

      <h2>What you get</h2>
      <ul>
        <li><b>risk_score</b> (0–100) and <b>risk_level</b> (low / medium / high / critical)</li>
        <li><b>verdict</b>: PROCEED · CAUTION · BLOCK</li>
        <li><b>flags</b>: OFAC sanctions, known scam/phishing/drainer addresses, honeypot &amp; rug signals for tokens</li>
      </ul>

      <h2>Pricing</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", margin: "16px 0" }}>
        <tbody>
          <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
            <td style={{ padding: "10px 0" }}><b>Free</b> — <code>/api/risk</code></td>
            <td style={{ textAlign: "right" }}>score, level, verdict, flags</td>
          </tr>
          <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
            <td style={{ padding: "10px 0" }}><b>Pro</b> — <code>/api/risk/pro</code></td>
            <td style={{ textAlign: "right" }}>$0.01 USDC (Base) — full report</td>
          </tr>
        </tbody>
      </table>
      <p style={{ color: "#555" }}>
        Pay per call with <b>x402</b> (USDC on Base) — built for AI agents. No accounts, no keys, no subscriptions.
      </p>

      <h2>For AI agents</h2>
      <p>
        Discoverable via the x402 Bazaar. Machine-readable manifest at{" "}
        <a href="/.well-known/x402.json" style={{ color: "#1652F0" }}>/.well-known/x402.json</a>{" "}
        and <a href="/llms.txt" style={{ color: "#1652F0" }}>/llms.txt</a>.
      </p>

      <footer style={{ marginTop: 48, paddingTop: 24, borderTop: "1px solid #e2e8f0", color: "#94a3b8", fontSize: 14 }}>
        CryptoRisk API · risk signals from public data (OFAC, scam lists, GoPlus). Developer-grade, not compliance-grade.
      </footer>
    </main>
  );
}

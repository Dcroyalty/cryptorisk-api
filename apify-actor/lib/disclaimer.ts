// lib/disclaimer.ts — the disclaimer that ships INSIDE every verdict-bearing
// JSON response. An agent consuming the API never sees the site footer.

export const RISK_DISCLAIMER =
  "Automated screening from public data (OFAC SDN list, community scam/phishing " +
  "registries, on-chain reads). Developer-grade signal, not legal, financial, or " +
  "compliance advice and not a substitute for a compliance program. Lists refresh " +
  "daily and can lag a real-world designation; verify against the official source " +
  "before you act. No warranty.";

export const ENTITY_DISCLAIMER =
  "Attribution from public label sets. 'sanctioned' reflects the OFAC SDN list as " +
  "last refreshed (daily) — confirm against the official list before acting. Not " +
  "legal or compliance advice. No warranty.";

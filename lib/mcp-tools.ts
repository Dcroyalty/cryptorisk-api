// lib/mcp-tools.ts — the MCP tool catalogue, shared by the JSON-RPC endpoint (app/api/mcp/route.ts) and the
// server card (app/.well-known/mcp/server-card.json/route.ts), so the card can never drift from the live tools.

import { lendingLive, NOT_LIVE_BODY } from "./xrpl-lending/live";

export const BASE = "https://uxus.finance";
export const PAY_TO = "0xe0ed7a30589fec49e98f2085c7162b90fdbb83de";
export const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const LATEST_PROTOCOL = "2025-06-18";
export const SERVER_INFO = { name: "uxus-agent-services", title: "UXUS Agent Services", version: "1.4.0" };
export const SERVER_DESCRIPTION =
  "Wallet and address tools for AI agents, no API key or account. Free: universal wallet lookup (EVM and XRPL) with a first-pass risk verdict, ENS and Basename resolution, entity labels, and a wallet caller-ID check (ANSWER, SCREEN or BLOCK). Paid: search_web and scrape_url cost $0.01 USDC on Base via x402, yield_grade (A-F risk grade for one way to earn on XRP or RLUSD, from the XRP Yield Desk) costs $0.02, and lending_grade (A-F risk grade for an XRP Ledger lending vault or broker) costs $0.02 and goes live when XRPL lending is enabled on mainnet (until then its endpoint returns 503 with no charge); each returns the payment resource to call.";

// ---- upgrade pointer (funnel) ----
const RISK_UPGRADE = {
  tool: "risk_report (HTTP, paid)",
  endpoint: `${BASE}/api/risk/pro`,
  price: "$0.02 USDC on Base (x402)",
  adds:
    "per-signal reasons with severity, the raw signals object (token buy/sell tax, mint/proxy/hidden-owner flags, or wallet age + tx count), and the source list behind every flag",
};

// ---- paid tools: the payment resource, never the result ----
const PAID_HOW =
  "GET the resource with no payment header to receive the 402 challenge, pay it with your own wallet (x402 v1, exact scheme, X-PAYMENT header), and repeat the GET with the header. No API key or account.";
function paidResource(path: string, query: Record<string, string | undefined>, returns: string, priceUsdc = "0.01") {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(query)) if (v) url.searchParams.set(k, v);
  return {
    paid: true,
    resource: url.toString(),
    method: "GET",
    price: `${priceUsdc} USDC on Base (x402 v1, X-PAYMENT header)`,
    pay_to: PAY_TO,
    how: PAID_HOW,
    returns,
    discovery: `${BASE}/.well-known/x402.json`,
  };
}
const str = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v));

// ---- tool catalogue ----
// Changing this list (add, remove, rename, free <-> paid)? Update docs/MCP_LISTING.md in the same commit, and bump
// SERVER_INFO.version here plus `version` in server.json (then tag vX.Y.Z to republish to the MCP Registry).
type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<unknown>;
};

async function proxyGet(path: string, args: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(args)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const r = await fetch(url.toString(), { headers: { accept: "application/json" } });
  return r.json();
}

export const TOOLS: ToolDef[] = [
  {
    name: "search_web",
    description:
      "Live web search: ranked results plus Google's answer box, knowledge graph, people-also-ask and related searches when the Google-backed provider answers. This is a PAID x402 call: $0.01 USDC on Base at GET /api/search. This tool returns the payment resource to call; it does not run the search. Params: query (string, required); count (integer 1-20, default 10); country/language/page/device (optional).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query. Required." },
        count: { type: "integer", minimum: 1, maximum: 20, default: 10, description: "Number of results, 1-20. Default 10." },
        country: { type: "string", description: "2-letter country code. Optional." },
        language: { type: "string", description: "2+ letter language code. Optional." },
        page: { type: "integer", minimum: 1, description: "1-based result page. Optional." },
        device: { type: "string", description: "Forwarded to the upstream provider if set; not confirmed to change results on every provider. Optional." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    run: async (a) => {
      const query = String(a.query ?? "").trim();
      if (!query) return { error: "query is required. Nothing was searched or charged." };
      return paidResource(
        "/api/search",
        { q: query, count: str(a.count), country: str(a.country), language: str(a.language), page: str(a.page), device: str(a.device) },
        "{ query, results: [{ title, url, description, score }], people_also_ask, related_searches, knowledge_graph, answer_box, shopping, provider, latency_ms }",
      );
    },
  },
  {
    name: "scrape_url",
    description:
      "Any web page as clean, LLM-ready markdown, text or html. This is a PAID x402 call: $0.01 USDC on Base at GET /api/scrape. This tool returns the payment resource to call; it does not fetch the page. Params: url (absolute http/https URL, required); format (markdown | text | html, default markdown); max_chars (integer, default 40000, max 120000).",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http/https URL to fetch. Required." },
        format: { type: "string", enum: ["markdown", "text", "html"], default: "markdown", description: "Output format. Default markdown." },
        max_chars: { type: "integer", default: 40000, maximum: 120000, description: "Truncation limit. Default 40000, max 120000." },
      },
      required: ["url"],
      additionalProperties: false,
    },
    run: async (a) => {
      const target = String(a.url ?? "").trim();
      if (!/^https?:\/\//i.test(target)) return { error: "url must be an absolute http/https URL. Nothing was fetched or charged." };
      return paidResource(
        "/api/scrape",
        { url: target, format: str(a.format), max_chars: str(a.max_chars) },
        "{ url, status, title, description, format, content, truncated, chars, latency_ms }",
      );
    },
  },
  {
    name: "yield_grade",
    description:
      "A-F risk grade for one way to earn on XRP or RLUSD, from the XRP Yield Desk (xrplhub.io/yield): XRPL AMM pools, Doppler vaults, Firelight stXRP and other Flare FXRP products, RLUSD and XRP DeFi pools, and exchange earn programs. Returns the rate, size, lockup and withdrawal terms, who holds the keys, chain, age, audits, the data source with its timestamp, and every rule that moved the grade. General information, not advice; the products graded pay nothing. This is a PAID x402 call: $0.02 USDC on Base at GET /api/yield/grade. This tool returns the payment resource to call; it does not compute the grade. Find ids for free at https://www.xrplhub.io/api/yield/options. Params: id (option id, required).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", pattern: "^[a-z0-9-]{3,90}$", description: "Option id (slug) from https://www.xrplhub.io/api/yield/options, e.g. doppler-xrp-vault-xrpl. Required." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    run: async (a) => {
      const id = String(a.id ?? "").trim();
      if (!/^[a-z0-9-]{3,90}$/.test(id)) return { error: "id must be an option id from https://www.xrplhub.io/api/yield/options. Nothing was charged." };
      return paidResource(
        "/api/yield/grade",
        { id },
        "{ id, name, provider, asset, chain, kind, rate, rateKind, tvlUsd, lockup, withdrawal, keys, custody, bridge, launchedAt, audits, auditLinks, source: { name, url, at }, grade (A|B|C|D|F), score, adjustments: [{ rule, points, why }], gradeHistory, methodVersion, method, disclaimer, checked_at }",
        "0.02",
      );
    },
  },
  {
    name: "lending_grade",
    description:
      "A-F risk grade for one XRP Ledger lending vault or loan broker, from on-ledger data only (size, utilization, first-loss cover ratio, late/impaired/defaulted loans, unrealized loss, realized yield), with every rule that moved the grade. Not a credit rating. This is a PAID x402 call: $0.02 USDC on Base at GET /api/lending/grade. This tool returns the payment resource to call; it does not compute the grade. NOT LIVE YET: it goes live when XRPL lending (the LendingProtocol and SingleAssetVault amendments) is enabled on mainnet. Until then this tool returns available:false and GET /api/lending/grade returns 503 with no charge. Params: id (64-hex Vault or LoanBroker ID, required); type (vault | broker, optional).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", pattern: "^[0-9A-Fa-f]{64}$", description: "64-hex ledger ID of an XRPL Vault or LoanBroker. Required." },
        type: { type: "string", enum: ["vault", "broker"], description: "Optional; detected when omitted." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    run: async (a) => {
      if (!(await lendingLive())) return { available: false, ...NOT_LIVE_BODY };
      const id = String(a.id ?? "").trim();
      if (!/^[0-9A-Fa-f]{64}$/.test(id)) return { error: "id must be a 64-hex Vault or LoanBroker ID. Nothing was charged." };
      return paidResource(
        "/api/lending/grade",
        { id: id.toUpperCase(), type: str(a.type) },
        "{ type, id, grade (A|B|C|D|F|N/A), score, capped, adjustments: [{ rule, points, why }], metrics, methodVersion, method, page, disclaimer, checked_at }",
        "0.02",
      );
    },
  },
  {
    name: "lookup_wallet",
    description:
      "Universal address lookup — any address, any chain, auto-detected. Params: address (EVM 0x address or XRPL classic r-address, required); chain (optional EVM history hint: base default, or ethereum). Detects EVM vs XRPL from the format. Returns one normalized envelope: { address, chain, chain_detected, exists, risk_score, risk_level, verdict, flags, entity, name }. Free. For a fast first-pass check on a counterparty wallet.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "EVM 0x address or XRPL classic r-address. Required." },
        chain: { type: "string", enum: ["base", "ethereum"], description: "Optional EVM history hint. Default base." },
      },
      required: ["address"],
      additionalProperties: false,
    },
    run: async (a) => {
      const out = await proxyGet("/api/lookup", a);
      return { ...(out as object), upgrade: RISK_UPGRADE };
    },
  },
  {
    name: "resolve_name",
    description:
      "Bidirectional name <-> address resolution for ENS (name.eth) and Basenames (name.base.eth). Param: q (an ENS/Basename name, an EVM 0x address, or an XRPL r-address, required). Auto-detects direction. Reverse records are forward-verified against the address to stop name spoofing. Returns { query, kind, namespace, chain, resolved, address, name, sources }. XRPL .xrp names are detected but resolved:false (no canonical registry). Free.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "An ENS/Basename name, an EVM 0x address, or an XRPL classic r-address. Required." },
      },
      required: ["q"],
      additionalProperties: false,
    },
    run: (a) => proxyGet("/api/resolve", a),
  },
  {
    name: "check_entity",
    description:
      "Entity attribution — what IS this address, not who owns it. Params: address (0x EVM address, required); chain (base default, or ethereum). Returns { address, chain, is_known, label, category }. category is one of sanctioned, mixer, exchange, bridge, dex_router, scam, drainer, phishing, flagged, token_contract, protocol, unknown. \"sanctioned\" is set only when the address is on the OFAC SDN list (the same source /api/risk uses); a non-OFAC blocklist hit is \"flagged\". Sourced from OFAC, ScamSniffer, MEW, eth-labels and curated Base/Tornado sets. Never guesses. Free.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x EVM address. Required." },
        chain: { type: "string", enum: ["base", "ethereum"], description: "Default base." },
      },
      required: ["address"],
      additionalProperties: false,
    },
    run: async (a) => {
      const out = await proxyGet("/api/entity", a);
      return { ...(out as object), upgrade: RISK_UPGRADE };
    },
  },
  {
    name: "caller_id",
    description:
      "Should this wallet be answered? For wallet messaging (XMTP, Push), which has no spam filter. Params: address (0x EVM address, required); chain (base default, or ethereum). Composes entity attribution + risk score + on-chain history + forward-verified name into ANSWER | SCREEN | BLOCK with reasons[] and a confidence flag. BLOCK on sanctioned/drainer/phishing/scam/mixer or risk verdict BLOCK; SCREEN is the default for unknown addresses. Free.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "0x EVM address. Required." },
        chain: { type: "string", enum: ["base", "ethereum"], description: "Default base." },
      },
      required: ["address"],
      additionalProperties: false,
    },
    run: (a) => proxyGet("/api/callerid", a),
  },
  {
    name: "health",
    description: "Service health check. No parameters. Returns { ok, service, time, upstream } — confirms the uxus.finance API is reachable. Free.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      let upstream = "unknown";
      try {
        const r = await fetch(`${BASE}/api/catalog`, { headers: { accept: "application/json" } });
        upstream = r.ok ? "ok" : `http_${r.status}`;
      } catch {
        upstream = "unreachable";
      }
      return { ok: upstream === "ok", service: SERVER_INFO.name, time: new Date().toISOString(), upstream };
    },
  },
];

export const PAID_TOOLS = ["search_web", "scrape_url", "yield_grade", "lending_grade"];

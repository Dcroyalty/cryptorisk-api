import { NextRequest, NextResponse } from "next/server";
import { isEvmAddress } from "@/lib/sources";
import { scoreAddress, chainId, SUPPORTED_CHAINS } from "@/lib/score-address";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { x402ResourceServer, x402HTTPResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createFacilitatorConfig } from "@coinbase/x402";
import { declareDiscoveryExtension, bazaarResourceServerExtension } from "@x402/extensions/bazaar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAY_TO = "0xe0ed7a30589fec49e98f2085c7162b90fdbb83de";
const RESOURCE_URL = "https://uxus.finance/api/risk/bazaar";

const facilitatorConfig = createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET);
const facilitatorClient = new HTTPFacilitatorClient(facilitatorConfig);
const resourceServer = new x402ResourceServer(facilitatorClient);
resourceServer.register("eip155:8453", new ExactEvmScheme());
resourceServer.registerExtension(bazaarResourceServerExtension);

const discovery = declareDiscoveryExtension({
  method: "GET",
  input: { address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", chain: "ethereum" },
  inputSchema: {
    properties: {
      address: { type: "string", description: "0x EVM address (wallet or token contract) to score" },
      chain: { type: "string", description: "ethereum or base (default base)" },
      type: { type: "string", description: "wallet or token (default wallet)" },
    },
    required: ["address"],
  },
  output: { example: { address: "0xd8da...6045", risk_score: 0, risk_level: "low", verdict: "PROCEED", flags: ["CLEAN"] } },
});

const routes = {
  "GET /api/risk/bazaar": {
    accepts: [{ scheme: "exact", price: "$0.01", network: "eip155:8453", payTo: PAY_TO }],
    resource: {
      url: RESOURCE_URL,
      description: "Wallet & token risk score: sanctions, scam, honeypot detection for Ethereum & Base.",
      mimeType: "application/json",
      serviceName: "CryptoRisk API",
      tags: ["risk", "security", "wallet", "sanctions", "defi"],
    },
    extensions: { ...discovery },
  },
} as const;

const httpServer = new x402HTTPResourceServer(resourceServer, routes as any);
let initialized = false;
async function ensureInit() { if (!initialized) { await httpServer.initialize(); initialized = true; } }

function makeAdapter(req: NextRequest) {
  const u = new URL(req.url);
  return {
    getHeader: (name: string) => req.headers.get(name) ?? undefined,
    getMethod: () => req.method,
    getPath: () => u.pathname,
    getUrl: () => req.url,
    getAcceptHeader: () => req.headers.get("accept") ?? "",
    getUserAgent: () => req.headers.get("user-agent") ?? "",
    getQueryParams: () => { const o: Record<string, string> = {}; u.searchParams.forEach((v, k) => { o[k] = v; }); return o; },
    getQueryParam: (name: string) => u.searchParams.get(name) ?? undefined,
    getBody: () => undefined,
  };
}

async function runScore(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("address") || "").trim();
  const chain = (searchParams.get("chain") || "base").toLowerCase();
  const type = (searchParams.get("type") || "wallet").toLowerCase() as "wallet" | "token";
  if (!isEvmAddress(raw)) return NextResponse.json({ error: "invalid_address", detail: "Provide a valid 0x EVM address" }, { status: 400 });
  if (!chainId(chain)) return NextResponse.json({ error: "unsupported_chain", detail: `Supported: ${SUPPORTED_CHAINS.join(", ")}` }, { status: 400 });
  return await scoreAddress(raw.toLowerCase(), chain, type);
}

export async function GET(req: NextRequest) {
  await ensureInit();
  const paymentHeader = req.headers.get("PAYMENT-SIGNATURE") || req.headers.get("X-PAYMENT") || undefined;
  const ctx = { adapter: makeAdapter(req) as any, path: "/api/risk/bazaar", method: "GET", paymentHeader, routePattern: "GET /api/risk/bazaar" };
  const result = await httpServer.processHTTPRequest(ctx as any);

  if (result.type === "payment-error") {
    const r = result.response;
    return new NextResponse(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}), { status: r.status, headers: r.headers });
  }
  if (result.type === "no-payment-required") {
    const data = await runScore(req);
    if (data instanceof NextResponse) return data;
    return NextResponse.json(data, { status: 200 });
  }
  const data = await runScore(req);
  if (data instanceof NextResponse) return data;
  const responseBody = Buffer.from(JSON.stringify(data));
  const settle = await httpServer.processSettlement(result.paymentPayload, result.paymentRequirements, result.declaredExtensions, { request: ctx as any, responseBody });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if ((settle as any).headers) Object.assign(headers, (settle as any).headers);
  return new NextResponse(JSON.stringify(data), { status: 200, headers });
}

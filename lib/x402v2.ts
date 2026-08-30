// lib/x402v2.ts — shared x402 v2 payment wrapper.
// Emits spec-compliant v2 402 challenges (PAYMENT-REQUIRED header) so directories
// can index the endpoint, and settles through the CDP facilitator.
import { NextRequest, NextResponse } from "next/server";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { x402ResourceServer, x402HTTPResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createFacilitatorConfig } from "@coinbase/x402";

export const PAY_TO = "0xe0ed7a30589fec49e98f2085c7162b90fdbb83de";
const NETWORK = "eip155:8453";
const ORIGIN = "https://cryptorisk-api.vercel.app";

function adapter(req: NextRequest) {
  const u = new URL(req.url);
  return {
    getHeader: (n: string) => req.headers.get(n) ?? undefined,
    getMethod: () => req.method,
    getPath: () => u.pathname,
    getUrl: () => req.url,
    getAcceptHeader: () => req.headers.get("accept") ?? "",
    getUserAgent: () => req.headers.get("user-agent") ?? "",
    getQueryParams: () => { const o: Record<string, string> = {}; u.searchParams.forEach((v, k) => { o[k] = v; }); return o; },
    getQueryParam: (n: string) => u.searchParams.get(n) ?? undefined,
    getBody: () => undefined,
  };
}

export type PaidRoute = {
  path: string;                 // "/api/llm"
  method: "GET" | "POST";
  price: string;                // "$0.01"
  description: string;
  serviceName?: string;
  tags?: string[];
};

export function withX402(
  route: PaidRoute,
  handler: (req: NextRequest) => Promise<NextResponse | any>
) {
  const routeKey = `${route.method} ${route.path}`;
  const routes: any = {
    [routeKey]: {
      accepts: [{ scheme: "exact", price: route.price, network: NETWORK, payTo: PAY_TO }],
      resource: {
        url: ORIGIN + route.path,
        description: route.description,
        mimeType: "application/json",
        serviceName: route.serviceName ?? "CryptoRisk Agent Services",
        tags: route.tags ?? ["agent", "x402", "base"],
      },
    },
  };

  let httpServer: any = null;
  let ready = false;

  async function ensure() {
    if (!httpServer) {
      const cfg = createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET);
      const fc = new HTTPFacilitatorClient(cfg as any);
      const rs = new x402ResourceServer(fc as any);
      rs.register(NETWORK as any, new ExactEvmScheme() as any);
      httpServer = new x402HTTPResourceServer(rs as any, routes);
    }
    if (!ready) { await httpServer.initialize(); ready = true; }
  }

  return async function (req: NextRequest) {
    await ensure();

    const paymentHeader =
      req.headers.get("PAYMENT-SIGNATURE") ||
      req.headers.get("X-PAYMENT") ||
      undefined;

    const ctx: any = {
      adapter: adapter(req),
      path: route.path,
      method: route.method,
      paymentHeader,
      routePattern: routeKey,
    };

    const result: any = await httpServer.processHTTPRequest(ctx);

    if (result.type === "payment-error") {
      const r = result.response;
      return new NextResponse(
        typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}),
        { status: r.status, headers: r.headers }
      );
    }

    // Paid (or nothing owed) -> run the real work
    const out = await handler(req);
    if (out instanceof NextResponse) {
      // validation failure etc — return without settling
      if (out.status >= 400) return out;
    }
    const data = out instanceof NextResponse ? await out.clone().json() : out;

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (result.type === "payment-verified") {
      try {
        const settle: any = await httpServer.processSettlement(
          result.paymentPayload,
          result.paymentRequirements,
          result.declaredExtensions,
          { request: ctx, responseBody: Buffer.from(JSON.stringify(data)) }
        );
        if (settle?.headers) Object.assign(headers, settle.headers);
      } catch { /* deliver anyway */ }
    }
    return new NextResponse(JSON.stringify(data), { status: 200, headers });
  };
}

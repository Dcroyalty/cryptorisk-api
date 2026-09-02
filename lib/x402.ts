// lib/x402.ts — x402 v2 payment wrapper.
// Generalized from the production-proven pattern in app/api/risk/bazaar/route.ts
// (@x402/core resource server + Coinbase CDP facilitator). Emits spec-compliant
// v2 challenges: base64 PAYMENT-REQUIRED header, mirrored into the JSON body.
//
// Migration rule: paid routes move here from middleware.ts ONE AT A TIME. A route
// is gated by EITHER middleware.ts (v1) OR this wrapper (v2) — never both, never
// neither. The same commit that wraps a route removes it from the middleware matcher.
import { NextRequest, NextResponse } from "next/server";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { x402ResourceServer, x402HTTPResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createFacilitatorConfig } from "@coinbase/x402";

export const PAY_TO = "0xe0ed7a30589fec49e98f2085c7162b90fdbb83de";
const NETWORK = "eip155:8453"; // Base mainnet
const ORIGIN = "https://uxus.finance";

// One resource server for the whole app — same CDP facilitator as /api/risk/bazaar.
const facilitatorClient = new HTTPFacilitatorClient(
  createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET),
);
const resourceServer = new x402ResourceServer(facilitatorClient);
resourceServer.register(NETWORK, new ExactEvmScheme());

export type PaidRoute = {
  path: string;
  method: "GET" | "POST";
  price: string;
  description: string;
  serviceName?: string;
  tags?: string[];
};

function makeAdapter(req: NextRequest) {
  const u = new URL(req.url);
  return {
    getHeader: (name: string) => req.headers.get(name) ?? undefined,
    getMethod: () => req.method,
    getPath: () => u.pathname,
    getUrl: () => req.url,
    getAcceptHeader: () => req.headers.get("accept") ?? "",
    getUserAgent: () => req.headers.get("user-agent") ?? "",
    getQueryParams: () => {
      const o: Record<string, string> = {};
      u.searchParams.forEach((v, k) => {
        o[k] = v;
      });
      return o;
    },
    getQueryParam: (name: string) => u.searchParams.get(name) ?? undefined,
    // Payment is always in the X-PAYMENT header, never the body — the wrapper
    // never reads req.body, so the wrapped handler gets the stream intact.
    getBody: () => undefined,
  };
}

export function withX402(
  route: PaidRoute,
  handler: (req: NextRequest) => Promise<NextResponse>,
) {
  const routePattern = `${route.method} ${route.path}`;
  const routes = {
    [routePattern]: {
      accepts: [{ scheme: "exact", price: route.price, network: NETWORK, payTo: PAY_TO }],
      resource: {
        url: ORIGIN + route.path,
        description: route.description,
        mimeType: "application/json",
        serviceName: route.serviceName ?? "UXUS Agent Services",
        tags: route.tags ?? ["agent", "x402", "base"],
      },
    },
  };
  const httpServer = new x402HTTPResourceServer(resourceServer, routes as any);

  let initialized = false;
  const ensureInit = async () => {
    if (!initialized) {
      await httpServer.initialize();
      initialized = true;
    }
  };

  return async function wrapped(req: NextRequest): Promise<NextResponse> {
    await ensureInit();
    const ctx = {
      adapter: makeAdapter(req),
      path: route.path,
      method: route.method,
      paymentHeader:
        req.headers.get("X-PAYMENT") || req.headers.get("PAYMENT-SIGNATURE") || undefined,
      routePattern,
    } as any;

    // Payment resolves BEFORE the handler — an unpaid or malformed request gets a
    // 402 here, never a 400 from the handler's own validation.
    const result = await httpServer.processHTTPRequest(ctx);

    if (result.type === "payment-error") {
      const r = result.response as { status?: number; body?: unknown; headers?: unknown };
      const headers = new Headers(r.headers as any);
      let body = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
      // --- BODY ECHO: mirror the v2 challenge (base64 in PAYMENT-REQUIRED) into
      // the body so body-parsing clients / directory probes read x402Version:2
      // directly. If a live 402 ever breaks, DELETE THIS BLOCK FIRST — the header
      // alone is spec-complete. ---
      const challengeB64 = headers.get("payment-required");
      if (challengeB64 && (body === "" || body === "{}")) {
        try {
          body = Buffer.from(challengeB64, "base64").toString("utf8");
          headers.set("content-type", "application/json");
        } catch {
          /* keep the library's body */
        }
      }
      // --- end body echo ---
      return new NextResponse(body, { status: r.status ?? 402, headers });
    }

    if (result.type === "no-payment-required") return handler(req);

    // payment-verified → run handler, then settle on-chain and attach the receipt.
    const res = await handler(req);
    const out = await res.clone().text();
    if (res.status >= 400) return res; // don't settle a failed response (caller not charged)

    const settle = await httpServer.processSettlement(
      (result as any).paymentPayload,
      (result as any).paymentRequirements,
      (result as any).declaredExtensions,
      { request: ctx, responseBody: Buffer.from(out) } as any,
    );
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    if ((settle as any).headers) Object.assign(headers, (settle as any).headers);
    return new NextResponse(out, { status: res.status, headers });
  };
}

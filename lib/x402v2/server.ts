// lib/x402v2/server.ts — the multi-rail payment layer for /api/v2/*.
//
// One x402 v2 resource server, settled by the Coinbase CDP facilitator, that
// offers every route in USDC on three rails:
//   Base     eip155:8453   payTo PAY_TO
//   Polygon  eip155:137    payTo PAY_TO (same EVM address)
//   Solana   solana:5eyk…  payTo X402_SOLANA_PAY_TO (rail omitted if unset/invalid)
//
// Order of operations per paid request (unlike x402-next v1, which settles
// BEFORE the route runs):  verify -> run the handler -> settle only if the
// handler answered 2xx -> deliver only if settlement succeeded. A buyer is never
// charged for an error, and nothing is delivered unpaid.
//
// Disabled (flag off / test-mode without the token / kill switch tripped) or any
// infrastructure failure -> 307 to the v1 Base twin (method + body preserved).
import { NextRequest, NextResponse } from "next/server";
import { HTTPFacilitatorClient } from "@x402/core/http";
import { x402ResourceServer, x402HTTPResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { createFacilitatorConfig } from "@coinbase/x402";
import { declareDiscoveryExtension, bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { PAY_TO, CANONICAL_ORIGIN } from "@/lib/pay-to";
import { RAIL_ROUTES, type RailRouteDef, type RailRouteId } from "@/lib/x402v2/catalog";
import { multiRailEnabled, recordRailError } from "@/lib/x402v2/flag";

export const BASE = "eip155:8453";
export const POLYGON = "eip155:137";
export const SOLANA = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const PRICE = "$0.01";

/** The Solana receive address, or null when unset / not a plausible base58 pubkey. */
export function solanaPayTo(): string | null {
  const a = (process.env.X402_SOLANA_PAY_TO || "").trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ? a : null;
}

export function activeRails(): Array<{ network: string; payTo: string; label: string }> {
  const rails = [
    { network: BASE, payTo: PAY_TO, label: "Base" },
    { network: POLYGON, payTo: PAY_TO, label: "Polygon" },
  ];
  const sol = solanaPayTo();
  if (sol) rails.push({ network: SOLANA, payTo: sol, label: "Solana" });
  return rails;
}

function routeKey(def: RailRouteDef) {
  return `${def.method} ${def.v2Path}`;
}

function buildRoutes() {
  const rails = activeRails();
  const routes: Record<string, unknown> = {};
  for (const def of Object.values(RAIL_ROUTES)) {
    routes[routeKey(def)] = {
      accepts: rails.map((r) => ({ scheme: "exact", price: PRICE, network: r.network, payTo: r.payTo })),
      resource: {
        url: `${CANONICAL_ORIGIN}${def.v2Path}`,
        description: def.description,
        mimeType: "application/json",
        serviceName: "UXUS Agent Services",
        tags: ["x402", "agents", "usdc", "base", "polygon", "solana", def.id],
      },
      extensions: { ...declareDiscoveryExtension(def.discovery as never) },
    };
  }
  return routes;
}

let serverPromise: Promise<x402HTTPResourceServer> | null = null;

/** Lazily build + initialize (fetches the facilitator's /supported and validates every rail). */
function getServer(): Promise<x402HTTPResourceServer> {
  if (!serverPromise) {
    serverPromise = (async () => {
      const facilitator = new HTTPFacilitatorClient(
        createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET),
      );
      const resourceServer = new x402ResourceServer(facilitator);
      resourceServer.register(BASE, new ExactEvmScheme());
      resourceServer.register(POLYGON, new ExactEvmScheme());
      if (solanaPayTo()) resourceServer.register(SOLANA, new ExactSvmScheme());
      resourceServer.registerExtension(bazaarResourceServerExtension);
      const http = new x402HTTPResourceServer(resourceServer, buildRoutes() as never);
      await http.initialize();
      return http;
    })().catch((e) => {
      serverPromise = null; // retry on the next request; the kill switch counts the failures
      throw e;
    });
  }
  return serverPromise;
}

/**
 * For the watchdog: build + initialize the multi-rail server (validates every
 * rail against the facilitator's live /supported), without serving a request.
 */
export async function validateRails(): Promise<string[]> {
  await getServer();
  return activeRails().map((r) => r.label);
}

function adapterFor(req: NextRequest) {
  const u = new URL(req.url);
  return {
    getHeader: (name: string) => req.headers.get(name) ?? undefined,
    getMethod: () => req.method,
    getPath: () => u.pathname,
    getUrl: () => req.url,
    getAcceptHeader: () => req.headers.get("accept") ?? "",
    getUserAgent: () => req.headers.get("user-agent") ?? "",
    getQueryParams: () => Object.fromEntries(u.searchParams.entries()),
    getQueryParam: (name: string) => u.searchParams.get(name) ?? undefined,
    getBody: () => undefined,
  };
}

/** The v1 Base twin — same method, query and body (307). */
function fallbackToV1(req: NextRequest, def: RailRouteDef, why: string): NextResponse {
  const u = new URL(req.url);
  const res = NextResponse.redirect(`${CANONICAL_ORIGIN}${def.v1Path}${u.search}`, 307);
  res.headers.set("x-uxus-rail", `v1-fallback; ${why}`);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

function toResponse(r: { status: number; headers: Record<string, string>; body?: unknown }): NextResponse {
  const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
  const headers = new Headers(r.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  headers.set("Cache-Control", "no-store");
  return new NextResponse(body, { status: r.status, headers });
}

type Handler = (req: NextRequest) => Promise<Response>;

/** Wrap a v1 handler as a multi-rail v2 paid route. */
export function multiRail(id: RailRouteId, handler: Handler): Handler {
  const def = RAIL_ROUTES[id];
  return async (req: NextRequest) => {
    if (!(await multiRailEnabled(req))) return fallbackToV1(req, def, "multi-rail off");

    let http: x402HTTPResourceServer;
    try {
      http = await getServer();
    } catch (e) {
      await recordRailError("init", errMsg(e));
      return fallbackToV1(req, def, "multi-rail unavailable");
    }

    const paymentHeader = req.headers.get("payment-signature") || req.headers.get("x-payment") || undefined;
    const ctx = { adapter: adapterFor(req), path: def.v2Path, method: req.method, paymentHeader, routePattern: routeKey(def) };

    let result: Awaited<ReturnType<x402HTTPResourceServer["processHTTPRequest"]>>;
    try {
      result = await http.processHTTPRequest(ctx as never);
    } catch (e) {
      await recordRailError("verify", errMsg(e));
      return fallbackToV1(req, def, "payment verification unavailable");
    }

    if (result.type === "payment-error") {
      // 402 = the challenge (no payment yet) or a rejected payment — buyer-side, not ours.
      if (result.response.status >= 500) await recordRailError("verify", `HTTP ${result.response.status}: ${JSON.stringify(result.response.body).slice(0, 300)}`);
      return toResponse(result.response);
    }
    if (result.type === "no-payment-required") return handler(req);

    // Verified. Run the product; settle only on success.
    let res: Response;
    try {
      res = await handler(req);
    } catch (e) {
      console.error(`[x402v2] ${def.v2Path} handler threw`, errMsg(e));
      return NextResponse.json({ error: "internal_error", detail: "The request failed. Your payment was not settled — you were not charged." }, { status: 500 });
    }
    if (!res.ok) return res; // not settled -> not charged

    const body = Buffer.from(await res.arrayBuffer());
    let settle: Awaited<ReturnType<x402HTTPResourceServer["processSettlement"]>>;
    try {
      settle = await http.processSettlement(result.paymentPayload, result.paymentRequirements, result.declaredExtensions, {
        request: ctx as never,
        responseBody: body,
      });
    } catch (e) {
      await recordRailError("settle", errMsg(e));
      return fallbackToV1(req, def, "settlement unavailable; not charged");
    }
    if (!settle.success) {
      // A rejected settlement (e.g. funds moved after verify) is buyer-side; a facilitator failure is ours.
      if ((settle.response?.status ?? 0) >= 500) await recordRailError("settle", `${settle.errorReason}: ${settle.errorMessage ?? ""}`);
      return toResponse(settle.response);
    }

    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(settle.headers ?? {})) headers.set(k, v);
    headers.set("x-uxus-rail", `v2; ${settle.network ?? result.paymentRequirements.network}`);
    return new NextResponse(body, { status: res.status, headers });
  };
}

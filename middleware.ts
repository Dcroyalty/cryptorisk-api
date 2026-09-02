import { NextRequest, NextResponse } from "next/server";
import { paymentMiddleware, Network } from "x402-next";
import { facilitator } from "@coinbase/x402";

const PAY_TO = "0xe0ed7a30589fec49e98f2085c7162b90fdbb83de";
const N = "base" as Network;

const inner = paymentMiddleware(
  PAY_TO,
  {
    "/api/risk/pro": { price: "$0.01", network: N,
      config: { description: "Adds to the free /api/risk (score, level, verdict, flags): per-signal reasons with severity, the raw signals object (token buy/sell tax, mint/proxy/hidden-owner flags, or wallet age + tx count), and the source list behind every flag." } },
    "/api/risk/live/pro": { price: "$0.01", network: N,
      config: { description: "Adds to the free /api/risk/live (verdict, mutable_risk_score, time_to_rug): every owner power explained in plain English, the raw controls object (owner, EIP-1967 implementation + admin slots, pause state, pending owner), and the on-chain reads to reproduce the score." } },
    "/api/llm":      { price: "$0.01", network: N,
      config: { description: "Returns the completion text, the model that produced it (from a 5-model fallback chain), token usage, and latency_ms." } },
    "/api/scrape":   { price: "$0.01", network: N,
      config: { description: "Returns the fetched page past bot-blocking: title, meta description, body as markdown/text/html, a character count, and a truncation flag." } },
    "/api/extract":  { price: "$0.01", network: N,
      config: { description: "Returns a JSON object populated to the schema you POST, extracted from your text or URL, plus the model that produced it." } },
    "/api/embed":    { price: "$0.01", network: N,
      config: { description: "Returns one 1024-dim jina-embeddings-v3 vector per input string (up to 64), with the dimension count and token usage." } },
    "/api/search":   { price: "$0.01", network: N,
      config: { description: "Returns a ranked list of {title, url, description} results plus which provider (Serper, Brave, or DuckDuckGo) served them." } },
  },
  facilitator as any
);

// x402-next's paymentMiddleware exposes no response hook. Wrap it: on a 402,
// add a PAYMENT-REQUIRED header carrying the base64-encoded v1 challenge that
// already lives in the JSON body. Additive only — the body is written back
// byte-for-byte, so v1 clients (which read the body) are unaffected. Directory
// probes (402 Index, x402scan) classify x402 on response-header presence and
// never read the body.
export async function middleware(req: NextRequest): Promise<NextResponse> {
  const res = await inner(req);
  if (res.status !== 402) return res;

  const body = await res.text();
  const headers = new Headers(res.headers);
  headers.set("PAYMENT-REQUIRED", Buffer.from(body, "utf8").toString("base64"));
  headers.delete("content-length"); // recomputed from the (identical) body

  return new NextResponse(body, { status: 402, statusText: res.statusText, headers });
}

export const config = {
  matcher: ["/api/risk/pro", "/api/risk/live/pro", "/api/llm", "/api/scrape", "/api/extract", "/api/embed", "/api/search"],
  runtime: "nodejs",
};

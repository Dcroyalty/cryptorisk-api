import { NextRequest, NextResponse } from "next/server";
import { paymentMiddleware, Network } from "x402-next";
import { facilitator } from "@coinbase/x402";

const PAY_TO = "0xe0ed7a30589fec49e98f2085c7162b90fdbb83de";
const N = "base" as Network;

const inner = paymentMiddleware(
  PAY_TO,
  {
    "/api/risk/pro": { price: "$0.01", network: N,
      config: { description: "Risk: wallet/token risk report (OFAC sanctions, scam lists, honeypot signals)." } },
    "/api/risk/live/pro": { price: "$0.01", network: N,
      config: { description: "Risk LIVE PRO: full mutable-risk breakdown - every owner power + raw on-chain controls." } },
    "/api/llm":      { price: "$0.01", network: N,
      config: { description: "LLM: pay-per-call AI inference. No API key, no account. POST {prompt} -> completion." } },
    "/api/scrape":   { price: "$0.01", network: N,
      config: { description: "Scrape: any URL -> clean markdown/text + title/description. No key, no account." } },
    "/api/extract":  { price: "$0.01", network: N,
      config: { description: "Extract: messy text or URL -> structured JSON matching your schema." } },
    "/api/embed":    { price: "$0.01", network: N,
      config: { description: "Embeddings: text -> vectors (jina-embeddings-v3). Batch up to 64." } },
    "/api/search":   { price: "$0.01", network: N,
      config: { description: "Search: live web search results as clean JSON." } },
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

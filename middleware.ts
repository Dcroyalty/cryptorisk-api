import { paymentMiddleware, Network } from "x402-next";
import { facilitator } from "@coinbase/x402";

const PAY_TO = "0xe0ed7a30589fec49e98f2085c7162b90fdbb83de";
const N = "base" as Network;

export const middleware = paymentMiddleware(
  PAY_TO,
  {
    "/api/risk/pro": { price: "$0.01", network: N,
      config: { description: "Risk: wallet/token risk report (OFAC sanctions, scam lists, honeypot signals)." } },
    "/api/llm":      { price: "$0.01", network: N,
      config: { description: "LLM: pay-per-call AI inference. No API key, no account. POST {prompt} -> completion." } },
    "/api/scrape":   { price: "$0.01", network: N,
      config: { description: "Scrape: any URL -> clean markdown/text + title/description. No key, no account." } },
    "/api/extract":  { price: "$0.02", network: N,
      config: { description: "Extract: messy text or URL -> structured JSON matching your schema." } },
    "/api/embed":    { price: "$0.01", network: N,
      config: { description: "Embeddings: text -> vectors (jina-embeddings-v3). Batch up to 64." } },
    "/api/search":   { price: "$0.02", network: N,
      config: { description: "Search: live web search results as clean JSON." } },
  },
  facilitator as any
);

export const config = {
  matcher: ["/api/risk/pro", "/api/llm", "/api/scrape", "/api/extract", "/api/embed", "/api/search"],
  runtime: "nodejs",
};

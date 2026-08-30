// app/api/embed/route.ts — x402 Embeddings Gateway. $0.01 USDC/call on Base.
// Env: JINA_API_KEY (free key at jina.ai)
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const key = process.env.JINA_API_KEY;
  if (!key) return NextResponse.json({ error: "gateway_unconfigured", detail: "Embeddings not enabled yet." }, { status: 503 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const raw = body?.input ?? body?.text;
  const input = Array.isArray(raw) ? raw.slice(0, 64).map(String) : raw ? [String(raw)] : null;
  if (!input) return NextResponse.json({ error: "bad_request", detail: "Provide input: string or string[] (max 64)." }, { status: 400 });

  const started = Date.now();
  const r = await fetch("https://api.jina.ai/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "jina-embeddings-v3", task: "retrieval.passage", input }),
  });
  if (!r.ok) return NextResponse.json({ error: "upstream_error", status: r.status, detail: (await r.text()).slice(0, 300) }, { status: 502 });
  const d = await r.json();
  return NextResponse.json({
    model: "jina-embeddings-v3",
    embeddings: (d?.data ?? []).map((x: any) => x.embedding),
    dimensions: d?.data?.[0]?.embedding?.length ?? null,
    count: d?.data?.length ?? 0,
    usage: d?.usage ?? null,
    latency_ms: Date.now() - started, served_by: "x402-embed-gateway",
  }, { status: 200 });
}

export async function GET() {
  return NextResponse.json({ service: "x402 Embeddings Gateway", method: "POST",
    price: "$0.01 USDC on Base per call", body: { input: "string or string[] (max 64)" },
    model: "jina-embeddings-v3" }, { status: 200 });
}

import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@/lib/x402v2";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = withX402(
  { path: "/api/embed", method: "POST", price: "$0.01",
    description: "Text to embedding vectors (jina-embeddings-v3, 1024 dims). Batch up to 64 strings.",
    tags: ["embeddings","vectors","rag","agent"] },
  async (req: NextRequest) => {
    const key = process.env.JINA_API_KEY;
    if (!key) return NextResponse.json({ error: "gateway_unconfigured" }, { status: 503 });
    let body: any = {}; try { body = await req.json(); } catch {}
    const raw = body?.input ?? body?.text;
    const input = Array.isArray(raw) ? raw.slice(0, 64).map(String) : raw ? [String(raw)] : null;
    if (!input) return NextResponse.json({ error: "bad_request", detail: "input is required" }, { status: 400 });
    const started = Date.now();
    const r = await fetch("https://api.jina.ai/v1/embeddings", {
      method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "jina-embeddings-v3", task: "retrieval.passage", input }) });
    if (!r.ok) return NextResponse.json({ error: "upstream_error", status: r.status }, { status: 502 });
    const d = await r.json();
    return { model: "jina-embeddings-v3", embeddings: (d?.data ?? []).map((x: any) => x.embedding),
      dimensions: d?.data?.[0]?.embedding?.length ?? null, count: d?.data?.length ?? 0,
      usage: d?.usage ?? null, latency_ms: Date.now() - started, served_by: "x402-embed-gateway" };
  }
);

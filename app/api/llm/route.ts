// app/api/llm/route.ts — x402 LLM Gateway. $0.01 USDC/call on Base.
// Tries a chain of models so a paid call never dies on one unavailable slug.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Tried in order. Free first, then dirt-cheap paid as guaranteed fallback.
const CHAIN = [
  "deepseek/deepseek-chat-v3-0324:free",
  "google/gemini-2.0-flash-exp:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "deepseek/deepseek-chat",
  "openai/gpt-4o-mini",
];

async function callModel(key: string, model: string, msgs: any[], max_tokens: number) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://uxus.finance",
      "X-Title": "x402 LLM Gateway",
    },
    body: JSON.stringify({ model, messages: msgs, max_tokens }),
  });
  if (!r.ok) return { ok: false as const, status: r.status, detail: (await r.text()).slice(0, 300) };
  const data = await r.json();
  const content = data?.choices?.[0]?.message?.content ?? "";
  if (!content) return { ok: false as const, status: 502, detail: "empty completion" };
  return { ok: true as const, content, usage: data?.usage ?? null };
}

export async function POST(req: NextRequest) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return NextResponse.json({ error: "gateway_unconfigured" }, { status: 500 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const msgs = Array.isArray(body?.messages) && body.messages.length
    ? body.messages
    : body?.prompt ? [{ role: "user", content: String(body.prompt) }] : null;
  if (!msgs) return NextResponse.json({ error: "bad_request", detail: "Provide prompt or messages[]." }, { status: 400 });

  const max_tokens = Math.min(Number(body?.max_tokens) || 800, 2000);
  const chain = body?.model ? [String(body.model), ...CHAIN] : CHAIN;

  const started = Date.now();
  const tried: string[] = [];
  for (const model of chain) {
    const out = await callModel(key, model, msgs, max_tokens);
    tried.push(model);
    if (out.ok) {
      return NextResponse.json({
        model, content: out.content, usage: out.usage,
        latency_ms: Date.now() - started, served_by: "x402-llm-gateway",
      }, { status: 200 });
    }
  }
  return NextResponse.json({ error: "all_models_failed", tried }, { status: 502 });
}

export async function GET() {
  return NextResponse.json({
    service: "x402 LLM Gateway", method: "POST",
    price: "$0.01 USDC on Base per call",
    body: { prompt: "string (or messages[])", model: "optional", max_tokens: "optional, max 2000" },
    models: CHAIN,
  }, { status: 200 });
}

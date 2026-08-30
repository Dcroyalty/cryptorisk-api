// app/api/llm/route.ts
// x402 LLM GATEWAY — agents pay $0.01 USDC on Base, get an LLM completion.
// No API keys, no accounts. Replicates the top-earning x402 pattern.
//
// Upstream: OpenRouter (one key, every model). Free-tier models = ~100% margin.
// Env needed on Vercel:  OPENROUTER_API_KEY

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cheap/free models first. ":free" models cost nothing upstream.
const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
const ALLOWED = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemini-2.0-flash-exp:free",
  "deepseek/deepseek-chat",
  "openai/gpt-4o-mini",
  "anthropic/claude-3.5-haiku",
];

export async function POST(req: NextRequest) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "gateway_unconfigured" }, { status: 500 });
  }

  let body: any = {};
  try { body = await req.json(); } catch {}

  const messages = body?.messages;
  const prompt = body?.prompt;
  const model = ALLOWED.includes(body?.model) ? body.model : DEFAULT_MODEL;
  const max_tokens = Math.min(Number(body?.max_tokens) || 800, 2000);

  const msgs = Array.isArray(messages) && messages.length
    ? messages
    : prompt
      ? [{ role: "user", content: String(prompt) }]
      : null;

  if (!msgs) {
    return NextResponse.json(
      { error: "bad_request", detail: "Provide messages[] or prompt. Optional: model, max_tokens." },
      { status: 400 }
    );
  }

  const started = Date.now();
  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://cryptorisk-api.vercel.app",
      "X-Title": "x402 LLM Gateway",
    },
    body: JSON.stringify({ model, messages: msgs, max_tokens }),
  });

  if (!upstream.ok) {
    const t = await upstream.text();
    return NextResponse.json(
      { error: "upstream_error", status: upstream.status, detail: t.slice(0, 400) },
      { status: 502 }
    );
  }

  const data = await upstream.json();
  const text = data?.choices?.[0]?.message?.content ?? "";

  return NextResponse.json({
    model,
    content: text,
    usage: data?.usage ?? null,
    latency_ms: Date.now() - started,
    served_by: "x402-llm-gateway",
  }, { status: 200 });
}

export async function GET() {
  return NextResponse.json({
    service: "x402 LLM Gateway",
    method: "POST",
    price: "$0.01 USDC on Base per call",
    body: { prompt: "string (or messages[])", model: "optional", max_tokens: "optional, max 2000" },
    models: ALLOWED,
  }, { status: 200 });
}

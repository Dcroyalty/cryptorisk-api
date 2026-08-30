import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@/lib/x402v2";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHAIN = ["deepseek/deepseek-chat-v3-0324:free","google/gemini-2.0-flash-exp:free","qwen/qwen-2.5-72b-instruct:free","deepseek/deepseek-chat","openai/gpt-4o-mini"];

async function callModel(key: string, model: string, msgs: any[], max_tokens: number) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json",
      "HTTP-Referer": "https://cryptorisk-api.vercel.app", "X-Title": "x402 LLM Gateway" },
    body: JSON.stringify({ model, messages: msgs, max_tokens }),
  });
  if (!r.ok) return null;
  const d = await r.json();
  const content = d?.choices?.[0]?.message?.content ?? "";
  return content ? { content, usage: d?.usage ?? null } : null;
}

export const POST = withX402(
  { path: "/api/llm", method: "POST", price: "$0.01",
    description: "LLM inference without an API key. POST a prompt, get a completion.",
    tags: ["llm","ai","inference","agent"] },
  async (req: NextRequest) => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return NextResponse.json({ error: "gateway_unconfigured" }, { status: 500 });
    let body: any = {}; try { body = await req.json(); } catch {}
    const msgs = Array.isArray(body?.messages) && body.messages.length ? body.messages
      : body?.prompt ? [{ role: "user", content: String(body.prompt) }] : null;
    if (!msgs) return NextResponse.json({ error: "bad_request", detail: "Provide prompt or messages[]." }, { status: 400 });
    const max_tokens = Math.min(Number(body?.max_tokens) || 800, 2000);
    const chain = body?.model ? [String(body.model), ...CHAIN] : CHAIN;
    const started = Date.now();
    for (const model of chain) {
      const out = await callModel(key, model, msgs, max_tokens);
      if (out) return { model, content: out.content, usage: out.usage, latency_ms: Date.now() - started, served_by: "x402-llm-gateway" };
    }
    return NextResponse.json({ error: "all_models_failed" }, { status: 502 });
  }
);

export async function GET() {
  return NextResponse.json({ service: "x402 LLM Gateway", method: "POST",
    price: "$0.01 USDC on Base per call", models: CHAIN }, { status: 200 });
}

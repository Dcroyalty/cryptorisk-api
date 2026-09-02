// app/api/extract/route.ts — x402 Extract Gateway. $0.01 USDC/call on Base.
// Messy HTML/text/URL -> structured JSON matching the caller's schema.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHAIN = ["deepseek/deepseek-chat", "openai/gpt-4o-mini", "google/gemini-2.0-flash-exp:free"];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function clean(html: string) {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  return s.replace(/\s{2,}/g, " ").trim();
}

export async function POST(req: NextRequest) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return NextResponse.json({ error: "gateway_unconfigured" }, { status: 500 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const schema = body?.schema;
  let text: string = body?.text || "";
  const url: string = body?.url || "";

  if (!schema) return NextResponse.json({ error: "bad_request", detail: "Provide schema (JSON object describing fields you want) plus text or url." }, { status: 400 });

  if (!text && url) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
      text = clean(await r.text());
    } catch (e: any) {
      return NextResponse.json({ error: "fetch_failed", detail: String(e?.message ?? e) }, { status: 502 });
    }
  }
  if (!text) return NextResponse.json({ error: "bad_request", detail: "No text to extract from." }, { status: 400 });
  text = text.slice(0, 30000);

  const sys = "You extract structured data. Return ONLY valid JSON matching the requested schema. No markdown fences, no commentary. Use null for fields you cannot find.";
  const user = `Schema:\n${JSON.stringify(schema)}\n\nSource text:\n${text}`;

  const started = Date.now();
  for (const model of CHAIN) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json",
                   "HTTP-Referer": "https://uxus.finance", "X-Title": "x402 Extract Gateway" },
        body: JSON.stringify({ model, max_tokens: 1500,
          messages: [{ role: "system", content: sys }, { role: "user", content: user }] }),
      });
      if (!r.ok) continue;
      const d = await r.json();
      let out = (d?.choices?.[0]?.message?.content ?? "").trim();
      out = out.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      let parsed: any;
      try { parsed = JSON.parse(out); } catch { continue; }
      return NextResponse.json({ data: parsed, model, latency_ms: Date.now() - started, served_by: "x402-extract-gateway" }, { status: 200 });
    } catch { continue; }
  }
  return NextResponse.json({ error: "extraction_failed" }, { status: 502 });
}

export async function GET() {
  return NextResponse.json({
    service: "x402 Extract Gateway", method: "POST", price: "$0.01 USDC on Base per call",
    body: { schema: "JSON object of fields you want", text: "raw text (or)", url: "page to fetch" },
    example: { schema: { title: "string", price: "number", in_stock: "boolean" }, url: "https://example.com/product" },
  }, { status: 200 });
}

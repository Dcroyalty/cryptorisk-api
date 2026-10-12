// app/api/extract/route.ts — x402 Extract Gateway. $0.01 USDC/call on Base.
// Messy HTML/text/URL -> structured JSON matching the caller's schema.
//
// Reliability (2026-10-12, our one returning customer calls this ~twice a day):
// x402 v1 settles BEFORE this handler runs, so a failure here still costs the caller. So:
//   - the page fetch is capped at 10 s and a non-2xx page is reported, not extracted;
//   - each model gets at most 20 s and JSON mode, temperature 0; the whole call is capped at 45 s;
//   - the fallback chain uses paid, current model slugs (the old ":free" experimental model is gone);
//   - every paid failure is recorded (payer, reason) in paid_call_failures so it can be refunded.
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHAIN = ["openai/gpt-4o-mini", "deepseek/deepseek-chat", "google/gemini-2.0-flash-001"];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const FETCH_MS = 10_000, MODEL_MS = 20_000, TOTAL_MS = 45_000, MAX_TEXT = 30_000;

function clean(html: string) {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  s = s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return s.replace(/\s{2,}/g, " ").trim();
}

/** The paying wallet, from the x402 v1 X-PAYMENT header (base64 JSON). Null when absent or unreadable. */
function payerOf(req: NextRequest): string | null {
  try {
    const h = req.headers.get("x-payment");
    if (!h) return null;
    const p = JSON.parse(Buffer.from(h, "base64").toString("utf8"));
    const from = p?.payload?.authorization?.from;
    return typeof from === "string" ? from.toLowerCase() : null;
  } catch { return null; }
}

let tableReady = false;
/** A paid call that failed: kept so the payer can be refunded by hand (see /refunds). Never throws. */
async function recordPaidFailure(req: NextRequest, reason: string, detail: string) {
  const payer = payerOf(req);
  console.error("[extract] paid call failed", { payer, reason, detail: detail.slice(0, 300) });
  if (!payer) return; // not a paid call — nothing to refund
  try {
    if (!tableReady) {
      await sql`CREATE TABLE IF NOT EXISTS paid_call_failures (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), route text NOT NULL, payer text, reason text NOT NULL, detail text, refunded_at timestamptz)`;
      tableReady = true;
    }
    await sql`INSERT INTO paid_call_failures (route, payer, reason, detail) VALUES ('/api/extract', ${payer}, ${reason}, ${detail.slice(0, 1000)})`;
  } catch (e) { console.error("[extract] could not record the failure", e); }
}

async function fail(req: NextRequest, status: number, error: string, detail: string) {
  await recordPaidFailure(req, error, detail);
  return NextResponse.json({ error, detail, refund: "If you were charged for this failed call, see https://uxus.finance/refunds." }, { status });
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return fail(req, 500, "gateway_unconfigured", "OPENROUTER_API_KEY is not set");

  let body: any = {};
  try { body = await req.json(); } catch {}
  const schema = body?.schema;
  let text: string = typeof body?.text === "string" ? body.text : "";
  const url: string = typeof body?.url === "string" ? body.url : "";

  if (!schema || typeof schema !== "object") return fail(req, 400, "bad_request", "Provide schema (a JSON object describing the fields you want) plus text or url.");

  if (!text && url) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(FETCH_MS) });
      if (!r.ok) return fail(req, 502, "fetch_failed", `The page answered HTTP ${r.status}.`);
      const raw = await r.text();
      text = /html/i.test(r.headers.get("content-type") ?? "html") ? clean(raw) : raw.trim();
    } catch (e: any) {
      return fail(req, 502, "fetch_failed", e?.name === "TimeoutError" ? `The page did not answer within ${FETCH_MS / 1000} s.` : String(e?.message ?? e));
    }
  }
  if (!text) return fail(req, 400, "bad_request", "No text to extract from.");
  text = text.slice(0, MAX_TEXT);

  const sys = "You extract structured data. Return ONLY one JSON object whose keys are exactly the schema's fields. No markdown, no commentary. Use null for any field you cannot find in the source.";
  const user = `Schema:\n${JSON.stringify(schema)}\n\nSource text:\n${text}`;

  const tried: string[] = [];
  for (const model of CHAIN) {
    const left = TOTAL_MS - (Date.now() - started);
    if (left < 3_000) break;
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://uxus.finance", "X-Title": "x402 Extract Gateway" },
        body: JSON.stringify({ model, max_tokens: 1500, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: sys }, { role: "user", content: user }] }),
        signal: AbortSignal.timeout(Math.min(MODEL_MS, left)),
      });
      if (!r.ok) { tried.push(`${model}: HTTP ${r.status}`); continue; }
      const d = await r.json();
      const out = String(d?.choices?.[0]?.message?.content ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      let parsed: any;
      try { parsed = JSON.parse(out); } catch { tried.push(`${model}: not JSON`); continue; }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { tried.push(`${model}: not an object`); continue; }
      return NextResponse.json({ data: parsed, model, latency_ms: Date.now() - started, served_by: "x402-extract-gateway" }, { status: 200 });
    } catch (e: any) { tried.push(`${model}: ${e?.name === "TimeoutError" ? "timed out" : String(e?.message ?? e)}`); continue; }
  }
  return fail(req, 502, "extraction_failed", `No model returned valid JSON (${tried.join("; ") || "out of time"}).`);
}

export async function GET() {
  return NextResponse.json({
    service: "x402 Extract Gateway", method: "POST", price: "$0.01 USDC on Base per call",
    body: { schema: "JSON object of fields you want", text: "raw text (or)", url: "page to fetch" },
    returns: { data: "an object with exactly your schema's fields (null when not found)", model: "the model that answered", latency_ms: "time taken" },
    limits: { page_fetch_seconds: FETCH_MS / 1000, total_seconds: TOTAL_MS / 1000, max_source_chars: MAX_TEXT },
    example: { schema: { title: "string", price: "number", in_stock: "boolean" }, url: "https://example.com/product" },
  }, { status: 200 });
}

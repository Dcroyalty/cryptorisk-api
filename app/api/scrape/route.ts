// app/api/scrape/route.ts — x402 Scrape Gateway. $0.01 USDC/call on Base.
// Fetches any URL and returns clean markdown/text + metadata. Own compute, no upstream cost.
// Handles the things agents choke on: bot-blocking, messy HTML, boilerplate.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function stripToText(html: string) {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, " ");
  s = s.replace(/<nav[\s\S]*?<\/nav>/gi, " ");
  s = s.replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  s = s.replace(/<header[\s\S]*?<\/header>/gi, " ");
  s = s.replace(/<form[\s\S]*?<\/form>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  return s;
}

function toMarkdown(html: string) {
  let s = stripToText(html);
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, t) => "\n\n# " + t.replace(/<[^>]+>/g, "").trim() + "\n\n");
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, t) => "\n\n## " + t.replace(/<[^>]+>/g, "").trim() + "\n\n");
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, t) => "\n\n### " + t.replace(/<[^>]+>/g, "").trim() + "\n\n");
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, t) => "\n- " + t.replace(/<[^>]+>/g, "").trim());
  s = s.replace(/<\/(p|div|section|article|tr|br)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
       .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  s = s.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function pick(html: string, re: RegExp) { const m = html.match(re); return m ? m[1].trim() : null; }

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const target = (searchParams.get("url") || "").trim();
  const format = (searchParams.get("format") || "markdown").toLowerCase();
  const maxChars = Math.min(Number(searchParams.get("max_chars")) || 40000, 120000);

  if (!target) {
    return NextResponse.json({
      service: "x402 Scrape Gateway",
      usage: "GET /api/scrape?url=https://example.com&format=markdown|text|html&max_chars=40000",
      price: "$0.01 USDC on Base per call",
    }, { status: 400 });
  }
  let u: URL;
  try { u = new URL(target); } catch { return NextResponse.json({ error: "invalid_url" }, { status: 400 }); }
  if (!["http:", "https:"].includes(u.protocol)) return NextResponse.json({ error: "invalid_protocol" }, { status: 400 });

  const started = Date.now();
  let r: Response;
  try {
    r = await fetch(u.toString(), {
      headers: {
        "user-agent": UA,
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
  } catch (e: any) {
    return NextResponse.json({ error: "fetch_failed", detail: String(e?.message ?? e) }, { status: 502 });
  }

  const ctype = r.headers.get("content-type") || "";
  const raw = await r.text();

  if (!ctype.includes("html")) {
    return NextResponse.json({
      url: u.toString(), status: r.status, content_type: ctype,
      content: raw.slice(0, maxChars), format: "raw",
      latency_ms: Date.now() - started, served_by: "x402-scrape-gateway",
    }, { status: 200 });
  }

  const title = pick(raw, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = pick(raw, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || pick(raw, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);

  let content: string;
  if (format === "html") content = raw;
  else if (format === "text") content = stripToText(raw).replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
  else content = toMarkdown(raw);

  const truncated = content.length > maxChars;
  return NextResponse.json({
    url: u.toString(), status: r.status, title, description,
    format, content: content.slice(0, maxChars), truncated,
    chars: Math.min(content.length, maxChars),
    latency_ms: Date.now() - started, served_by: "x402-scrape-gateway",
  }, { status: 200 });
}

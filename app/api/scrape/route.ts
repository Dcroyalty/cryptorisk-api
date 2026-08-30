import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@/lib/x402v2";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
function stripToText(html: string) {
  let s = html;
  for (const tag of ["script","style","noscript","svg","nav","footer","header","form"]) {
    s = s.replace(new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, "gi"), " ");
  }
  return s.replace(/<!--[\s\S]*?-->/g, " ");
}
function toMarkdown(html: string) {
  let s = stripToText(html);
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, t) => "\n\n# " + t.replace(/<[^>]+>/g, "").trim() + "\n\n");
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, t) => "\n\n## " + t.replace(/<[^>]+>/g, "").trim() + "\n\n");
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, t) => "\n\n### " + t.replace(/<[^>]+>/g, "").trim() + "\n\n");
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, t) => "\n- " + t.replace(/<[^>]+>/g, "").trim());
  s = s.replace(/<\/(p|div|section|article|tr|br)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return s.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function pick(html: string, re: RegExp) { const m = html.match(re); return m ? m[1].trim() : null; }

export const GET = withX402(
  { path: "/api/scrape", method: "GET", price: "$0.01",
    description: "Fetch any URL and return clean markdown or text plus title and description.",
    tags: ["scrape","web","markdown","agent"] },
  async (req: NextRequest) => {
    const { searchParams } = new URL(req.url);
    const target = (searchParams.get("url") || "").trim();
    const format = (searchParams.get("format") || "markdown").toLowerCase();
    const maxChars = Math.min(Number(searchParams.get("max_chars")) || 40000, 120000);
    if (!target) return NextResponse.json({ error: "bad_request", detail: "url is required" }, { status: 400 });
    let u: URL; try { u = new URL(target); } catch { return NextResponse.json({ error: "invalid_url" }, { status: 400 }); }
    if (!["http:","https:"].includes(u.protocol)) return NextResponse.json({ error: "invalid_protocol" }, { status: 400 });
    const started = Date.now();
    let r: Response;
    try {
      r = await fetch(u.toString(), { headers: { "user-agent": UA,
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" }, redirect: "follow" });
    } catch (e: any) { return NextResponse.json({ error: "fetch_failed", detail: String(e?.message ?? e) }, { status: 502 }); }
    const ctype = r.headers.get("content-type") || "";
    const raw = await r.text();
    if (!ctype.includes("html")) {
      return { url: u.toString(), status: r.status, content_type: ctype, content: raw.slice(0, maxChars),
        format: "raw", latency_ms: Date.now() - started, served_by: "x402-scrape-gateway" };
    }
    const title = pick(raw, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const description = pick(raw, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
      || pick(raw, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    let content: string;
    if (format === "html") content = raw;
    else if (format === "text") content = stripToText(raw).replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
    else content = toMarkdown(raw);
    return { url: u.toString(), status: r.status, title, description, format,
      content: content.slice(0, maxChars), truncated: content.length > maxChars,
      chars: Math.min(content.length, maxChars), latency_ms: Date.now() - started, served_by: "x402-scrape-gateway" };
  }
);

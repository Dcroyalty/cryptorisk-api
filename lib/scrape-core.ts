// lib/scrape-core.ts — URL -> clean content, shared by the paid /api/scrape
// route and the free MCP scrape_url tool. Own compute, no upstream cost.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export interface ScrapeResult {
  url: string;
  status: number;
  title: string | null;
  description: string | null;
  format: "markdown" | "text" | "html" | "raw";
  content: string;
  truncated: boolean;
  chars: number;
  content_type?: string;
  latency_ms: number;
  served_by: string;
}

export class ScrapeError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function stripToText(html: string): string {
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

function toMarkdown(html: string): string {
  let s = stripToText(html);
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, t) => "\n\n# " + t.replace(/<[^>]+>/g, "").trim() + "\n\n");
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, t) => "\n\n## " + t.replace(/<[^>]+>/g, "").trim() + "\n\n");
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, t) => "\n\n### " + t.replace(/<[^>]+>/g, "").trim() + "\n\n");
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, t) => "\n- " + t.replace(/<[^>]+>/g, "").trim());
  s = s.replace(/<\/(p|div|section|article|tr|br)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  s = s.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function pick(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

export async function scrapeUrl(
  targetRaw: string,
  formatRaw: string,
  maxCharsRaw: number,
  hardCap = 120000,
): Promise<ScrapeResult> {
  const target = (targetRaw || "").trim();
  const format = (formatRaw || "markdown").toLowerCase();
  const maxChars = Math.min(Math.max(Number(maxCharsRaw) || 40000, 1000), hardCap);

  if (!target) throw new ScrapeError("missing_url", "url is required");
  let u: URL;
  try {
    u = new URL(target);
  } catch {
    throw new ScrapeError("invalid_url", "url must be an absolute http(s) URL");
  }
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new ScrapeError("invalid_protocol", "url must use http or https");
  }

  const started = Date.now();
  let r: Response;
  try {
    r = await fetch(u.toString(), {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
  } catch (e) {
    throw new ScrapeError("fetch_failed", String((e as Error)?.message ?? e), 502);
  }

  const ctype = r.headers.get("content-type") || "";
  const raw = await r.text();

  if (!ctype.includes("html")) {
    const content = raw.slice(0, maxChars);
    return {
      url: u.toString(),
      status: r.status,
      title: null,
      description: null,
      content_type: ctype,
      content,
      format: "raw",
      truncated: raw.length > maxChars,
      chars: content.length,
      latency_ms: Date.now() - started,
      served_by: "x402-scrape-gateway",
    };
  }

  const title = pick(raw, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    pick(raw, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    pick(raw, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);

  let content: string;
  if (format === "html") content = raw;
  else if (format === "text") content = stripToText(raw).replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim();
  else content = toMarkdown(raw);

  const truncated = content.length > maxChars;
  return {
    url: u.toString(),
    status: r.status,
    title,
    description,
    format: (format === "html" || format === "text" ? format : "markdown") as "markdown" | "text" | "html",
    content: content.slice(0, maxChars),
    truncated,
    chars: Math.min(content.length, maxChars),
    latency_ms: Date.now() - started,
    served_by: "x402-scrape-gateway",
  };
}

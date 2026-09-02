// app/api/resolve/route.ts — bidirectional name <-> address resolution. FREE.
// GET /api/resolve?q=<name or address>. Auto-detects direction. One envelope
// both ways. Never invents a resolution. Not in the middleware matcher.
import { NextRequest, NextResponse } from "next/server";
import { detectName } from "@/lib/name-detect";
import { resolveForward, resolveReverse, type Resolution } from "@/lib/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCEPTS =
  "an ENS name (name.eth), a Basename (name.base.eth), an EVM address (0x + 40 hex), or an XRPL classic r-address.";

export async function GET(req: NextRequest) {
  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  if (!q) {
    return NextResponse.json(
      { error: "missing_query", detail: `Provide ?q=. Accepts: ${ACCEPTS}` },
      { status: 400 },
    );
  }

  const det = detectName(q);

  if (det.kind === "unknown") {
    return NextResponse.json(
      { error: "unrecognized_query", detail: `Could not classify the query. Accepts: ${ACCEPTS}` },
      { status: 400 },
    );
  }

  // .xrp name — recognized, but there is no canonical resolver
  if (det.namespace === "xrp") {
    return NextResponse.json(
      envelope(q, det, {
        resolved: false,
        address: null,
        name: q,
        namespace: null,
        chain: "xrpl",
        sources: [],
        note: "no canonical .xrp resolver — XRPNames and XRPL Name Service are competing, non-interoperable registries",
      }),
      { status: 200, headers: { "Cache-Control": "public, max-age=30" } },
    );
  }

  // XRPL classic address — no permissionless reverse lookup
  if (det.namespace === "xrpl") {
    return NextResponse.json(
      envelope(q, det, {
        resolved: false,
        address: q,
        name: null,
        namespace: null,
        chain: "xrpl",
        sources: [],
        note: "no permissionless reverse lookup for XRPL addresses",
      }),
      { status: 200, headers: { "Cache-Control": "public, max-age=30" } },
    );
  }

  // name -> address
  if (det.kind === "name") {
    const r = await resolveForward(q, det.namespace === "basename" ? "basename" : "ens");
    return NextResponse.json(envelope(q, det, r), {
      status: 200,
      headers: { "Cache-Control": "public, max-age=60" },
    });
  }

  // EVM address -> primary name (ENS mainnet, then Basenames)
  const r = await resolveReverse(q.toLowerCase());
  return NextResponse.json(envelope(q, det, r), {
    status: 200,
    headers: { "Cache-Control": "public, max-age=60" },
  });
}

function envelope(query: string, det: ReturnType<typeof detectName>, r: Resolution & { note?: string }) {
  const address = r.address ?? null;
  const out: Record<string, unknown> = {
    query,
    kind: det.kind,
    namespace: r.namespace ?? (det.namespace === "unknown" ? null : det.namespace),
    chain: r.chain ?? (det.chain === "unknown" || det.chain === "evm" ? null : det.chain),
    resolved: !!r.resolved,
    address,
    name: r.name ?? null,
    sources: r.sources ?? [],
    // cross-link: when we have an address, point at /api/lookup for it
    lookup: address ? `/api/lookup?address=${address}` : null,
  };
  if (r.note) out.note = r.note;
  return out;
}

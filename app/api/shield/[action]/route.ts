// app/api/shield/[action]/route.ts — per-user private wallet blocklist. FREE (v1).
//
// Not in the middleware matcher — /api/shield/* is never a paid path.
//
// Actions:
//   GET  /api/shield/nonce?owner=0x...        -> { owner, nonce, expires_at }   (also sweeps expired state)
//   POST /api/shield/session { owner, signature }        -> { token, owner, expires_at }
//   POST /api/shield/block   { owner, signature, address, chain?, reason? }
//   POST /api/shield/unblock { owner, signature, address, chain? }
//   POST /api/shield/allow   { owner, signature, address, reason? }
//   POST /api/shield/unallow { owner, signature, address }
//   GET  /api/shield/list    (Bearer)                    -> { owner, blocks[], allows[], counts }
//   GET  /api/shield/check?address=0x...&chain=base|ethereum  (Bearer)
//   GET  /api/shield/stats   (Bearer)                    -> 7d / 30d / 90d, 90-day retention
import { NextRequest, NextResponse } from "next/server";
import * as Shield from "@/lib/shield";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function fail(e: unknown): NextResponse {
  if (e instanceof Shield.ShieldError) {
    return NextResponse.json({ error: e.code, detail: e.message }, { status: e.status, headers: NO_STORE });
  }
  return NextResponse.json(
    { error: "internal", detail: String((e as Error)?.message ?? e) },
    { status: 500, headers: NO_STORE },
  );
}

const WRITE_ACTIONS = new Set(["block", "unblock", "allow", "unallow"]);

export async function GET(req: NextRequest, ctx: { params: Promise<{ action: string }> }): Promise<NextResponse> {
  const { action } = await ctx.params;
  const url = new URL(req.url);
  try {
    if (action === "nonce") {
      const owner = url.searchParams.get("owner") || "";
      await Shield.sweep().catch(() => {}); // opportunistic; never blocks the response
      return NextResponse.json(await Shield.issueNonce(owner), { headers: NO_STORE });
    }

    if (action === "list") {
      const owner = await Shield.ownerFromBearer(req.headers.get("authorization"));
      return NextResponse.json(await Shield.listLists(owner), { headers: NO_STORE });
    }

    if (action === "check") {
      const owner = await Shield.ownerFromBearer(req.headers.get("authorization"));
      const address = url.searchParams.get("address") || "";
      const chain = (url.searchParams.get("chain") || "base").toLowerCase();
      if (chain !== "base" && chain !== "ethereum") {
        return NextResponse.json(
          { error: "unsupported_chain", detail: "chain must be 'base' or 'ethereum'" },
          { status: 400, headers: NO_STORE },
        );
      }
      return NextResponse.json(
        await Shield.checkAddress(owner, address, chain as "base" | "ethereum"),
        { headers: NO_STORE },
      );
    }

    if (action === "stats") {
      const owner = await Shield.ownerFromBearer(req.headers.get("authorization"));
      return NextResponse.json(await Shield.stats(owner), { headers: NO_STORE });
    }

    return NextResponse.json({ error: "not_found", detail: `no GET action '${action}'` }, { status: 404, headers: NO_STORE });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }): Promise<NextResponse> {
  const { action } = await ctx.params;
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "bad_json", detail: "request body must be JSON" }, { status: 400, headers: NO_STORE });
    }

    const owner = typeof body.owner === "string" ? body.owner : "";
    const signature = typeof body.signature === "string" ? body.signature : "";

    if (action === "session") {
      if (!owner || !signature) {
        return NextResponse.json({ error: "bad_request", detail: "body: { owner, signature }" }, { status: 400, headers: NO_STORE });
      }
      return NextResponse.json(await Shield.createSession(owner, signature), { headers: NO_STORE });
    }

    if (WRITE_ACTIONS.has(action)) {
      const address = typeof body.address === "string" ? body.address : "";
      const chain = typeof body.chain === "string" ? body.chain : undefined;
      const reason = typeof body.reason === "string" ? body.reason : undefined;
      if (!owner || !signature || !address) {
        return NextResponse.json(
          { error: "bad_request", detail: "body: { owner, signature, address, chain?, reason? }" },
          { status: 400, headers: NO_STORE },
        );
      }
      const out = await Shield.applyWrite(
        action as Shield.WriteAction,
        owner,
        signature,
        address,
        { chain, reason },
      );
      return NextResponse.json(out, { headers: NO_STORE });
    }

    return NextResponse.json({ error: "not_found", detail: `no POST action '${action}'` }, { status: 404, headers: NO_STORE });
  } catch (e) {
    return fail(e);
  }
}

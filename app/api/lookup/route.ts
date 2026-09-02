// app/api/lookup/route.ts — universal FREE reverse lookup.
// GET /api/lookup?address=<any address, any chain>. No chain parameter: the
// address format alone selects EVM or XRPL. ONE normalized envelope for every
// chain — identical field names regardless of chain is the product.
import { NextRequest, NextResponse } from "next/server";
import { detectAddress } from "@/lib/address-detect";
import { scoreAddress } from "@/lib/score-address";
import { evmAccountState } from "@/lib/evm-account";
import { lookupEntity } from "@/lib/entity";
import { xrplLookup } from "@/lib/xrpl-lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCEPTS = "EVM (0x + 40 hex) or XRPL classic (r..., 25-35 chars).";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get("address") || "").trim();

  if (!raw) {
    return NextResponse.json(
      { error: "missing_address", detail: `Provide ?address=. Accepts: ${ACCEPTS}` },
      { status: 400 },
    );
  }

  const det = detectAddress(raw);

  if (det.chain === "unknown") {
    return NextResponse.json(
      {
        error: "unrecognized_address_format",
        detail: `Could not detect the chain from the address. Accepts: ${ACCEPTS}`,
      },
      { status: 400 },
    );
  }

  if (det.format === "xrpl-x-address") {
    return NextResponse.json(
      {
        error: "x_address_not_supported",
        detail:
          "X-addresses are recognized but not resolved yet. Provide the classic r-address for the same account (drop the destination-tag wrapper).",
      },
      { status: 400 },
    );
  }

  if (det.chain === "evm") {
    // EVM screening defaults to Base (our buyers and the store run on Base).
    // ?chain=ethereum is an optional hint that only moves the history signal.
    const hint = (url.searchParams.get("chain") || "").toLowerCase();
    const evmChain = hint === "ethereum" ? "ethereum" : "base";
    const addr = raw.toLowerCase();

    const [full, acct, ent] = await Promise.all([
      scoreAddress(addr, evmChain, "wallet"),
      evmAccountState(evmChain, addr),
      lookupEntity(addr, evmChain).catch(() => null),
    ]);

    // Sanctions/scam lists are address-based and chain-agnostic; only tx_count
    // (a normal-tx count from the explorer) is chain-specific. Define `exists`
    // from on-chain state, and refuse to assert it when we could not check.
    const txCount = Number((full.signals as Record<string, unknown>)?.tx_count ?? 0);
    let exists: boolean | null;
    if (acct.has_code || acct.nonce > 0 || acct.balance_wei > BigInt(0) || txCount > 0) {
      exists = true;
    } else if (acct.fully_checked) {
      exists = false; // code + nonce + balance all returned zero, and no tx history
    } else {
      exists = null; // could not verify on-chain state
    }

    return NextResponse.json(
      {
        address: addr,
        chain: "evm",
        chain_detected: true,
        exists,
        risk_score: full.risk_score,
        risk_level: full.risk_level,
        verdict: full.verdict,
        flags: full.flags,
        entity: ent
          ? { is_known: ent.is_known, label: ent.label, category: ent.category }
          : { is_known: false, label: null, category: "unknown" },
        upgrade:
          "GET /api/risk/pro?address=0x...&chain=ethereum|base for reasons, signals, and sources ($0.01/call via x402).",
      },
      { status: 200, headers: { "Cache-Control": "public, max-age=30" } },
    );
  }

  // XRPL — classic or X-address (xrplLookup decodes X-addresses internally).
  const r = await xrplLookup(raw);
  if (r.flags.includes("INVALID_ADDRESS")) {
    return NextResponse.json(
      {
        error: "invalid_address",
        detail: `That matches the XRPL address format but the checksum is invalid. Accepts: ${ACCEPTS}`,
      },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      address: r.address,
      chain: "xrpl",
      chain_detected: true,
      exists: r.exists,
      risk_score: r.risk_score,
      risk_level: r.risk_level,
      verdict: r.verdict,
      flags: r.flags,
      entity: { is_known: false, label: null, category: "unknown" },
      upgrade: null,
    },
    { status: 200, headers: { "Cache-Control": "public, max-age=30" } },
  );
}

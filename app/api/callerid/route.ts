// app/api/callerid/route.ts — "should this wallet be answered." FREE.
// Wallet messaging (XMTP, Push) has no spam filter. This composes what we
// already have — entity attribution, risk score, on-chain history, verified
// name — into one recommendation with the reasoning. Not in the middleware matcher.
import { NextRequest, NextResponse } from "next/server";
import { isEvmAddress } from "@/lib/sources";
import { lookupEntity } from "@/lib/entity";
import { scoreAddress } from "@/lib/score-address";
import { evmAccountState } from "@/lib/evm-account";
import { primaryName } from "@/lib/resolve";
import { recommend } from "@/lib/callerid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("address") || "").trim();
  const chain = (searchParams.get("chain") || "base").toLowerCase();

  if (!isEvmAddress(raw)) {
    return NextResponse.json(
      { error: "invalid_address", detail: "Provide a valid 0x EVM address." },
      { status: 400 },
    );
  }
  if (chain !== "base" && chain !== "ethereum") {
    return NextResponse.json(
      { error: "unsupported_chain", detail: "chain must be 'base' or 'ethereum'." },
      { status: 400 },
    );
  }
  const addr = raw.toLowerCase();

  const [entR, riskR, acctR, nameR] = await Promise.allSettled([
    lookupEntity(addr, chain),
    scoreAddress(addr, chain, "wallet"),
    evmAccountState(chain, addr),
    primaryName(addr),
  ]);

  const entity = entR.status === "fulfilled" ? entR.value : null;
  const score = riskR.status === "fulfilled" ? riskR.value : null;
  const acct = acctR.status === "fulfilled" ? acctR.value : null;
  const name = nameR.status === "fulfilled" && nameR.value ? nameR.value.name : null;

  const risk = score
    ? { score: score.risk_score, level: score.risk_level, verdict: score.verdict }
    : null;

  const { recommendation, confidence, reasons } = recommend({
    entity: entity ? { is_known: entity.is_known, label: entity.label, category: entity.category } : null,
    risk,
    name,
  });

  const exists = acct
    ? acct.has_code || acct.nonce > 0 || acct.balance_wei > BigInt(0)
      ? true
      : acct.fully_checked
        ? false
        : null
    : null;

  return NextResponse.json(
    {
      address: addr,
      chain,
      name,
      entity: entity
        ? { is_known: entity.is_known, label: entity.label, category: entity.category }
        : { is_known: false, label: null, category: "unknown" },
      exists,
      risk_score: risk ? risk.score : null,
      risk_level: risk ? risk.level : null,
      verdict: risk ? risk.verdict : null,
      recommendation,
      confidence,
      reasons,
      checked_at: new Date().toISOString(),
    },
    { status: 200, headers: { "Cache-Control": "public, max-age=60" } },
  );
}

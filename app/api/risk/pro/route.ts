import { NextRequest, NextResponse } from "next/server";
import { isEvmAddress } from "@/lib/sources";
import { scoreAddress, chainId, SUPPORTED_CHAINS } from "@/lib/score-address";
import { isArcMainnetLive, ARC_NOT_LIVE_MESSAGE } from "@/lib/arc";
import { verdictFirst } from "@/lib/verdict";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("address") || "").trim();
  const chain = (searchParams.get("chain") || "base").toLowerCase();
  const type = (searchParams.get("type") || "wallet").toLowerCase() as "wallet" | "token";

  if (!isEvmAddress(raw)) return NextResponse.json({ error: "invalid_address", detail: "Provide a valid 0x EVM address" }, { status: 400 });
  if (!chainId(chain)) return NextResponse.json({ error: "unsupported_chain", detail: `Supported: ${SUPPORTED_CHAINS.join(", ")}` }, { status: 400 });
  if (chain === "arc" && !isArcMainnetLive()) return NextResponse.json({ error: "not_yet_live", message: ARC_NOT_LIVE_MESSAGE }, { status: 503 });

  const full = await scoreAddress(raw.toLowerCase(), chain, type);
  // One call, one verdict: verdict + summary + reasons first, the full report after.
  return NextResponse.json(verdictFirst(full), { status: 200 });
}

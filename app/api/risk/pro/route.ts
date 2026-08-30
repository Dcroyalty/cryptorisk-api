import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@/lib/x402v2";
import { isEvmAddress } from "@/lib/sources";
import { scoreAddress, chainId, SUPPORTED_CHAINS } from "@/lib/score-address";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withX402(
  { path: "/api/risk/pro", method: "GET", price: "$0.01",
    description: "Full EVM wallet/token risk report: OFAC sanctions, scam and phishing lists, honeypot and rug signals, 0-100 score with PROCEED/CAUTION/BLOCK verdict.",
    tags: ["risk","security","sanctions","wallet","defi"] },
  async (req: NextRequest) => {
    const { searchParams } = new URL(req.url);
    const raw = (searchParams.get("address") || "").trim();
    const chain = (searchParams.get("chain") || "base").toLowerCase();
    const type = (searchParams.get("type") || "wallet").toLowerCase() as "wallet" | "token";
    if (!isEvmAddress(raw)) return NextResponse.json({ error: "invalid_address" }, { status: 400 });
    if (!chainId(chain)) return NextResponse.json({ error: "unsupported_chain", detail: `Supported: ${SUPPORTED_CHAINS.join(", ")}` }, { status: 400 });
    return await scoreAddress(raw.toLowerCase(), chain, type);
  }
);

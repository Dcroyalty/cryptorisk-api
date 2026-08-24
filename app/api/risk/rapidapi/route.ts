import { NextRequest, NextResponse } from "next/server";
import { isEvmAddress } from "@/lib/sources";
import { scoreAddress, chainId, SUPPORTED_CHAINS } from "@/lib/score-address";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const provided = req.headers.get("x-rapidapi-proxy-secret");
  const expected = process.env.RAPIDAPI_PROXY_SECRET;
  if (!expected || provided !== expected) {
    return NextResponse.json(
      { error: "forbidden", detail: "This endpoint is for RapidAPI subscribers. Subscribe at rapidapi.com or use /api/risk/pro to pay per call via x402." },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("address") || "").trim();
  const chain = (searchParams.get("chain") || "base").toLowerCase();
  const type = (searchParams.get("type") || "wallet").toLowerCase() as "wallet" | "token";

  if (!isEvmAddress(raw)) return NextResponse.json({ error: "invalid_address", detail: "Provide a valid 0x EVM address" }, { status: 400 });
  if (!chainId(chain)) return NextResponse.json({ error: "unsupported_chain", detail: `Supported: ${SUPPORTED_CHAINS.join(", ")}` }, { status: 400 });

  const full = await scoreAddress(raw.toLowerCase(), chain, type);
  return NextResponse.json(full, { status: 200 });
}

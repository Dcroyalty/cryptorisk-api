// app/api/v2/extract/route.ts — multi-rail (x402 v2: USDC on Base, Polygon or
// Solana) twin of /api/extract. Same handler; payment layer in lib/x402v2/server.ts.
// Falls back (307) to /api/extract whenever multi-rail is off or unhealthy.
import { POST as v1 } from "@/app/api/extract/route";
import { multiRail } from "@/lib/x402v2/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = multiRail("extract", v1);

// GET is the free usage doc, same as the v1 route.
export { GET } from "@/app/api/extract/route";

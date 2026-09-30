// app/api/v2/search/route.ts — multi-rail (x402 v2: USDC on Base, Polygon or
// Solana) twin of /api/search. Same handler; payment layer in lib/x402v2/server.ts.
// Falls back (307) to /api/search whenever multi-rail is off or unhealthy.
import { GET as v1 } from "@/app/api/search/route";
import { multiRail } from "@/lib/x402v2/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = multiRail("search", v1);

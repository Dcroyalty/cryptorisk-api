// app/api/v2/llm/route.ts — multi-rail (x402 v2: USDC on Base, Polygon or
// Solana) twin of /api/llm. Same handler; payment layer in lib/x402v2/server.ts.
// Falls back (307) to /api/llm whenever multi-rail is off or unhealthy.
import { POST as v1 } from "@/app/api/llm/route";
import { multiRail } from "@/lib/x402v2/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = multiRail("llm", v1);

// GET is the free usage doc, same as the v1 route.
export { GET } from "@/app/api/llm/route";

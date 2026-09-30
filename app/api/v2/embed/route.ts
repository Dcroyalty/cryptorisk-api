// app/api/v2/embed/route.ts — multi-rail (x402 v2: USDC on Base, Polygon or
// Solana) twin of /api/embed. Same handler; payment layer in lib/x402v2/server.ts.
// Falls back (307) to /api/embed whenever multi-rail is off or unhealthy.
import { POST as v1 } from "@/app/api/embed/route";
import { multiRail } from "@/lib/x402v2/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = multiRail("embed", v1);

// GET is the free usage doc, same as the v1 route.
export { GET } from "@/app/api/embed/route";

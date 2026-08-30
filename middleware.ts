// Payment is now handled per-route by lib/x402v2.ts (spec-compliant x402 v2).
// This middleware intentionally does nothing.
import { NextResponse } from "next/server";
export function middleware() { return NextResponse.next(); }
export const config = { matcher: [] };

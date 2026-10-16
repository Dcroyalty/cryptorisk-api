// app/api/lending/grade/route.ts — A–F risk grade for one XRPL lending vault or loan broker. $0.02 via x402
// (middleware.ts), or free with an XRPLHub Pro key. Read live from the ledger with the same code XRPLHub uses
// (lib/xrpl-lending, copied from kreditkarma-backend), so the grade matches xrplhub.io/lending.
//
// Off until XRPL lending is enabled on mainnet: the middleware answers 503 before the paywall, and this route
// re-checks so it can never serve a grade while lending is off.
import { NextResponse } from "next/server";
import { readVault, readBroker } from "@/lib/xrpl-lending/facts";
import { gradeVault, gradeBroker } from "@/lib/xrpl-lending/grade";
import { lendingLive, lendingRpc, NOT_LIVE_BODY } from "@/lib/xrpl-lending/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ID = /^[0-9A-Fa-f]{64}$/;

export async function GET(req: Request) {
  if (!(await lendingLive())) return NextResponse.json(NOT_LIVE_BODY, { status: 503, headers: { "Retry-After": "3600" } });
  const q = new URL(req.url).searchParams;
  const id = (q.get("id") ?? "").toUpperCase();
  const type = q.get("type");
  if (!ID.test(id)) return NextResponse.json({ error: "bad_request", message: "id must be the 64-hex ledger ID of a Vault or LoanBroker." }, { status: 400 });
  if (type && type !== "vault" && type !== "broker") return NextResponse.json({ error: "bad_request", message: "type must be vault or broker (or omit it)." }, { status: 400 });

  try {
    if (type !== "broker") {
      const v = await readVault(lendingRpc, id);
      if (v) {
        const g = gradeVault(v.facts);
        const brokers = Object.fromEntries(Object.entries(g.brokerGrades).map(([k, r]) => [k, { grade: r.grade, score: r.score }]));
        return NextResponse.json({
          type: "vault", id, grade: g.grade, score: g.score, capped: g.capped, adjustments: g.adjustments, metrics: g.metrics,
          brokers, asset: v.facts.assetLabel, owner: v.facts.owner,
          methodVersion: g.methodVersion, method: "https://www.xrplhub.io/lending/method", page: `https://www.xrplhub.io/lending/vault/${id}`,
          disclaimer: g.disclaimer, checked_at: new Date().toISOString(),
        });
      }
    }
    if (type !== "vault") {
      const b = await readBroker(lendingRpc, id);
      if (b) {
        const g = gradeBroker(b.facts);
        return NextResponse.json({
          type: "broker", id, grade: g.grade, score: g.score, capped: g.capped, adjustments: g.adjustments, metrics: g.metrics,
          vaultId: b.facts.vaultId, owner: b.facts.owner,
          methodVersion: g.methodVersion, method: "https://www.xrplhub.io/lending/method", page: `https://www.xrplhub.io/lending/broker/${id}`,
          disclaimer: g.disclaimer, checked_at: new Date().toISOString(),
        });
      }
    }
    return NextResponse.json({ error: "not_found", message: "No Vault or LoanBroker with that ID on the XRP Ledger mainnet." }, { status: 404 });
  } catch (e) {
    console.error("[lending/grade]", (e as Error).message);
    return NextResponse.json({ error: "ledger_unavailable", message: "Couldn't read the XRP Ledger right now. Try again in a minute." }, { status: 503, headers: { "Retry-After": "60" } });
  }
}

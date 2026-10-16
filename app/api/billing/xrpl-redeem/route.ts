// app/api/billing/xrpl-redeem/route.ts — XRPLHub Pro for 49 RLUSD (30 days), paid with Xaman on xrplhub.io.
//
// POST { txHash, secret } → { api_key, plan, quota_limit, period_end }.
// The XRP Ledger is the proof; there is no shared secret between xrplhub.io and uxus. We read the transaction
// ourselves and require ALL of:
//   - validated and tesSUCCESS, a Payment to the XRPLHub treasury (rs59g3amo5iT6T64Cg96XXMAWuw3WPQcLF)
//   - delivered_amount at least 49 RLUSD (Ripple's issuer)
//   - memo xrplhub/product = "xrplhubpro" and memo xrplhub/claim = sha256(secret) — the secret is made in the
//     buyer's browser and never leaves it until now, so a public transaction hash alone can't be used to claim a key
//   - sent within the last 7 days
// The key lasts 30 days from the payment. Redeeming the same payment again returns the same key (idempotent:
// keyed on stripe_subscription_id = "xrpl:<hash>").
import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { mintKey } from "@/lib/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TREASURY = "rs59g3amo5iT6T64Cg96XXMAWuw3WPQcLF";
const RLUSD_ISSUER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
const RLUSD_HEX = "524C555344000000000000000000000000000000";
const PRICE_RLUSD = 49;
const RIPPLE_EPOCH = 946_684_800;
const NODES = ["https://s1.ripple.com:51234", "https://s2.ripple.com:51234", "https://xrplcluster.com"];
const hex = (s: string) => Buffer.from(s, "utf8").toString("hex").toUpperCase();

async function readTx(hash: string): Promise<Record<string, unknown> | null> {
  for (const url of NODES) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method: "tx", params: [{ transaction: hash, binary: false }] }), signal: AbortSignal.timeout(10_000), cache: "no-store" });
      const j = (await r.json()) as { result?: Record<string, unknown> };
      if (j.result && !j.result.error) return j.result;
      if (j.result?.error === "txnNotFound") return null;
    } catch { /* next node */ }
  }
  throw new Error("ledger_unreachable");
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { txHash?: unknown; secret?: unknown };
  const hash = String(b.txHash ?? "").toUpperCase();
  const secret = String(b.secret ?? "");
  if (!/^[0-9A-F]{64}$/.test(hash) || !/^[0-9a-f]{64}$/.test(secret)) {
    return NextResponse.json({ error: "bad_request", message: "Send the payment's transaction hash and the claim code from the page that made the payment." }, { status: 400 });
  }
  let tx: Record<string, unknown> | null;
  try {
    tx = await readTx(hash);
  } catch {
    return NextResponse.json({ error: "ledger_unreachable", message: "Couldn't read the XRP Ledger. Try again in a minute; your payment is safe." }, { status: 503 });
  }
  if (!tx) return NextResponse.json({ error: "not_found", message: "That transaction isn't on the ledger (yet). Wait a few seconds and try again." }, { status: 404 });
  const t = (tx.tx_json ?? tx) as Record<string, unknown>;
  const meta = tx.meta as { TransactionResult?: string; delivered_amount?: unknown } | undefined;
  const fail = (message: string) => NextResponse.json({ error: "not_eligible", message }, { status: 422 });
  if (tx.validated !== true) return NextResponse.json({ error: "pending", message: "The payment isn't final yet. Try again in a few seconds." }, { status: 409 });
  if (t.TransactionType !== "Payment" || meta?.TransactionResult !== "tesSUCCESS" || t.Destination !== TREASURY) return fail("This isn't a successful payment to XRPLHub.");
  const d = meta.delivered_amount as { currency?: string; issuer?: string; value?: string } | string | undefined;
  if (!d || typeof d === "string" || d.currency !== RLUSD_HEX || d.issuer !== RLUSD_ISSUER || Number(d.value) < PRICE_RLUSD) return fail(`XRPLHub Pro by Xaman is ${PRICE_RLUSD} RLUSD; this payment delivered something else.`);
  const memos = ((t.Memos as { Memo?: { MemoType?: string; MemoData?: string } }[] | undefined) ?? []).map((m) => m.Memo ?? {});
  const memo = (type: string) => memos.find((m) => (m.MemoType ?? "").toUpperCase() === hex(type))?.MemoData?.toUpperCase();
  if (memo("xrplhub/product") !== hex("xrplhubpro")) return fail("This payment wasn't made for XRPLHub Pro.");
  const claim = memo("xrplhub/claim");
  const given = hex(createHash("sha256").update(secret).digest("hex"));
  if (!claim || claim.length !== given.length || !timingSafeEqual(Buffer.from(claim), Buffer.from(given))) return fail("The claim code doesn't match this payment.");
  const paidAt = new Date((Number(t.date) + RIPPLE_EPOCH) * 1000);
  if (!Number.isFinite(paidAt.getTime()) || Date.now() - paidAt.getTime() > 7 * 86_400_000) return fail("Payments older than 7 days can't be redeemed here — email support@uxus.finance.");
  const key = await mintKey({
    stripeCustomerId: `xrpl:${String(t.Account)}`,
    stripeSubscriptionId: `xrpl:${hash}`,
    plan: "xrplhub_pro",
    periodStart: paidAt,
    periodEnd: new Date(paidAt.getTime() + 30 * 86_400_000),
  });
  return NextResponse.json(key, { headers: { "Cache-Control": "no-store" } });
}

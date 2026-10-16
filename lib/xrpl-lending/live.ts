// lib/xrpl-lending/live.ts — is XRPL lending enabled on mainnet? Read from the ledger, never a flag.
//
// The paid grade API (/api/lending/grade, MCP lending_grade, Lending Pro) switches itself on the first time
// both LendingProtocol and SingleAssetVault appear in the ledger's Amendments object. Until then the
// middleware answers 503 BEFORE the x402 paywall, so nobody can pay for a grade that can't exist yet.
// "Enabled" is remembered for the life of the instance (an amendment can't be disabled); "not yet" is re-read
// every 10 minutes; a failed read counts as not live (fail closed).
import { xrplRpc } from "@/lib/xrpl-nodes";
import type { LedgerRpc } from "./facts";

const AMENDMENTS_INDEX = "7DB0788C020F02780A673DC74757F23823FA3014C1866E72CC4CD8B226CD6EF4";
const LENDING_PROTOCOL = "565B90CA1AB2B9D42208ED10884188C64F9E19083DECB9634AAF06EB03299509";
const SINGLE_ASSET_VAULT = "81BD2619B6B3C8625AC5D0BC01DE17F06C3F0AB95C7C87C93715B87A4FD240D8";
const RECHECK_MS = 10 * 60_000;

let liveForever = false;
let checked: { at: number; live: boolean } | null = null;

export const lendingRpc: LedgerRpc = async (method, params) => {
  const r = await xrplRpc(method, params, 12_000);
  return r.ok ? (r.result as Record<string, any>) : null;
};

export async function lendingLive(): Promise<boolean> {
  if (liveForever) return true;
  if (checked && Date.now() - checked.at < RECHECK_MS) return checked.live;
  const r = await lendingRpc("ledger_entry", { index: AMENDMENTS_INDEX, ledger_index: "validated" });
  const enabled = new Set(((r?.node?.Amendments as string[] | undefined) ?? []).map((a) => a.toUpperCase()));
  const live = r?.node?.LedgerEntryType === "Amendments" && enabled.has(LENDING_PROTOCOL) && enabled.has(SINGLE_ASSET_VAULT);
  if (live) liveForever = true;
  checked = { at: Date.now(), live };
  return live;
}

export const NOT_LIVE_BODY = {
  error: "lending_not_live",
  message:
    "XRPL lending isn't enabled on the XRP Ledger mainnet yet, so there are no vaults or brokers to grade. You were not charged. This endpoint switches on by itself when the LendingProtocol and SingleAssetVault amendments are enabled.",
  tracker: "https://www.xrplhub.io/lending",
};

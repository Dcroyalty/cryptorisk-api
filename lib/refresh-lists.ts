// lib/refresh-lists.ts — refresh the bad-address lists in bad_addresses.
// Shared by the scheduled cron route (app/api/cron/refresh-lists) and the
// manual CLI (scripts/ingest.mjs mirrors this logic).
//
// The OFAC list is a FULL SYNC (adds new, removes delisted). It is guarded: if
// the upstream fetch returns fewer than MIN_OFAC addresses, it aborts and the
// table is left untouched. A silently emptied sanctions list is the worst
// failure this product can have.
//
// ScamSniffer + MEW are append-only upserts (those feeds don't publish reliable
// removals) — also guarded against an empty fetch so a bad response is a no-op.

import type { NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

const isEvm = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
const lc = (a: string) => a.toLowerCase();

// Sanity floor for the OFAC sync. The list has had 100+ ETH addresses for years;
// anything below this is a broken upstream, not a real delisting wave.
export const MIN_OFAC = 50;

const OFAC_URL =
  "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.txt";
const SCAMSNIFFER_URL =
  "https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json";
const MEW_URL =
  "https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json";

async function getText(u: string): Promise<string> {
  const r = await fetch(u, { headers: { "user-agent": "uxus-list-refresh" }, cache: "no-store" });
  if (!r.ok) throw new Error(`${u} -> HTTP ${r.status}`);
  return r.text();
}
async function getJson(u: string): Promise<unknown> {
  const r = await fetch(u, { headers: { "user-agent": "uxus-list-refresh" }, cache: "no-store" });
  if (!r.ok) throw new Error(`${u} -> HTTP ${r.status}`);
  return r.json();
}

async function upsert(sql: Sql, rows: { address: string; source: string; category: string }[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const c = rows.slice(i, i + 500);
    await sql`
      INSERT INTO bad_addresses (address, chain, source, category)
      SELECT * FROM UNNEST(
        ${c.map((r) => r.address)}::text[],
        ${c.map(() => "evm")}::text[],
        ${c.map((r) => r.source)}::text[],
        ${c.map((r) => r.category)}::text[]
      )
      ON CONFLICT (address, source) DO NOTHING
    `;
  }
}

export interface RefreshReport {
  ok: boolean;
  ofac: { on_list: number; added: number; removed: number } | { error: string };
  scamsniffer: { count: number; added: number } | { error: string };
  mew: { count: number; added: number } | { error: string };
}

export async function refreshBadAddresses(sql: Sql): Promise<RefreshReport> {
  const report: RefreshReport = {
    ok: true,
    ofac: { error: "not run" },
    scamsniffer: { error: "not run" },
    mew: { error: "not run" },
  };

  // 1) OFAC — FULL SYNC, guarded.
  try {
    const txt = await getText(OFAC_URL);
    const list = [...new Set(txt.split(/\r?\n/).map((s) => s.trim()).filter(isEvm).map(lc))];
    if (list.length < MIN_OFAC) {
      throw new Error(`OFAC list returned ${list.length} addresses (< ${MIN_OFAC}) — refusing to sync, table untouched`);
    }
    const before = (await sql`SELECT count(*)::int AS n FROM bad_addresses WHERE source = 'ofac'`)[0]
      .n as number;
    await upsert(sql, list.map((address) => ({ address, source: "ofac", category: "sanctioned" })));
    const removed = (await sql`
      DELETE FROM bad_addresses
      WHERE source = 'ofac' AND address <> ALL(${list}::text[])
      RETURNING address
    `).length;
    const after = (await sql`SELECT count(*)::int AS n FROM bad_addresses WHERE source = 'ofac'`)[0]
      .n as number;
    report.ofac = { on_list: list.length, added: after - before + removed, removed };
  } catch (e) {
    report.ofac = { error: (e as Error).message };
    report.ok = false;
  }

  // 2) ScamSniffer — append-only, guarded against an empty fetch.
  try {
    const raw = await getJson(SCAMSNIFFER_URL);
    const arr = Array.isArray(raw) ? raw : Object.keys((raw as object) || {});
    const list = [...new Set(arr.map(String).filter(isEvm).map(lc))];
    if (!list.length) throw new Error("ScamSniffer returned 0 addresses — skipped");
    const before = (await sql`SELECT count(*)::int AS n FROM bad_addresses WHERE source = 'scamsniffer'`)[0]
      .n as number;
    await upsert(sql, list.map((address) => ({ address, source: "scamsniffer", category: "scam" })));
    const after = (await sql`SELECT count(*)::int AS n FROM bad_addresses WHERE source = 'scamsniffer'`)[0]
      .n as number;
    report.scamsniffer = { count: list.length, added: after - before };
  } catch (e) {
    report.scamsniffer = { error: (e as Error).message };
    report.ok = false;
  }

  // 3) MEW darklist — append-only, guarded.
  try {
    const raw = await getJson(MEW_URL);
    const arr = Array.isArray(raw) ? (raw as { address?: string }[]) : [];
    const list = [...new Set(arr.map((o) => o?.address).filter((a): a is string => !!a && isEvm(a)).map(lc))];
    if (!list.length) throw new Error("MEW darklist returned 0 addresses — skipped");
    const before = (await sql`SELECT count(*)::int AS n FROM bad_addresses WHERE source = 'mew'`)[0]
      .n as number;
    await upsert(sql, list.map((address) => ({ address, source: "mew", category: "scam" })));
    const after = (await sql`SELECT count(*)::int AS n FROM bad_addresses WHERE source = 'mew'`)[0]
      .n as number;
    report.mew = { count: list.length, added: after - before };
  } catch (e) {
    report.mew = { error: (e as Error).message };
    report.ok = false;
  }

  return report;
}

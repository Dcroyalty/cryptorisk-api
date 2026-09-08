// lib/entity.ts — entity attribution: "what IS this address" (not who owns it).
// Reads the entity_labels table (built by scripts/ingest-entity.mjs). Never
// guesses — an address with no matching label is is_known:false / "unknown".
//
// SANCTIONS ARE NOT DECIDED HERE. `category:"sanctioned"` is asserted only when
// the address is on the OFAC SDN list we ingest into bad_addresses (source='ofac')
// — the single source of truth shared with /api/risk*. A "sanctioned" row in
// entity_labels that is NOT OFAC-backed is downgraded to "flagged" (some list
// flagged it; not an OFAC designation) and never triggers a hard block.
import { sql } from "@/lib/db";

// most-severe-wins when an address carries multiple categories
const SEVERITY: Record<string, number> = {
  sanctioned: 100,
  drainer: 90,
  phishing: 85,
  scam: 80,
  mixer: 70,
  flagged: 55, // non-OFAC blocklist hit — informational, not a hard stop
  bridge: 40,
  exchange: 35,
  dex_router: 30,
  protocol: 20,
  token_contract: 10,
  unknown: 0,
};
// tiebreak: which source's label to show
const SOURCE_RANK: Record<string, number> = {
  curated: 5,
  ofac: 4,
  "eth-labels": 3,
  scamsniffer: 2,
  mew: 1,
};

export interface Entity {
  address: string;
  chain: "ethereum" | "base";
  is_known: boolean;
  label: string | null;
  category: string;
  sources: string[];
  /** present only when category === "sanctioned": the list that designated it */
  sanctions_source?: string;
}

export async function lookupEntity(address: string, chain: "ethereum" | "base"): Promise<Entity> {
  const addr = address.toLowerCase();
  const chains = chain === "base" ? ["base", "evm"] : ["ethereum", "evm"];

  const [labelRowsRaw, ofacRowsRaw] = await Promise.all([
    sql`
      SELECT label, category, source
      FROM entity_labels
      WHERE address = ${addr} AND chain = ANY(${chains})
    `,
    // Single source of truth for sanctions: the OFAC ingest in bad_addresses.
    sql`
      SELECT source FROM bad_addresses
      WHERE address = ${addr} AND source = 'ofac'
      LIMIT 1
    `,
  ]);
  const labelRows = labelRowsRaw as { label: string; category: string; source: string }[];
  const ofacRows = ofacRowsRaw as { source: string }[];

  const ofacHit = ofacRows.length > 0;

  // entity_labels can't assert sanctions — remap any such row to "flagged".
  const rows = labelRows.map((r) =>
    r.category === "sanctioned" ? { ...r, category: "flagged" } : r,
  );

  if (!rows.length && !ofacHit) {
    return { address: addr, chain, is_known: false, label: null, category: "unknown", sources: [] };
  }

  let best = rows[0];
  for (const r of rows) {
    const s = SEVERITY[r.category] ?? 0;
    const bs = SEVERITY[best?.category] ?? 0;
    if (!best || s > bs || (s === bs && (SOURCE_RANK[r.source] ?? 0) > (SOURCE_RANK[best.source] ?? 0))) {
      best = r;
    }
  }

  const sources = [...new Set(rows.map((r) => r.source))];

  if (ofacHit) {
    if (!sources.includes("ofac")) sources.push("ofac");
    return {
      address: addr,
      chain,
      is_known: true,
      label: best?.label ?? "OFAC SDN List",
      category: "sanctioned",
      sanctions_source: "ofac",
      sources: sources.sort(),
    };
  }

  return {
    address: addr,
    chain,
    is_known: true,
    label: best.label,
    category: best.category,
    sources: sources.sort(),
  };
}

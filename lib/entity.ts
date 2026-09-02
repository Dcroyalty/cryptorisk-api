// lib/entity.ts — entity attribution: "what IS this address" (not who owns it).
// Reads the entity_labels table (built by scripts/ingest-entity.mjs). Never
// guesses — an address with no matching label is is_known:false / "unknown".
import { sql } from "@/lib/db";

// most-severe-wins when an address carries multiple categories
const SEVERITY: Record<string, number> = {
  sanctioned: 100,
  drainer: 90,
  phishing: 85,
  scam: 80,
  mixer: 70,
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
}

export async function lookupEntity(address: string, chain: "ethereum" | "base"): Promise<Entity> {
  const addr = address.toLowerCase();
  const chains = chain === "base" ? ["base", "evm"] : ["ethereum", "evm"];

  const rows = (await sql`
    SELECT label, category, source
    FROM entity_labels
    WHERE address = ${addr} AND chain = ANY(${chains})
  `) as { label: string; category: string; source: string }[];

  if (!rows.length) {
    return { address: addr, chain, is_known: false, label: null, category: "unknown", sources: [] };
  }

  let best = rows[0];
  for (const r of rows) {
    const s = SEVERITY[r.category] ?? 0;
    const bs = SEVERITY[best.category] ?? 0;
    if (s > bs || (s === bs && (SOURCE_RANK[r.source] ?? 0) > (SOURCE_RANK[best.source] ?? 0))) {
      best = r;
    }
  }

  return {
    address: addr,
    chain,
    is_known: true,
    label: best.label,
    category: best.category,
    sources: [...new Set(rows.map((r) => r.source))].sort(),
  };
}

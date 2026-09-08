// scripts/fix-sanctions.mjs — one-shot remediation for the sanctions data.
//
// WHY: entity_labels carried ~700+ category='sanctioned' rows derived from the
// eth-labels "blocked" slug, cross-checked against nothing — 16 of them were
// placeholders including the zero address. /api/entity, /api/callerid and
// /api/shield/check told users these addresses were OFAC-sanctioned, and
// Shield's hard-stop made that unappealable.
//
// WHAT THIS DOES (idempotent — safe to re-run):
//   1. Full-sync bad_addresses(source='ofac') to the live OFAC SDN list
//      (0xB10C mirror). This table is now THE sanctions source of truth.
//   2. Delete every entity_labels row with category='sanctioned' whose address
//      is NOT on that list.
//   3. Downgrade the survivors to category='flagged' — entity_labels no longer
//      asserts sanctions; lib/entity.ts re-derives "sanctioned" by joining
//      against bad_addresses at request time.
//
// Run:  node scripts/fix-sanctions.mjs
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const url =
  process.env.DATABASE_URL ||
  (() => {
    try {
      const m = readFileSync(new URL("../.env", import.meta.url), "utf8").match(/^DATABASE_URL=(.+)$/m);
      return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
    } catch {
      return null;
    }
  })();
if (!url) {
  console.error("FATAL: no DATABASE_URL (env or ../.env)");
  process.exit(1);
}
console.log("db endpoint:", url.replace(/:[^:@/]+@/, ":****@").replace(/\?.*$/, ""));
const sql = neon(url);
const isEvm = (a) => /^0x[0-9a-fA-F]{40}$/.test(a);
const lc = (a) => a.toLowerCase();
const OFAC_URL =
  "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.txt";

async function step(name, fn) {
  process.stdout.write(`\n[${name}] ... `);
  try {
    const r = await fn();
    console.log("done");
    return r;
  } catch (e) {
    console.log("FAILED");
    console.error(`  ${e?.stack || e?.message || e}`);
    process.exit(1);
  }
}

const snap = () =>
  sql`SELECT
    (SELECT count(*)::int FROM bad_addresses WHERE source='ofac')          AS badaddr_ofac,
    (SELECT count(*)::int FROM entity_labels WHERE category='sanctioned')  AS el_sanctioned,
    (SELECT count(*)::int FROM entity_labels WHERE category='flagged')     AS el_flagged
  `.then((r) => r[0]);

const before = await step("snapshot: before", snap);
console.log("  ", before);

const list = await step("fetch live OFAC SDN list", async () => {
  const res = await fetch(OFAC_URL, { headers: { "user-agent": "uxus-fix-sanctions" } });
  if (!res.ok) throw new Error(`OFAC list HTTP ${res.status}`);
  const txt = await res.text();
  const l = [...new Set(txt.split(/\r?\n/).map((s) => s.trim()).filter(isEvm).map(lc))];
  if (l.length < 50) throw new Error(`OFAC list looks wrong (${l.length} addresses)`);
  return l;
});
console.log(`   ${list.length} addresses on the live list`);

const added = await step("1. add missing OFAC addresses to bad_addresses", async () => {
  const r = await sql`
    INSERT INTO bad_addresses (address, chain, source, category)
    SELECT addr, 'evm', 'ofac', 'sanctioned' FROM UNNEST(${list}::text[]) AS addr
    ON CONFLICT (address, source) DO NOTHING
    RETURNING address
  `;
  return r.length;
});
console.log(`   inserted ${added}`);

const delisted = await step("1b. remove delisted OFAC addresses from bad_addresses", async () => {
  const r = await sql`
    DELETE FROM bad_addresses
    WHERE source = 'ofac' AND address <> ALL(${list}::text[])
    RETURNING address
  `;
  return r;
});
console.log(`   removed ${delisted.length}${delisted.length ? ": " + delisted.map((x) => x.address).join(", ") : ""}`);

const deleted = await step("2. delete unverified 'sanctioned' rows from entity_labels", async () => {
  const r = await sql`
    DELETE FROM entity_labels
    WHERE category = 'sanctioned' AND lower(address) <> ALL(${list}::text[])
    RETURNING address, label, source
  `;
  return r;
});
console.log(`   deleted ${deleted.length}`);

const downgraded = await step("3. downgrade OFAC-backed survivors 'sanctioned' -> 'flagged'", async () => {
  const r = await sql`
    UPDATE entity_labels SET category = 'flagged'
    WHERE category = 'sanctioned'
    RETURNING address
  `;
  return r.length;
});
console.log(`   downgraded ${downgraded}`);

const after = await step("snapshot: after", snap);
console.log("  ", after);

const zero = await sql`SELECT category FROM entity_labels WHERE address = '0x0000000000000000000000000000000000000000'`;

console.log(`
============================================================
SUMMARY
  OFAC SDN list (live) ............... ${list.length}
  bad_addresses(source=ofac) ........ ${after.badaddr_ofac}   (was ${before.badaddr_ofac})
  entity_labels sanctioned ......... ${after.el_sanctioned}   (was ${before.el_sanctioned})   <- MUST be 0
  entity_labels flagged ............ ${after.el_flagged}   (was ${before.el_flagged})
  unverified rows purged ........... ${deleted.length}
  OFAC-backed rows kept (as flagged) ${downgraded}
  zero-address entity_labels rows .. ${zero.length ? zero.map((r) => r.category).join(",") : "none"}
============================================================`);

if (after.el_sanctioned !== 0) {
  console.error("\nFAIL: entity_labels still has category='sanctioned' rows");
  process.exit(1);
}
console.log("\nOK — sanctions now come from bad_addresses(source='ofac') only.");

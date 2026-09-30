// lib/xrpl-nodes.ts — XRPL mainnet JSON-RPC pool with per-node cooldown and a
// staleness / amendment-block defense. Ported from XRPLHub's
// kreditkarma-backend/src/lib/xrplNodes.ts so both products behave the same.
//
// Every node below answered server_info on 2026-09-29 with network_id 0 and a
// validated ledger within 1 of the others.
//
// Rotation: each xrplRpc() call starts at the next node in the ring, so the 4
// parallel reads one lookup fires land on different nodes. A node that 429s,
// times out, or 5xx's is cooled and skipped — the call never fails while any
// other node is healthy.

export const XRPL_NODES = [
  "https://xrplcluster.com",
  "https://xrpl.ws",
  "https://xrpl.link",
  "https://s1.ripple.com:51234",
  "https://s2.ripple.com:51234",
  "https://s-west.ripple.com:51234",
  "https://s-east.ripple.com:51234",
  "https://rippled.xrptipbot.com",
];

export type XrplRpcResult<T = any> =
  | { ok: true; result: T }
  // no_majority: the ring disagrees on the ledger — we refuse to read rather than guess.
  // exhausted: every node failed or is rate-limited.
  | { ok: false; reason: "no_majority" | "exhausted" };

const DEFAULT_COOL_MS = 10_000; // 429 with no Reset hint
const TRANSIENT_COOL_MS = 3_000; // timeout / network blip

const coolUntil = new Map<string, number>(); // url -> epoch ms
let ring = Math.floor(Math.random() * XRPL_NODES.length);

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function cool(url: string, ms: number): void {
  coolUntil.set(url, Date.now() + Math.max(1_000, ms));
}

/** Healthy nodes first (starting at the ring cursor), cooling nodes as a last resort. */
function candidateOrder(): string[] {
  const start = ring;
  ring = (ring + 1) % XRPL_NODES.length;
  const rotated = XRPL_NODES.map((_, k) => XRPL_NODES[(start + k) % XRPL_NODES.length]);
  const now = Date.now();
  const healthy = rotated.filter((u) => (coolUntil.get(u) ?? 0) <= now);
  const cooling = rotated.filter((u) => (coolUntil.get(u) ?? 0) > now);
  return healthy.length ? [...healthy, ...cooling] : rotated;
}

/**
 * One XRPL JSON-RPC call, rotated across the pool. Returns ok:false only when
 * the ring has no ledger majority, or when every node failed.
 */
export async function xrplRpc<T = any>(method: string, params: object, timeoutMs = 4_500): Promise<XrplRpcResult<T>> {
  const sweep = await ensureSweepFresh().catch(() => null); // the sweep itself must never break a read
  if (sweep && !sweep.trusted) return { ok: false, reason: "no_majority" };

  for (const url of candidateOrder()) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method, params: [params] }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429) {
        const retry = Number(res.headers.get("retry-after")) * 1000;
        const reset = Number(res.headers.get("ratelimit-reset")) * 1000;
        cool(url, retry || reset || DEFAULT_COOL_MS);
        continue;
      }
      if (!res.ok) {
        cool(url, TRANSIENT_COOL_MS);
        continue;
      }
      const j = await res.json();
      if (j?.result === undefined) {
        cool(url, TRANSIENT_COOL_MS);
        continue;
      }
      return { ok: true, result: j.result as T };
    } catch {
      cool(url, TRANSIENT_COOL_MS);
    }
  }
  return { ok: false, reason: "exhausted" };
}

// ─── STALENESS / AMENDMENT-BLOCK DEFENSE ────────────────────────────────────
// HTTP-level cooling can't see a node that answers 200 OK with stale data —
// which is exactly what an amendment-blocked rippled does: it keeps serving
// reads, it just stops advancing its ledger. A periodic server_info sweep
// (lazily from xrplRpc, and forced from the watchdog) cools any node reporting
// amendment_blocked, and any node whose validated ledger has fallen behind the
// trusted cluster.
//
// SAFETY FLOOR: the sweep never cools a node if that would leave fewer than
// MIN_HEALTHY_NODES out of cooldown. Going fully dark is worse than serving
// from a marginal node; the watchdog alerts a human when the floor is hit.
//
// NO MAJORITY: if responding nodes don't form a strict-majority ledger cluster,
// there is no basis to say which side is right, and xrplRpc refuses to serve.

const SWEEP_INTERVAL_MS = 5 * 60_000; // lazy refresh while trusted
const DISTRUST_RETRY_MS = 15_000; // recheck fast while in no-majority
const STALE_LEDGER_THRESHOLD = 10; // ledgers behind the cluster before "lagging"
const CLUSTER_BAND = 3; // ledgers apart that still count as the same (gossip jitter)
export const MIN_HEALTHY_NODES = 3;
const AMENDMENT_BLOCK_COOL_MS = 10 * 60_000;
const STALE_COOL_MS = 2 * 60_000;
const SERVER_INFO_TIMEOUT_MS = 4_000;

interface NodeProbe {
  url: string;
  ok: boolean;
  ledgerIndex?: number;
  amendmentBlocked?: boolean;
}

async function probeServerInfo(url: string): Promise<NodeProbe> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "server_info", params: [{}] }),
      signal: AbortSignal.timeout(SERVER_INFO_TIMEOUT_MS),
    });
    if (!res.ok) return { url, ok: false };
    const j = (await res.json()) as {
      result?: { info?: { amendment_blocked?: boolean; validated_ledger?: { seq?: number } } };
    };
    const info = j.result?.info;
    const seq = info?.validated_ledger?.seq;
    if (!info || typeof seq !== "number") return { url, ok: false };
    return { url, ok: true, ledgerIndex: seq, amendmentBlocked: !!info.amendment_blocked };
  } catch {
    return { url, ok: false };
  }
}

export interface StalenessSweepResult {
  ranAt: number;
  /** false = no ledger-index majority; xrplRpc refuses reads until a later sweep clears it. */
  trusted: boolean;
  majorityLedgerIndex: number | null;
  clusterSize: number;
  responded: number;
  amendmentBlocked: string[]; // hosts
  lagging: Array<{ host: string; ledgerIndex: number; behindBy: number }>;
  cooled: string[]; // hosts cooled this sweep
  /** true = flagged nodes were left uncooled to respect MIN_HEALTHY_NODES — needs a human. */
  floorHit: boolean;
}

/** Largest group of values within CLUSTER_BAND of each other. */
function largestCluster(values: Array<{ url: string; ledgerIndex: number }>) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a.ledgerIndex - b.ledgerIndex);
  let best: typeof values = [];
  for (const anchor of sorted) {
    const group = sorted.filter((v) => Math.abs(v.ledgerIndex - anchor.ledgerIndex) <= CLUSTER_BAND);
    if (group.length > best.length) best = group;
  }
  return { members: best, index: best[Math.floor(best.length / 2)].ledgerIndex };
}

let lastSweep: StalenessSweepResult | null = null;
let sweepInFlight: Promise<StalenessSweepResult> | null = null;

/**
 * Probe every node's server_info, cool anything amendment-blocked or behind the
 * trusted cluster (subject to MIN_HEALTHY_NODES), and decide whether this
 * round's ledger state can be trusted. Exported so the watchdog can force a
 * fresh read and a test can pass a synthetic node list.
 */
export async function sweepNodeHealth(nodes: string[] = XRPL_NODES): Promise<StalenessSweepResult> {
  const probes = await Promise.all(nodes.map((u) => probeServerInfo(u)));
  const ok = probes.filter((p): p is NodeProbe & { ledgerIndex: number } => p.ok && typeof p.ledgerIndex === "number");
  const blockedUrls = probes.filter((p) => p.ok && p.amendmentBlocked).map((p) => p.url);

  const cluster = largestCluster(ok.map((p) => ({ url: p.url, ledgerIndex: p.ledgerIndex })));
  // STRICT majority of responders — a plurality can't tell which side of a split is right.
  const trusted = !!cluster && cluster.members.length > ok.length / 2;

  const lagging: Array<{ url: string; ledgerIndex: number; behindBy: number }> = [];
  if (trusted && cluster) {
    for (const p of ok) {
      const behindBy = cluster.index - p.ledgerIndex;
      if (behindBy > STALE_LEDGER_THRESHOLD) lagging.push({ url: p.url, ledgerIndex: p.ledgerIndex, behindBy });
    }
  }

  // Cool worst-first (amendment-blocked, then laggards by lag) while respecting the floor.
  const priority = [...blockedUrls, ...[...lagging].sort((a, b) => b.behindBy - a.behindBy).map((l) => l.url)];
  const now = Date.now();
  let remainingHealthy = nodes.filter((u) => (coolUntil.get(u) ?? 0) <= now).length;
  const cooled: string[] = [];
  let floorHit = false;
  for (const url of priority) {
    if (cooled.includes(url)) continue;
    const wasHealthy = (coolUntil.get(url) ?? 0) <= now;
    if (wasHealthy && remainingHealthy - 1 < MIN_HEALTHY_NODES) {
      floorHit = true;
      continue;
    }
    cool(url, blockedUrls.includes(url) ? AMENDMENT_BLOCK_COOL_MS : STALE_COOL_MS);
    cooled.push(url);
    if (wasHealthy) remainingHealthy--;
  }

  const result: StalenessSweepResult = {
    ranAt: now,
    trusted,
    majorityLedgerIndex: cluster?.index ?? null,
    clusterSize: cluster?.members.length ?? 0,
    responded: ok.length,
    amendmentBlocked: blockedUrls.map(host),
    lagging: lagging.map((l) => ({ host: host(l.url), ledgerIndex: l.ledgerIndex, behindBy: l.behindBy })),
    cooled: cooled.map(host),
    floorHit,
  };
  lastSweep = result;
  return result;
}

function sweepDue(): boolean {
  if (!lastSweep) return true;
  return Date.now() - lastSweep.ranAt > (lastSweep.trusted ? SWEEP_INTERVAL_MS : DISTRUST_RETRY_MS);
}

/** Refresh the sweep if due, coalescing concurrent callers onto one in-flight probe. */
async function ensureSweepFresh(): Promise<StalenessSweepResult | null> {
  if (!sweepDue()) return lastSweep;
  if (!sweepInFlight) sweepInFlight = sweepNodeHealth().finally(() => (sweepInFlight = null));
  return sweepInFlight;
}

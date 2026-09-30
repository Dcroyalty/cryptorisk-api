// lib/cron-runs.ts — per-job heartbeat rows in cron_runs. Each scheduled job
// records its outcome here; the watchdog reads them to catch a job that stopped
// running or keeps failing. Written only from CRON_SECRET-gated routes.
import { sql } from "@/lib/db";

export type Job = "refresh-lists" | "shield-sweep" | "watchdog";

export interface CronRun {
  job: Job;
  last_run_at: string;
  last_ok_at: string | null;
  ok: boolean;
  detail: unknown;
}

let ensured = false;
async function ensureTable() {
  if (ensured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS cron_runs (
      job text PRIMARY KEY,
      last_run_at timestamptz NOT NULL,
      last_ok_at timestamptz,
      ok boolean NOT NULL,
      detail jsonb
    )
  `;
  ensured = true;
}

/** Never throws — a heartbeat write must not turn a good run into a failed one. */
export async function recordRun(job: Job, ok: boolean, detail: unknown): Promise<void> {
  try {
    await ensureTable();
    await sql`
      INSERT INTO cron_runs (job, last_run_at, last_ok_at, ok, detail)
      VALUES (${job}, now(), ${ok ? new Date().toISOString() : null}, ${ok}, ${JSON.stringify(detail ?? null)}::jsonb)
      ON CONFLICT (job) DO UPDATE SET
        last_run_at = now(),
        last_ok_at = CASE WHEN EXCLUDED.ok THEN now() ELSE cron_runs.last_ok_at END,
        ok = EXCLUDED.ok,
        detail = EXCLUDED.detail
    `;
  } catch (e) {
    console.error(`[cron-runs] could not record ${job}:`, (e as Error)?.message ?? e);
  }
}

export async function readRuns(): Promise<Map<Job, CronRun>> {
  await ensureTable();
  const rows = (await sql`SELECT job, last_run_at, last_ok_at, ok, detail FROM cron_runs`) as CronRun[];
  return new Map(rows.map((r) => [r.job, r]));
}

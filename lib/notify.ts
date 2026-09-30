// lib/notify.ts — loud-failure alerting, same contract as XRPLHub's notify.ts.
// Posts DIRECTLY to ERROR_WEBHOOK_URL (Discord or Slack incoming webhook). Every
// path is wrapped: these never throw and their promises never reject, so they
// are safe anywhere. Everything is also console'd, so it lands in the Vercel
// logs even when no webhook is configured.

const LABEL = "UXUS";

function hookUrl(): string | null {
  const hook = process.env.ERROR_WEBHOOK_URL;
  return hook && /^https:\/\//.test(hook) ? hook : null;
}

async function post(hook: string, discordContent: string, slackText: string): Promise<boolean> {
  try {
    const isDiscord = /discord(app)?\.com\//.test(hook);
    const r = await fetch(hook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(isDiscord ? { content: discordContent.slice(0, 1990) } : { text: slackText }),
      signal: AbortSignal.timeout(5000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function notifyError(route: string, err: unknown, context?: Record<string, unknown>): Promise<boolean> {
  const message = err instanceof Error ? err.message : String(err);
  try {
    console.error(`[alert] ${route}: ${message}`, context ? JSON.stringify(context) : "");
  } catch {
    /* ignore */
  }
  const hook = hookUrl();
  if (!hook) return false;
  const ctx = context ? "\n```" + JSON.stringify(context).slice(0, 800) + "```" : "";
  return post(hook, `🚨 **${LABEL}** \`${route}\`\n\`\`\`${message.slice(0, 1000)}\`\`\`${ctx}`, `🚨 ${LABEL} \`${route}\`: ${message}${ctx}`);
}

/** Non-error message through the same webhook (recoveries, weekly "I'm alive"). */
export async function notifyInfo(route: string, message: string, context?: Record<string, unknown>): Promise<boolean> {
  try {
    console.log(`[info] ${route}: ${message}`, context ? JSON.stringify(context) : "");
  } catch {
    /* ignore */
  }
  const hook = hookUrl();
  if (!hook) return false;
  const ctx = context ? "\n```" + JSON.stringify(context).slice(0, 1200) + "```" : "";
  return post(hook, `ℹ️ **${LABEL}** \`${route}\`\n${message.slice(0, 1200)}${ctx}`, `ℹ️ ${LABEL} \`${route}\`: ${message}${ctx}`);
}

/**
 * External dead-man's switch. If HEALTHCHECK_PING_URL is set (a healthchecks.io
 * check), the watchdog pings it on success and appends "/fail" on failure. If
 * the crons, Vercel, the database or the webhook die, the pings stop and that
 * service emails you. Nothing inside this app can report its own death.
 */
export async function pingHealthcheck(suffix: "" | "/fail" = "", body?: string): Promise<void> {
  const url = process.env.HEALTHCHECK_PING_URL;
  if (!url || !/^https:\/\//.test(url)) return;
  try {
    await fetch(url.replace(/\/$/, "") + suffix, {
      method: body ? "POST" : "GET",
      body: body?.slice(0, 10_000),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  } catch {
    /* never break the caller */
  }
}

export function alertingArmed(): boolean {
  return !!hookUrl();
}

export function deadMansSwitchArmed(): boolean {
  const url = process.env.HEALTHCHECK_PING_URL;
  return !!url && /^https:\/\//.test(url);
}

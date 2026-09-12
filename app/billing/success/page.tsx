"use client";
import { useEffect, useState } from "react";
import { BASE_SITE_CSS } from "../../site-style";
import SiteFooter from "../../components/SiteFooter";

type KeyResult = { api_key: string; plan: string; quota_limit: number; period_end: string };

export default function BillingSuccess() {
  const [state, setState] = useState<"loading" | "pending" | "ready" | "error">("loading");
  const [key, setKey] = useState<KeyResult | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) {
      setState("error");
      setMessage("Missing session_id — this page is reached from the Stripe checkout redirect.");
      return;
    }

    let cancelled = false;
    let attempts = 0;

    async function poll() {
      attempts++;
      try {
        const r = await fetch(`/api/billing/key?session_id=${encodeURIComponent(sessionId as string)}`);
        const j = await r.json();
        if (cancelled) return;
        if (r.status === 202) {
          setState("pending");
          if (attempts < 8) setTimeout(poll, 1500);
          else { setState("error"); setMessage("Still provisioning — refresh this page in a minute, or contact support."); }
          return;
        }
        if (!r.ok) {
          setState("error");
          setMessage(j.message || "Could not retrieve your key.");
          return;
        }
        setKey(j);
        setState("ready");
      } catch {
        if (!cancelled) { setState("error"); setMessage("Request failed. Refresh to retry."); }
      }
    }
    poll();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html:
            BASE_SITE_CSS +
            `
        .keybox{background:var(--card);border:1px solid var(--rule);border-radius:3px;padding:20px;margin:24px 0}
        .keybox code{display:block;font-family:'IBM Plex Mono',monospace;font-size:14px;padding:12px 14px;
          background:#F6F8F9;border:1px solid var(--rule);border-radius:2px;word-break:break-all;margin:10px 0}
        .row{font-size:13.5px;margin:4px 0}
      `,
        }}
      />
      <div className="wrap">
        <div className="top">
          <a href="/"><b>UXUS Agent Services</b></a>
          <nav>
            <a href="/pricing">Pricing</a>
            <a href="/terms">Terms</a>
          </nav>
        </div>

        <h1>You&apos;re subscribed</h1>

        {state === "loading" || state === "pending" ? (
          <p className="lede">Provisioning your API key…</p>
        ) : state === "error" ? (
          <p className="lede">{message}</p>
        ) : (
          key && (
            <div className="keybox">
              <div className="row">
                Plan: <strong>{key.plan}</strong> — {key.quota_limit.toLocaleString()} screens/month
              </div>
              <div className="row">Your API key (save this — it won&apos;t be shown again here):</div>
              <code>{key.api_key}</code>
              <div className="row muted">
                Use it as <code>Authorization: Bearer {"<key>"}</code> on <code>GET /api/risk/pro</code>.
              </div>
            </div>
          )
        )}

        <SiteFooter />
      </div>
    </>
  );
}

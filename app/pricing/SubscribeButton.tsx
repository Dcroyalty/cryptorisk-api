"use client";
import { useState } from "react";
import type { PlanId } from "@/lib/stripe";

export default function SubscribeButton({ plan }: { plan: PlanId }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function go() {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const j = await r.json();
      if (!r.ok || !j.url) {
        setErr(j.message || "Checkout is unavailable right now.");
        setBusy(false);
        return;
      }
      window.location.href = j.url;
    } catch {
      setErr("Request failed. Try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn on" onClick={go} disabled={busy} style={{ width: "100%", border: 0, cursor: busy ? "default" : "pointer" }}>
        {busy ? "Redirecting…" : "Subscribe"}
      </button>
      {err && <div style={{ color: "#B3261E", fontSize: 12.5, marginTop: 8 }}>{err}</div>}
    </>
  );
}

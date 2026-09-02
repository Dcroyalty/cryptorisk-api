"use client";
import { useState } from "react";

const SERVICES = [
  { id: "llm",     send: "prompt",           get: "completion",              price: "0.01", note: "any model, no key" },
  { id: "scrape",  send: "url",              get: "markdown + title",        price: "0.01", note: "handles bot-blocking" },
  { id: "extract", send: "schema + url/text",get: "JSON in your shape",      price: "0.01", note: "" },
  { id: "embed",   send: "text or text[]",   get: "1024-dim vectors",        price: "0.01", note: "batch to 64" },
  { id: "search",  send: "query",            get: "ranked results",          price: "0.01", note: "" },
  { id: "risk/pro",send: "0x address",       get: "0–100 score + verdict",   price: "0.01", note: "sanctions, scam, honeypot" },
];

export default function Home() {
  const [addr, setAddr] = useState("0x0330070FD38Ec3bB94F58FA55D40368271E9e54A");
  const [out, setOut] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true); setOut("");
    try {
      const r = await fetch(`/api/risk?address=${encodeURIComponent(addr.trim())}&chain=ethereum`);
      setOut(JSON.stringify(await r.json(), null, 2));
    } catch {
      setOut("Request failed. Check the address format and try again.");
    }
    setBusy(false);
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        :root{
          --paper:#EDF1F3; --card:#FFFFFF; --ink:#12171C; --muted:#5A6B75;
          --petrol:#0E5C63; --gold:#8A6212; --ok:#1C6B3C; --rule:#C6D1D6;
        }
        *{box-sizing:border-box}
        body{margin:0;background:var(--paper);color:var(--ink);
          font-family:Archivo,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
        .wrap{max-width:920px;margin:0 auto;padding:0 24px}
        .top{display:flex;justify-content:space-between;align-items:baseline;
          padding:22px 0;border-bottom:1px solid var(--rule);font-family:'IBM Plex Mono',monospace;font-size:13px}
        .top b{font-weight:600;letter-spacing:-.01em}
        .top span{color:var(--muted)}
        h1{font-size:clamp(34px,6vw,58px);line-height:1.02;letter-spacing:-.035em;
          font-weight:700;margin:56px 0 20px;max-width:16ch}
        .lede{font-size:19px;line-height:1.55;color:var(--muted);max-width:56ch;margin:0 0 40px}
        .exchange{background:var(--card);border:1px solid var(--rule);border-radius:3px;
          font-family:'IBM Plex Mono',monospace;font-size:13px;line-height:1.75;overflow:hidden}
        .row{padding:14px 18px}
        .row + .row{border-top:1px solid var(--rule)}
        .dim{color:var(--muted)}
        .code402{color:var(--gold);font-weight:600}
        .code200{color:var(--ok);font-weight:600}
        .mid{background:#F6F8F9;color:var(--muted);font-style:italic}
        h2{font-size:15px;font-weight:600;letter-spacing:.01em;margin:64px 0 18px;
          padding-bottom:10px;border-bottom:1px solid var(--rule)}
        table{width:100%;border-collapse:collapse;font-size:14px}
        th{text-align:left;font-weight:500;color:var(--muted);padding:0 12px 10px 0;font-size:13px}
        td{padding:11px 12px 11px 0;border-top:1px solid var(--rule);vertical-align:top}
        td.svc{font-family:'IBM Plex Mono',monospace;font-weight:500;white-space:nowrap}
        td.price{font-family:'IBM Plex Mono',monospace;text-align:right;color:var(--gold);
          font-weight:600;white-space:nowrap;padding-right:0}
        .note{display:block;color:var(--muted);font-size:12.5px;margin-top:2px}
        .demo{background:var(--card);border:1px solid var(--rule);border-radius:3px;padding:18px}
        .demo label{display:block;font-size:13px;color:var(--muted);margin-bottom:8px}
        .field{display:flex;gap:8px;flex-wrap:wrap}
        input{flex:1;min-width:260px;font-family:'IBM Plex Mono',monospace;font-size:13px;
          padding:11px 12px;border:1px solid var(--rule);border-radius:2px;background:#FBFCFC;color:var(--ink)}
        input:focus{outline:2px solid var(--petrol);outline-offset:-1px}
        button{font-family:Archivo,sans-serif;font-size:14px;font-weight:600;padding:11px 22px;
          border:0;border-radius:2px;background:var(--petrol);color:#fff;cursor:pointer}
        button:disabled{opacity:.5;cursor:default}
        pre{margin:14px 0 0;padding:14px;background:#F6F8F9;border:1px solid var(--rule);
          border-radius:2px;font-family:'IBM Plex Mono',monospace;font-size:12.5px;
          line-height:1.6;overflow-x:auto;white-space:pre-wrap;word-break:break-word}
        .links{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:1px;
          background:var(--rule);border:1px solid var(--rule);border-radius:3px;overflow:hidden}
        .links a{display:block;padding:16px 18px;background:var(--card);text-decoration:none;color:var(--ink)}
        .links a:hover{background:#F6F8F9}
        .links strong{display:block;font-size:14px;font-weight:600;margin-bottom:3px}
        .links span{font-size:12.5px;color:var(--muted);font-family:'IBM Plex Mono',monospace;
          word-break:break-all}
        footer{margin:72px 0 40px;padding-top:20px;border-top:1px solid var(--rule);
          font-size:12.5px;color:var(--muted);line-height:1.7}
        @media (prefers-reduced-motion:reduce){*{transition:none!important}}
      `}} />

      <div className="wrap">
        <div className="top">
          <b>CryptoRisk Agent Services</b>
          <span>USDC · Base · x402</span>
        </div>

        <h1>Six primitives your agent can pay for by itself.</h1>
        <p className="lede">
          No account, no API key, no signup form. A funded USDC wallet on Base is the
          entire integration. Your agent calls, gets a price, pays, and gets the answer —
          usually inside three seconds.
        </p>

        <div className="exchange">
          <div className="row">
            <span className="dim">$</span> curl https://uxus.finance/api/scrape?url=https://example.com
          </div>
          <div className="row">
            <span className="code402">402 Payment Required</span><br />
            <span className="dim">payment-required:</span> eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0cyI6W3sic2NoZW1lIjoiZXhhY3Qi…<br />
            <span className="dim">amount</span> 10000 <span className="dim">atomic USDC</span> · <span className="dim">network</span> Base
          </div>
          <div className="row mid">client signs the transfer and retries — no human in the loop</div>
          <div className="row">
            <span className="code200">200 OK</span><br />
            {`{ "title": "Example Domain", "content": "# Example Domain\\n\\nThis domain is for use in…", "chars": 149 }`}
          </div>
        </div>

        <h2>Services and prices</h2>
        <table>
          <thead>
            <tr><th>Endpoint</th><th>You send</th><th>You get</th><th style={{textAlign:"right"}}>USDC</th></tr>
          </thead>
          <tbody>
            {SERVICES.map(s => (
              <tr key={s.id}>
                <td className="svc">/api/{s.id}</td>
                <td>{s.send}</td>
                <td>{s.get}{s.note && <span className="note">{s.note}</span>}</td>
                <td className="price">{s.price}</td>
              </tr>
            ))}
            <tr>
              <td className="svc">/api/risk</td>
              <td>0x address</td>
              <td>score, level, verdict<span className="note">free, no payment</span></td>
              <td className="price">0.00</td>
            </tr>
            <tr>
              <td className="svc">/api/catalog</td>
              <td>nothing</td>
              <td>every service, machine-readable<span className="note">free, no payment</span></td>
              <td className="price">0.00</td>
            </tr>
          </tbody>
        </table>

        <h2>Try the free tier now</h2>
        <div className="demo">
          <label htmlFor="a">Any Ethereum address — the one below is on the OFAC sanctions list</label>
          <div className="field">
            <input id="a" value={addr} onChange={e => setAddr(e.target.value)} spellCheck={false} />
            <button onClick={run} disabled={busy}>{busy ? "Checking" : "Check address"}</button>
          </div>
          {out && <pre>{out}</pre>}
        </div>

        <h2>Connect</h2>
        <div className="links">
          <a href="/api/mcp"><strong>MCP server</strong><span>/api/mcp</span></a>
          <a href="/api/catalog"><strong>Catalog</strong><span>/api/catalog</span></a>
          <a href="/.well-known/x402.json"><strong>x402 discovery</strong><span>/.well-known/x402.json</span></a>
          <a href="/openapi.json"><strong>OpenAPI</strong><span>/openapi.json</span></a>
          <a href="/llms.txt"><strong>Agent docs</strong><span>/llms.txt</span></a>
        </div>

        <footer>
          Payments settle in USDC on Base via the x402 protocol. Risk signals are compiled from public
          sources including the OFAC sanctions list, community scam and phishing registries, and on-chain
          contract analysis — developer-grade screening, not a substitute for a compliance program.
        </footer>
      </div>
    </>
  );
}

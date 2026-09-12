// app/components/SiteFooter.tsx — footer used on every page. Self-contained
// (own <style> tag, hardcoded colors) so it renders correctly regardless of
// which page's CSS surrounds it.
import { CONTACT_EMAIL } from "@/lib/legal";

export default function SiteFooter() {
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .uxus-foot{margin:72px 0 40px;padding-top:20px;border-top:1px solid #C6D1D6;
          font-size:12.5px;color:#5A6B75;line-height:1.7;font-family:Archivo,system-ui,sans-serif}
        .uxus-foot nav{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px;
          font-family:'IBM Plex Mono',monospace}
        .uxus-foot nav a{color:#0E5C63;text-decoration:none}
        .uxus-foot nav a:hover{text-decoration:underline}
        .uxus-foot a.mail{color:#0E5C63;text-decoration:none}
        .uxus-foot a.mail:hover{text-decoration:underline}
      `,
        }}
      />
      <footer className="uxus-foot">
        <nav>
          <a href="/pricing">Pricing</a>
          <a href="/terms">Terms</a>
          <a href="/refunds">Refunds</a>
        </nav>
        Contact: <a className="mail" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Risk signals are
        compiled from public sources including the OFAC sanctions list, community scam and phishing
        registries, and on-chain contract analysis — developer-grade screening, not a substitute for a
        compliance program. No warranty on accuracy or completeness.
      </footer>
    </>
  );
}

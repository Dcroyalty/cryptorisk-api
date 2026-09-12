// app/site-style.ts — shared design tokens/base styles for the static pages
// (/pricing, /terms, /refunds). Extracted from the homepage's inline style so
// the legal/pricing pages match the site's look without re-typing the same
// ~30 lines of CSS in every file. Each page still owns any page-specific CSS
// (e.g. pricing cards) and appends it after this block.

export const BASE_SITE_CSS = `
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
.top a{color:inherit;text-decoration:none}
.top span, .top nav{color:var(--muted)}
.top nav{display:flex;gap:18px}
.top nav a:hover{color:var(--ink)}
h1{font-size:clamp(30px,5vw,46px);line-height:1.05;letter-spacing:-.03em;
  font-weight:700;margin:48px 0 16px;max-width:22ch}
.lede{font-size:17px;line-height:1.55;color:var(--muted);max-width:60ch;margin:0 0 32px}
h2{font-size:15px;font-weight:600;letter-spacing:.01em;margin:48px 0 16px;
  padding-bottom:10px;border-bottom:1px solid var(--rule)}
p, li{font-size:15px;line-height:1.7}
p + p{margin-top:14px}
ul, ol{padding-left:20px}
li + li{margin-top:8px}
.muted{color:var(--muted)}
.updated{font-family:'IBM Plex Mono',monospace;font-size:12.5px;color:var(--muted);margin:-8px 0 32px}
`;

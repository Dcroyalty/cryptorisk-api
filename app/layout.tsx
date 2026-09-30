import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "UXUS — Agent Services",
  description:
    "Pay-per-call primitives for AI agents on Base: inference, scraping, extraction, embeddings, search, and wallet/token risk. Paid in USDC via x402 — no accounts, no API keys.",
  metadataBase: new URL("https://uxus.finance"),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {children}
        {/* Vercel Web Analytics: cookieless page views + referrers (e.g. YouTube). */}
        <Analytics />
      </body>
    </html>
  );
}

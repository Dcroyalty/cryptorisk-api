// lib/address-detect.ts — chain + address-format detection from the string alone.
// No network calls. This is what lets /api/lookup take any address with no chain param.

export type DetectedChain = "evm" | "xrpl" | "unknown";
export type AddressFormat = "evm" | "xrpl-classic" | "xrpl-x-address" | "unknown";

export interface Detection {
  chain: DetectedChain;
  format: AddressFormat;
}

// Base58 character set — identical for Bitcoin and XRPL (only the ordering
// differs). Excludes 0, O, I, l. Detection only needs the set, not the order.
const B58 = "1-9A-HJ-NP-Za-km-z";

const EVM = /^0x[0-9a-fA-F]{40}$/;
// Classic XRPL address: 'r' + 24-34 base58 chars (25-35 total).
const XRPL_CLASSIC = new RegExp(`^r[${B58}]{24,34}$`);
// XRPL X-address: 'X' (mainnet) / 'T' (testnet) + base58 body (~46-48 total).
// Charset + length guard beyond "starts with X/T" so a random string isn't misread.
const XRPL_XADDR = new RegExp(`^[XT][${B58}]{40,55}$`);

export function detectAddress(raw: string): Detection {
  const a = (raw || "").trim();
  if (EVM.test(a)) return { chain: "evm", format: "evm" };
  if (XRPL_CLASSIC.test(a)) return { chain: "xrpl", format: "xrpl-classic" };
  if (XRPL_XADDR.test(a)) return { chain: "xrpl", format: "xrpl-x-address" };
  return { chain: "unknown", format: "unknown" };
}

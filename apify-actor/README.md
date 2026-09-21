# Wallet & Address Sanctions + Risk Screener

Give it an EVM address. It checks the **OFAC SDN list**, **community scam/phishing registries**, **live on-chain contract control reads** (owner, pause, upgradeable proxy), and **wallet age + transaction history** — and resolves all four into one scored verdict. Not a single-list lookup wearing a scanner's name.

## Why this one, not the others

There are a handful of OFAC/crypto-sanctions actors on the Store already. Look at what they actually do: submit an address, get back `sanctioned: true/false` against one static list. That's it — one signal, one lookup.

This actor runs the same production scoring engine behind [uxus.finance](https://uxus.finance), and it checks four things, not one:

- **OFAC SDN list** — the real US Treasury sanctions list, refreshed daily
- **Community scam/phishing registries** — addresses reported malicious outside of OFAC (a different, and differently-labeled, risk)
- **Live on-chain contract reads** — `eth_call`/`eth_getStorageAt` against the address right now: is it a contract, is ownership renounced, can the owner pause transfers, is it an upgradeable proxy that could swap its own logic in one transaction
- **Wallet age and transaction history** — a wallet a few days old with high transaction velocity reads differently than one with years of history

A single-signal OFAC checker tells you "not on the list." This tells you "not on the list, *and* here's what its owner could still do to you, *and* whether the read that would tell us otherwise actually succeeded."

## What you get back, per address

```json
{
  "address": "0x0330070fd38ec3bb94f58fa55d40368271e9e54a",
  "chain": "ethereum",
  "valid": true,
  "degraded": false,
  "sanctions_verdict": "BLOCK",
  "sanctions_risk_score": 100,
  "sanctions_flags": ["SANCTIONED"],
  "sanctions_reasons": [
    {
      "code": "SANCTIONED",
      "severity": 10,
      "detail": "Address is on the OFAC SDN sanctions list",
      "source": "ofac"
    }
  ],
  "sanctions_source": "ofac",
  "wallet_signals": {
    "wallet_age_days": 1246,
    "tx_count": 4,
    "first_seen": "2023-04-21T12:13:59.000Z",
    "last_seen": "2024-12-04T05:51:11.000Z",
    "signals_ok": true
  },
  "lists_consulted": ["mew", "ofac", "scamsniffer"],
  "lists_matched": ["ofac"],
  "is_contract": false,
  "mutable_verdict": "SAFE_TO_HOLD",
  "mutable_risk_score": 0,
  "can_turn_hostile": false,
  "time_to_rug": "impossible",
  "owner_powers": ["NOT_A_CONTRACT"],
  "controls": { "owner": null, "ownership_renounced": true, "is_upgradeable_proxy": false, "proxy_admin": null, "implementation": null, "has_pause": false, "is_paused": null, "pending_owner": null },
  "rpc_ok": true,
  "disclaimer": "Automated screening from public data (OFAC SDN list, community scam/phishing registries, on-chain reads). Developer-grade signal, not legal, financial, or compliance advice and not a substitute for a compliance program. Lists refresh daily and can lag a real-world designation; verify against the official source before you act. No warranty.",
  "checked_at": "2026-09-19T02:46:20.514Z"
}
```

That's a real, live run against an address actually on the current OFAC SDN list — not a mocked example. Here's a clean address, same run, same code:

```json
{
  "address": "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
  "chain": "ethereum",
  "valid": true,
  "degraded": false,
  "sanctions_verdict": "PROCEED",
  "sanctions_risk_score": 0,
  "sanctions_flags": ["CLEAN"],
  "sanctions_source": null,
  "wallet_signals": { "wallet_age_days": 4008, "tx_count": 10000, "signals_ok": true },
  "lists_consulted": ["mew", "ofac", "scamsniffer"],
  "lists_matched": [],
  "is_contract": true,
  "mutable_verdict": "SAFE_TO_HOLD",
  "mutable_risk_score": 0,
  "can_turn_hostile": false,
  "time_to_rug": "impossible",
  "owner_powers": ["CONTROLS_LOCKED"],
  "rpc_ok": true
}
```

## When a source can't be reached, you're told — never a silent "clean"

If the block-explorer history lookup fails, or an on-chain read doesn't land on any node, that's not treated as "no findings." It's treated as **unknown**. The sanctions verdict is floored so it can never read as safe, and every on-chain field we couldn't read is `null` — never a default that looks like an observation:

```json
{
  "degraded": true,
  "sanctions_verdict": "CAUTION",
  "sanctions_flags": ["HISTORY_UNAVAILABLE"],
  "sanctions_reasons": [{
    "code": "HISTORY_UNAVAILABLE",
    "detail": "Block-explorer history lookup failed (rate-limited or unavailable). No sanctions or scam-list match was found, but wallet-behavior signals were NOT checked — treat this as unassessed, not clean."
  }],
  "wallet_signals": { "wallet_age_days": null, "tx_count": null, "signals_ok": false },
  "lists_consulted": ["mew", "ofac", "scamsniffer"],
  "lists_matched": [],
  "is_contract": null,
  "mutable_verdict": "MONITOR",
  "mutable_risk_score": null,
  "can_turn_hostile": null,
  "time_to_rug": null,
  "owner_powers": ["RPC_UNAVAILABLE_RESULT_UNKNOWN"],
  "controls": { "owner": null, "ownership_renounced": null, "is_upgradeable_proxy": null, "proxy_admin": null, "implementation": null, "has_pause": null, "is_paused": null, "pending_owner": null },
  "rpc_ok": false
}
```

When `rpc_ok` is `false`:

- `is_contract`, `mutable_risk_score`, `can_turn_hostile`, `time_to_rug` and **every key of `controls`** are `null`. `null` means "we couldn't read this" — not `false`, not `0`. A `false` from this actor is always something we observed.
- It's all-or-nothing. If any read that feeds the verdict fails, the whole on-chain block is `null`, even a read that did land (`eth_getCode` succeeding doesn't make `is_contract` trustworthy when the owner and proxy reads didn't).
- `mutable_verdict` is the fixed floor `MONITOR` — "could not assess," never `SAFE_TO_HOLD` — the on-chain counterpart of `CAUTION`. `owner_powers` names why: `RPC_UNAVAILABLE_RESULT_UNKNOWN` (no node answered) or `PARTIAL_READ_RESULT_UNKNOWN` (some reads landed, some didn't).

An address that's on a list still returns that hit when the sources are down — a degraded run never downgrades a `BLOCK`.

### Which lists were checked vs. which matched

- **`lists_consulted`** — every list the address was checked against, hit or not (currently `mew`, `ofac`, `scamsniffer`). It's the same on every record in a run, so a clean address shows what "clean" was checked against. If no lists are loaded (or the list database can't be reached) the run returns an explanatory `no_lists_loaded` / `database_unavailable` record instead of any verdict, rather than return unsupported "clean" results.
- **`lists_matched`** — only the lists that matched this address. `[]` on a clean address means checked, no hit.
- **`sanctions_source`** — the list behind a `SANCTIONED` finding: `"ofac"` for an actual SDN hit, never `"ofac"` for anything else. It is `null` when the address is only on a scam/phishing registry — those come back as a `SCAM_LIST_MATCH` reason (with the registry as its `source`), `BLOCK`, and an entry in `lists_matched`.

## Input

| Field | Type | Required | Notes |
|---|---|---|---|
| `addresses` | array of strings | yes | EVM addresses, `0x` + 40 hex chars. Up to 1,000 per run. |
| `chain` | `"ethereum"` \| `"base"` \| `"arc"` | no (default `ethereum`) | Which chain to read on-chain signals from. |

An address that isn't valid EVM format gets back `{ "valid": false, "error": "invalid_address", ... }` instead of failing the run — and isn't charged.

Both fields are pre-filled in the Console form — one address on no list and one on the OFAC SDN list, on `ethereum` — so pressing **Start** shows a clean result and a `BLOCK` side by side in well under a minute.

## Errors never fail the run

The Actor always finishes **SUCCEEDED** and always writes at least one dataset item. Anything that goes wrong is a record with an `error` code, a `message`, and usually a `hint` — never a verdict, and never a silent "clean". An address that could not be screened is reported as **not screened**.

| `error` | Meaning |
|---|---|
| `invalid_address` | Not a 0x + 40-hex address. Not screened. |
| `invalid_chain` | `chain` was not `ethereum`, `base` or `arc`. Nothing screened. |
| `no_addresses` | Input had no `addresses`. |
| `too_many_addresses` | More than 1,000 addresses; the first 1,000 were screened. |
| `missing_database_url` | `DATABASE_URL` is not set on the Actor, so the sanctions/scam lists can't be read. Nothing screened. |
| `database_unavailable` | The list database could not be reached or rejected the connection. Nothing screened. |
| `no_lists_loaded` | The lists table is empty; screening it would report everything clean, so nothing is screened. |
| `screening_timeout` | One address took more than 45 s (a data provider hung). That address was not screened. |
| `screening_failed` | One address could not be screened (message says why). |
| `screening_aborted` | Three addresses in a row failed, so the rest were not attempted. |
| `charge_limit_reached` | The run's maximum charge was reached; remaining addresses were not screened. |
| `no_output` | Safety net: the run produced nothing else. |

A reachable-but-degraded data source (block explorer or RPC down) is different: that still returns a full record with `degraded: true` and `null` on-chain fields, as described above. Only a genuine crash (a bug, out-of-memory) exits FAILED. Error records are never billed as `address-screened`; under pay-per-event, Apify's standard per-dataset-item event still applies to every item pushed.

## Pricing

**$0.03 per address screened — $30 per 1,000.** Invalid-format addresses aren't charged — no work was done. Pay-per-event, no subscription.

## What this is not

Developer-grade signal, not a compliance program and not legal advice. Sanctions and scam lists refresh daily and can lag a real, current designation — verify against the official OFAC source before you act on a match. This actor does not check for token clawback or freeze functions; the live contract-control checks cover ownership, pause, and upgradeable-proxy admin — nothing more.

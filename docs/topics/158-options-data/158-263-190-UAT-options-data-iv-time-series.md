**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV rank  
**Thread Slug:** iv-rank  
**Issue:** #263  
**Task:** #190  
**Blueprint Parent:** #184  
**Thread Parent:** #163  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-03  
**Last Updated:** 2026-11-03  

# UAT — Task #190: IV rank prod verify script

## Scope

The deliverable is the script itself and its guide — a deliberate,
on-demand production verification for the IV-rank pipeline:
`computeForDate` → `computeRankForDate` → day-entry rank fields →
`iv-rank-latest` forward-only update → deployed `partnerIvRankV2`
screener (`sort`/`dir`/`minN`/auth/error paths) →
`partnerIvMetricsV2` rank-field flow. QA = execute the documented
scenarios and confirm the script detects what it claims to detect.

## Prerequisites

- `cd functions`; Node deps installed; ADC credentials with Firestore +
  GCS read (`gcloud auth application-default login` or SA key).
- For endpoint checks: an OIDC token minted for an allowlisted SA —
  see `options-data-190-iv-rank.md` (base-host `--audiences`,
  `--include-email` required).
- An `optionsEnabled` symbol — default `QQQ`.

## Scenarios — executed

| # | Scenario | Command / steps | Expected | Result |
|---|---|---|---|---|
| 1 | Registration + exclusion | `grep` README for the #190 row; `run-all.ts` exclusion comment present | Row + comment exist | ✅ PASS — README table row registered; `run-all.ts` carries the "mutating, run manually" comment |
| 2 | Full pipeline + endpoint sweep | `options-data-190-iv-rank.ts QQQ 2026-10-30` with `IV_RANK_ID_TOKEN` | `=== All verification checks passed ===`, exit 0 | ✅ PASS — **41/41** (2026-11-03): optionsEnabled gate, compute, rank write, all day-entry invariants, `latestUpdated=true`/`asOfDate === date`, 130-row sorted table + missing-sink desc+asc, wire/doc parity, `minN` ceiling + fallback + **discriminating window-mapping** (NTAP `ivN30=14 < ivN360=148`), metrics-endpoint rank fields, 400 `BAD_REQUEST` ×3, `minN=-1`/`2.5` → 400, POST → 405 |
| 3 | Forward-only branch | same, `QQQ 2024-01-05` (no token) | `latestUpdated=false`, `asOfDate` strictly `>`; withheld-fields invariant (`n=1` → `ivRank` absent, `ivPct=100` present) | ✅ PASS — `asOfDate` stayed `2026-10-30`, no regression; `(endpoint auth checks skipped)` banner, exit 0 |
| 4 | Anti-pollution gate | `… ZZZZ 2024-01-05` | FAIL before any write | ✅ PASS — `FAIL: ZZZZ is tracked and optionsEnabled`, exit 1 |
| 5 | Arg validation | `… QQQ not-a-date` | FAIL before any write | ✅ PASS — `FAIL: date arg is YYYY-MM-DD`, exit 1 |
| 6 | Transport resilience | observed live twice | transport error → clean FAIL, not uncaught crash | ✅ PASS — `FAIL: no token → 401 (got 0)` / `FAIL: sorted table 200 (got 0)`, exit 1, no stack-free crash. `NODE_OPTIONS=--dns-result-order=ipv4first` cleared the Node fetch blip when curl was healthy |
| 7 | No-token path | `env -u IV_RANK_ID_TOKEN …` | compute/rank/latest/401 verified, then SKIP + exit 0 | ✅ PASS |
| 8 | Regression | `cd functions && npx jest`; `npx tsc --noEmit` | all green | ✅ PASS — **107 suites / 1,242 tests**; tsc clean |

## Traceability

| Task #190 acceptance criterion | Scenario |
|---|---|
| Deliberate on-demand prod verify script (extends #173 pattern) | 1, 2 |
| Full path: compute → rank → day-entry fields → latest → endpoint | 2, 3 |
| `sort`/`dir`/`minN`/auth/invalid-param verification | 2 |
| Positional `[SYMBOL] [YYYY-MM-DD]`; env defaults | 2, 3, 5 |
| Mutating writes documented; excluded from `run-all` w/ comment | 1; guide §Mutating |
| Per-task guide: commands, ADC/SA setup, token minting, pass/fail shapes, cleanup | guide doc reviewed — includes Pass/Fail sections, base-host aud note, troubleshooting |
| Registered in verify README | 1 |
| Real prod services/endpoint, not mocks | 2, 3 (live GCS, Firestore, run.app) |

## Findings

None blocking. Notes:

- Node `fetch` to run.app was intermittently flaky this session while
  `curl` stayed healthy; `NODE_OPTIONS=--dns-result-order=ipv4first`
  resolved it locally. Transient — not a script defect; the script
  correctly fails (status 0) rather than passing.
- The `minN=148` discriminator depends on a real row with
  `ivN30 < ivN360` existing; if none, the script logs an acceptable
  `SKIP:` (documented in the guide).

## Refinement pass

Not applicable — no user-facing surface (backend verification script +
guide doc only).

## Verdict

**PASS** — ship-eligible.

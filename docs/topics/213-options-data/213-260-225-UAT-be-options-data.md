**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-data  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** corpus-backfill-2026  
**Issue:** #260  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Task:** #225  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-01  
**Last Updated:** 2026-11-01  

# UAT — Task #225: Partner endpoint + Firestore rules

## Scope

`partnerOptionsDeltaPicksV1` — partner HTTPS GET endpoint serving one
year-sharded delta-pick cell doc,
`options-delta-picks/{SYM}-{type}-{deltaPct}-{dte}/years/{YYYY}`, for
`(symbol, type, delta, dte, year)` — the unit a SavantTrader backtest reads
(a full year of daily picks per call). Params validated against `PICK_GRID`;
off-grid delta/DTE or invalid params → 400 naming the failed component.
Firestore rules deny all client access to `options-delta-picks` — consumers
go through the endpoint only. Auth follows existing partner conventions
(dual-auth OIDC/Firebase; service-account allowlist).

## Prerequisites

- `partnerOptionsDeltaPicksV1` **deployed** (does not exist until
  `firebase deploy --only functions:partnerOptionsDeltaPicksV1`) — plus
  `firebase deploy --only firestore:rules` for the deny rule.
- A Google OIDC ID token for an allowlisted service account (pick one):
  - `$env:PICKS_ID_TOKEN` — pre-minted token
  - `$env:GOOGLE_APPLICATION_CREDENTIALS` — SA key path
  - `$env:SMOKE_SERVICE_ACCOUNT` — SA email for `gcloud` impersonation
  (`--include-email` required for the app-level allowlist check)
- ADC with Firestore read on **prod** for the local handler verification —
  `GCLOUD_PROJECT=alpha-vantage-proxy-api` required or ADC resolves the dev
  `rel-str` project.
- Verify script guide:
  `functions/scripts/verify/options-data-225-pick-endpoint.md`.
- Discovery doc (partner-facing contract):
  `docs/partner/options-data/options-delta-picks-discovery.md`.

## Scenarios

### S1 — Unit tests: validation matrix + handler

```
cd functions
npx jest tests/v2/partner/options-delta-picks
```

Expected: 49 tests — method gate 405, auth 403, every param failure naming
its component (symbol/type/delta/dte/year), off-grid `delta=17`/`dte=63`,
boundary levels (5/95 deltas, 7/365 DTE), `OPTIONS_NOT_ENABLED`,
missing-shard 404, doc serve with envelope + day entries, field-strip,
`toDate()`/`{seconds}`/unstamped `updatedAt` branches, hyphenated `BRK-B`
round-trip.

- **Result/evidence:** PASS — 49 tests green (2026-11-01, post-review-pass-2).

### S2 — Full suite + typecheck

```
cd functions
npx tsc --noEmit
npx jest
```

- **Result/evidence:** PASS — tsc clean; 105 suites / 1,193 tests
  (2026-11-01, post-review-pass-2).

### S3 — Handler against real prod Firestore (pre-deploy read path)

```
cd functions
$env:GCLOUD_PROJECT='alpha-vantage-proxy-api'
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
  scripts/verify/options-data-225-pick-endpoint.ts
```

Expected: full PASS list — 405, validation matrix incl. dotted `BRK.B` →
400 (never 500), `ZZZNOSUCH1` → 404 `OPTIONS_NOT_ENABLED` via the real
gate, `years/2099` → 404 `NOT_FOUND`, and the real
`QQQ-put-20-45/years/2026` doc served with day-entry/header consistency and
ISO `updatedAt`.

- **Result/evidence:** PASS — real `QQQ-put-20-45/years/2026` served
  **208 day entries (204 picks / 4 misses)**; all 20 checks green
  (2026-11-01, post-remediation).

### S4 — Deployed endpoint smoke (requires deploy)

```
firebase deploy --only functions:partnerOptionsDeltaPicksV1
```

Then, with an allowlisted SA OIDC token (see Prerequisites):

```
# method gate runs before auth — no token needed
curl -X POST https://partneroptionsdeltapicksv1-<hash>-uc.a.run.app
# → 405 METHOD_NOT_ALLOWED

curl "https://partneroptionsdeltapicksv1-<hash>-uc.a.run.app?symbol=QQQ&type=put&delta=20&dte=45&year=2026"
# → 401 unauthenticated

curl -H "Authorization: Bearer $PICKS_ID_TOKEN" \
  "https://partneroptionsdeltapicksv1-<hash>-uc.a.run.app?symbol=QQQ&type=put&delta=20&dte=45&year=2026"
# → 200 { ok:true, symbol, type:"put", targetDelta:-0.2, expiry, gridVersion,
#        firstDate, lastDate, pickCount, missCount, days{…}, updatedAt }

# validation on the deployed function
...?symbol=QQQ&type=put&delta=17&dte=45&year=2026   → 400 naming delta
...?symbol=QQQ&type=put&delta=20&dte=63&year=2026   → 400 naming dte
...?type=put&delta=20&dte=45&year=2026              → 400 naming symbol
...?symbol=BRK.B&type=put&delta=20&dte=45&year=2026 → 400 naming symbol (not 500)
...?symbol=ZZZNOSUCH1&type=put&delta=20&dte=45&year=2026 → 404 OPTIONS_NOT_ENABLED
...?symbol=QQQ&type=put&delta=20&dte=45&year=2099   → 404 NOT_FOUND
```

- **Result/evidence:** PASS (2026-11-01). Deployed URL:
  `https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerOptionsDeltaPicksV1`
  (run.app form also registered). Verified live:
  - `POST` → **405** `METHOD_NOT_ALLOWED` (gate runs before auth)
  - no token → **401** `Unauthorized`
  - non-SA user OIDC token → **403** `Forbidden`
  - allowlisted SA (`maintenance-bot@…`, impersonated, `--include-email`)
    → **200**: `symbol=QQQ type=put targetDelta=-0.2 dte=45
    gridVersion=1 firstDate=2026-01-02 lastDate=2026-10-29 pickCount=204
    missCount=4 dayEntries=208 updatedAt=2026-10-30T16:52:39.747Z`
    (ISO-8601, no raw Timestamp shape)
  - `delta=17` → **400** naming `delta`; `dte=63` → **400** naming `dte`;
    missing `symbol` → **400**; `BRK.B` → **400** naming `symbol` (not 500)
  - `ZZZNOSUCH1` → **404** `OPTIONS_NOT_ENABLED`; `year=2099` →
    **404** `NOT_FOUND`
  - Gotcha found + fixed: `EXPECTED_GOOGLE_AUDIENCE` was missing the new
    URL → appended both URL forms (secret v19); firebase pins secret
    versions per function so a function redeploy was required to re-pin
    (recorded in `102-106-RUNBOOK-nightly-ops.md`).

### S5 — Firestore rules deployed: client access denied (requires rules deploy)

```
firebase deploy --only firestore:rules
```

Expected: `firestore.rules` release includes
`match /options-delta-picks/{document=**} { allow read, write: if false; }`.
Verification: rules deploy output + (if feasible) a denied client-SDK read
from a test app. Backend writers/Admin SDK unaffected (rules bypass).

- **Result/evidence:** PASS (2026-11-01) — `firebase deploy --only
  firestore:rules` released `firestore.rules` (compiled clean). The deny
  block `match /options-delta-picks/{document=**} { allow read, write:
  if false; }` is in the deployed ruleset; Admin SDK writers unaffected
  (rules bypass applies to backend only).

### S6 — Partner-facing docs flipped to live (post-deploy)

- `docs/partner/partner-endpoint-inventory.md` — add the
  `partnerOptionsDeltaPicksV1` row (function, Cloud Run service, GET,
  optionsEnabled gate, dual-auth, link to discovery doc).
- `docs/partner/options-data/options-delta-picks-discovery.md` — Status →
  live; fill the deployed URL.
- SavantTrader onboarding: SA email allowlisted +
  `EXPECTED_GOOGLE_AUDIENCE` covers the new URL.

- **Result/evidence:** PASS (2026-11-01) — inventory row added
  (SA-only auth, optionsEnabled 404, grid-validation purpose); discovery
  doc flipped to Live with both deployed URLs; `EXPECTED_GOOGLE_AUDIENCE`
  v19 covers both URL forms; ST's SA
  (`rel-str-partner-caller-prod@rel-str.iam…`) already in
  `ALLOWED_SERVICE_ACCOUNT_EMAILS`.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| GET serves `options-delta-picks/{cell}/years/{YYYY}` for valid in-grid params | S1, S3 (real doc), S4 (deployed) |
| Off-grid delta/DTE → 400 naming the failed param | S1, S3, S4 |
| Missing/invalid params → 400 | S1, S3, S4 |
| `options-delta-picks` rules deny client read/write; admin/backend only | S5 |
| Endpoint tests: doc read + validation matrix | S1 |
| Auth follows partner conventions (dual-auth + SA allowlist) | S1 (unit), S4 (deployed) |
| TEST J4: `(QQQ, put, 20, 45, 2026)` → year doc; off-grid/invalid → 400 | S3, S4 |

## Regression checklist

- [x] Sibling partner endpoints untouched — new files only; `index.ts` adds
  one export line (shared file — other sessions' exports unstaged)
- [x] `PICK_CELL_SYMBOL_PATTERN` extraction — `buildCellId` behavior
  unchanged (same regex, now exported); codec suite green
- [x] `firestore.rules` — new match block is additive; all prior rules
  untouched
- [x] `run-all.ts` — comment-only entry (script needs ADC; manual)
- [x] Writer/pipeline unchanged — endpoint is read-only against existing
  cell docs (pick writer, materialize, nightly append suites green)

## Result

**PASS (2026-11-01)** — all scenarios green. The endpoint is live at
`https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerOptionsDeltaPicksV1`,
verified with a real allowlisted-SA token across the full status matrix
(405/401/403/400×4/404×2/200); the deployed Firestore ruleset denies
client access to `options-delta-picks`; partner docs flipped to live.

**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-data  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** corpus-backfill-2026  
**Issue:** #264  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Task:** #227  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-02  
**Last Updated:** 2026-11-02  

# UAT — Task #227: Chain sanity flags

## Scope

Chain-sanity detection on stored option-chain snapshots. The seed worker
counts puts/calls/rows on the already-fetched AV chain and records them
(`putCount`/`callCount`/`rowCount`/`chainFlag`) on the run-item outcome;
the flag is also stamped on the GCS object's custom metadata. The
standing reconciler treats unconfirmed flagged in-window objects as
gap-eligible (`forceRefetch` dispatch, `kind` preserved) and
upstream-confirmed ones as known thin chains (logged, counted, never
re-seeded). A forced refetch that stays flagged marks the object
`chainFlagConfirmed`; a healthy one delete+writes a replacement.

Acceptance criteria (task #227):

1. Seed outcome metadata records `putCount`/`callCount`/`rowCount` per
   stored chain.
2. `empty`/`calls_only`/`puts_only` flags surface on run items.
3. Reconciler treats flagged chains as gap-eligible for re-seed.
4. Confirmed-empty chains logged distinctly (not retried forever).
5. Unit tests for flag derivation + reconciler consumption.

No user-facing surface — verification is unit tests plus the read-only
prod verification script.

## Prerequisites

- Repo at `av-proxy-api`, `functions/` dependencies installed.
- For prod scenarios: `GCLOUD_PROJECT=alpha-vantage-proxy-api` and ADC
  with read access to prod Firestore + the corpus bucket
  (`av-hist-options-corpus-bucket`). Without it the script refuses to run
  (safety gate).
- `npx jest` / `npx tsc` runnable from `functions/`.

## Test scenarios

### S1 — Prod verify script, dry (read-only) — PASS

Confirms: census projects stamped metadata; recount detects stamped-vs-
payload drift; the real reconcile core dispatches `forceRefetch` for
suspects and logs confirmed chains as thin (synthetic probes make the
assertions non-vacuous); run-item field census.

```powershell
cd functions
$env:GCLOUD_PROJECT='alpha-vantage-proxy-api'
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json `
  scripts/verify/options-data-227-chain-sanity-flags.ts --symbols QQQ
```

Expected: exits 0 with `=== All verification checks passed ===`;
drift lines list the 4 known unstamped QQQ `calls_only` objects
(`2026-08-27`, `2026-09-09`, `2026-09-25`, `2026-10-12`); reconcile
dry-run shows `flagged=1 thinChains=1` from the synthetic probes; all
four `PASS` check lines green.

Evidence (executed 2026-11-02): all checks PASS — `1,967` objects,
`210` in-window recounted (0 corrupt), drift=4 (all `calls_only`);
probe `2026-01-02` dispatched `forceRefetch`, probe `2026-01-05` logged
`thin-chain … empty — upstream-confirmed`; `1,310` run items scanned,
`withCounts=0` (expected pre-deploy — counts land on seeds that run the
flagging worker code).

### S2 — Unit-test gate — PASS

Confirms: flag derivation, adapter stamping/projection/conditional
write, worker counts + forceRefetch heal/confirm/short-circuit/retry,
reconciler consumption + kind preservation, metadata flatten, live-queue
suppression, out-of-window ignore.

```powershell
cd functions
npx jest tests/v2/historical-options-corpus   # corpus suites
npx jest                                     # full regression
npx tsc --noEmit
```

Expected: all green; `tsc` clean.

Evidence (executed 2026-11-02): corpus **31 suites / 316 tests**;
full suite **107 suites / 1,248 tests**; `tsc` clean.

### S3 — Boundary/negative paths — PASS (via unit tests)

Covered by the suites in S2 (no separate prod run needed — all pure or
injected-dep seams):

- `empty`/`calls_only`/`puts_only`/healthy/untyped-row derivation
  (`chain-sanity.test.ts`, 5 cases).
- Conditional write 412s instead of overwriting (fake bucket enforces
  `preconditionOpts.ifGenerationMatch:0` → `alreadyExists`).
- Confirmed object `getMetadata`-projected `chainFlagConfirmed`
  short-circuits a stray `forceRefetch` with zero AV calls.
- Flagged-but-live-queued dates suppressed, not double-dispatched;
  flagged out-of-window objects ignored.
- `markChainConfirmed` on an unstamped object stamps the flag too —
  a confirmed-without-flag object would escape both reconciler buckets
  (pass-3 review finding).

### S4 — `--stamp-flags` backfill mode (MUTATING) — DEFERRED by decision

Confirms: recounted flags land on object metadata; the next reconcile
then re-seeds the object.

```powershell
cd functions
$env:GCLOUD_PROJECT='alpha-vantage-proxy-api'
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json `
  scripts/verify/options-data-227-chain-sanity-flags.ts --symbols QQQ --stamp-flags
```

Expected: stamps the 4 drifting QQQ objects; re-list verifies every
stamped flag projects through `listItems` (post-check covers all
stamped symbols).

**Status: not a gate item — deliberate operator decision.** The stamp is
a production metadata mutation; the mechanism is unit-tested
(`setChainFlag` merge semantics) and the downstream reconcile path is
proven by S1's probes. Deferred to post-ship ops: stamping is what makes
the nightly reconciler re-seed the 4 known suspects (4 AV fetches each).

### S5 — Post-deploy live confirmation — DEFERRED to post-ship

After the flagging worker code is deployed and a seed/reconcile cycle
runs: rerun S1 — `withCounts` climbs above 0 on new run items; stamped
objects appear in the census (`chainFlag=N`). Not a pre-ship gate — the
fields only exist on seeds executed after deploy.

## Traceability

| AC | Scenario(s) |
|----|-------------|
| 1. putCount/callCount/rowCount on outcomes | S2 (metadata-flatten + worker tests), S1 §run-item census |
| 2. empty/calls_only/puts_only on run items | S2 (worker + metadata tests), S1 §run-item census |
| 3. Flagged → gap-eligible re-seed | S1 (synthetic suspect → forceRefetch dispatch), S2 (reconcile tests) |
| 4. Confirmed-empty logged, not retried | S1 (synthetic confirmed → thin-chain, zero dispatch), S2 (worker short-circuit + reconcile tests) |
| 5. Unit tests derivation + consumption | S2 (25+ new #227 tests across 4 suites) |

## Regression / smoke checklist

| Area | Result | Evidence |
|------|--------|----------|
| Corpus coverage service (kind/flag projections) | PASS | `corpus-coverage.service.test.ts` green; `CorpusObjectRef` move typechecked |
| Pivot-seed fanout + supersede sweep | PASS | `pivot-seed-fanout.test.ts` green; `kind` preserved on forced dispatches (reconcile test) |
| Nightly corpus + pilot services | PASS | suites green; key format unchanged (`corpusItemKey` is the same `{SYMBOL}_{date}` uppercased format) |
| #220 reconcile verify script | PASS | `listObjects` dep shape honored (script updated in pass 1) |
| `planCorpusRun` manifest echo | PASS | forced-map keys align with persisted item docs (planner echoes `items` verbatim) |

## Findings

- Deferred ops decision (not a defect): 4 real QQQ `calls_only` objects
  are unstamped; `--stamp-flags` (S4) is the deliberate repair and was
  intentionally left unrun.
- Accepted deviations are recorded in the code-review doc (flagged dates
  count `present`; worker returns `stored` on confirm; worker ~310
  lines vs the 300 soft target).

## UI/UX refinement pass

Not applicable — no user-facing surface (BE pipeline internals +
verification tooling).

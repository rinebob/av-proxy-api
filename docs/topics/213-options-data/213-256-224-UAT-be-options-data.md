**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-data  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** corpus-backfill-2026  
**Issue:** #256  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Task:** #224  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-31  
**Last Updated:** 2026-10-31  

# UAT — Task #224: Nightly pick append wiring

## Scope

On seed-task success (`corpus-seed.task.ts` → `handleCorpusSeedSuccess`),
enqueue a `{symbol, date}` pick task onto the dedicated
`processOptionsDeltaPickMaterializeTask` queue in parallel with the
existing ts-build enqueue. The pick task materializes that single date
through `materializeSymbolPicks` → `mergeDayEntries` into all 380
cell-year docs. Picks depend only on the stored chain (not the time
series) — no ordering dependency on ts-build, no ts-build lease gate.
Seed failure/no-store → no pick task. Miss-rewrite rule self-repairs
previously `no_chain` days.

## Prerequisites

- `processHistoricalOptionsCorpusSeedTask` **redeployed** with the #224
  wiring (`firebase deploy --only functions:processHistoricalOptionsCorpusSeedTask`)
  — currently deployed revision predates the change (last update
  2026-10-30).
- `processOptionsDeltaPickMaterializeTask` deployed (#223 — live).
- ADC auth with GCS read + Firestore read/write on prod for verify runs.
- Test symbol `QQQ` (optionsEnabled, fully materialized corpus).

## Scenarios

### S1 — Unit-level wiring (no deploy needed)

Focused suites cover the wiring contract:

```
cd functions
npx jest tests/v2/historical-options-corpus/corpus-seed.core.test.ts tests/v2/historical-options-corpus/corpus-seed.worker.test.ts
```

Expected: 27 tests green — dual-enqueue payload, pick enqueued while
ts-build is lease-covered, pick-failure doesn't block ts-build,
`onSeedSuccess` NOT fired on `permanent_failure`/pre-floor `skipped`.

- **Result/evidence:** PASS — 27 tests green (2026-10-31).

### S2 — Full suite + typecheck

```
cd functions
npx tsc --noEmit
npx jest
```

- **Result/evidence:** PASS — 101 suites / 1,103 tests; tsc clean.

### S3 — Bounded single-date materialization lands in all 380 cell docs (direct test-enqueue equivalent)

The AC allows "a seed-success **or direct test-enqueue**". The deployed
pick task's bound path is `materializeSymbolPicks({dates:[date]})` —
identical to the #223 verify script's `--date` mode.

**⚠ Project scope — `GCLOUD_PROJECT` must be set.** Default ADC resolves
the dev `rel-str` project (same pitfall documented for the #209 verify
scripts). Run prod checks with:

```
$env:GCLOUD_PROJECT = 'alpha-vantage-proxy-api'   # PowerShell
# or GCLOUD_PROJECT=alpha-vantage-proxy-api <cmd>  # bash
```

The #223 verify script's `--date` mode runs the identical bound path as
the deployed pick task (`materializeSymbolPicks({dates:[date]})`):

```
cd functions
npx ts-node -r tsconfig-paths/register -P scripts/tsconfig.json \
  scripts/verify/options-data-223-materialize-picks.ts --symbol QQQ --date <YYYY-MM-DD>
```

Expected per run: `daysWritten=380`, all 380 cell docs carry
`days.{date}`, `gridVersion=1`, idempotent re-run `daysWritten=0` /
`daysSkipped=380`.

- **Result/evidence (rel-str, 2026-10-31):** PASS on the dev project —
  `2026-10-29` and `2026-10-30` each `datesSeen=1`, `datesPicked=1`,
  `daysWritten=380`, readback `380 docs / 380 entries / 380 picks`,
  re-run `0 written / 380 skipped`; `lastDate` 2026-10-28→2026-10-30,
  `daysKeys` 207→209, `pickCount` 203→205, `missCount=4` unchanged.
  **Project correction:** these runs targeted `rel-str` (default ADC),
  not prod — the code-path evidence is valid, but prod state was not
  touched by them.
- **Result/evidence (prod, 2026-10-31):** prod cell doc state observed
  pre-deploy: `lastDate=2026-10-29`, `daysKeys=208`, `pickCount=204`,
  `missCount=4` — consistent with the same semantics. Post-deploy
  E2E under S4.

### S4 — Deployed seed→pick enqueue on seed success (live E2E)

Driver: bounded pilot run for a real corpus hole — `SNDK/2026-09-21`
(09-18/09-22 covered, Monday missing; SNDK is optionsEnabled):

```
$env:GCLOUD_PROJECT='alpha-vantage-proxy-api'
$env:FIREBASE_SERVICE_ACCOUNT_ID='29825344315-compute@developer.gserviceaccount.com'
# pilot.service — symbols ['SNDK'], startDate=endDate='2026-09-21',
# execute=true → createRunPlan + coverage diff + enqueue missing only
```

Local-enqueue note: `getFunctions().taskQueue` needs a service-account
identity off-GCP — `FIREBASE_SERVICE_ACCOUNT_ID` is the supported seam
in `firebase-admin-init.ts`.

- **Result/evidence:** PASS (live prod, 2026-10-31, deploy rev
  `processhistoricaloptionscorpusseedtask-00062`) —
  1. Pilot: `totalItems=1`, `missingItems=1`, `enqueued=1`,
     run `qa-224-live-check-1793478423449`.
  2. Seed stored: `gs://av-hist-options-corpus-bucket/historical-options/v1/SNDK/2026-09-21.json.gz`
     created — the known SNDK gap healed by the QA run itself.
  3. Logs: `[corpus-seed] enqueued pick-materialize {SNDK, 2026-09-21}`
     + `[corpus-seed] enqueued ts-build` (both, parallel).
  4. Pick task: `[pick-materialize] done` —
     `datesSeen=1, datesPicked=1, cellDocsTouched=380, daysWritten=380`.
  5. Docs: `options-delta-picks/SNDK-put-20-45/years/2026`
     `days.2026-09-21` = real pick `SNDK261030P01490000` (δ=-0.19913,
     strike 1490, dte 39); `SNDK-call-20-45` same-day real pick.

### S5 — Pick enqueue independent of ts-build lease coverage

PASS at unit level (S1). Live: the SNDK dispatch enqueued the pick
task unconditionally alongside ts-build — the pick enqueue precedes and
ignores the lease check by construction.

- **Result/evidence:** PASS — unit + live log pair (S4 step 3).

### S6 — No pick task on seed failure / no-store

Unit-covered (S1): `onSeedSuccess` fires only on
`stored`/`gcs-hit`/`already-recorded`. A live failure-injection wasn't
run — forcing a prod seed failure adds no signal beyond the worker's
structural contract + tests.

- **Result/evidence:** PASS at unit level — 2 worker negative tests.

### S7 — Self-repair of an absent/`no_chain` day

The SNDK run demonstrated the mechanism end-to-end: cell docs already
materialized (through 10-29) had **no** `days.2026-09-21` entry (the
chain didn't exist at their materialization); once the chain stored,
the appended pick day landed as a real pick — the same path that
repairs a `no_chain` miss via the writer's miss-rewrite.

- **Result/evidence:** PASS — absent-day → real-pick landing proven
  live (S4 step 5); the `no_chain`-rewrite variant is unit-covered in
  #222's writer tests.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Seed success enqueues `{symbol,date}` on a dedicated queue | S1 (unit), S4 (live) |
| Same handler as materialization, bounded to one date | S3 (deployed task's bound path) |
| Parallel with ts-build; chain-only dependency; no lease gate | S1, S5 |
| Appended day lands in all 380 cell docs | S3 |
| `lastDate`/counts advance; prior days untouched | S3 |
| Seed failure/no-store → no pick task | S1, S6 |
| Miss-rewrite self-repair | S7 |
| Unit test: enqueue on success only | S1 |

## Regression checklist

- [x] ts-build enqueue unchanged (still lease-gated, same payload) — S1
- [x] Metrics/rank seams unchanged — full suite
- [x] Prior cell-doc days immutable — S3 post-state (missCount unchanged)

## Result

**PASS** — all scenarios resolved. The S4 live E2E ran against the
deployed wiring (revision 00062): SNDK/2026-09-21 seeded → stored →
pick task → 380 cell docs gained the day. The run also healed the known
SNDK corpus gap. Residue: run doc `qa-224-live-check-1793478423449` +
item (TTL'd like normal runs) and the SNDK/2026-09-21 corpus object +
cell-doc entries — all legit product data, nothing to clean up.

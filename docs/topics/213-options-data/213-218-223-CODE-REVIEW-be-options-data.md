**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-data  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** corpus-backfill-2026  
**Issue:** #218  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Task:** #223  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-29  
**Last Updated:** 2026-10-29  

# Code Review — Task #223: Materialization fanout (per-symbol)

Scope: `services/pick-materialize.service.ts` (new core),
`handlers/pick-materialize.task.ts` (new Cloud Task worker),
`handlers/trigger-delta-pick-materialize.http.ts` (new ops trigger),
services barrel + `functions/src/index.ts` exports, test suite (new),
`options-data-223-materialize-picks.ts` prod verify script + guide,
`run-all.ts` / `README.md` registration.

## Standards — PASS

- Core follows the repo's injectable-deps function convention
  (`corpus-seed.worker.ts`, `ts-build.core.ts`) — `listCorpusDates` /
  `loadChain` / `loadCloses` / `db` / `logger` injected; zero AV calls are
  impossible by construction, which is the right way to satisfy that AC.
- Accumulate-then-merge is the correct batching: one `mergeDayEntries`
  transaction per cell per run (380 total) instead of 380 per date
  (~76k). Memory ~80k small entries — well inside the 1GiB task budget.
- Task worker mirrors `corpus-seed.task.ts`/`ts-build.task.ts` exactly:
  queue name = function name, `retryConfig.maxAttempts: 3` (safe — the
  writer's skip semantics make retries no-ops), payload validation,
  options-enabled gate at the worker (consistent with seed/ts-build).
- Ops trigger mirrors `triggerHistoricalOptionsTimeSeriesBuild`:
  POST-only, `x-admin-secret` gate, `allSymbols` →
  `listOptionsEnabledSymbols` → `Promise.all` enqueue. New dedicated
  secret `HISTORICAL_OPTIONS_PICK_MATERIALIZE_ADMIN_SECRET` — same
  per-surface secret convention as the coverage trigger.
- Single-date bound uses `bars.readDate` (one year-shard read) rather
  than the full-history `bars.read` — the shape #224's nightly append
  will reuse; deliberate efficiency in the dep wiring, not the core.
- SDK contracts verified against real usage: `GcsCorpusAdapter.listItems`
  / `readItem` status union (`FOUND`/`NOT_FOUND`/`CORRUPT` — CORRUPT maps
  to a per-date load failure, never silently treated as absent),
  `DailyAdjustedReader.read`/`readDate`, `getFunctions().taskQueue`.
- Tests follow the #222 in-memory Firestore fake convention and exercise
  the REAL picker + writer end-to-end (not stubs) — stronger than a mock.
- No duplication: consumes `pickCellsForDate`, `noChainPickEntries`,
  `mergeDayEntries`, `buildCellId`, `isValidIsoDate` — invents nothing.

## Spec — PASS (all AC met)

| AC | Evidence |
|---|---|
| `{symbol}` covers all stored corpus dates, floor 2026-01-01 | `listItems`→`resolveDates` (sort/dedupe/floor); unit-tested; prod QQQ walked 207 dates |
| Ops trigger enqueues one task per enabled symbol; GCS reads only | `allSymbols` path; deps are GCS adapter + Firestore only — no AV client anywhere in the call graph |
| Idempotent re-run writes nothing; miss-status dates re-attempted | Unit-tested + prod-proven: QQQ re-run `daysWritten=0`, 78,660 skipped; `no_chain`→pick repair test |
| QQQ end-to-end: all 380 cell docs materialize | Prod verify: 380 docs, 78,660 day entries, 77,900 picks, `gridVersion=1` on all |
| Unit tests: coverage iteration + per-date chain-load failure isolation | 12 tests, all green |

- Test-plan deviation (same as #222, documented): in-memory Firestore
  fake instead of an emulator (repo has no emulator infra); prod read-back
  in the verify script covers the real persistence path.

## Thermo-nuclear — PASS (1 minor fixed in-review)

- **Fixed in-review:** the trigger silently widened a malformed `date`
  to a full-corpus enqueue (`isValidIsoDate(...) ? body.date : undefined`
  — typo → unbounded run). Now a provided-but-invalid date → 400.
- Chain-load failures are isolated per date (`loadFailures[]` + warn +
  continue) — a corrupt object can't abort the symbol; re-runs retry it.
- `pickCellsForDate` throwing mid-loop aborts the run — deliberate: the
  only reachable throw is malformed input, i.e. caller-contract violation,
  which should be loud, not swallowed per date.
- A `mergeDayEntries` tx failure mid-merge aborts the run — task-level
  retry resumes idempotently; per-cell isolation would only mask systemic
  Firestore failure. Documented, not changed.
- Report invariant holds by construction: `datesPicked + datesNoChain +
  loadFailures.length === datesSeen`.

## Test results

- Focused: **12/12** green (incl. 2 added in second impl pass:
  symbol normalization, explicit-empty-dates early return).
- Full suite: **94 suites / 982 tests** green; `tsc --noEmit` clean.
- Prod: full QQQ materialization + idempotent re-run + `--date`
  single-date mode all PASS via `options-data-223-materialize-picks.ts`.

## Pass 2 — 2026-10-29 (convergence check)

Fresh sweep for anything pass 1 missed — same footgun class found in
adjacent spots:

- **Fixed:** trigger `date` — pass 1 caught malformed *strings*, but a
  non-string (`{"date": 20260401}`) or whitespace-only value still
  degraded to `undefined` → silent full-corpus enqueue. Now ANY
  provided-but-unusable `date` → 400.
- **Fixed:** verify script `argOf` — `--date` as the last arg (no value)
  silently became a full-run; `--symbol --date X` would have swallowed
  `--date` as the symbol value. Missing/flag-shaped values now fail fast.
- Re-verified: 12/12 focused, `tsc` clean.

Nits documented, not acted on: core doesn't re-guard an empty `symbol`
(the task validates upstream; a direct caller passing `''` gets a zero
report, not corruption); `--symbol` misparsed fails *safe* (no objects →
`datesSeen=0` → assert fails, zero writes).

## Verdict: PASS

Deploy prerequisite for ship: create the Secret Manager value
`HISTORICAL_OPTIONS_PICK_MATERIALIZE_ADMIN_SECRET` before the trigger
goes live.

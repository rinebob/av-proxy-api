**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-data  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** corpus-backfill-2026  
**Issue:** #218  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Task:** #224  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-31  
**Last Updated:** 2026-10-31  

# Code Review — Task #224: Nightly pick append wiring

Scope: `handlers/corpus-seed.core.ts` (new testable seam),
`handlers/corpus-seed.task.ts` (`onSeedSuccess` rewired through the core),
`tests/v2/historical-options-corpus/corpus-seed.core.test.ts` (new),
`tests/v2/historical-options-corpus/corpus-seed.worker.test.ts` (+2
negative tests). ~150 lines of diff.

## Standards — PASS

- Follows the repo's `*.core.ts` seam convention exactly — same pattern as
  `ts-build.core.ts`: injected deps, side-effect-free, `import type` for
  payload types so no firebase-admin init lands in jest.
- Queue name = function name convention preserved; the dedicated queue is
  `OPTIONS_PICK_MATERIALIZE_TASK_QUEUE` (`processOptionsDeltaPickMaterializeTask`)
  — no new queue, no shared queue with seeds or ts-builds.
- The moved lease-check rationale comment was preserved verbatim into the
  `isTsBuildDateCovered` dep JSDoc — no existing comment dropped.
- No duplication: consumes `PickMaterializePayload`,
  `OPTIONS_PICK_MATERIALIZE_TASK_QUEUE`, `isTsBuildDateCovered`,
  `getFunctions().taskQueue` — invents nothing.
- Test harness (`deps()` builder, focused describe) mirrors
  `ts-build.task.test.ts` conventions.
- No dead code, no speculative generality: the deps interface carries
  exactly the four seams the core needs.
- SDK contract: `taskQueue(...).enqueue(payload)` matches the existing
  call sites; payload `{symbol, date}` matches
  `PickMaterializePayload.date?: string` (ISO-validated inside the task).

## Spec — PASS (all implementable ACs met; live ACs deferred to QA)

| AC | Evidence |
|---|---|
| Seed success enqueues `{symbol,date}` pick task on a dedicated queue | `handleCorpusSeedSuccess` → `enqueuePick` on `OPTIONS_PICK_MATERIALIZE_TASK_QUEUE`; core test asserts the payload |
| Same handler as materialization, bounded to one date | `PickMaterializePayload.date` → `materializeSymbolPicks({dates:[date]})` — shipped in #223 |
| Runs in parallel with ts-build; depends only on the stored chain | Pick enqueue precedes and is independent of `isTsBuildDateCovered`; lease-covered test proves pick still enqueues while ts-build skips |
| Seed failure / no-store → no pick task | `notifySeedSuccess` fires only on `stored`/`gcs-hit`/`already-recorded`; two new worker negative tests (`permanent_failure`, `pre-floor skipped`) |
| Unit test: wiring asserts enqueue on success only | `corpus-seed.core.test.ts` (4 tests) + worker negatives |
| Appended day lands in all 380 cell docs; `lastDate`/counts advance | **Deferred to QA (J2)** — requires a deployed task dispatch or emulator run; writer's `runTransaction` recompute semantics already unit-covered in #222 |
| Miss-rewrite self-repair for previously `no_chain` dates | Falls out: `already-recorded`/`gcs-hit` re-seeds re-fire the callback → pick task → `mergeDayEntries` repairs miss-status entries (#222 semantics) |

## Thermo-nuclear — PASS WITH MINORS

- **Failure-domain asymmetry is deliberate and protective**: pick enqueue
  runs first with its own catch (a pick-queue failure cannot starve the
  established ts-build path); a ts-build failure propagates to
  `notifySeedSuccess`'s existing swallow — by then the pick is already
  enqueued. Both failure logs are distinct (`pick-materialize enqueue
  failed` vs `seed.onSeedSuccess.error`).
- **Concurrent same-symbol writers are race-safe**: a nightly append can
  overlap a bulk materialization for the same symbol (queue allows 5
  concurrent dispatches). Verified `mergeDayEntries` recomputes
  `firstDate`/`lastDate`/`pickCount`/`missCount` from the merged `days`
  map inside `runTransaction` — disjoint `days.{date}` keys, no blind
  overwrites; contention costs retries, not corruption.
- **Accepted (info)**: a failed pick enqueue heals only on the next seed
  dispatch for that date — the same healing model the ts-build enqueue
  already had; `already-recorded`/`gcs-hit` re-fires make it
  self-correcting. Standing reconciler (#220) is the systematic sweeper.
- **Accepted (info)**: re-seeding a covered date enqueues a pick task
  that does a chain load + 380 transactional reads for an all-skipped
  no-op — bounded, infrequent, and the mechanism by which `no_chain`
  days repair.

## Findings

- nit — `isTsBuildDateCovered: (s, d) => …` terse params where the file
  spells names out: **fixed during review** → `(sym, dt)`.

No critical, major, or minor findings remain.

## Test results

- Focused: `corpus-seed.core.test.ts` + `corpus-seed.worker.test.ts` —
  27 tests green.
- Full suite: **101 suites / 1,103 tests** green.
- `npx tsc --noEmit` — clean.

## Verdict

**PASS** — task advances to `7_QA`; live-path verification (J2: appended
day lands in all 380 cell docs, `lastDate` advances, prior days
untouched) goes on the QA checklist.

## Re-review — Pass 2 (2026-10-31)

- `isTsBuildDateCovered` throw → propagates → `notifySeedSuccess` swallows
  → ts-build heals on next seed dispatch; pick already enqueued — sound.
- Malformed/lowercase/absent payload fields → the pick task itself
  uppercases, ISO-validates, and gate-checks — downstream contract holds.
- Duplicate pick tasks on covered-date re-seeds → idempotent writer —
  accepted info-level in pass 1.
- Pick-failure log via `logger` (not `warn`) — consistent with the
  worker's single-logger convention (`seed.error`,
  `seed.onSeedSuccess.error` all log through it). Not a finding.
- `OPTIONS_CORPUS_FLOOR_DATE = '2019-01-01'` confirmed — the new pre-floor
  worker test (`2018-12-31`) exercises the intended skip path.

**New findings: none.**

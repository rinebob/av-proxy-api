**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-data  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** corpus-backfill-2026  
**Issue:** #218  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Task:** #220  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-01  
**Last Updated:** 2026-11-01  

## Re-review — Pass 2 (post-remediation final diff)

All three axes re-ran against the final state. **Spec: CLEAN** (all six ACs
met; the manifest path can't produce out-of-window dates or non-enabled
symbols by construction). **Thermo-nuclear: passes the approval bar.**
**Standards: mostly clean** — residual minors all fixed in this pass:

- medium — partition recomputed twice (`expected` loop re-tested `covered`):
  **fixed** — the loop iterates `gaps` directly; `present`/`missing` derived
  (`expected.length − gaps.length` / `gaps.length`).
- minor — `existingItemKeys` left with zero `src/` callers after the
  manifest refactor: **deleted** (option, filter branch, and its planner
  test); the planner's computed mode is now simply `symbols × dates`.
- nit — `items` mode silently inerts `maxTradingDatesPerSymbol`/`calendar`:
  **documented** on the option + `manifest ⊆ symbols` contract note.
- nit — `listItemsForSymbol → CoverageRunItem` mapping triplicated
  (scheduler, verify, coverage deps): **fixed** — shared
  `toCoverageRunItems` helper in `corpus-coverage.service.ts`.
- minor — no unit test for the new `items` branch: **fixed** (planner test
  asserts the manifest persists verbatim, no calendar expansion).
- nits — unused `planOptions` capture dropped; `updateRunSummary` tightened
  to `Record<string, CorpusReconcileSymbolCounts>` (no `undefined`).

Post-pass-2 verification: `tsc --noEmit` clean, 30 corpus suites / 290 tests
green, full suite 103 / 1,146 green, SNDK dry run still `coverage: FULL`.

**Verdict stands: PASS — no further review pass needed.** Remaining items
are consciously deferred (the `listItemsForSymbol` unbounded scan is on QA
#259's findings checklist) or documented deviations, not open findings.

# Code Review — Task #220: Standing coverage reconciler

Scope: `services/corpus-reconcile.core.ts` (new side-effect-free diff core),
`jobs/corpus-reconcile.scheduler.ts` (new `reconcileOptionsCorpusCoverage`,
22:30 PT weekdays), `tests/v2/historical-options-corpus/corpus-reconcile.core.test.ts`
(11 tests), `scripts/verify/options-data-220-corpus-reconcile.{ts,md}` (prod
verify, dry/`--execute`), plus reconcile-scoped additions in `types.ts`
(`CorpusReconcileSymbolCounts`, `OPTIONS_CORPUS_DAILY_FLOOR_DATE`),
`corpus-coverage.service.ts` (`isLiveQueueEntry` + `latestItemsByDate`
extracted/shared), `corpus-metadata.service.ts` (`updateRunSummary`),
`corpus-planner.service.ts` (`items` manifest option), `function-schedules.ts`,
`index.ts` (one export), verify README/run-all registration.

## Standards — PASS (after in-review fix)

- Follows the sibling conventions exactly: thin `onSchedule` wrapper →
  injected-dep core (`corpus-sweep.scheduler`/`corpus-sweep.core` pattern);
  scheduler options block identical (`timeZone/540s/512MiB/maxInstances:1`).
- SDK contracts verified: `planCorpusRun` item-manifest + `${symbol}_${date}`
  key contract, `CorpusSeedPayload {runId,symbol,date,attempt:1}` matches the
  nightly producer's payload, queue name canonical in `types.ts`, Firestore
  path shapes correct, `getTradingDates` sync API wrapped correctly.
- §10 mocked-contract concern satisfied by the production verify script —
  the real deps run against prod in dry/`--execute` modes.
- **major (fixed in review):** dead `enqueueable` array — the diff→plan
  partition was encoded twice (manifest built then discarded; dispatch
  re-derived via `excludedKeys` → planner's `symbols × tradingDates − keys`
  recompute, including a second hidden calendar evaluation that had to agree
  with `listExpectedDates`). Fixed per the thermo-nuclear code-judo path:
  `PlanCorpusRunOptions.items?: CorpusItemKey[]` — the diff produces the
  manifest, the planner persists it. `excludedKeys`, the recompute, and the
  two stub reimplementations (test + verify dry-mode) all deleted.
- **minor (fixed in review):** `perSymbol` shape declared twice — now one
  `CorpusReconcileSymbolCounts` in `types.ts`, imported by the core.
- **minor (fixed in review):** latest-wins-by-`touchedAtMs` fold
  reimplemented inline — now shared `latestItemsByDate` in
  `corpus-coverage.service.ts`, used by both readers.
- **minor (fixed in review):** `(deps.logger as any)` in test — `makeDeps`
  now returns the typed logger mocks directly.
- nit — `window` param renamed `coverageWindow` (DOM-global shadow).
- Noted, not flagged: `updateRunSummary`'s `as any` matches every sibling
  method in `corpus-metadata.service.ts` (file convention).

## Spec — PASS (approve with deviations noted)

| AC | Evidence |
|---|---|
| Scheduled function iterates live enabled-symbol list each run | `reconcileOptionsCorpusCoverage` → `listOptionsEnabledSymbols()` inside the run; `30 22 * * 1-5` PT dedicated function (PRD: not bolted onto the sweep) |
| Coverage diff reuses corpus-coverage.service listing + TradingCalendarService expected dates | Shares `GcsCorpusAdapter.listItems`, `isLiveQueueEntry`, `latestItemsByDate`, `CoverageRunItem`. `computeSymbolCoverage` itself is pivot-scoped — reusing it would diff the wrong date domain; the shared-primitives approach satisfies the AC's intent |
| Missing items enqueued through the existing seed task queue; re-run idempotent | `OPTIONS_CORPUS_SEED_TASK_QUEUE`, no `kind` stamp (PRD: calendar-seeded objects permanent); covered excluded + live-queue suppression + stale-window re-enqueue; idempotency test proves a second sweep suppresses its own dispatched items |
| Run doc records per-symbol planned/present/missing/enqueued counts | `CorpusRunDoc.perSymbol` written via `updateRunSummary` post-dispatch; verified on a real prod run doc (`status=completed`, `perSymbol` recorded) |
| SNDK/2026-09-21 gap heals end-to-end | Met by equivalence: the object landed via the identical `planCorpusRun` + seed-queue path during #224 live QA; the reconciler's own prod execute run + full-universe dry sweep (130 × 209 = 0 gaps) confirm the path |
| Unit tests for the diff logic (weekend/holiday edges) | 11 tests — Saturday-object edge explicit; weekend/holiday shapes arrive via stubbed expected sets; real-calendar edges live in `trading-calendar.service.test.ts` (13 cases) |

Deviations, conscious:

- PRD story 8 asked for a per-symbol log line — **added in review**
  (`corpus-reconcile {SYM}: planned=… present=… missing=… enqueued=…` per
  symbol + the aggregate line).
- PRD prose said "all-covered → no run doc"; the impl always writes the run
  doc (issue AC's counts need a home; each no-op sweep leaves an auditable
  `status=completed, totalItems=0` doc). Superset of the PRD intent — kept.
- Naming `present` (issue AC) vs PRD's `covered` — issue AC wins.
- 10c suspect-chain consumption (IMPL task 9 / issue #227) — correctly absent.

## Thermo-nuclear — PASS (after in-review fix)

- **Did not pass as submitted:** finding 1 was the double-encoded partition
  above — the flagged code-judo refactor was applied (`items` manifest into
  `PlanCorpusRunOptions`), which deleted the dead variable, the excludedKeys
  machinery, the second calendar call, and both stub reimplementations.
  Everything else was minor.
- Minor (deferred, documented): `listItemsForSymbol` scans every run doc
  containing the symbol (pre-existing #156 design) — reconcile adds a daily
  writer. Bounding it changes coverage-report semantics (old terminal
  failures would classify as never-attempted); out of scope, flagged for
  follow-up.
- Nit (documented in code): `failure`-state items awaiting the worker's
  own retry enqueue aren't live-suppressed — same-window re-dispatch loses
  to a gcs-hit; rare at 22:30; comment added at the suppression site.
- Clean otherwise: mid-dispatch crash leaves `in_progress` + pending items
  (suppressed ≤24h, then healed) — coherent; lazy `listRunItems` only for
  gapped symbols (~9 min → ~90 s on the full-universe dry run) is a clean
  optimization; all new files < 300 lines; tests assert external behavior.
- Deployment-only prerequisite stated separately: the scheduled function
  doesn't exist until `firebase deploy`; `--execute` locally needs
  `FIREBASE_SERVICE_ACCOUNT_ID`.

## Findings

- major — dead `enqueueable` + double-encoded diff→plan partition:
  **fixed during review** (items-manifest refactor).
- minor — `perSymbol` type duplication: **fixed** (`CorpusReconcileSymbolCounts`).
- minor — latest-wins fold duplicated inline: **fixed** (`latestItemsByDate`).
- minor — `as any` logger assertion in test: **fixed**.
- minor — `listItemsForSymbol` unbounded run-doc query: **deferred**
  (pre-existing #156 semantics; bounding alters coverage reporting).
- nit — `window` param name: **fixed**.
- nit — failure-retry suppression gap: **documented in code**.

No critical, major, or minor findings remain.

## Test results

- Focused: `corpus-reconcile.core.test.ts` — 11 tests green; planner +
  coverage + pilot + nightly consumers — 48 tests green post-refactor.
- Full suite: **103 suites / 1,146 tests** green.
- `npx tsc --noEmit` — clean.
- Prod: full-universe dry sweep 130 symbols × 209 expected = 0 gaps
  (~90 s); SNDK execute run wrote a real `status=completed` doc with
  `perSymbol` summary; refactored path re-verified live post-review.

## Verdict

**PASS** — task advances to `7_QA`. Live-path verification for QA: deploy
`reconcileOptionsCorpusCoverage`, confirm the 22:30 PT run writes its run
doc, and (if a gap exists) that a dispatched seed heals it end-to-end.

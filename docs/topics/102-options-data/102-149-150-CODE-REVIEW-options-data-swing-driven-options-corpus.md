**Topic:** Swing-driven options corpus platform
**Topic Slug:** swing-driven-options-corpus
**Thread:** Options corpus ingest
**Thread Slug:** options-corpus-ingest
**Blueprint:** #149 (BE Blueprint)
**Task:** #150 (Lift CorpusSymbol restriction + optionsEnabled gate)
**Thread Parent:** #106
**Topic Parent:** #102
**Domain:** OPTIONS-DATA
**Type:** CODE-REVIEW
**Status:** Approved
**Created:** 2026-09-25
**Last Updated:** 2026-09-25

# Code Review — Task #150: curation gate + CorpusSymbol lift

## Scope reviewed

- `options-enabled-gate.ts` (new) — `createOptionsEnabledChecker` + `listOptionsEnabledSymbols`
- `corpus-seed.worker.ts`, `corpus-seed.task.ts`, `ts-build.task.ts`, `trigger-historical-options-time-series-build.http.ts`
- `nightly-corpus.service.ts`, `pilot.service.ts`, `trigger-historical-options-pilot.http.ts`
- `types.ts` (CorpusSymbol removed, `skipped` item status added)
- Tests: `options-enabled-gate.test.ts` (8) + corpus test builders updated

## Findings and remediation

### Resolved during review

- **MEDIUM — gated items stranded at `pending` (both axes).** `createRunPlan` writes all item docs `pending`; the worker's gate-skip returned before any item write, so a disabled symbol's planned items stayed `pending` forever and run counters never converged. Fix: gate path now writes terminal `status: 'skipped'` (new `CorpusItemStatus` member) + `incrementCompleted(runId, 0)` — item counts toward run completion without inflating `apiCalls`.
- **MAJOR — `NIGHTLY_CORPUS_SYMBOLS`/`DEFAULT_PILOT_SYMBOLS` hardcoding (AC failure).** A gated constant still meant only QQQ/TQQQ could ever be processed — "extend to all options-enabled symbols" would never work. Replaced with `listOptionsEnabledSymbols()` (one `optionsEnabled==true` query): nightly plans the live enabled set; pilot defaults to it and filters explicit requests by membership. Both constants deleted; stale "QQQ/TQQQ corpus" doc comments fixed.
- **Empty-symbol plan noise.** Pilot early-returns a synthesized empty plan (`runId: 'no-enabled-symbols'`) instead of writing an empty run doc.

### Second pass (post-remediation verification)

- `'skipped'` status is inert to all consumers — `listItems` ignores status; run math is counter-only; `existing.status === 'success'` check can't be poisoned by it.
- Accepted residual: re-enabling a symbol + manual re-enqueue of the same runId/item could double-count `completedItems` — requires out-of-band re-enqueue; queue `maxAttempts:1` makes it unreachable organically.
- `listOptionsEnabledSymbols` doesn't filter `_isActive` — matches `swing-set-sweep.core.ts` precedent.
- Fixed remaining nits: stale "QQQ/TQQQ" pilot docstring; gate test now asserts the terminal `skipped` write + `incrementCompleted(runId, 0)`.

### Verified clean

- Gate reads `tracked-symbols` (correct collection + `optionsEnabled` field + uppercase doc ids — verified against `set-options-enabled.core.ts`).
- Gate covers every ingest entry point: seed worker (covers all enqueue sources), ts-build task + trigger, nightly, pilot.
- `options-index-write`/`backfill-contract-catalog` left ungated — index maintenance on existing data, no AV spend.
- Mid-run disable is safe: gate precedes all writes; in-flight items terminate as `skipped`.

### Accepted

- Per-item doc read in the worker (~1 read per seed task). At the rate limit (1 dispatch/s) this is trivial; the *planners* filter the set once up front, so per-item reads only gate stragglers/manual enqueues.

## Verification

- Full Functions suite: **653/653**; corpus module suite 110/110
- `npm run build` clean; `git diff --check` clean
- Deployed-endpoint verification deferred — gate semantics change worker behavior; observe via corpus run metadata on first non-pilot symbol seed (or dry-run pilot showing enabled-set default).

## Verdict

**PASS** — the gate is correct at every entry point, orphaned-pending and hardcoding findings fixed, ACs met.

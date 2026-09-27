**Topic:** IV time series  
**Topic Slug:** iv-time-series  
**Thread:** IV history for all tracked symbols  
**Thread Slug:** iv-history-tracked-symbols  
**Issue:** #171  
**Task:** #171  
**Thread Parent:** #159  
**Topic Parent:** #158  
**Domain:** OPTIONS-DATA  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# Code Review — Task #171: seed-worker metric compute hook

## Scope reviewed

- `functions/src/v2/historical-options-corpus/services/corpus-seed.worker.ts`
- `functions/src/v2/historical-options-corpus/handlers/corpus-seed.task.ts`
- `functions/tests/v2/historical-options-corpus/corpus-seed.worker.test.ts`

## Findings (three axes) + resolutions

- **[Medium — thermo] Silent `written:false` hid skip reasons.** The seam
  typed `Promise<unknown>` discarded the result; a systematically missing
  close bar would be invisible. → Seam now `Promise<MetricBuildResult>`;
  worker logs `seed.metrics.written` / `seed.metrics.skipped` with fields.
- **[Medium — spec] `already-recorded` path never computed metrics.** A
  prior-dispatch metrics failure would never heal within the run. →
  `computeSymbolMetrics` now fires there too — uniform "confirmed present →
  compute" (idempotent).
- [Low] Extra `gcs.readItem` download per hit — spec-mandated (chain must be
  read back); acceptable at 1 dispatch/sec.
- [Low] Sequential awaits vs `allSettled` — matches existing pattern; no churn.
- [Info] Per-invocation service construction — cheap refs over shared admin
  clients; fine.
- Standards axis: clean — structural seam mirrors `MetricBuildDeps` convention.

## Design notes

- `metrics` is an optional structural seam (same shape as `gcs`/`bars` in
  `MetricBuildDeps`) — fakes inject a jest.fn with no casts.
- Fires on: fresh write, `writeItem` 412 alreadyExists, gcs-hit, and
  already-recorded. Absent from options-disabled and failure paths.
- Errors warn-swallowed as `seed.metrics.error` — a metric failure never
  retries or fails the seed (heals on next seed of the date).
- This is the sole prod trigger: nightly seeds, pivot backfill, and ad-hoc
  densification all flow through `seedCorpusItem`.

## Rounds 2–3 (convergence passes)

Round 2 (3 axes) found and fixed:

- **[Low] `notifySeedSuccess` asymmetry on already-recorded** — the same
  healing argument applies to the ts-build enqueue; now both callbacks fire
  on that path (enqueue is idempotent; lease-gated in the handler).
- **[Low] Mocks below the real `MetricBuildResult` shape** — updated to
  `{symbol, date, written, fields}`.
- Spec axis: re-verified all ACs; the already-recorded path now matches the
  "confirmed present → compute" uniform semantic.
- Standards axis: clean (import direction type-only; seam mirrors
  `MetricBuildDeps` convention; `seed.metrics.*` naming consistent).

Round 3 (final): **NO BLOCKING FINDINGS.** One advisory landed — an
`onSeedSuccess` assertion was added to the already-recorded test.

## Test results

- Worker suite: 16 tests green (4 new hook-path tests + updated negative).
- Full suite: 76 suites / 733 tests; `tsc --noEmit` clean.

## Verdict

**PASS** — findings resolved; task → QA.

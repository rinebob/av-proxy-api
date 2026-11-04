**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-data  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** corpus-backfill-2026  
**Issue:** #218  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Task:** #229  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-04  
**Last Updated:** 2026-11-04  

## Verdict: **PASS** (three passes — converged, no residual findings)

## Third pass (2026-11-04) — focused re-review of pass-2 edits

Single focused axis on the final script (pagination streak logic, enqueue
gate, artifact ordering, per-build check, arg validation). **Zero new
findings** — every pass-2 edit site verified correct, termination
properties proven, gate invariant documented with a comment pinning that
future `check()` calls must precede the enqueue block. **Converged.**

## Second pass (2026-11-04) — re-review of pass-1 remediation

Three axes re-ran on the final-state code, verifying pass-1 fixes and
reporting only new findings. Remediations verified holding across all axes
(`nextPageToken`-driven truncation, token-in-retry-loop, exit pattern,
artifact write, per-build invariant, new tests). New findings — all
remediated:

- **medium → fixed** — `google-auth-library` was added to
  `devDependencies`, but prod code
  (`intraday-snapshot-jobs.aggregator.ts:4`) imports it — moved to
  `dependencies`; the prod import's version floor was previously
  uncontrolled (transitive only).
- **medium → fixed** — `--enqueue` dispatched even when checks FAILED
  (e.g., a truncated enumeration would enqueue a knowingly-incomplete
  repair set). Now gated on `failures === 0`; zero-payload runs print an
  explicit "nothing to enqueue".
- **medium → fixed** — triage artifact was written before its own
  completeness check. Now written after the checks and carries provenance
  (`generatedAt/since/until/symbols/logReadTruncated/
  underReportedBuilds`) so an incomplete artifact can't masquerade as a
  good one.
- **low → fixed** — per-build completeness check
  (`b.errors.length >= b.failedContracts` per build) replaces the global
  sum, which could mask a truncated build behind another's union surplus.
- **low → fixed** — empty-page-with-live-`nextPageToken` hole: the loop
  could declare a clean enumeration while dropping later pages. Now an
  empty-page streak (>3) reports `truncated: true`.
- **low → fixed** — `--limit` accepts only positive integers
  (`Number.isInteger`); fractional values previously sent a non-integer
  `pageSize` to the API.
- **nit → fixed** — `--symbols`-scoped artifact now records the filter
  (`symbols` field); guide documents the JSON shape.

Post-pass-2 prod verification: bounded `--limit 2500 --symbols AAPL` run
correctly FAILED the truncation check, per-build check PASSed
(105/105), artifact written with `logReadTruncated: true`, clean exit.
Full suite re-run: 108/1,256 green; `tsc` clean.

---

## First pass (2026-11-04) — verdict: PASS after in-place remediation

Three axes ran against the working-tree change set (new files read whole;
uncommitted). No critical or major findings. Six minor/medium findings and
the actionable nits were fixed during the review and re-verified against
prod before this verdict.

## Change set

- `functions/src/v2/historical-options-corpus/services/ts-build-repair.ts`
  (NEW) — pure helpers: `extractFailedBuilds` (parse `builder.symbol.done`
  entries → deduped failed `(symbol, range)` tasks), `toRepairPayloads`
  (sorted `TsBuildPayload[]`), `flattenUnhealed` (contract+error triage).
- `functions/tests/v2/historical-options-corpus/ts-build-repair.test.ts`
  (NEW) — 8 tests, behavior-level, honestly-typed fixtures.
- `functions/scripts/verify/options-data-229-ts-build-repair.ts` (NEW) —
  ops script; dry default enumerates failed builds via Cloud Logging
  `entries:list` REST + `google-auth-library` (ADC `logging.read`), with
  429/503 backoff; `--enqueue` re-enqueues repair payloads on
  `processHistoricalOptionsTsBuildTask` (GCS-only, `writeMerged` dedupes).
- `functions/scripts/verify/options-data-229-ts-build-repair.md` (NEW) —
  ops guide.
- `functions/scripts/verify/README.md` + `run-all.ts` — registration row
  + deliberate run-all exclusion (prod log reads + mutating mode).
- `functions/package.json` — `google-auth-library` pinned to devDeps
  (was transitive-only via firebase-admin).

## Standards axis — 0 critical / 0 major / 3 minor / 4 nit

Contract verification: `builder.symbol.done` payload shape, `TsBuildPayload`,
queue constant, `getFunctions().taskQueue().enqueue()` idiom, and the
`entries:list` request body all verified real against producer code and
sibling scripts — nothing invented.

Remediated:

- minor → fixed — stale `--limit` header doc (`10000` → actual `60000`).
- minor → fixed — missing `process.exit` on the success tail; script now
  uses the sibling `exitCode + .finally(exit)` pattern so open admin/gRPC
  handles can't hang the run.
- judgement → considered, kept — serial `queue.enqueue` loop. Thermo-
  nuclear axis explicitly justified it (~733 payloads, no urgency, simpler
  failure semantics than the reconciler's chunked parallel dispatch).
- nit → fixed — unvalidated `--limit` (`NaN` → silent empty read); now a
  guarded arg error.
- nit → fixed — `--symbols` missing `.filter(Boolean)` vs sibling.
- nit → fixed — ADC token fetched once outside the retry loop; moved
  inside (`getAccessToken` caches/self-refreshes), so a long 429 backoff
  can't strand an expired token.

## Spec axis — 0 high / 2 medium / 3 low

| AC | Verdict |
|---|---|
| AC1 enumerate all failed tasks in the window | met |
| AC2 re-enqueue valid payload, GCS-only | met |
| AC3 post-pass audit workflow | met |
| AC4 explicit contract+error triage report | met (after remediation) |

- **Spec text vs impl deviation (correct substitution):** the issue says
  enumerate `[ts-build-task] done` events — but that event carries no
  `startDate/endDate`/`errors[]` and cannot produce repair pairs. The impl
  uses `builder.symbol.done`, which carries the full `TimeSeriesBuildReport`.
  Spec text wrong; impl right.
- medium → fixed — AC4 printed only the first 20 triage rows with no
  persisted output. Full list now writes to
  `.devin/tmp/options-data-229-unhealed.json` each run.
- medium → fixed — ~30-day `_Default` log-retention bound undocumented;
  now in the guide + script header.
- low → addressed — guide now instructs bounding `--since` to the repair
  window so original failures don't merge into the audit dedup.
- low → fixed — both doc/count mismatches (limit, retry count).

## Thermo-nuclear axis — bar MET

1 moderate + 3 minor + 3 nit; all actionable items remediated:

- moderate → fixed — `unhealed > 0` check could silently under-report if
  Cloud Logging truncated an oversized `errors[]` jsonPayload. Now
  `unhealed >= max failedContracts` (union can legitimately exceed max —
  prod confirms: 11,755 unhealed vs 10,561 max on a bounded read).
- minor → fixed — truncation check compared `entries.length` to the cap,
  which false-positives when the final page lands exactly on it. Now
  driven by `nextPageToken` presence.
- minor → fixed — retry-count doc mismatch (3× → 5× escalating).
- nit → fixed — 3 missing test edges added (non-numeric `failedContracts`,
  absent `errors[]` with `failedContracts>0`, orphan error entries).
- nit → fixed — `google-auth-library` pinned in devDependencies.
- noted for later — `ts-build-repair.ts` becomes single-caller ops weight
  after the repair pass; acceptable now (mirrors `corpus-reconcile.core`
  seam), flag for post-repair cleanup.

## Test results

- Full suite: **108 suites / 1,256 tests green** (incl. 8 new).
- `tsc -p scripts/tsconfig.json --noEmit`: clean.
- Prod dry-run re-verified post-remediation (`--limit 2500` bounded):
  truncation guard fails loudly by design, triage artifact written,
  `unhealed >= failedContracts` check passes, clean exit (no hang).
- Full-window prod result: **733 failed (symbol,date) tasks / 25,172
  unhealed contracts** (~3× the issue's ~2.6k estimate — the first run's
  235/16,453 was truncated by the original 10k entry cap; found and fixed
  during implementation audit).

## Residual risks / notes

- `--enqueue` deliberately untested in prod — operator-gated by design;
  payload shape is assertion-checked and worker-side `writeMerged` makes
  the repair idempotent.
- Enumeration depends on log retention (~30d); if the repair is deferred
  past that, the persisted triage JSON is the surviving artifact.

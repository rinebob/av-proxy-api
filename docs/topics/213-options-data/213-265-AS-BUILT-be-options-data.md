**Topic:** Options Corpus Bulk Ingest  
**Topic Slug:** options-data  
**Thread:** Full-Date Corpus Backfill (2026)  
**Thread Slug:** corpus-backfill-2026  
**Issue:** #265  
**Thread Parent:** #214  
**Topic Parent:** #213  
**Domain:** BE  
**Type:** AS-BUILT  
**Status:** Complete  
**Created:** 2026-11-04  
**Last Updated:** 2026-11-04  

## What the Topic delivered

A Firestore/GCS-backed options data service: immutable historical
option-chain snapshots in GCS, per-contract JSONL time series, Firestore
catalog + IV metrics, delta×DTE pick documents, a contract-availability
endpoint for partners, and self-healing coverage for ~129
`optionsEnabled` symbols across every trading date from `2026-01-01`.

## Threads shipped

- **#214 — Full-Date Corpus Backfill (Blueprint #218)** — the pipeline:
  seed/nightly ingestion, coverage reconciliation, pick materialization,
  and the repair tooling tasks below.
- **#237 — Contract Availability Endpoint (Blueprint #242)** —
  `partnerContractAvailabilityV1` — partner discovery of which
  (symbol, date) chains exist.

## Task-level outcomes (#218 blueprint)

| Task | Delivered |
|---|---|
| #219 | Grid config + pick types |
| #220 | `reconcileOptionsCorpusCoverage` — scheduled sweep; gap manifest → `corpusItemKey` run items → seed dispatch; live-queue suppression |
| #221 | `pickCellsForDate` — delta×DTE grid picker |
| #222 | Cell doc writer — `options-delta-picks` Firestore docs |
| #223 | Per-symbol materialization fanout |
| #224 | Nightly pick append wiring on seed success |
| #225 | `partnerOptionsDeltaPicksV1` endpoint + rules deny |
| #226 | Golden-file pick verification — prod-path regen, strict day-for-day equality, provenance fingerprints |
| #227 | Chain sanity flags — put/call/row counts; `chainFlag`/`chainFlagConfirmed` GCS stamps; `forceRefetch` suspect re-seed; confirmed thin chains retired |
| #229 | Ts-build repair pass — Cloud Logging enumeration of `failedContracts>0` builds → idempotent re-enqueue + contract-level triage artifact |

## Architecture decisions

- **Write-once corpus**: GCS objects immutable via
  `ifGenerationMatch: 0`; repairs delete+write replacements, never
  mutate bytes (metadata-only stamps for `chainFlag`).
- **Pure cores + thin workers**: domain logic in `*.core.ts` /
  `services/` pure modules (TDD'd); task handlers are thin
  orchestrators. Reconciler plan is pure; side effects isolated at the
  edge.
- **Logs-as-audit-trail**: per-contract build failures are recoverable
  from `builder.symbol.done` jsonPayloads rather than a persisted
  report — accepted the ~30-day `_Default` retention bound (triage JSON
  artifact is the surviving record).
- **Ops scripts as the verification surface**: one committed script per
  component under `functions/scripts/verify/`, dry-read-only by default,
  mutating modes behind explicit flags + `GCLOUD_PROJECT` guards.

## Deviations from plan

- **Scale**: 733 failed ts-build tasks / ~25k unhealed contracts found —
  ~3× the ~2.6k estimate; repair replays whole date-ranges (payload has
  no contract narrowing — dedup makes it safe, just heavier).
- **Enumeration source**: the spec named `[ts-build-task] done` events;
  those carry no range/errors, so `builder.symbol.done` (full
  `TimeSeriesBuildReport`) is the real source.
- **`google-auth-library`**: promoted to a direct prod dependency
  during #229 — the pre-existing `intraday-snapshot-jobs.aggregator.ts`
  import had been resolving transitively with an uncontrolled version.

## Known follow-ups / ops posture

- `--enqueue` repair dispatch (733 tasks) is a deliberate, gated prod
  operation — runbook: `functions/scripts/verify/options-data-229-ts-build-repair.md`.
- 4 QQQ `calls_only` objects stamped 2026-11-02 — heals/confirms via the
  nightly reconciler (`forceRefetch`).
- `services/ts-build-repair.ts` becomes single-caller ops weight after
  the repair pass — post-repair cleanup candidate.

# Tasks

## Completed

- [x] **2026-07-21: Implement QQQ/TQQQ historical-options GCS corpus** — Built the pure retrieval seam, GCS adapter, Firestore metadata/planner, Cloud Tasks seed worker, bounded pilot, Jest tests, and verified TypeScript compilation plus full test suite.
- [x] **2026-07-21: Apply historical-options review fixes** — Fixed `pilot.service.ts` yesterday ET calculation, defaulted `endpoint`/`message` in retrieval, routed partner through `HistoricalOptionsRetrievalService` with reused analysis, cleaned dead code (`av-api-key.utils.ts`, `GcsCorpusAdapter.exists`, `strategy-reader.service.ts`, `CorpusRunDoc.manifest`), removed handler debug banners, added focused tests, and updated relevant planning docs.
- [x] **2026-07-22: Create and update consumer discovery/usage docs for `partnerHistoricalOptionsContractV2`** — Added `docs/partner/options-data/historical-options-contract-v2-discovery.md` and `docs/partner/options-data/historical-options-contract-v2-usage.md`, and linked them from `docs/partner/options-data/historical-options-discovery.md`, `docs/partner/options-data/rs-historical-options-usage.md`, and `docs/partner/partner-discovery.md`.

## Active

- [ ] **2026-07-23: Run 2026 QQQ per-contract time-series backfill** — Q1 (Jan–Mar, 61/61 days, 25,746 contracts) complete; remainder (Apr–current date) running.
- [ ] **2026-07-22: Add nightly historical-options corpus maintenance** — Schedule an idempotent `QQQ`/`TQQQ` incremental corpus run at 7:00 PM Pacific on trading days, after the 6:00 PM Pacific Alpha Vantage workload.
- [ ] **2026-07-21: Run corrected first-20 historical-options corpus pilot** — Deploy the ascending-date planner, then seed and verify the first 20 2019 trading dates for `QQQ` and `TQQQ` at 60 requests/minute.
- [x] **2026-07-21: Write PRD for historical options per-contract time series** — Define GCS-based storage, `partnerHistoricalOptionsContractV2` retrieval endpoint, two-phase ingestion pipeline, and daily incremental worker for `QQQ`/`TQQQ` from 2019 onward; captured in `docs/partner/options-data/historical-options-time-series-prd.md`.
- [ ] **2026-07-21: Review Cloud Functions architecture candidates** — Decide whether to approve a remediation plan for the identified Cloud Functions deepening opportunities; no implementation is authorized by the review.
- [x] **2026-07-23: Complete QQQ 2025 per-contract time-series backfill** — H1 (123/123 days, 55,458 contracts), Q3 (66/66 days, 24,294 contracts), and Q4 (64/64 days, 23,564 contracts) all completed with zero missing, corrupt, or failed contracts. `TQQQ` backfill remains pending.
  - [x] Document historical-options retrieval findings, target design, and prescribed phased fixes in `docs/partner/options-data/historical-options-retrieval-architecture.md`.
  - [x] Document all Cloud Functions architecture findings, prescribed fixes, sequencing, and acceptance criteria in `docs/project-plan/cloud-functions-architecture-remediation-plan.md`.
  - [x] Document the staged implementation plan in `docs/partner/options-data/qqq-tqqq-options-corpus-implementation-plan.md`.
  - [x] Produce the per-contract time-series PRD in `docs/partner/options-data/historical-options-time-series-prd.md` as input to the corpus approval decision.
  - [ ] Approve or reject the proposed GCS development corpus for `QQQ` and `TQQQ` from 2019 onward after Alpha Vantage licensing/quota, GCS retention/IAM, and shared-throttling decisions are confirmed; no implementation is authorized.
- [x] **2026-07-20: Create partner historical-options V2 as-built guide** — Document the endpoint's end-to-end request lifecycle, implementation paths, contract, tests, deployment prerequisites, and operational limits.
- [x] **2026-07-22: Implement and deploy `triggerHistoricalOptionsTimeSeriesBuild` and complete 2019–2024 QQQ per-contract time-series backfill** — Added `TimeSeriesBuilderService` with idempotent per-contract JSONL merge, progress logging, optional `contractID` filter, `DEFAULT_WRITE_CONCURRENCY` reduced to 20, GCS retry for `EPIPE`/`ECONNRESET`/`ETIMEDOUT`/`ECONNREFUSED`, and `timeoutSeconds` raised to 1200s; deployed and used to backfill QQQ 2019, 2020, 2021, 2022, 2023, and 2024.

# Tasks

## Completed

- [x] **2026-07-21: Implement QQQ/TQQQ historical-options GCS corpus** — Built the pure retrieval seam, GCS adapter, Firestore metadata/planner, Cloud Tasks seed worker, bounded pilot, Jest tests, and verified TypeScript compilation plus full test suite.
- [x] **2026-07-21: Apply historical-options review fixes** — Fixed `pilot.service.ts` yesterday ET calculation, defaulted `endpoint`/`message` in retrieval, routed partner through `HistoricalOptionsRetrievalService` with reused analysis, cleaned dead code (`av-api-key.utils.ts`, `GcsCorpusAdapter.exists`, `strategy-reader.service.ts`, `CorpusRunDoc.manifest`), removed handler debug banners, added focused tests, and updated relevant planning docs.
- [x] **2026-07-22: Create and update consumer discovery/usage docs for `partnerHistoricalOptionsContractV2`** — Added `docs/partner/options-data/historical-options-contract-v2-discovery.md` and `docs/partner/options-data/historical-options-contract-v2-usage.md`, and linked them from `docs/partner/options-data/historical-options-discovery.md`, `docs/partner/options-data/rs-historical-options-usage.md`, and `docs/partner/partner-discovery.md`.

## Active

- [x] **2026-07-23: Run 2026 QQQ per-contract time-series backfill** — Q1 (Jan–Mar, 61/61 days, 25,746 contracts) and Q2–Q4 (Apr–Jul 23, 76/78 days, 39,650 contracts) complete. Fixed safety-net flush bug in `TimeSeriesBuilderService` where unflushed chunks were silently dropped when the last trading date(s) had no corpus data. Zero errors, zero corrupt dates, 2 missing dates (future/unavailable).
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
- [x] **2026-07-26: Refactor Storage Viewer to dual-column layout** — Split `StorageViewerStore` into `CorpusViewerStore` and `TimeSeriesViewerStore`, extracted shared utilities to `viewer-utils.ts`, created `ContentSearchService` for global in-content search, created `CorpusViewerComponent` and `TimeSeriesViewerComponent` with side-by-side list+content panels, refactored `StorageViewerComponent` into thin layout wrapper with find bar, updated barrel exports and SCSS. `ng build` passes.
- [x] **2026-08-03: Refine `proj` skill system — naming, labels, lifecycle, commit format, and sub-skill split** — Renamed `project-topic` to `proj` throughout. Updated label taxonomy (FEATURE/CORE/PARTNER categories, BE/FE/SHARED areas, IMPL/BUG/REFACTOR/CHORE/CONFIG/DOCS types, DOMAIN labels). Standardized commit format to `NN-NN_AREA-TYPE-DOMAIN: Description` (no `#`, underscore separator). Split `proj-start.md` into `proj-plan.md`, `proj-blueprint.md`, `proj-implement.md` — one sub-skill per stage, no auto-detection. Refined lifecycle: Idea = capture only, Plan = flesh out + grill + PRD, Blueprint = grill implementation approach + implementation plans + test plans + `to-tickets`, Implement = TDD iteration loop. Created `persona.md` (flexible format) alongside legacy `15_PERSONA.md`. Updated `skill.md`, `GLOSSARY.md`, `REFERENCE.md`, `README.md`, `proj-skill-design.md`, `commit.md`, and all sub-skill files for consistency.

- [ ] **2026-07-27: Implement contract catalog — metadata, discovery & filtering** — Build Firestore `ts-contracts` subcollection with per-contract metadata (length, observations, greeks), `partnerContractCatalogV2` endpoint with summary/catalog modes, builder integration for daily writes, backfill script, and Firestore indexes. PRD: `docs/partner/options-data/contract-catalog-prd.md`.
  - [x] Phase 1: Shared types & constants (`shared/options/contract-catalog.types.ts`)
  - [x] Phase 2: Catalog writer (`contract-catalog.writer.ts`)
  - [x] Phase 3: Catalog query service (`contract-catalog-query.service.ts`)
  - [x] Phase 4: Summary aggregator (`contract-summary-aggregator.service.ts`)
  - [x] Phase 5: Builder integration (catalog writer wired into `writeMerged()`)
  - [x] Phase 6: Endpoint (`partner-contract-catalog-partner.ts`, registered in `index.ts`)
  - [x] Phase 7: Firestore indexes (`firestore.indexes.json`)
  - [x] Phase 8: Backfill script (`backfill-contract-catalog.ts`) — created with missing-metadata detection + repair
  - [ ] Phase 9: Scheduled summary refresh
  - [x] Phase 10: Firestore rules review (no changes needed — Admin SDK bypasses rules)

- [ ] **2026-07-28: Implement spread time series endpoint** — Build on-demand spread pricing engine that computes historical time series for multi-leg options positions (verticals, straddles, strangles, iron condors) from stored per-contract JSONL data. PRD: `docs/partner/options-data/spread-time-series-prd.md`. Implementation plan: `docs/partner/options-data/spread-time-series-implementation-plan.md`.
  - [ ] Phase 1: Single-spread endpoint (`POST /partnerSpreadTimeSeries`, sync)
    - [ ] Task 1.1: Shared types (`spread-request.types.ts`)
    - [ ] Task 1.2: OCC ID constructor (`occ-id-constructor.utils.ts`)
    - [ ] Task 1.3: Spread validator (`spread-validator.utils.ts`)
    - [ ] Task 1.4: Leg mark resolver (`leg-mark-resolver.utils.ts`)
    - [ ] Task 1.5: Spread pricing service (`spread-pricing.service.ts`)
    - [ ] Task 1.6: HTTP handler (`spread-time-series-partner.ts`)
    - [ ] Task 1.7: Register in `index.ts`
    - [ ] Task 1.8: Tests
    - [ ] Task 1.9: Post-deployment workflow
  - [ ] Phase 2: Batch endpoint (`POST /partnerSpreadTimeSeriesBatch`, sync, max 200)
  - [ ] Phase 3: Strategy scan (async, Cloud Tasks, GCS output)
  - [ ] Phase 4: Caching (GCS persistence)

## Discovered During Work

- [ ] **TECH-DEBT: Split diagnostic scripts exceeding 500-line limit** — `data-quality-detect.ts` (594 lines) needs decomposition: extract `detectStructuralIssues` into its own module and/or split `detectBsAnomalies` out. Apply app-wide as a tech debt effort to catch all instances of files over 500 lines.

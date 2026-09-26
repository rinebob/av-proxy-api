# Changelog

All notable changes to this project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [2026-09-26]

### Changed
- [Swing-Driven Options Corpus] 102-161_BE-IMPL-OPTIONS-DATA: Dates-only corpus swing doc + single dev2 config — SwingSetDoc stores pivotDates/currentExtreme (not pivot objects), one doc per symbol under CORPUS_ZIGZAG_CONFIG, planner reads it directly
- [Swing-Driven Options Corpus] 102-161_DOCS-OPTIONS-DATA: Slim-shape decision doc + backfill runbook; superseded notices on obsolete swing-set platform docs

### Removed
- [Swing-Driven Options Corpus] 102-161_BE-IMPL-OPTIONS-DATA: partnerSwingSetsV2 + CANONICAL_ZIGZAG_CONFIGS (ST keeps client-side zigzag; SA swing docs are corpus-internal)

### Added
- [Swing-Driven Options Corpus] 102-152_BE-IMPL-OPTIONS-DATA: Extract testable ts-build task core — handler seam (handleTsBuildTask) over injected deps so the Cloud Tasks path is unit-testable
- [Swing-Driven Options Corpus] 102-152_DOCS-OPTIONS-DATA: Add code review doc and changelog for task 152

## [2026-09-25]

### Added
- [Swing-Driven Options Corpus] 102-151_BE-IMPL-OPTIONS-DATA: Add swing-doc pivot planner (deduped confirmed + interim work items from 4 canonical swing docs)
- [Swing-Driven Options Corpus] 102-150_BE-IMPL-OPTIONS-DATA: Lift CorpusSymbol restriction + optionsEnabled gate on every corpus ingest entry point (seed/ts-build/nightly/pilot; gated items terminate 'skipped'; live enabled-set listing)
- [Swing-Driven Options Corpus] 102-144_FE-IMPL-OPTIONS-DATA: Wire Options Enabled checkbox to setOptionsEnabledV2 (optionable-gated, confirm dialog, store patch on success, revert + snackbar on error)
- [Swing-Driven Options Corpus] 102-144_DOCS-OPTIONS-DATA: Add code review doc for task 144
- [Swing-Driven Options Corpus] 102-142_BE-IMPL-OPTIONS-DATA: Add optionable/optionsEnabled filters to symbol list endpoints (in-memory sort under flag filters; no composite index)
- [Swing-Driven Options Corpus] 102-148_BE-IMPL-OPTIONS-DATA: Add post-deploy smoke script for swing-set platform (OIDC + admin-secret, read-only)
- [Swing-Driven Options Corpus] 102-141_BE-IMPL-OPTIONS-DATA: Add batch-enable admin script routing through the governed set-options-enabled core
- [Swing-Driven Options Corpus] 102-141_DOCS-OPTIONS-DATA: Add admin scripts README and code review doc
- [Swing-Driven Options Corpus] 102-140_BE-IMPL-OPTIONS-DATA: Add setOptionsEnabledV2 guarded curation callable + audit history and swing-set enqueue
- [Swing-Driven Options Corpus] 102-140_DOCS-OPTIONS-DATA: Add callable verification guide and code review doc

## [2026-09-24]

### Fixed
- [Repo & Deploy Hygiene] 118-119_CONFIG-CONFIG-OPS: Reconcile firestore.indexes.json with prod ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â file now tracks all 78 deployed indexes in CLI-export format
- [Repo & Deploy Hygiene] 118-119_TESTS-BUG-OPS: Fix relative path depth in contract-summary-aggregator test (pre-existing failure)

### Added
- [Repo & Deploy Hygiene] 118-119_BE-IMPL-OPS: Add ops-119-firestore-indexes drift verification script
- [Repo & Deploy Hygiene] 118-119_DOCS-DOCS-OPS: Index management guide, drift-check guide, code review doc, README updates

## [2026-09-23]

### Added
- [Swing-Driven Options Corpus] 102-122_SHARED-IMPL-OPTIONS-DATA: Port ZigZag engine into shared/zigzag
- [Swing-Driven Options Corpus] 102-122_SHARED-DOCS-OPTIONS-DATA: Add zigzag engine verification script and guide
- [Swing-Driven Options Corpus] 102-122_DOCS-OPTIONS-DATA: Add Topic 102 planning docs and terminology
- [Swing-Driven Options Corpus] 102-123_SHARED-IMPL-OPTIONS-DATA: Add swing-set types, paramsId, and canonical configs
- [Swing-Driven Options Corpus] 102-123_SHARED-DOCS-OPTIONS-DATA: Add swing-set types verification script and guide
- [Swing-Driven Options Corpus] 102-123_DOCS-OPTIONS-DATA: Add code review doc and changelog for task 123
- [Swing-Driven Options Corpus] 102-124_BE-IMPL-OPTIONS-DATA: Add swing-set data layer (repository + daily-adjusted reader)
- [Swing-Driven Options Corpus] 102-124_BE-DOCS-OPTIONS-DATA: Add data-layer verification script and guide
- [Swing-Driven Options Corpus] 102-124_DOCS-OPTIONS-DATA: Add code review doc and changelog for task 124
- [Swing-Driven Options Corpus] 102-125_BE-IMPL-OPTIONS-DATA: Add SwingSetGenerationService
- [Swing-Driven Options Corpus] 102-125_BE-DOCS-OPTIONS-DATA: Add generation verification script and guide
- [Swing-Driven Options Corpus] 102-125_DOCS-OPTIONS-DATA: Add code review doc and changelog for task 125
- [Swing-Driven Options Corpus] 102-126_BE-IMPL-OPTIONS-DATA: Add generateSwingSetsTask + optionsEnabled trigger
- [Swing-Driven Options Corpus] 102-126_BE-DOCS-OPTIONS-DATA: Add task-handler verification script and guide
- [Swing-Driven Options Corpus] 102-126_DOCS-OPTIONS-DATA: Add code review doc and changelog for task 126
- [Swing-Driven Options Corpus] 102-127_BE-IMPL-OPTIONS-DATA: Add sweepSwingSets scheduler + backfillSwingSets
- [Swing-Driven Options Corpus] 102-127_BE-DOCS-OPTIONS-DATA: Add sweep verification script and guide
- [Swing-Driven Options Corpus] 102-127_DOCS-OPTIONS-DATA: Add code review doc and changelog for task 127
- [Swing-Driven Options Corpus] 102-128_BE-IMPL-OPTIONS-DATA: Add partnerSwingSetsV2 partner endpoint
- [Swing-Driven Options Corpus] 102-128_BE-DOCS-OPTIONS-DATA: Add endpoint verify script + register partnerSwingSetsV2 in partner docs
- [Swing-Driven Options Corpus] 102-128_DOCS-OPTIONS-DATA: Add code review doc and changelog for task 128
- [Swing-Driven Options Corpus] 102-138_BE-IMPL-OPTIONS-DATA: Add OptionableProbeService + refactor backfill-optionable onto it
- [Swing-Driven Options Corpus] 102-138_DOCS-OPTIONS-DATA: Add code review doc, IMPL/TEST plans, verify script guide + changelog for task 138
- [Swing-Driven Options Corpus] 102-139_BE-IMPL-OPTIONS-DATA: Add ingestion flag defaults (saveTrackedSymbol) + onSymbolReady probe trigger
- [Swing-Driven Options Corpus] 102-139_DOCS-OPTIONS-DATA: Add code review doc and changelog for task 139
- [Add Company Overview Data to Symbol Manager] 88-97_BE-IMPL-SYMBOL-MANAGER: Add numeric marketCap/beta to companyInfo write-back
- [Add Company Overview Data to Symbol Manager] 88-97_BE-DOCS-SYMBOL-MANAGER: Add verification script and guide for companyInfo write-back
- [Add Company Overview Data to Symbol Manager] 88-97_DOCS-SYMBOL-MANAGER: Add code review doc and changelog for task 97
- [Add Company Overview Data to Symbol Manager] 88-98_BE-IMPL-SYMBOL-MANAGER: Add sortBy whitelist + composite indexes for listSymbolsV2
- [Add Company Overview Data to Symbol Manager] 88-98_BE-DOCS-SYMBOL-MANAGER: Add verification script and guide for sortable fields
- [Add Company Overview Data to Symbol Manager] 88-98_DOCS-SYMBOL-MANAGER: Add code review doc and changelog for task 98
- [Add Company Overview Data to Symbol Manager] 88-99_BE-IMPL-SYMBOL-MANAGER: Add companyInfo diff + backfill script (marketCap/beta onto tracked-symbols)
- [Add Company Overview Data to Symbol Manager] 88-99_BE-DOCS-SYMBOL-MANAGER: Add backfill verification guide
- [Add Company Overview Data to Symbol Manager] 88-99_DOCS-SYMBOL-MANAGER: Add code review doc and changelog for task 99
- [Add Company Overview Data to Symbol Manager] 88-100_FE-IMPL-SYMBOL-MANAGER: Add Sector/Industry/Market Cap/Beta columns to V2 table; drop region/timezone/currency/matchScore
- [Add Company Overview Data to Symbol Manager] 88-100_DOCS-SYMBOL-MANAGER: Add code review doc and changelog for task 100
- [Add Company Overview Data to Symbol Manager] 88-101_FE-IMPL-SYMBOL-MANAGER: Add multi-level client-side sort, fetch-cap guard, Optionable/Options Enabled columns, optionable probe backfill
- [Add Company Overview Data to Symbol Manager] 88-101_DOCS-SYMBOL-MANAGER: Add code review doc and changelog for task 101

## [2026-09-20]

### Added
- [Add Company Overview Data to Symbol Manager] 88-88_DOCS-SYMBOL-MANAGER: Add Topic 88 PRD, ADR 0001, and BE/FE impl + test plans (checkpoint)

## [2026-09-09]

### Added
- [Intraday Run Reliability] 63-68_DOCS-AV-ENDPOINTS: Add PRD, implementation plans, test plans, and code review for intraday run reliability
- [Intraday Run Reliability] 63-69_SHARED-IMPL-AV-ENDPOINTS: Implement MarketCalendarService
- [Intraday Run Reliability] 63-69_DOCS-AV-ENDPOINTS: Add code review doc for Task #69
- [Intraday Run Reliability] 63-70_DOCS-AV-ENDPOINTS: Add code review doc for Task #70
- [Intraday Run Reliability] 63-71_BE-IMPL-AV-ENDPOINTS: Add FAILED to PartnerRunStatus enum
- [Intraday Run Reliability] 63-71_DOCS-AV-ENDPOINTS: Add code review doc for Task #71
- [Intraday Run Reliability] 63-72_BE-IMPL-AV-ENDPOINTS: Add calendar gate to intraday scheduler
- [Intraday Run Reliability] 63-72_DOCS-AV-ENDPOINTS: Add code review doc for Task #72
- [Intraday Run Reliability] 63-73_BE-IMPL-AV-ENDPOINTS: Add self-healing for stale intraday runs
- [Intraday Run Reliability] 63-73_DOCS-AV-ENDPOINTS: Add code review doc for Task #73
- [Intraday Run Reliability] 63-75_BE-IMPL-AV-ENDPOINTS: Add integration tests for intraday scheduler + self-healing
- [Intraday Run Reliability] 63-75_DOCS-AV-ENDPOINTS: Add code review doc for Task #75
- [Intraday Run Reliability] 63-74_BE-IMPL-AV-ENDPOINTS: Add intraday PDR delivery watchdog
- [Intraday Run Reliability] 63-74_DOCS-AV-ENDPOINTS: Add code review doc for Task #74
- [Intraday Run Reliability] 63-76_BE-IMPL-AV-ENDPOINTS: Update watchdog test describe block to reference Task #76
- [Intraday Run Reliability] 63-76_DOCS-AV-ENDPOINTS: Add code review doc for Task #76

### Changed
- [Intraday Run Reliability] 63-68_SHARED-CHORE-AV-ENDPOINTS: Move market-holidays.data.ts to common/market-calendar/

## [2026-08-22]

### Added
- [AV SA Earnings Endpoints] 33-38_SHARED-IMPL-AV-SA-EARNINGS-ENDPOINTS: Add SavantApiEndpoint enum and earnings response types
- [AV SA Earnings Endpoints] 33-38_BE-IMPL-AV-SA-EARNINGS-ENDPOINTS: Add unit tests for SavantApiEndpoint enum and earnings types
- [AV SA Earnings Endpoints] 33-38_BE-DOCS-AV-SA-EARNINGS-ENDPOINTS: Add verification scripts and guides for earnings types
- [AV SA Earnings Endpoints] 33-38_DOCS-DOCS-AV-SA-EARNINGS-ENDPOINTS: Add code review doc for Task #38
- [AV SA Earnings Endpoints] 33-39_SHARED-CONFIG-AV-SA-EARNINGS-ENDPOINTS: Update earnings endpoint configs and implemented set
- [AV SA Earnings Endpoints] 33-39_BE-TEST-AV-SA-EARNINGS-ENDPOINTS: Add config tests for earnings endpoints
- [AV SA Earnings Endpoints] 33-39_BE-DOCS-AV-SA-EARNINGS-ENDPOINTS: Add verification script and guide for config changes
- [AV SA Earnings Endpoints] 33-39_DOCS-DOCS-AV-SA-EARNINGS-ENDPOINTS: Add code review doc for Task #39
- [AV SA Earnings Endpoints] 33-40_BE-IMPL-AV-SA-EARNINGS-ENDPOINTS: Add hand-rolled CSV parser utility for AV EARNINGS_CALENDAR
- [AV SA Earnings Endpoints] 33-40_BE-TEST-AV-SA-EARNINGS-ENDPOINTS: Add unit tests for CSV parser utility
- [AV SA Earnings Endpoints] 33-40_BE-DOCS-AV-SA-EARNINGS-ENDPOINTS: Add verification script and guide for CSV parser
- [AV SA Earnings Endpoints] 33-40_DOCS-DOCS-AV-SA-EARNINGS-ENDPOINTS: Add code review doc for Task #40
- [AV SA Earnings Endpoints] 33-41_BE-IMPL-AV-SA-EARNINGS-ENDPOINTS: Add AvEarningsHandler and fix AvReportTime type
- [AV SA Earnings Endpoints] 33-41_BE-TEST-AV-SA-EARNINGS-ENDPOINTS: Add unit tests for AvEarningsHandler
- [AV SA Earnings Endpoints] 33-41_BE-DOCS-AV-SA-EARNINGS-ENDPOINTS: Add verification script and guide for AvEarningsHandler
- [AV SA Earnings Endpoints] 33-41_DOCS-DOCS-AV-SA-EARNINGS-ENDPOINTS: Add code review doc for Task #41
- [AV SA Earnings Endpoints] 33-42_BE-IMPL-AV-SA-EARNINGS-ENDPOINTS: Add AvEarningsEstimatesHandler and fix horizon type
- [AV SA Earnings Endpoints] 33-42_BE-TEST-AV-SA-EARNINGS-ENDPOINTS: Add unit tests for AvEarningsEstimatesHandler
- [AV SA Earnings Endpoints] 33-42_BE-DOCS-AV-SA-EARNINGS-ENDPOINTS: Add verification script and guide for AvEarningsEstimatesHandler
- [AV SA Earnings Endpoints] 33-42_DOCS-DOCS-AV-SA-EARNINGS-ENDPOINTS: Add code review doc for Task #42
- [AV SA Earnings Endpoints] 33-43_BE-IMPL-AV-SA-EARNINGS-ENDPOINTS: Add AvEarningsCalendarHandler for CSV-based global earnings calendar
- [AV SA Earnings Endpoints] 33-43_BE-TEST-AV-SA-EARNINGS-ENDPOINTS: Add unit tests for AvEarningsCalendarHandler
- [AV SA Earnings Endpoints] 33-43_BE-DOCS-AV-SA-EARNINGS-ENDPOINTS: Add verification script and guide for AvEarningsCalendarHandler
- [AV SA Earnings Endpoints] 33-43_DOCS-DOCS-AV-SA-EARNINGS-ENDPOINTS: Add code review doc for Task #43
- [AV SA Earnings Endpoints] 33-44_BE-IMPL-AV-SA-EARNINGS-ENDPOINTS: Register earnings handlers in factory + fix refresh manager for global endpoints
- [AV SA Earnings Endpoints] 33-44_BE-TEST-AV-SA-EARNINGS-ENDPOINTS: Add unit tests for factory registration and isGlobalEndpoint helper
- [AV SA Earnings Endpoints] 33-44_BE-DOCS-AV-SA-EARNINGS-ENDPOINTS: Add verification script and guide for factory registration + refresh manager fix
- [AV SA Earnings Endpoints] 33-44_DOCS-DOCS-AV-SA-EARNINGS-ENDPOINTS: Add code review doc for Task #44
- [AV SA Earnings Endpoints] 33-44_FE-IMPL-AV-SA-EARNINGS-ENDPOINTS: Add AV earnings endpoint support to SA Data Maintainer page
- [AV SA Earnings Endpoints] 33-44_FE-TEST-AV-SA-EARNINGS-ENDPOINTS: Add Karma/Jasmine tests for earnings endpoint frontend support
- [AV SA Earnings Endpoints] 33-44_DOCS-DOCS-AV-SA-EARNINGS-ENDPOINTS: Add code review doc for frontend earnings endpoint support

### Changed
- [PT PDR Rate Limit Fixes] 47-51_BE-REFACTOR-AV-ENDPOINTS: Migrate time-series schedulers from ET to PT and remove deprecated no-op schedulers
- [PT PDR Rate Limit Fixes] 47-51_BE-CHORE-AV-ENDPOINTS: Tune Cloud Tasks rate limits and remove redundant job delay

### Fixed
- [PT PDR Rate Limit Fixes] 47-51_BE-BUGFIX-AV-ENDPOINTS: Fix duplicate PDR messages with atomic run completion claim

### Added
- [PT PDR Rate Limit Fixes] 47-51_DOCS-DOCS-AV-ENDPOINTS: Add Topic #47 docs (PRD, IMPL, TEST, code review)

## [2026-08-18]

### Added
- [SA UI HT Endpoint Integration] 17-27_BE-IMPL-AV-ENDPOINTS: Accept Firebase user auth for technical indicators endpoint
- [SA UI HT Endpoint Integration] 17-27_FE-IMPL-AV-ENDPOINTS: Apply review fixes and add integration tests for Hilbert Transform indicators
- [SA UI HT Endpoint Integration] 17-27_DOCS-AV-ENDPOINTS: Add code review doc for Tasks #24-27 batched review

### Changed
- [SA UI HT Endpoint Integration] 17-27_CHORE-AV-ENDPOINTS: Remove @topic tags from shipped files

## [2026-08-16]

### Added
- [SA UI HT Endpoint Integration] 17-23_FE-IMPL-AV-ENDPOINTS: Add partner endpoint config and shared enums
- [SA UI HT Endpoint Integration] 17-23_FE-IMPL-AV-ENDPOINTS: Add TechnicalIndicatorsService with unit tests
- [SA UI HT Endpoint Integration] 17-23_DOCS-AV-ENDPOINTS: Add PRD, IMPL, TEST, and CODE-REVIEW docs for Topic #17
- [SA UI HT Endpoint Integration] 17-24_FE-IMPL-AV-ENDPOINTS: Refactor ChartViewStore with IndicatorState and fetch logic
- [SA UI HT Endpoint Integration] 17-24_FE-IMPL-AV-ENDPOINTS: Consolidate local HT calc toggles into single control
- [SA UI HT Endpoint Integration] 17-24_DOCS-AV-ENDPOINTS: Add code review doc for Task #24
- [SA UI HT Endpoint Integration] 17-25_FE-IMPL-AV-ENDPOINTS: Add indicator toggles, series_type dropdown, and sine display mode
- [SA UI HT Endpoint Integration] 17-25_DOCS-AV-ENDPOINTS: Add code review doc for Task #25
- [SA UI HT Endpoint Integration] 17-26_FE-IMPL-AV-ENDPOINTS: Add multi-pane chart layout for endpoint indicators
- [SA UI HT Endpoint Integration] 17-26_DOCS-AV-ENDPOINTS: Add code review doc for Task #26

### Fixed
- [SA UI HT Endpoint Integration] 17-23_FE-CHORE-AV-ENDPOINTS: Fix pre-existing test infrastructure bugs

### Changed
- [SA UI HT Endpoint Integration] 17-23_CHORE-AV-ENDPOINTS: Remove @topic tags from shipped files
- [SA UI HT Endpoint Integration] 17-24_CHORE-AV-ENDPOINTS: Remove @topic tags from shipped files
- [SA UI HT Endpoint Integration] 17-25_CHORE-AV-ENDPOINTS: Remove @topic tags from shipped files
- [SA UI HT Endpoint Integration] 17-25_CHORE-AV-ENDPOINTS: Add .devin/mcp_config.local.json to gitignore
- [SA UI HT Endpoint Integration] 17-26_CHORE-AV-ENDPOINTS: Remove @topic tags from shipped files

## [2026-08-15]

### Added
- [Alpha Vantage Endpoint Expansion] 5-12_DOCS-AV-ENDPOINTS: Add Hilbert Transform PRD, implementation plan, and test plan
- [Alpha Vantage Endpoint Expansion] 5-12_BE-IMPL-AV-ENDPOINTS: Add Hilbert Transform enum entries and endpoint configs
- [Alpha Vantage Endpoint Expansion] 5-12_BE-IMPL-AV-ENDPOINTS: Add technical indicators config module and barrel export
- [Alpha Vantage Endpoint Expansion] 5-12_BE-TEST-AV-ENDPOINTS: Add unit and consistency tests for Hilbert Transform config
- [Alpha Vantage Endpoint Expansion] 5-12_DOCS-AV-ENDPOINTS: Add code review doc for Hilbert Transform config
- [Alpha Vantage Endpoint Expansion] 5-13_BE-IMPL-AV-ENDPOINTS: Add technical-indicators partner endpoint with typed error mapping
- [Alpha Vantage Endpoint Expansion] 5-13_BE-TEST-AV-ENDPOINTS: Add unit tests for technical-indicators partner endpoint
- [Alpha Vantage Endpoint Expansion] 5-13_DOCS-AV-ENDPOINTS: Add code review doc for technical-indicators partner endpoint
- [Alpha Vantage Endpoint Expansion] 5-14_BE-IMPL-AV-ENDPOINTS: Export technical-indicators partner endpoint and update inventory
- [Alpha Vantage Endpoint Expansion] 5-14_DOCS-AV-ENDPOINTS: Add code review doc for Task #14

### Changed
- [Alpha Vantage Endpoint Expansion] 5-13_CHORE-AV-ENDPOINTS: Remove @topic tags from shipped files
- [Alpha Vantage Endpoint Expansion] 5-14_CHORE-AV-ENDPOINTS: Remove @topic tags from shipped files

# Changelog

All notable changes to this project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [2026-09-09]

### Added
- [Intraday Run Reliability] 63-68_DOCS-AV-ENDPOINTS: Add PRD, implementation plans, test plans, and code review for intraday run reliability

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

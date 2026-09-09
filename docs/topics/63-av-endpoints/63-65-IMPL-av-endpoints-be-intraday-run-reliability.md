**Topic:** Fix Intraday PRE Delivery Reliability  
**Topic Slug:** intraday-run-reliability  
**Issue:** #65  
**Topic Parent:** #63  
**Domain:** AV-ENDPOINTS  
**Type:** Implementation Plan  
**Status:** Complete  
**Created:** 2026-09-09  
**Last Updated:** 2026-09-09  

## Area: BE

## Modules

### Calendar gate (modify existing)

File: `functions/src/v2/alpha-vantage/data-refresher/av-time-series-refresh-manager.ts`

In `runIntradaySnapshotJobsForSymbols`, replace the existing inline weekend guard with a call to `MarketCalendarService.isMarketOpenAt(marketDate, clockPt)`. If the market is closed (holiday, weekend, or post-early-close), log and return immediately — no jobs created, no run doc written.

This gate applies to both scheduled and manual invocations since it lives in the shared `runIntradaySnapshotJobsForSymbols` function.

### Self-healing (modify existing)

File: `functions/src/v2/alpha-vantage/data-refresher/av-time-series-refresh-manager.ts`

Before creating jobs for a new tick, query `intraday-runs` for any IN_PROGRESS run from a previous tick on the same market date. If found:

1. Force-complete the stale run (set status to COMPLETE, stamp `staleRun: true`)
2. Publish a PDR with `runStatus: FAILED` so consumers are notified
3. Proceed with creating jobs for the new tick

### PartnerRunStatus extension (modify existing)

File: `functions/src/v2/partner/constants.ts`

Add `FAILED = 'failed'` to the `PartnerRunStatus` enum. This is used by the self-healing path to signal that a stale run failed, not completed with errors. Consumers can handle this explicitly.

### Alerting watchdog (new)

Location: `functions/src/v2/alpha-vantage/intraday-watchdog/`

New scheduled function `intradayPdrWatchdog` that fires at 0815, 1015, and 1215 PT (15 minutes after each tick). For each tick:

1. Query Firestore for the intraday run doc matching the tick's market date and clockPt
2. If the run doc doesn't exist → alert (scheduler didn't fire)
3. If the run doc exists but `partnerDataReady.messageSent !== true` → alert (PDR not published)
4. If the run doc exists and `partnerDataReady.messageSent === true` → silent (OK)

The alert is a Cloud Logging alert (structured log at ERROR level with runId, clockPt, marketDate, and alert reason). This feeds the existing Cloud Logging alerting infrastructure without requiring a new UI.

The watchdog also writes a health doc to Firestore (`intraday-health/{marketDate}-{clockPt}`) with the tick status, PDR delivery state, and alert state. This is consumable by the future Run Status Dashboard (Topic #61).

## Phases

### Phase 1: MarketCalendarService + tests (SHARED)

- Create `common/market-calendar/` directory
- Move `market-holidays.data.ts` from `partner/` to `common/market-calendar/`
- Update import in `partner/market-holidays-partner.ts`
- Implement `MarketCalendarService` with `isTradingDay`, `isMarketOpenAt`, `getEarlyCloseEt`, year-coverage guard
- Write unit tests for `MarketCalendarService`

### Phase 2: Calendar gate + self-healing + tests (BE)

- Add `FAILED` to `PartnerRunStatus` enum
- Replace weekend guard in `runIntradaySnapshotJobsForSymbols` with `MarketCalendarService.isMarketOpenAt()`
- Add stale-run detection and force-completion before job creation
- Publish PDR with `runStatus: FAILED` for stale runs
- Write integration tests for the scheduler (skip holidays, create jobs on trading days, force-complete stale runs)

### Phase 3: Alerting watchdog + tests (BE)

- Create `intraday-watchdog/` directory
- Implement `intradayPdrWatchdog` scheduled function
- Write Firestore health docs for dashboard consumption
- Write unit tests for the watchdog (alert when PDR missing, silent when delivered, alert when run doc missing)

## Dependencies

- Phase 1 must complete before Phase 2 (calendar gate depends on MarketCalendarService)
- Phase 2 must complete before Phase 3 (watchdog depends on stable run doc structure)
- No cross-area dependencies (no FE work)

## Risks

- The self-healing force-completion writes to the same run doc as the aggregator. Must use a transaction to avoid race conditions if a late job terminal callback arrives during force-completion.
- The watchdog runs 15 minutes after each tick. If a run takes longer than 15 minutes (degraded but not broken), the watchdog will alert even though the run eventually completes. This is acceptable — a 15+ minute run is a problem worth alerting on.
- Adding `FAILED` to `PartnerRunStatus` is a payload change. Consumers (rel-str) must handle the new value. Since the receiver already rejects `intraday` intervals, this is not a regression — it's a new value for a new code path.

**Topic:** Fix Intraday PRE Delivery Reliability  
**Topic Slug:** intraday-run-reliability  
**Issue:** #66  
**Task:** #74  
**Topic Parent:** #63  
**Domain:** AV-ENDPOINTS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-10  
**Last Updated:** 2026-09-10  

## Summary

Task #74 adds the intraday PDR delivery watchdog — a scheduled function that fires 15 minutes after each intraday tick (0815, 1015, 1215 PT) to verify that the tick's run doc exists and that the Partner Data Ready (PDR) message was sent. Alerts via ERROR-level log and writes a health doc to `intraday-health/{marketDate}-{clockPt}` for consumption by the future Run Status Dashboard (Topic #61). 8 unit tests cover all acceptance criteria.

## Standards

- File size: 189 lines (impl) + 212 lines (test) — within limits.
- Single responsibility: the module has one purpose — verify PDR delivery for a tick and record the result.
- No dead code: all imports are used. Exported types are consumed by the test.
- Consistent patterns: follows existing patterns (`betterLogger`, `onSchedule`, `FirestoreCollection`, `getIntradaySkipReason`, `clockPtNow`).
- Clean type contracts: `IntradayWatchdogTickStatus`, `IntradayWatchdogPdrState`, `IntradayWatchdogAlertState` are well-documented exported types.
- Security defaults: no secrets needed (watchdog only reads Firestore, no API calls).

### Nit (not blocking)

The runId construction logic (`marketDate` → DOW → `{marketDate}-{DOW}-LIVE-{clockPt}`) is duplicated between `av-time-series-refresh-manager.ts` and `intraday-pdr-watchdog.ts`. Both modules construct the same runId string from the same inputs using the same DOW_ENUM array. A shared `buildIntradayRunId(marketDate, clockPt)` helper would eliminate this duplication. This is a nit because the logic is simple, stable, and unlikely to change; extracting it is a good refactor but out of scope for this task.

## Spec

Acceptance criteria from task #74:

- [x] `intradayPdrWatchdog` scheduled function fires at 0815, 1015, 1215 PT — **met** (schedule: `'15 8,10,12 * * 1-5'`, timeZone: `America/Los_Angeles`)
- [x] Silent when run doc exists and `partnerDataReady.messageSent === true` — **met** (no ERROR log, health doc written with `tickStatus: 'ok'`)
- [x] ERROR-level log when run doc exists but `partnerDataReady.messageSent !== true` — **met** (`logger.error('intraday.watchdog.pdr_missing', ...)`, health doc with `tickStatus: 'pdr_missing'`)
- [x] ERROR-level log when run doc does not exist (scheduler didn't fire) — **met** (`logger.error('intraday.watchdog.run_missing', ...)`, health doc with `tickStatus: 'run_missing'`)
- [x] Writes health doc to `intraday-health/{marketDate}-{clockPt}` with tick status, PDR state, and alert state — **met** (doc ID: `{marketDate}-{clockPt}`, fields: `marketDate`, `clockPt`, `runId`, `tickStatus`, `pdrState`, `alertState`, `checkedAt`)
- [x] Health doc is consumable by future Run Status Dashboard (Topic #61) — **met** (structured doc with clear, typed fields; `alertState` enables filtering for alerts)
- [x] Build passes — **met**

No Spec findings.

## Thermo-nuclear

- Abstraction quality: `checkIntradayPdrDelivery` is cleanly separated from the `onSchedule` wrapper, making the core logic testable without triggering the scheduler. Good seam.
- File size: fine.
- Spaghetti detection: no spaghetti. Clear linear flow: calendar gate → construct runId → query run doc → determine status → write health doc.
- Code judo: the watchdog reuses the existing `getIntradaySkipReason` calendar gate, which is the right seam — no calendar logic is duplicated.
- `mapWatchdogFireToTick` design: uses hour-based mapping (`08` → `0800`, `10` → `1000`, `12` → `1200`) rather than exact HHMM matching. This is resilient to Cloud Scheduler firing a few seconds/minutes off. Good design.
- No `secrets` on the `onSchedule` config: correct — the watchdog only reads Firestore, no API calls needed.
- Test quality: tests mock Firestore at the module level. Calendar gate uses real static data (no mocking needed), which means the tests exercise the real calendar logic end-to-end. Tests verify both the alert logic (ERROR logs, health doc content) and the doc paths.
- Edge cases: holiday, weekend, post-early-close, PDR sent, PDR not sent, run doc missing — all covered.

No Thermo-nuclear findings.

## Test results

- Unit tests: 8/8 passed
- Build: PASS

## Verdict: PASS

No critical, major, or minor findings. One nit (runId construction duplication) noted but not blocking. All acceptance criteria met. Tests pass and build passes. The watchdog is cleanly separated, reuses the calendar gate, and writes structured health docs consumable by the future dashboard.

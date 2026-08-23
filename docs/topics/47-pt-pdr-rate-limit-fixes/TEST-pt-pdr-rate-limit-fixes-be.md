**Topic:** Update PDR message, migrate to PT timezone and consolidate schedules
**Issue:** #49 (Plan)
**Topic Parent:** #47
**Domain:** AV-ENDPOINTS
**Type:** TEST
**Status:** Complete
**Created:** 2026-08-22
**Last Updated:** 2026-08-22

# TEST: PT Timezone Migration, PDR Fix, and Rate Limit Tuning

## E2E journeys

- **Scheduler fires at PT times:** Deploy and observe that `refreshAvTimeSeriesPostAllIntervals` fires at 13:35 PT (not 16:35 ET). Verify run IDs contain PT clock labels (e.g. `1335`, `1800`, `0400`).
- **Single PDR per run:** Trigger a run with multiple symbols. Verify exactly one PDR message is published to `partner-data-ready`, even when multiple workers finish concurrently.
- **Rate limit throughput:** Observe Cloud Tasks dispatch rate in GCP console — should be ~1.2/sec (72/min), not 1.0/sec.

## Integration boundaries

- RunIdFactory ↔ time-series-refresh-manager: clockEt→clockPt rename must be consistent across both
- function-schedules.ts ↔ infer-trigger-for-logs.ts: removed constants must not be referenced anywhere
- index.ts exports ↔ deployed functions: removed exports must not be referenced by GCP

## Unit test targets

- `RunIdFactory.createRealtime()` — accepts `clockPt`, rejects missing/invalid `clockPt`
- `RunIdFactory.parseRealtimeRunId()` — returns `clockPt` field
- `RunIdFactory.isValidRealtimeRunId()` — validates format with PT clock labels
- `CLOUD_TASKS_RATE_LIMITS.maxDispatchesPerSecond` === 1.2
- `JOB_EXECUTION_DELAY_MS` === 0

## Test seams

- RunIdFactory is a pure function — testable without Firestore
- Rate limit constants are exported — testable by import
- Atomic completion claim is transactional — requires Firestore emulator for integration test

## Edge cases

- Two workers finish last job simultaneously — only one publishes PDR
- Reconcile path triggers after fast path already completed — skips PDR
- Run doc doesn't exist when transaction reads it — transaction no-ops, no PDR
- Deprecated schedule constant referenced by external script — would fail at import time (catches stale references)
